import { readFile } from 'node:fs/promises';
import { parseObjVertices } from './mesh/obj.js';
import { parseObjBodies } from './mesh/corps.js';
import { buildPoses } from './geometrie/poses.js';
import { placeForPose, placeBodies } from './geometrie/placement.js';
import { buildCrate } from './moteur/structure.js';
import type { Axis } from './geometrie/emprise.js';
import type { UnitChoice } from './geometrie/unites.js';
import { study } from './moteur/etude.js';
import { render } from './rapport.js';

/**
 * La chaîne complète, en ligne de commande : maillage → emprises → étude.
 *
 * Usage : tsx src/etude-cli.ts <fichier.obj> <masse_kg> [--up=z] [--unit=auto]
 *                              [--no-couchage] [--mode=maritime|route]
 *
 * C'est l'ossature de ce que l'interface fera en étape 5. L'avoir en console
 * d'abord permet de vérifier les chiffres sans se battre avec du HTML.
 */

const [, , path, massArg] = process.argv;
if (!path || !massArg) {
  console.error(
    'Usage : tsx src/etude-cli.ts <fichier.obj> <masse_kg> [--up=z] [--unit=auto] [--no-couchage] [--mode=maritime]'
  );
  process.exit(1);
}

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const massKg = Number(massArg);
if (!Number.isFinite(massKg) || massKg <= 0) {
  // Un STEP ne porte pas de matériau : la masse est saisie, et la demander
  // montre qu'on le sait (§5).
  console.error(`Masse invalide : « ${massArg} ». Un STEP ne porte pas de matériau.`);
  process.exit(1);
}

const texte = await readFile(path, 'utf8');
const cloud = parseObjVertices(texte);
const corps = parseObjBodies(texte);
const geometry = buildPoses(cloud, arg('up', 'z') as Axis, arg('unit', 'auto') as UnitChoice);

// Les corps placés pose par pose : ce qui permet de désigner ceux qui portent
// un dépassement dans cette orientation-là.
const posesAvecCorps = geometry.poses.map((p, i) => {
  if (p.pose === 'reference' || corps.length < 2) return p;
  const axis = geometry.oriented[i - 1]!;
  const c = buildCrate(p.footprint, massKg);
  const placement = placeForPose(cloud, axis.axis, axis.footprint.yawDeg, geometry.unit.scale, c.skid.heightMm + c.floorThicknessMm);
  return { ...p, bodies: placeBodies(corps, axis.axis, placement, geometry.unit.scale) };
});

if (!geometry.unit.plausible) {
  console.error(`\n⚠ ${geometry.unit.note}\n`);
}

const result = study({
  poses: posesAvecCorps,
  massKg,
  forbidLying: process.argv.includes('--no-couchage'),
  mode: arg('mode', 'maritime') as 'maritime' | 'route',
});

render(`${path} — ${cloud.count.toLocaleString('fr-FR')} sommets`, result);

console.log(`\n  ${geometry.unit.note}`);
console.log(
  `  Emprise orientée, machine debout : ${geometry.areaGainPct.toFixed(1)} % d'emprise au sol gagnés sur le repère CAO (lacet ${geometry.oriented[0]!.footprint.yawDeg.toFixed(1)}°).`
);
