import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import type { InputFormat3d, System } from '@kittycad/lib';
import { EngineSession } from './engine/session.js';
import { createBoxesBatched } from './engine/scene.js';
import { crateBoxes, boxesEnvelope } from './engine/caisse.js';
import { parseObjVertices } from './mesh/obj.js';
import { compactObj, BSON_MAX_BYTES } from './mesh/compacter.js';
import { gltfSizeMm } from './mesh/gltf.js';
import { buildPoses } from './geometrie/poses.js';
import { placeForPose } from './geometrie/placement.js';
import type { Axis } from './geometrie/emprise.js';
import type { UnitChoice } from './geometrie/unites.js';
import { study } from './moteur/etude.js';

/**
 * Étape 4 : la caisse générée autour de la machine, dans une scène Zoo, et le
 * STEP commun (PROJECT.md §4, §7.3).
 *
 * C'est ici que le projet devient un showcase Zoo et non un script : la
 * géométrie produite est **la conséquence d'une autre géométrie**. On consomme
 * la CAO du client, on mesure, on calcule, on construit autour, et on ressort
 * du STEP qui rentre dans son PLM.
 *
 * Usage : tsx src/scene-cli.ts <fichier.obj> <masse_kg> [--pose=A|B|C]
 *                              [--up=z] [--unit=auto] [--mode=maritime|route]
 *                              [--sans-machine] [--brep=<fichier.stp>]
 *
 * `--brep` fait entrer la machine par son **STEP** plutôt que par son maillage.
 * C'est la seule voie vers le STEP commun machine + caisse du §7.3, puisqu'un
 * maillage importé n'est pas réexportable (FEEDBACK.md #8). Le moteur ne sait
 * pas lire tous les STEP — pas celui du KUKA (#5) — d'où l'option plutôt que le
 * comportement par défaut.
 */

const OUT_DIR = 'out';

const ZOO_COORDS: System = {
  forward: { axis: 'y', direction: 'negative' },
  up: { axis: 'z', direction: 'positive' },
};

const [, , path, massArg] = process.argv;
if (!path || !massArg) {
  console.error('Usage : tsx src/scene-cli.ts <fichier.obj> <masse_kg> [--pose=B] [--mode=route]');
  process.exit(1);
}

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const massKg = Number(massArg);
const withMachine = !process.argv.includes('--sans-machine');
const brepPath = process.argv.find((a) => a.startsWith('--brep='))?.split('=')[1];
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/* ------------------------------------------------------- calcul, hors Zoo */

const objText = await readFile(path, 'utf8');
const cloud = parseObjVertices(objText);
const geometry = buildPoses(cloud, arg('up', 'z') as Axis, arg('unit', 'auto') as UnitChoice);
const result = study({
  poses: geometry.poses,
  massKg,
  mode: arg('mode', 'maritime') as 'maritime' | 'route',
});

// Pose retenue : celle demandée, sinon la meilleure trouvée, sinon la plus
// compacte. On ne construit jamais « rien » : même hors gabarit, la caisse
// existe et se regarde.
const wanted = arg('pose', result.best?.pose ?? 'A');
const pose = result.poses.find((p) => p.pose === wanted) ?? result.poses[1]!;
const poseIndex = ['A', 'B', 'C'].indexOf(pose.pose);
const axis = geometry.oriented[poseIndex === -1 ? 0 : poseIndex]!;

const crate = pose.crate;
const boxes = crateBoxes(crate);
const envelope = boxesEnvelope(boxes);

const floorTopMm = crate.skid.heightMm + crate.floorThicknessMm;
const placement = placeForPose(cloud, axis.axis, axis.footprint.yawDeg, geometry.unit.scale, floorTopMm);

console.log(`${path} — ${cloud.count.toLocaleString('fr-FR')} sommets`);
console.log(`${geometry.unit.note}`);
console.log(`\nPose retenue : ${pose.label}`);
console.log(`  machine  ${placement.size.map((v) => Math.round(v)).join(' × ')} mm`);
console.log(`  caisse   ${envelope.size.map((v) => Math.round(v)).join(' × ')} mm  (${boxes.length} pavés)`);
console.log(
  `  verdict  ${pose.retained ? pose.retained.gabarit.label : 'hors gabarit'} — ${pose.costing.totalEur.toLocaleString('fr-FR')} €, ${pose.costing.leadTimeDays} j`
);

/* ------------------------------------------------------------- scène Zoo */

async function openWithRetry(attempts = 3): Promise<EngineSession> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await EngineSession.open();
    } catch (err) {
      last = err;
      console.log(`  tentative ${i}/${attempts} refusée : ${err instanceof Error ? err.message : err}`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

await mkdir(OUT_DIR, { recursive: true });

console.log('\nScène Zoo');
const session = await openWithRetry();
const entityIds: string[] = [];

try {
  // La machine, si elle entre. Le moteur refuse le STEP d'origine (FEEDBACK #5) ;
  // on lui donne donc le maillage déjà converti par la File Format API.
  if (withMachine) {
    const t = performance.now();
    try {
      let payload: Buffer;
      let importFormat: InputFormat3d;

      if (brepPath) {
        // Voie b-rep : le STEP du client entre tel quel. C'est la seule qui
        // permet de le réexporter avec la caisse dans un même fichier.
        payload = await readFile(brepPath);
        importFormat = { type: 'step', split_closed_faces: false };
        console.log(`  STEP b-rep                 ${(payload.length / 1024 / 1024).toFixed(1)} Mo`);
      } else {
        // Voie maillage : l'OBJ brut dépasse la limite de document BSON, on
        // retire les normales que le moteur recalcule. Voir mesh/compacter.ts.
        const compact = compactObj(objText);
        console.log(
          `  maillage compacté          ${(compact.beforeBytes / 1024 / 1024).toFixed(1)} → ${(compact.afterBytes / 1024 / 1024).toFixed(1)} Mo  (${compact.vertices.toLocaleString('fr-FR')} sommets, ${compact.faces.toLocaleString('fr-FR')} faces)`
        );
        if (compact.afterBytes > BSON_MAX_BYTES) {
          throw new Error(
            `maillage encore trop lourd pour une trame BSON : ${(compact.afterBytes / 1024 / 1024).toFixed(1)} Mo pour ${(BSON_MAX_BYTES / 1024 / 1024).toFixed(0)} Mo autorisés`
          );
        }
        payload = Buffer.from(compact.obj);
        // L'OBJ produit par la File Format API a été demandé en mm : on le
        // redit à l'import, un maillage ne portant pas son unité.
        importFormat = { type: 'obj', coords: ZOO_COORDS, units: 'mm' };
      }

      const { resp } = await session.send(
        {
          type: 'import_files',
          files: [{ path: basename(brepPath ?? path), data: payload as unknown as number[] }],
          format: importFormat,
        },
        900_000
      );

      if (resp.type !== 'modeling' || resp.data.modeling_response.type !== 'import_files') {
        throw new Error(`réponse inattendue : ${resp.type}`);
      }

      const machineId = resp.data.modeling_response.data.object_id;
      console.log(`  machine importée           ${s(performance.now() - t)}`);

      // `set: false` — transformation **relative**. Le schéma documente
      // pourtant `set: true` comme « écraser la valeur précédente », mais le
      // moteur répond « Absolute transforms are currently not supported ».
      // L'objet part de l'identité : relatif et absolu coïncident ici.
      // Voir FEEDBACK.md #7.
      await session.send({
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
      });
      console.log(`  machine posée dans la pose`);
      entityIds.push(machineId);
    } catch (err) {
      // Une machine qui n'entre pas ne doit pas emporter la caisse : le STEP
      // de caisse seule reste utile, et l'échec est une mesure à documenter.
      console.log(`  ⚠ machine non importée : ${err instanceof Error ? err.message : err}`);
    }
  }

  const t = performance.now();
  const crateIds = await createBoxesBatched(session, boxes);
  entityIds.push(...crateIds);
  console.log(`  caisse construite          ${s(performance.now() - t)}  ${crateIds.length} solides`);

  /**
   * Exporte des entités, en repliant sur la caisse seule si le moteur refuse.
   *
   * Le moteur n'exporte que du b-rep. Une machine entrée sous forme de maillage
   * n'en est pas : l'inclure fait échouer l'export **entier** sur « No such Brep
   * object exists », et ce quel que soit le format demandé et que l'on passe par
   * `export` ou par `export3d`. Voir FEEDBACK.md #8.
   *
   * On tente donc la scène complète, et on retombe sur la caisse seule plutôt
   * que de ne rien produire — en le disant.
   */
  async function exportTo(
    format: 'step' | 'gltf',
    name: string,
    wanted: string[]
  ): Promise<void> {
    const outputFormat =
      format === 'step'
        ? ({ type: 'step', coords: ZOO_COORDS, created: undefined } as const)
        : ({ type: 'gltf', storage: 'embedded', presentation: 'compact' } as const);

    for (const ids of wanted === crateIds ? [crateIds] : [wanted, crateIds]) {
      const t0 = performance.now();
      const complet = ids.length === wanted.length;
      try {
        const { resp } = await session.send(
          { type: 'export', entity_ids: ids, format: outputFormat },
          600_000
        );
        if (resp.type !== 'export') throw new Error(`réponse ${resp.type}`);

        for (const f of resp.data.files) {
          const buf = Buffer.from(f.contents as unknown as Uint8Array);
          await writeFile(`${OUT_DIR}/${name}`, buf);
          console.log(
            `  ${`${OUT_DIR}/${name}`.padEnd(20)} ${s(performance.now() - t0).padStart(7)}  ` +
              `${(buf.length / 1024 / 1024).toFixed(1).padStart(5)} Mo  ` +
              `${complet ? 'machine + caisse' : 'caisse seule (b-rep)'}`
          );
        }
        return;
      } catch (err) {
        console.log(
          `  ⚠ export ${format} avec la machine : ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }

  await exportTo('step', 'caisse.step', entityIds);
  await exportTo('gltf', 'scene.gltf', entityIds);

  /** Rend la scène en PNG. Le calcul est fait sur le GPU de Zoo, sans moteur local. */
  async function snapshot(name: string): Promise<void> {
    await session.send({ type: 'view_isometric', padding: 0.15 });
    await session.send({ type: 'zoom_to_fit', padding: 0.15 });
    const { resp } = await session.send({ type: 'take_snapshot', format: 'png' }, 120_000);
    if (resp.type !== 'modeling' || resp.data.modeling_response.type !== 'take_snapshot') return;

    const raw = resp.data.modeling_response.data.contents as unknown;
    const bytes = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.from(raw as Uint8Array);
    await writeFile(`${OUT_DIR}/${name}`, bytes);
    console.log(`  ${`${OUT_DIR}/${name}`.padEnd(20)} ${' '.repeat(9)}${(bytes.length / 1024).toFixed(0).padStart(5)} Ko`);
  }

  // Contrôle de non-régression, à chaque exécution : la caisse **réellement
  // produite par Zoo** doit avoir l'encombrement qui a reçu le verdict. Un écart
  // ici veut dire que la démonstration ment, quelle que soit la beauté du rendu.
  try {
    const exported = gltfSizeMm(JSON.parse(await readFile(`${OUT_DIR}/scene.gltf`, 'utf8')));
    if (exported) {
      const attendu: [number, number, number] = [
        crate.outer.lengthMm,
        crate.outer.widthMm,
        crate.outer.heightMm,
      ];
      const ecart = exported.map((v, i) => Math.abs(v - attendu[i]!));
      const pire = Math.max(...ecart);
      console.log(
        `  contrôle glTF              ${exported.map((v) => Math.round(v)).join(' × ')} mm  ` +
          (pire < 1 ? '✅ conforme au verdict' : `❌ écart de ${Math.round(pire)} mm avec le verdict`)
      );
    }
  } catch (err) {
    console.log(`  ⚠ contrôle glTF impossible : ${err instanceof Error ? err.message : err}`);
  }

  await snapshot('caisse-fermee.png');

  // Vue écorchée : on retire le chapeau et deux parois pour montrer la machine
  // **à l'intérieur** de la caisse générée. C'est la seule image qui compte
  // (§13), et c'est aussi la convention de représentation en caisserie.
  //
  // `entity_set_opacity` aurait été plus élégant, mais le moteur le refuse sur
  // un solide b-rep : « This object cannot be made semi-transparent ». Voir
  // FEEDBACK.md #10.
  const masques = new Set(['chapeau', 'panneau_long_b', 'panneau_pignon_b']);
  await session.sendBatch(
    boxes
      .map((b, i) => (masques.has(b.name) ? crateIds[i]! : undefined))
      .filter((id): id is string => id !== undefined)
      .map((object_id) => ({ type: 'object_visible' as const, object_id, hidden: true }))
  );

  await snapshot('caisse-ecorchee.png');

} finally {
  await session.close();
  console.log(`  session fermée             ${s(session.elapsedMs())} facturées`);
}
