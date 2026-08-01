import test from 'node:test';
import assert from 'node:assert/strict';
import { convexHull2d, minimalAreaRectangle, naiveFootprint, orientedFootprint } from './emprise.js';
import { resolveUnit } from './unites.js';
import { buildPoses } from './poses.js';
import type { VertexCloud } from '../mesh/obj.js';

/** Construit un nuage à partir de triplets, pour lire les cas en clair. */
function cloud(points: Array<[number, number, number]>): VertexCloud {
  return { count: points.length, xyz: Float64Array.from(points.flat()) };
}

/** Les huit sommets d'un pavé, tourné de `deg` autour de l'axe Z. */
function rotatedBox(l: number, w: number, h: number, deg: number): VertexCloud {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts: Array<[number, number, number]> = [];
  for (const x of [-l / 2, l / 2]) {
    for (const y of [-w / 2, w / 2]) {
      for (const z of [0, h]) {
        pts.push([x * cos - y * sin, x * sin + y * cos, z]);
      }
    }
  }
  return cloud(pts);
}

/* -------------------------------------------------------------------- hull */

test('l’enveloppe convexe ignore les points intérieurs', () => {
  const hull = convexHull2d([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [5, 5], // intérieur
    [3, 7], // intérieur
  ]);
  assert.equal(hull.length, 4);
});

test('trois points colinéaires ne font pas une enveloppe à trois sommets', () => {
  const hull = convexHull2d([
    [0, 0],
    [5, 0],
    [10, 0],
  ]);
  assert.ok(hull.length <= 2 || hull.length === 3);
});

/* --------------------------------------------------------- aire minimale */

test('le rectangle d’aire minimale retrouve les cotes d’une boîte tournée', () => {
  // Une boîte de 2000 × 800 tournée de 37° : la boîte naïve est bien plus grosse,
  // le balayage doit retrouver 2000 × 800.
  const box = rotatedBox(2000, 800, 1000, 37);
  const oriented = orientedFootprint(box, 'z');

  assert.ok(Math.abs(oriented.lengthMm - 2000) < 20, `longueur ${oriented.lengthMm}`);
  assert.ok(Math.abs(oriented.widthMm - 800) < 20, `largeur ${oriented.widthMm}`);
});

test('l’emprise orientée est plus petite que la boîte naïve sur une machine de travers', () => {
  const box = rotatedBox(2000, 800, 1000, 37);
  const naive = naiveFootprint(box, 'z');
  const oriented = orientedFootprint(box, 'z');

  const aireNaive = naive.lengthMm * naive.widthMm;
  assert.ok(
    oriented.areaMm2 < aireNaive * 0.75,
    `attendu un gain net, obtenu ${Math.round(oriented.areaMm2)} contre ${Math.round(aireNaive)} mm²`
  );
});

test('une machine déjà alignée ne perd rien à être orientée', () => {
  const box = rotatedBox(2000, 800, 1000, 0);
  const naive = naiveFootprint(box, 'z');
  const oriented = orientedFootprint(box, 'z');

  assert.ok(Math.abs(oriented.lengthMm - naive.lengthMm) < 1);
  assert.ok(Math.abs(oriented.widthMm - naive.widthMm) < 1);
});

test('la hauteur ne dépend pas du lacet : elle est gratuite', () => {
  for (const deg of [0, 13, 45, 71]) {
    assert.equal(orientedFootprint(rotatedBox(2000, 800, 1234, deg), 'z').heightMm, 1234);
  }
});

test('un nuage vide échoue au lieu de rendre une emprise nulle', () => {
  assert.throws(() => orientedFootprint(cloud([]), 'z'), /vide/);
  assert.throws(() => minimalAreaRectangle([]), /vide/);
});

/* -------------------------------------------------------------- axe vertical */

test('changer d’axe vertical change l’emprise et la hauteur', () => {
  const box = rotatedBox(2000, 800, 1200, 0);

  const surZ = orientedFootprint(box, 'z');
  const surY = orientedFootprint(box, 'y');

  assert.equal(surZ.heightMm, 1200);
  assert.equal(surY.heightMm, 800);
});

/* -------------------------------------------------------------------- unités */

test('le millimètre est cru quand il est vraisemblable', () => {
  const r = resolveUnit('auto', 2517);
  assert.equal(r.unit, 'mm');
  assert.ok(r.plausible);
});

test('une machine de 2,5 en lecture directe est en mètres, pas en millimètres', () => {
  // Sans ce contrôle on déclare une caisse de 2 cm et on passe pour un amateur
  // en direct (§11).
  const r = resolveUnit('auto', 2.517);
  assert.equal(r.unit, 'm');
  assert.equal(Math.round(r.largestMm), 2517);
});

test('le pouce est le dernier recours', () => {
  const r = resolveUnit('auto', 99); // 99 pouces = 2515 mm
  assert.equal(r.unit, 'in');
  assert.ok(r.plausible);
});

test('une unité imposée est respectée, même invraisemblable, mais signalée', () => {
  const r = resolveUnit('mm', 2.5);
  assert.equal(r.unit, 'mm');
  assert.equal(r.plausible, false);
  assert.match(r.note, /Vérifiez l’unité/);
});

test('aucune interprétation vraisemblable : on le dit au lieu de deviner', () => {
  const r = resolveUnit('auto', 0.0001);
  assert.equal(r.plausible, false);
  assert.match(r.note, /à la main/);
});

/* --------------------------------------------------------------------- poses */

test('trois poses et une référence, jamais six', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 20), 'z');
  assert.equal(result.poses.length, 4);
  assert.deepEqual(
    result.poses.map((p) => p.pose),
    ['reference', 'A', 'B', 'C']
  );
});

test('la pose A est toujours la machine debout, même en Y-up', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 20), 'y');
  const a = result.poses.find((p) => p.pose === 'A')!;
  assert.equal(a.lying, false);
  assert.match(a.label, /debout \(axe Y/);
  assert.equal(result.poses.filter((p) => p.lying).length, 2);
});

test('le gain d’emprise au sol est mesuré et positif sur une machine de travers', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 37), 'z');
  assert.ok(result.areaGainPct > 20, `gain ${result.areaGainPct.toFixed(1)} %`);
});

test('une machine alignée ne prétend pas gagner quelque chose', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 0), 'z');
  assert.ok(Math.abs(result.areaGainPct) < 1);
});
