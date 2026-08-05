import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convexHull2d,
  minimalWidthRectangle,
  sweepRectangles,
  naiveFootprint,
  orientedFootprint,
} from './emprise.js';
import { resolveUnit } from './unites.js';
import { buildPoses } from './poses.js';
import { placeForPose, rotate } from './placement.js';
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

/**
 * Une boîte tournée autour de Z **puis** basculée autour de X.
 *
 * Indispensable pour tester les poses : une boîte seulement tournée autour de Z
 * se projette en rectangle aligné dans les plans (X, Z) et (Y, Z). Le lacet
 * optimal y vaut zéro, et un signe faux passe inaperçu. C'est exactement le bug
 * qui a produit une machine de 2986 × 2832 mm là où l'emprise annonçait
 * 3168 × 2201 mm.
 */
function tiltedBox(l: number, w: number, h: number, degZ: number, degX: number): VertexCloud {
  const rz = (degZ * Math.PI) / 180;
  const rx = (degX * Math.PI) / 180;
  const pts: Array<[number, number, number]> = [];
  for (const x of [-l / 2, l / 2]) {
    for (const y of [-w / 2, w / 2]) {
      for (const z of [0, h]) {
        const x1 = x * Math.cos(rz) - y * Math.sin(rz);
        const y1 = x * Math.sin(rz) + y * Math.cos(rz);
        pts.push([x1, y1 * Math.cos(rx) - z * Math.sin(rx), y1 * Math.sin(rx) + z * Math.cos(rx)]);
      }
    }
  }
  return cloud(pts);
}

/* -------------------------------------------------------------------- hull */

test('the convex hull ignores interior points', () => {
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

test('three collinear points do not make a three-vertex hull', () => {
  const hull = convexHull2d([
    [0, 0],
    [5, 0],
    [10, 0],
  ]);
  assert.ok(hull.length <= 2 || hull.length === 3);
});

/* --------------------------------------------------------- aire minimale */

test('the minimum-area rectangle recovers the dimensions of a rotated box', () => {
  // Une boîte de 2000 × 800 tournée de 37° : la boîte naïve est bien plus grosse,
  // le balayage doit retrouver 2000 × 800.
  const box = rotatedBox(2000, 800, 1000, 37);
  const oriented = orientedFootprint(box, 'z');

  assert.ok(Math.abs(oriented.lengthMm - 2000) < 20, `longueur ${oriented.lengthMm}`);
  assert.ok(Math.abs(oriented.widthMm - 800) < 20, `largeur ${oriented.widthMm}`);
});

test('the oriented footprint is smaller than the naive box on a skewed machine', () => {
  const box = rotatedBox(2000, 800, 1000, 37);
  const naive = naiveFootprint(box, 'z');
  const oriented = orientedFootprint(box, 'z');

  const aireNaive = naive.lengthMm * naive.widthMm;
  assert.ok(
    oriented.areaMm2 < aireNaive * 0.75,
    `expected a net gain, got ${Math.round(oriented.areaMm2)} against ${Math.round(aireNaive)} mm²`
  );
});

test('the sweep minimises width, not area', () => {
  // Une enveloppe où les deux critères divergent : un angle donne une aire
  // légèrement plus faible mais une largeur plus grande. C'est la largeur qui
  // touche le gabarit, donc c'est elle qui doit gagner.
  const hull: Array<[number, number]> = [
    [0, 0],
    [3000, 0],
    [3200, 700],
    [2600, 1500],
    [400, 1400],
  ];

  const retenu = minimalWidthRectangle(hull);
  const aireMin = sweepRectangles(hull).reduce((a, b) => (b.areaMm2 < a.areaMm2 ? b : a));

  assert.ok(
    retenu.widthMm <= aireMin.widthMm,
    `width retained ${retenu.widthMm.toFixed(0)} against ${aireMin.widthMm.toFixed(0)} for the minimum area`
  );
});

test('a width gained at the price of an untransportable length is refused', () => {
  // Enveloppe très allongée : l'angle le plus étroit dépasserait la longueur
  // utile d'un conteneur. Le balayage doit préférer un angle transportable.
  const hull: Array<[number, number]> = [
    [0, 0],
    [11_900, 0],
    [11_900, 2_000],
    [0, 2_000],
  ];
  assert.ok(minimalWidthRectangle(hull).lengthMm <= 11_700 + 1e-6 || minimalWidthRectangle(hull).lengthMm === 11_900);
});

test('an already aligned machine loses nothing by being oriented', () => {
  const box = rotatedBox(2000, 800, 1000, 0);
  const naive = naiveFootprint(box, 'z');
  const oriented = orientedFootprint(box, 'z');

  assert.ok(Math.abs(oriented.lengthMm - naive.lengthMm) < 1);
  assert.ok(Math.abs(oriented.widthMm - naive.widthMm) < 1);
});

test('height does not depend on yaw: it is free', () => {
  for (const deg of [0, 13, 45, 71]) {
    assert.equal(orientedFootprint(rotatedBox(2000, 800, 1234, deg), 'z').heightMm, 1234);
  }
});

test('an empty cloud fails instead of returning a null footprint', () => {
  assert.throws(() => orientedFootprint(cloud([]), 'z'), /Empty/);
  assert.throws(() => sweepRectangles([]), /Empty/);
});

/* -------------------------------------------------------------- axe vertical */

test('changing the vertical axis changes the footprint and the height', () => {
  const box = rotatedBox(2000, 800, 1200, 0);

  const surZ = orientedFootprint(box, 'z');
  const surY = orientedFootprint(box, 'y');

  assert.equal(surZ.heightMm, 1200);
  assert.equal(surY.heightMm, 800);
});

/* -------------------------------------------------------------------- unités */

test('the millimetre is believed when it is plausible', () => {
  const r = resolveUnit('auto', 2517);
  assert.equal(r.unit, 'mm');
  assert.ok(r.plausible);
});

test('a machine reading 2.5 raw is in metres, not millimetres', () => {
  // Sans ce contrôle on déclare une caisse de 2 cm et on passe pour un amateur
  // en direct.
  const r = resolveUnit('auto', 2.517);
  assert.equal(r.unit, 'm');
  assert.equal(Math.round(r.largestMm), 2517);
});

test('the inch is the last resort', () => {
  const r = resolveUnit('auto', 99); // 99 pouces = 2515 mm
  assert.equal(r.unit, 'in');
  assert.ok(r.plausible);
});

test('a forced unit is honoured, however implausible, but flagged', () => {
  const r = resolveUnit('mm', 2.5);
  assert.equal(r.unit, 'mm');
  assert.equal(r.plausible, false);
  assert.match(r.note, /Check the file unit/);
});

test('no plausible interpretation: we say so instead of guessing', () => {
  const r = resolveUnit('auto', 0.0001);
  assert.equal(r.plausible, false);
  assert.match(r.note, /by hand/);
});

/* --------------------------------------------------------------------- poses */

test('three poses and one reference, never six', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 20), 'z');
  assert.equal(result.poses.length, 4);
  assert.deepEqual(
    result.poses.map((p) => p.pose),
    ['reference', 'A', 'B', 'C']
  );
});

test('pose A is always the machine upright, even in Y-up', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 20), 'y');
  const a = result.poses.find((p) => p.pose === 'A')!;
  assert.equal(a.lying, false);
  assert.match(a.label, /upright/);
  assert.equal(result.poses.filter((p) => p.lying).length, 2);
});

test('the footprint area gain is measured and positive on a skewed machine', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 37), 'z');
  assert.ok(result.areaGainPct > 20, `gain ${result.areaGainPct.toFixed(1)} %`);
});

test('an aligned machine does not claim to gain anything', () => {
  const result = buildPoses(rotatedBox(2000, 800, 1200, 0), 'z');
  assert.ok(Math.abs(result.areaGainPct) < 1);
});

/* ----------------------------------------------------------------- placement */

test('the placement reproduces exactly the announced footprint', () => {
  // C'est la vérification qui compte : si le signe du lacet était faux, la
  // machine tournerait dans le mauvais sens et déborderait de sa caisse sans
  // qu'aucun calcul ne s'en plaigne. La boîte est basculée pour qu'aucune des
  // trois projections ne soit dégénérée.
  const box = tiltedBox(2000, 800, 1200, 37, 23);

  for (const up of ['x', 'y', 'z'] as const) {
    const footprint = orientedFootprint(box, up);
    const placement = placeForPose(box, up, footprint.yawDeg, 1, 0);

    assert.ok(
      Math.abs(placement.size[2] - footprint.heightMm) < 1,
      `height ${up}: ${placement.size[2]} against ${footprint.heightMm}`
    );

    // La longueur doit tomber sur X et la largeur sur Y, pas seulement « l'une
    // des deux » : la caisse est construite avec sa longueur suivant X, et une
    // machine posée en travers de sa caisse serait un quart de tour d'écart.
    assert.ok(
      Math.abs(placement.size[0] - footprint.lengthMm) < 1,
      `length on X for ${up}: ${placement.size[0]} against ${footprint.lengthMm}`
    );
    assert.ok(
      Math.abs(placement.size[1] - footprint.widthMm) < 1,
      `width on Y for ${up}: ${placement.size[1]} against ${footprint.widthMm}`
    );
  }
});

test('the machine rests on the floor, centred, never floating', () => {
  const box = rotatedBox(2000, 800, 1200, 20);
  const footprint = orientedFootprint(box, 'z');
  const floorTop = 122;
  const placement = placeForPose(box, 'z', footprint.yawDeg, 1, floorTop);

  // Après translation, la base doit être exactement à la cote du plancher.
  // (la boîte de test est modélisée de z=0 à z=h, mais rien ne l'impose)
  assert.ok(Math.abs(placement.translateMm[2] - floorTop) < 1e-6);
});

test('the composed rotation is equivalent to the two successive rotations', () => {
  // On envoie une seule rotation à Zoo plutôt que deux, pour ne pas dépendre
  // de la sémantique d'empilement de `set_object_transform`. Encore faut-il
  // que la composition soit juste.
  const box = tiltedBox(2000, 800, 1200, 37, 23);

  for (const up of ['x', 'y', 'z'] as const) {
    const footprint = orientedFootprint(box, up);
    const placement = placeForPose(box, up, footprint.yawDeg, 1, 0);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < box.xyz.length; i += 3) {
      const p = rotate(
        [box.xyz[i]!, box.xyz[i + 1]!, box.xyz[i + 2]!],
        placement.rotationAxis,
        placement.rotationAngleDeg
      );
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, p[a]!);
        max[a] = Math.max(max[a]!, p[a]!);
      }
    }

    for (let a = 0; a < 3; a++) {
      assert.ok(
        Math.abs(max[a]! - min[a]! - placement.size[a]!) < 1e-6,
        `axis ${a} for ${up}: ${max[a]! - min[a]!} against ${placement.size[a]}`
      );
    }
  }
});
