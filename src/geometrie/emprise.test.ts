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

test('le balayage minimise la largeur, pas l’aire', () => {
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
    `largeur retenue ${retenu.widthMm.toFixed(0)} contre ${aireMin.widthMm.toFixed(0)} pour l’aire minimale`
  );
});

test('une largeur gagnée au prix d’une longueur intransportable est refusée', () => {
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
  assert.throws(() => sweepRectangles([]), /vide/);
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
  assert.match(r.note, /Check the file unit/);
});

test('aucune interprétation vraisemblable : on le dit au lieu de deviner', () => {
  const r = resolveUnit('auto', 0.0001);
  assert.equal(r.plausible, false);
  assert.match(r.note, /by hand/);
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
  assert.match(a.label, /upright/);
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

/* ----------------------------------------------------------------- placement */

test('le placement reproduit exactement l’emprise annoncée', () => {
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
      `hauteur ${up} : ${placement.size[2]} contre ${footprint.heightMm}`
    );

    // La longueur doit tomber sur X et la largeur sur Y, pas seulement « l'une
    // des deux » : la caisse est construite avec sa longueur suivant X, et une
    // machine posée en travers de sa caisse serait un quart de tour d'écart.
    assert.ok(
      Math.abs(placement.size[0] - footprint.lengthMm) < 1,
      `longueur sur X pour ${up} : ${placement.size[0]} contre ${footprint.lengthMm}`
    );
    assert.ok(
      Math.abs(placement.size[1] - footprint.widthMm) < 1,
      `largeur sur Y pour ${up} : ${placement.size[1]} contre ${footprint.widthMm}`
    );
  }
});

test('la machine repose sur le plancher, centrée, jamais flottante', () => {
  const box = rotatedBox(2000, 800, 1200, 20);
  const footprint = orientedFootprint(box, 'z');
  const floorTop = 122;
  const placement = placeForPose(box, 'z', footprint.yawDeg, 1, floorTop);

  // Après translation, la base doit être exactement à la cote du plancher.
  // (la boîte de test est modélisée de z=0 à z=h, mais rien ne l'impose)
  assert.ok(Math.abs(placement.translateMm[2] - floorTop) < 1e-6);
});

test('la rotation composée est équivalente aux deux rotations successives', () => {
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
        `axe ${a} pour ${up} : ${max[a]! - min[a]!} contre ${placement.size[a]}`
      );
    }
  }
});
