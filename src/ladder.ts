import { readFile } from 'node:fs/promises';
import { file } from '@kittycad/lib';
import { createZooClient } from './zoo-client.js';
import { parseObjVertices, axisAlignedBounds } from './mesh/obj.js';

/**
 * Où est le plafond de taille ?
 *
 * Le spike a répondu oui sur 137 Ko et non sur 12,6 Mo, des deux côtés. Avant
 * de choisir un fichier de démo (PROJECT.md §14) il faut savoir *où* ça casse,
 * pas seulement que ça casse.
 *
 * On sonde avec la File Format API seule : elle ne consomme pas de session, donc
 * la mesure est gratuite en temps facturé, et c'est de toute façon la route
 * candidate pour la mesure d'emprise.
 */

const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'fixtures/as1_assembly.stp',
      'fixtures/as1-oc-214.stp',
      'fixtures/11752.stp',
      'fixtures/Ventilator.stp',
    ];

const client = createZooClient();

for (const path of FILES) {
  const bytes = await readFile(path);
  const mo = (bytes.length / 1024 / 1024).toFixed(2);
  process.stdout.write(`${path.padEnd(30)} ${mo.padStart(6)} Mo  … `);

  const t0 = performance.now();
  try {
    const conversion = await file.create_file_conversion({
      client,
      src_format: 'step',
      output_format: 'obj',
      body: bytes.toString('utf8'),
    });
    const ms = performance.now() - t0;

    if ('error_code' in (conversion as object)) throw new Error(JSON.stringify(conversion).slice(0, 200));
    if (conversion.error) throw new Error(conversion.error);

    const outputs = conversion.outputs ?? {};
    let vertices = 0;
    let size: number[] = [];
    for (const name of Object.keys(outputs)) {
      const cloud = parseObjVertices(Buffer.from(outputs[name] as string, 'base64').toString('utf8'));
      vertices += cloud.count;
      if (cloud.count > 0) size = axisAlignedBounds(cloud).size.map((v) => Math.round(v));
    }

    console.log(
      `✅ ${(ms / 1000).toFixed(1)} s  ${vertices.toLocaleString('fr-FR')} sommets  ${size.join('×')} mm`
    );
  } catch (err) {
    console.log(`❌ ${((performance.now() - t0) / 1000).toFixed(1)} s  ${err instanceof Error ? err.message : err}`);
  }
}
