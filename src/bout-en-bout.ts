import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { file, api_calls } from '@kittycad/lib';
import type { InputFormat3d, System } from '@kittycad/lib';
import { createZooClient } from './zoo-client.js';
import { parseObjVertices } from './mesh/obj.js';
import { buildPoses } from './geometrie/poses.js';
import { placeForPose } from './geometrie/placement.js';
import { study, savings } from './moteur/etude.js';
import { crateBoxes } from './engine/caisse.js';
import { blockingBoxes } from './engine/calage.js';
import { machineProfile } from './geometrie/tranches.js';
import { EngineSession } from './engine/session.js';
import { createBoxesBatched } from './engine/scene.js';
import { gltfSizeMm } from './mesh/gltf.js';

/**
 * La chaîne complète, chronométrée poste par poste (PROJECT.md §14).
 *
 *     STEP client → Zoo lit → notre code mesure et décide → Zoo construit → STEP
 *
 * L'objet n'est pas de faire joli : c'est de savoir **où passe le temps**, et de
 * pouvoir l'écrire dans le README sans arrondir. La promesse des trente
 * secondes se mesure avant de s'écrire.
 *
 * Usage : tsx src/bout-en-bout.ts [fichier.step] [masse_kg]
 */

const ZOO_COORDS: System = {
  forward: { axis: 'y', direction: 'negative' },
  up: { axis: 'z', direction: 'positive' },
};

const path = process.argv[2] ?? 'fixtures/machine-demo.step';
const massKg = Number(process.argv[3] ?? 2350);

const chrono: Array<{ poste: string; ms: number; ou: 'Zoo' | 'nous' }> = [];
const mesurer = async <T>(poste: string, ou: 'Zoo' | 'nous', f: () => Promise<T> | T): Promise<T> => {
  const t = performance.now();
  const r = await f();
  chrono.push({ poste, ms: performance.now() - t, ou });
  return r;
};

const client = createZooClient();
const total0 = performance.now();

/* 1 ─ Zoo lit le STEP du client ------------------------------------------- */

const bytes = await readFile(path);

const objText = await mesurer('lecture du STEP (File Format API)', 'Zoo', async () => {
  const started = await file.create_file_conversion_options({
    client,
    files: [{ name: basename(path), data: new Blob([new Uint8Array(bytes)]) }],
    body: {
      src_format: { type: 'step', split_closed_faces: false },
      output_format: { type: 'obj', coords: ZOO_COORDS, units: 'mm' },
    },
  });
  if ('error_code' in (started as object)) throw new Error(JSON.stringify(started).slice(0, 200));

  let op: { status: string; outputs?: Record<string, string>; error?: string } = started as never;
  while (['queued', 'uploaded', 'in_progress'].includes(op.status)) {
    await new Promise((r) => setTimeout(r, 1500));
    op = (await api_calls.get_async_operation({ client, id: started.id })) as never;
  }
  if (op.status !== 'completed' || !op.outputs) throw new Error(op.error ?? op.status);
  return Buffer.from(Object.values(op.outputs)[0] as string, 'base64').toString('utf8');
});

/* 2 ─ notre code mesure et décide ------------------------------------------ */

const cloud = await mesurer('lecture du maillage', 'nous', () => parseObjVertices(objText));
const geometry = await mesurer('emprises et poses', 'nous', () => buildPoses(cloud, 'z', 'auto'));
const result = await mesurer('caisse, verdicts, coûts', 'nous', () =>
  study({ poses: geometry.poses, massKg })
);

const pose = result.best ?? result.poses[1]!;
const index = ['A', 'B', 'C'].indexOf(pose.pose);
const axis = geometry.oriented[index === -1 ? 0 : index]!;
const floorTop = pose.crate.skid.heightMm + pose.crate.floorThicknessMm;
const placement = placeForPose(cloud, axis.axis, axis.footprint.yawDeg, geometry.unit.scale, floorTop);
const boxes = [
  ...crateBoxes(pose.crate),
  ...blockingBoxes(pose.crate, machineProfile(cloud, axis.axis, placement, geometry.unit.scale, floorTop)),
];

/* 3 ─ Zoo construit la caisse et ressort le STEP --------------------------- */

const session = await mesurer('ouverture de session (Engine API)', 'Zoo', () => EngineSession.open());
await mkdir('out', { recursive: true });

try {
  const machineId = await mesurer('import du STEP en b-rep', 'Zoo', async () => {
    const { resp } = await session.send(
      {
        type: 'import_files',
        files: [{ path: basename(path), data: bytes as unknown as number[] }],
        format: { type: 'step', split_closed_faces: false } as InputFormat3d,
      },
      900_000
    );
    if (resp.type !== 'modeling' || resp.data.modeling_response.type !== 'import_files') {
      throw new Error(`réponse ${resp.type}`);
    }
    return resp.data.modeling_response.data.object_id;
  });

  await mesurer('mise en pose de la machine', 'Zoo', () =>
    session.send({
      type: 'set_object_transform',
      object_id: machineId,
      transforms: [
        {
          rotate_angle_axis: {
            property: {
              x: placement.rotationAxis[0],
              y: placement.rotationAxis[1],
              z: placement.rotationAxis[2],
              w: placement.rotationAngleDeg,
            },
            set: false,
          },
          translate: {
            property: {
              x: placement.translateMm[0],
              y: placement.translateMm[1],
              z: placement.translateMm[2],
            },
            set: false,
          },
        },
      ],
    })
  );

  const crateIds = await mesurer('construction de la caisse en b-rep', 'Zoo', () =>
    createBoxesBatched(session, boxes)
  );

  const ids = [machineId, ...crateIds];

  const step = await mesurer('export du STEP commun', 'Zoo', async () => {
    const { resp } = await session.send(
      { type: 'export', entity_ids: ids, format: { type: 'step', coords: ZOO_COORDS, created: undefined } },
      600_000
    );
    if (resp.type !== 'export') throw new Error(`réponse ${resp.type}`);
    return Buffer.from(resp.data.files[0]!.contents as unknown as Uint8Array);
  });
  await writeFile('out/bout-en-bout.step', step);

  const gltf = await mesurer('export du glTF pour le viewer', 'Zoo', async () => {
    const { resp } = await session.send(
      { type: 'export', entity_ids: ids, format: { type: 'gltf', storage: 'embedded', presentation: 'compact' } },
      600_000
    );
    if (resp.type !== 'export') throw new Error(`réponse ${resp.type}`);
    return Buffer.from(resp.data.files[0]!.contents as unknown as Uint8Array);
  });
  await writeFile('out/bout-en-bout.gltf', gltf);

  /* 4 ─ le compte rendu ---------------------------------------------------- */

  const totalMs = performance.now() - total0;
  const zooMs = chrono.filter((c) => c.ou === 'Zoo').reduce((a, c) => a + c.ms, 0);
  const nousMs = chrono.filter((c) => c.ou === 'nous').reduce((a, c) => a + c.ms, 0);

  console.log(`\n${path} — ${(bytes.length / 1024).toFixed(0)} Ko, ${cloud.count} sommets, ${massKg} kg\n`);
  for (const c of chrono) {
    const barre = '█'.repeat(Math.max(1, Math.round((c.ms / totalMs) * 40)));
    console.log(
      `  ${c.poste.padEnd(38)} ${(c.ms / 1000).toFixed(2).padStart(6)} s  ${c.ou.padEnd(5)} ${barre}`
    );
  }

  console.log(`\n  ${'total'.padEnd(38)} ${(totalMs / 1000).toFixed(2).padStart(6)} s`);
  console.log(`  ${'dont Zoo'.padEnd(38)} ${(zooMs / 1000).toFixed(2).padStart(6)} s  ${((zooMs / totalMs) * 100).toFixed(0)} %`);
  console.log(`  ${'dont notre code'.padEnd(38)} ${(nousMs / 1000).toFixed(2).padStart(6)} s  ${((nousMs / totalMs) * 100).toFixed(0)} %`);

  const controle = gltfSizeMm(JSON.parse(gltf.toString('utf8')));
  const eco = savings(result);
  console.log(
    `\n  ${pose.label} — ${pose.retained?.gabarit.label ?? 'hors gabarit'}, ` +
      `${pose.costing.totalEur.toLocaleString('fr-FR')} €, ${pose.costing.leadTimeDays} j` +
      (eco ? `, soit ${eco.eur.toLocaleString('fr-FR')} € et ${eco.days} jours économisés` : '')
  );
  console.log(
    `  out/bout-en-bout.step — ${(step.length / 1024 / 1024).toFixed(2)} Mo, machine + caisse, ` +
      `${controle ? controle.map((v) => Math.round(v)).join(' × ') : '?'} mm`
  );
} finally {
  await session.close();
}
