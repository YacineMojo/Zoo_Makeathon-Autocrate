import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { file, api_calls } from '@kittycad/lib';
import type { System } from '@kittycad/lib';
import { createZooClient } from './zoo-client.js';
import { parseObjVertices, axisAlignedBounds } from './mesh/obj.js';

/**
 * Conversion STEP → OBJ par la voie **asynchrone**.
 *
 * `create_file_conversion` (`PUT /file/conversion/{src}/{out}`) est synchrone :
 * la passerelle abandonne en 504 au bout d'une minute, quelle que soit la taille
 * du fichier. Le seuil documenté des 25 Mo, lui, porte sur la taille — il ne
 * protège donc de rien, puisque ce qui dépasse la minute est le *temps de
 * conversion*, qui dépend de la complexité et non du poids. Voir FEEDBACK.md #4.
 *
 * `create_file_conversion_options` (`POST /file/conversion`) démarre un job et
 * rend un id d'opération. C'est la même conversion, sans horloge de passerelle.
 *
 * Usage : tsx src/async-conversion.ts <chemin> [--from=step] [--to=obj]
 *
 * `--to=glb` sert à compacter un maillage : l'OBJ est du texte, et un maillage
 * de 174 000 sommets y pèse 23 Mo — au-delà de ce qu'une trame BSON peut
 * transporter vers l'Engine API (FEEDBACK.md #6).
 */

const ZOO_COORDS: System = {
  forward: { axis: 'y', direction: 'negative' },
  up: { axis: 'z', direction: 'positive' },
};

const client = createZooClient();
const argOf = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const path = process.argv[2] ?? 'fixtures/kuka_kr600_r2830.stp';
const srcFormat = argOf('from', 'step') as 'step' | 'obj';
const outFormat = argOf('to', 'obj') as 'obj' | 'glb' | 'ply' | 'gltf';
const bytes = await readFile(path);

console.log(`${path} — ${(bytes.length / 1024 / 1024).toFixed(2)} Mo\n`);

const t0 = performance.now();
const started = await file.create_file_conversion_options({
  client,
  files: [{ name: basename(path), data: new Blob([new Uint8Array(bytes)]) }],
  body: {
    src_format:
      srcFormat === 'step' ? { type: 'step', split_closed_faces: false } : { type: 'obj', coords: ZOO_COORDS, units: 'mm' },
    output_format:
      outFormat === 'obj'
        ? { type: 'obj', coords: ZOO_COORDS, units: 'mm' }
        : outFormat === 'ply'
          ? { type: 'ply', coords: ZOO_COORDS, storage: 'binary_little_endian', units: 'mm', selection: { type: 'default_scene' } }
          : { type: 'gltf', storage: outFormat === 'glb' ? 'binary' : 'embedded', presentation: 'compact' },
  },
});

if ('error_code' in (started as object)) {
  console.error(`❌ démarrage refusé : ${JSON.stringify(started).slice(0, 400)}`);
  process.exit(1);
}

console.log(`job démarré en ${((performance.now() - t0) / 1000).toFixed(1)} s — ${started.status}, id ${started.id}`);

// Le job peut déjà être terminé dans la réponse initiale : on ne repart en
// scrutation que s'il ne l'est pas.
let operation: typeof started | Awaited<ReturnType<typeof api_calls.get_async_operation>> = started;
let polls = 0;

while (operation.status === 'queued' || operation.status === 'uploaded' || operation.status === 'in_progress') {
  await new Promise((r) => setTimeout(r, 2000));
  polls++;
  const next = await api_calls.get_async_operation({ client, id: started.id });
  if ('error_code' in (next as object)) {
    console.error(`❌ scrutation : ${JSON.stringify(next).slice(0, 300)}`);
    process.exit(1);
  }
  operation = next as typeof operation;
  if (polls % 5 === 0) {
    console.log(`  … ${operation.status} après ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
}

const totalMs = performance.now() - t0;
console.log(`\nstatut final : ${operation.status} après ${(totalMs / 1000).toFixed(1)} s (${polls} scrutations)`);

// `get_async_operation` rend une union de tous les types d'opérations : la
// conversion n'expose ses `outputs` que dans la variante `file_conversion`.
if (operation.status !== 'completed' || !('outputs' in operation)) {
  console.error(`❌ ${operation.error ?? 'échec sans détail'}`);
  process.exit(1);
}

await mkdir('out', { recursive: true });
let vertices = 0;
for (const [name, b64] of Object.entries(operation.outputs ?? {})) {
  const buf = Buffer.from(b64 as string, 'base64');
  await writeFile(`out/async-${name}`, buf);
  if (outFormat !== 'obj') {
    console.log(`✅ out/async-${name} — ${(buf.length / 1024 / 1024).toFixed(1)} Mo`);
    vertices = 1; // pas de comptage hors OBJ : ce n'est pas l'objet de la conversion
    continue;
  }
  const cloud = parseObjVertices(buf.toString('utf8'));
  vertices += cloud.count;
  const size = axisAlignedBounds(cloud).size.map((v) => Math.round(v));
  console.log(
    `✅ out/async-${name} — ${(buf.length / 1024 / 1024).toFixed(1)} Mo, ` +
      `${cloud.count.toLocaleString('fr-FR')} sommets, emprise naïve ${size.join(' × ')} mm`
  );
}

if (vertices === 0) {
  console.error('❌ conversion terminée mais aucun sommet : géométrie inexploitable.');
  process.exit(1);
}
