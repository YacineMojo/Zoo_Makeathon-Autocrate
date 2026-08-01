import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { file } from '@kittycad/lib';
import type { System } from '@kittycad/lib';
import { EngineSession } from './engine/session.js';
import { createZooClient } from './zoo-client.js';
import { parseObjVertices, axisAlignedBounds } from './mesh/obj.js';

/**
 * Spike Zoo — PROJECT.md §9.
 *
 * Deux questions, deux seulement :
 *
 *   1. l'API rend-elle de la géométrie exploitable à partir d'un STEP importé —
 *      des sommets suffisent ;
 *   2. en combien de temps, sur un fichier lourd.
 *
 * Les deux routes prévues sont mesurées côte à côte, parce que le choix entre
 * elles se fait sur des chiffres et que la comparaison est elle-même du
 * matériau pour FEEDBACK.md :
 *
 *   A. Engine API, commande `import_files` en session ;
 *   B. File Format API, conversion STEP → OBJ hors session.
 *
 * Une troisième mesure est ajoutée, parce qu'elle ne coûte qu'une commande et
 * qu'elle dérisque l'étape 4 : réexporter un STEP contenant à la fois la
 * machine importée et une caisse fictive construite autour (§7.3).
 *
 * Usage : tsx src/spike.ts [chemin.stp]
 */

const OUT_DIR = 'out';
const DEFAULT_FIXTURE = 'fixtures/kuka_kr600_r2830.stp';

/** Repère par défaut de Zoo, exigé explicitement par les formats de sortie. */
const ZOO_COORDS: System = {
  forward: { axis: 'y', direction: 'negative' },
  up: { axis: 'z', direction: 'positive' },
};

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const mo = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

interface RouteResult {
  label: string;
  ok: boolean;
  ms: number;
  vertices?: number;
  size?: [number, number, number];
  note?: string;
}

const results: RouteResult[] = [];

/* ------------------------------------------------------------------ route A */

/**
 * Ouvre une session en réessayant.
 *
 * Le moteur refuse parfois la connexion avec « modeling connection interrupted;
 * please reconnect and retry » **au handshake**, avant toute commande. Le
 * message dit lui-même quoi faire : on le fait, plutôt que de conclure à tort
 * que l'import a échoué. Voir FEEDBACK.md #3.
 */
async function openSessionWithRetry(attempts = 3): Promise<EngineSession> {
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

async function routeEngine(path: string, bytes: Buffer): Promise<void> {
  console.log('\n── Route A — Engine API, import_files en session\n');

  const t0 = performance.now();
  let session: EngineSession;
  try {
    session = await openSessionWithRetry();
  } catch (err) {
    // Une session qui n'ouvre pas ne doit pas emporter la route B avec elle :
    // les deux mesures du §9 sont indépendantes.
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ session impossible : ${message}`);
    results.push({ label: 'A — Engine import_files', ok: false, ms: performance.now() - t0, note: message });
    return;
  }
  console.log(`  session ouverte            ${s(session.elapsedMs())}`);

  try {
    // Le type déclaré est `number[]`. Passer un Buffer laisse le sérialiseur
    // l'encoder en binaire au lieu d'un tableau de 13 millions d'entiers : la
    // différence entre une trame de 13 Mo et une trame de plusieurs centaines.
    // Si le moteur refuse, c'est une entrée FEEDBACK.md à part entière.
    const tImport = performance.now();
    const { resp } = await session.send(
      {
        type: 'import_files',
        files: [{ path: basename(path), data: bytes as unknown as number[] }],
        format: { type: 'step', split_closed_faces: false },
      },
      600_000
    );
    const importMs = performance.now() - tImport;

    // Les réponses de commande sont enveloppées : `modeling` → `modeling_response`.
    // Seul l'export échappe à cette enveloppe, ce qui n'est signalé nulle part.
    if (resp.type !== 'modeling' || resp.data.modeling_response.type !== 'import_files') {
      throw new Error(
        `réponse inattendue à l'import : ${resp.type === 'modeling' ? resp.data.modeling_response.type : resp.type}`
      );
    }
    const objectId = resp.data.modeling_response.data.object_id;
    console.log(`  import STEP                ${s(importMs)}  → objet ${objectId}`);

    // La boîte naïve alignée sur le repère du fichier — la ligne « avant » du
    // §6.2 — est disponible sans exporter quoi que ce soit.
    const tBox = performance.now();
    const { resp: bboxResp } = await session.send(
      { type: 'bounding_box', entity_ids: [objectId], output_unit: 'mm' },
      120_000
    );
    const bboxMs = performance.now() - tBox;

    let engineSize: [number, number, number] | undefined;
    if (bboxResp.type === 'modeling' && bboxResp.data.modeling_response.type === 'bounding_box') {
      const d = bboxResp.data.modeling_response.data.dimensions;
      engineSize = [d.x, d.y, d.z];
      console.log(
        `  bounding_box moteur        ${s(bboxMs)}  → ${engineSize.map((v) => Math.round(v)).join(' × ')} mm`
      );
    } else {
      console.log(`  bounding_box moteur        ${s(bboxMs)}  → réponse ${bboxResp.type}`);
    }

    // Sommets : l'export OBJ du solide importé. C'est la question 1 du §9.
    const tObj = performance.now();
    const { resp: objResp } = await session.send(
      {
        type: 'export',
        entity_ids: [objectId],
        format: { type: 'obj', coords: ZOO_COORDS, units: 'mm' },
      },
      600_000
    );
    const objMs = performance.now() - tObj;

    if (objResp.type !== 'export') throw new Error(`réponse inattendue à l'export OBJ : ${objResp.type}`);

    let vertices = 0;
    let meshSize: [number, number, number] | undefined;
    for (const f of objResp.data.files) {
      const buf = Buffer.from(f.contents as unknown as Uint8Array);
      await writeFile(`${OUT_DIR}/${f.name || 'import.obj'}`, buf);
      if ((f.name || '').endsWith('.obj') || objResp.data.files.length === 1) {
        const cloud = parseObjVertices(buf.toString('utf8'));
        vertices += cloud.count;
        if (cloud.count > 0) meshSize = axisAlignedBounds(cloud).size;
      }
    }
    console.log(
      `  export OBJ                 ${s(objMs)}  → ${vertices.toLocaleString('fr-FR')} sommets`
    );
    if (meshSize) {
      console.log(`    emprise du maillage      ${meshSize.map((v) => Math.round(v)).join(' × ')} mm`);
    }

    results.push({
      label: 'A — Engine import_files + export OBJ',
      ok: vertices > 0,
      ms: performance.now() - t0,
      vertices,
      size: engineSize ?? meshSize,
    });

    // Dérisquage de l'étape 4 : une caisse fictive autour de la machine, et un
    // STEP unique qui contient les deux. C'est l'artefact du §7.3.
    if (engineSize ?? meshSize) {
      const { createBox } = await import('./engine/box.js');
      const dims = (engineSize ?? meshSize) as [number, number, number];
      const clearance = 150;
      const crateId = await createBox(session, {
        name: 'caisse_fictive_spike',
        x: -dims[0] / 2 - clearance,
        y: -dims[1] / 2 - clearance,
        z: -clearance,
        width: dims[0] + 2 * clearance,
        depth: dims[1] + 2 * clearance,
        height: 60, // un plancher, pas une caisse : on prouve la scène commune
      });

      const tStep = performance.now();
      const { resp: stepResp } = await session.send(
        {
          type: 'export',
          entity_ids: [objectId, crateId],
          format: { type: 'step', coords: ZOO_COORDS, created: undefined },
        },
        600_000
      );
      const stepMs = performance.now() - tStep;

      if (stepResp.type === 'export') {
        for (const f of stepResp.data.files) {
          const buf = Buffer.from(f.contents as unknown as Uint8Array);
          await writeFile(`${OUT_DIR}/scene-commune.step`, buf);
          console.log(`  export STEP machine+caisse ${s(stepMs)}  → out/scene-commune.step (${mo(buf.length)})`);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ ${message}`);
    results.push({ label: 'A — Engine import_files', ok: false, ms: performance.now() - t0, note: message });
  } finally {
    await session.close();
    console.log(`  session fermée             ${s(session.elapsedMs())} facturées`);
  }
}

/* ------------------------------------------------------------------ route B */

async function routeFileFormat(path: string, bytes: Buffer): Promise<void> {
  console.log('\n── Route B — File Format API, conversion STEP → OBJ\n');

  const t0 = performance.now();
  try {
    const conversion = await file.create_file_conversion({
      client: createZooClient(),
      src_format: 'step',
      output_format: 'obj',
      body: bytes.toString('utf8'),
    });

    const ms = performance.now() - t0;

    if ('error_code' in (conversion as object)) {
      throw new Error(JSON.stringify(conversion).slice(0, 300));
    }
    if (conversion.error) throw new Error(conversion.error);

    // Au-delà de 25 Mo la conversion bascule en asynchrone et ne renvoie qu'un
    // id d'opération : le spike doit savoir dire lequel des deux régimes il a eu.
    const outputs = conversion.outputs ?? {};
    const names = Object.keys(outputs);
    if (names.length === 0) {
      throw new Error(`aucune sortie — statut ${conversion.status}, opération ${conversion.id}`);
    }

    let vertices = 0;
    let size: [number, number, number] | undefined;
    for (const name of names) {
      const buf = Buffer.from(outputs[name] as string, 'base64');
      await writeFile(`${OUT_DIR}/ffapi-${name}`, buf);
      const cloud = parseObjVertices(buf.toString('utf8'));
      vertices += cloud.count;
      if (cloud.count > 0) size = axisAlignedBounds(cloud).size;
    }

    console.log(`  conversion                 ${s(ms)}  → ${vertices.toLocaleString('fr-FR')} sommets`);
    if (size) console.log(`    emprise du maillage      ${size.map((v) => Math.round(v)).join(' × ')} mm`);

    results.push({ label: 'B — File Format API STEP → OBJ', ok: vertices > 0, ms, vertices, size });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ ${message}`);
    results.push({
      label: 'B — File Format API STEP → OBJ',
      ok: false,
      ms: performance.now() - t0,
      note: message,
    });
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  const path = process.argv[2] ?? DEFAULT_FIXTURE;
  const bytes = await readFile(path);

  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Spike Zoo — ${path} (${mo(bytes.length)})`);
  console.log('Question 1 : de la géométrie exploitable sort-elle d\'un STEP importé ?');
  console.log('Question 2 : en combien de temps ?');

  await routeEngine(path, bytes);
  await routeFileFormat(path, bytes);

  console.log('\n── Verdict\n');
  for (const r of results) {
    const head = `${r.ok ? '✅' : '❌'} ${r.label.padEnd(38)}`;
    const detail = r.ok
      ? `${s(r.ms).padStart(7)}  ${r.vertices?.toLocaleString('fr-FR')} sommets  ${r.size?.map((v) => Math.round(v)).join('×') ?? ''} mm`
      : `${s(r.ms).padStart(7)}  ${r.note}`;
    console.log(`  ${head} ${detail}`);
  }

  const go = results.some((r) => r.ok);
  console.log(
    go
      ? '\n✅ GO — de la géométrie exploitable entre. On garde la route la plus rapide.'
      : "\n❌ NO-GO — repli §9 : saisie manuelle des cotes."
  );
  process.exit(go ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Spike interrompu :', err instanceof Error ? err.stack : err);
  process.exit(1);
});
