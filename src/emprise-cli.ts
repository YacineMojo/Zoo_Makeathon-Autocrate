import { readFile } from 'node:fs/promises';
import { parseObjVertices } from './mesh/obj.js';
import { buildPoses } from './geometrie/poses.js';
import type { Axis } from './geometrie/emprise.js';
import type { UnitChoice } from './geometrie/unites.js';

/**
 * Mesure l'emprise d'un maillage converti.
 *
 * Usage : tsx src/emprise-cli.ts <fichier.obj> [--up=z] [--unit=auto]
 *
 * Sert à vérifier sur du vrai maillage ce que les tests vérifient sur des
 * boîtes tournées : que l'emprise orientée est réellement plus petite que la
 * boîte du repère CAO, et de combien.
 */

const path = process.argv[2];
if (!path) {
  console.error('Usage: tsx src/emprise-cli.ts <file.obj> [--up=z] [--unit=auto]');
  process.exit(1);
}

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const up = arg('up', 'z') as Axis;
const unit = arg('unit', 'auto') as UnitChoice;

const t0 = performance.now();
const cloud = parseObjVertices(await readFile(path, 'utf8'));
const parseMs = performance.now() - t0;

const t1 = performance.now();
const result = buildPoses(cloud, up, unit);
const computeMs = performance.now() - t1;

const mm = (v: number) => `${Math.round(v)}`.padStart(5);
const m2 = (v: number) => (v / 1e6).toFixed(2);

console.log(`${path}`);
console.log(`  ${cloud.count.toLocaleString('en-GB')} vertices read in ${parseMs.toFixed(0)} ms`);
console.log(`  footprints computed in ${computeMs.toFixed(0)} ms`);
console.log(`  ${result.unit.note}\n`);

console.log(`  Reference (CAD frame)  ${mm(result.reference.lengthMm)} × ${mm(result.reference.widthMm)} × ${mm(result.reference.heightMm)} mm   ${m2(result.reference.areaMm2)} m² footprint`);
for (const { axis, footprint } of result.oriented) {
  console.log(
    `  Oriented, ${axis.toUpperCase()} up          ${mm(footprint.lengthMm)} × ${mm(footprint.widthMm)} × ${mm(footprint.heightMm)} mm   ${m2(footprint.areaMm2)} m² footprint   yaw ${footprint.yawDeg.toFixed(1)}°`
  );
}

console.log(
  `\n  Footprint area gained, machine upright : ${result.areaGainPct.toFixed(1)} %`
);
