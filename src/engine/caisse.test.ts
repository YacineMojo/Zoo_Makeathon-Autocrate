import test from 'node:test';
import assert from 'node:assert/strict';
import { crateBoxes, boxesEnvelope } from './caisse.js';
import { blockingBoxes } from './calage.js';
import { COLONNE_MM } from '../geometrie/tranches.js';
import { buildCrate } from '../moteur/structure.js';
import { placeForPose } from '../geometrie/placement.js';
import type { VertexCloud } from '../mesh/obj.js';

const crate = buildCrate({ lengthMm: 3168, widthMm: 2201, heightMm: 1303 }, 2_350);

test('les pavés reproduisent exactement l’encombrement qui a été confronté au gabarit', () => {
  // Si la caisse dessinée n'est pas celle qui a reçu le verdict, la
  // démonstration est fausse en silence. C'est le test le plus important du
  // fichier.
  const env = boxesEnvelope(crateBoxes(crate));

  assert.ok(Math.abs(env.size[0] - crate.outer.lengthMm) < 1e-6, `L ${env.size[0]}`);
  assert.ok(Math.abs(env.size[1] - crate.outer.widthMm) < 1e-6, `l ${env.size[1]}`);
  assert.ok(Math.abs(env.size[2] - crate.outer.heightMm) < 1e-6, `h ${env.size[2]}`);
});

test('la caisse est centrée sur l’origine en X et Y, posée sur z = 0', () => {
  const env = boxesEnvelope(crateBoxes(crate));
  assert.ok(Math.abs(env.min[0] + env.max[0]) < 1e-6);
  assert.ok(Math.abs(env.min[1] + env.max[1]) < 1e-6);
  assert.equal(env.min[2], 0);
});

test('aucun pavé n’est dégénéré', () => {
  for (const b of crateBoxes(crate)) {
    assert.ok(b.width > 0 && b.depth > 0 && b.height > 0, `${b.name} : ${b.width}×${b.depth}×${b.height}`);
  }
});

test('tous les pavés tiennent dans l’encombrement annoncé', () => {
  const { outer } = crate;
  for (const b of crateBoxes(crate)) {
    assert.ok(b.x >= -outer.lengthMm / 2 - 1e-6 && b.x + b.width <= outer.lengthMm / 2 + 1e-6, `${b.name} en X`);
    assert.ok(b.y >= -outer.widthMm / 2 - 1e-6 && b.y + b.depth <= outer.widthMm / 2 + 1e-6, `${b.name} en Y`);
    assert.ok(b.z >= -1e-6 && b.z + b.height <= outer.heightMm + 1e-6, `${b.name} en Z`);
  }
});

test('on retrouve les postes attendus, et le bon nombre de patins', () => {
  const boxes = crateBoxes(crate);
  const names = boxes.map((b) => b.name);

  assert.equal(names.filter((n) => n.startsWith('patin_')).length, crate.skidCount);
  assert.ok(names.includes('plancher'));
  assert.ok(names.includes('chapeau'));
  assert.equal(names.filter((n) => n.startsWith('panneau_')).length, 4);
  assert.ok(names.filter((n) => n.startsWith('montant_')).length >= 4);
});

test('la machine placée tient dans le volume intérieur de sa caisse', () => {
  // Le calage est de 60 mm par face : la machine doit être strictement à
  // l'intérieur, sans jamais toucher un panneau.
  const machine = { lengthMm: 3168, widthMm: 2201, heightMm: 1303 };
  const cloud: VertexCloud = {
    count: 8,
    xyz: Float64Array.from(
      [
        [0, 0, 0],
        [machine.lengthMm, 0, 0],
        [machine.lengthMm, machine.widthMm, 0],
        [0, machine.widthMm, 0],
        [0, 0, machine.heightMm],
        [machine.lengthMm, 0, machine.heightMm],
        [machine.lengthMm, machine.widthMm, machine.heightMm],
        [0, machine.widthMm, machine.heightMm],
      ].flat()
    ),
  };

  const floorTop = crate.skid.heightMm + crate.floorThicknessMm;
  const placement = placeForPose(cloud, 'z', 0, 1, floorTop);

  const halfL = crate.outer.lengthMm / 2 - crate.panelThicknessMm;
  const halfW = crate.outer.widthMm / 2 - crate.panelThicknessMm;

  assert.ok(placement.size[0] / 2 < halfL, 'la machine déborde en longueur');
  assert.ok(placement.size[1] / 2 < halfW, 'la machine déborde en largeur');
  assert.ok(floorTop + placement.size[2] < crate.outer.heightMm, 'la machine touche le chapeau');
});

/* ------------------------------------------------------------------ calage */

const zSol = crate.skid.heightMm + crate.floorThicknessMm;
const col = (center: number, min: number, max: number, top = zSol + 400) => ({
  center,
  min,
  max,
  topMm: top,
  count: 40,
});

/**
 * Machine appuyée sur toute sa longueur : le cas facile.
 */
const profilPlein = {
  basParX: [col(-900, -600, 600), col(0, -600, 600), col(900, -600, 600)],
  basParY: [col(-450, -1200, 1200), col(450, -1200, 1200)],
  hautParX: [col(-900, -600, 600, zSol + 1303), col(900, -600, 600, zSol + 1303)],
  topMm: zSol + 1303,
};

test('les butées vont de la paroi jusqu’à la machine, dans leur propre colonne', () => {
  const cales = blockingBoxes(crate, profilPlein);
  const interieurY = crate.outer.widthMm / 2 - crate.panelThicknessMm - 45;

  const cotesA = cales.filter((b) => b.name.startsWith('butee_long_a'));
  assert.ok(cotesA.length > 0);
  for (const b of cotesA) {
    assert.ok(Math.abs(b.y - -interieurY) < 1e-6, `${b.name} ne part pas de la paroi`);
    assert.ok(Math.abs(b.y + b.depth - -600) < 1e-6, `${b.name} n’atteint pas la machine`);
  }
});

test('une colonne où la machine n’est pas au sol ne reçoit pas de butée', () => {
  // C'est le défaut qui a motivé la réécriture : une butée posée là où la
  // machine n'est pas s'appuie sur la paroi et sur rien d'autre. Elle a l'air
  // d'une cale sans en être.
  const surUneBande = {
    ...profilPlein,
    basParX: [col(1400, -600, 600)],
    basParY: [col(0, 1250, 1550)],
  };

  const cales = blockingBoxes(crate, surUneBande).filter((b) => b.name.startsWith('butee_long'));
  for (const b of cales) {
    assert.ok(
      Math.abs(b.x + b.width / 2 - 1400) < COLONNE_MM,
      `${b.name} est posée en ${Math.round(b.x)} alors que la machine n’est qu’en 1400`
    );
  }
});

test('une butée ne monte jamais plus haut que la machine qu’elle retient', () => {
  const basse = {
    ...profilPlein,
    basParX: [col(0, -600, 600, zSol + 60)],
    basParY: [col(0, -1200, 1200, zSol + 60)],
  };
  for (const b of blockingBoxes(crate, basse).filter((x) => x.name.startsWith('butee_'))) {
    assert.ok(b.height <= 60 + 1e-6, `${b.name} monte à ${b.height} pour une machine à 60`);
  }
});

test('la traverse descend jusqu’à la machine sous elle, pas jusqu’au sommet global', () => {
  const irregulier = {
    ...profilPlein,
    hautParX: [col(-900, -600, 600, zSol + 600), col(900, -600, 600, zSol + 1303)],
    topMm: zSol + 1303,
  };

  const traverses = blockingBoxes(crate, irregulier).filter((b) => b.name.startsWith('traverse_'));
  assert.equal(traverses.length, 2);
  const hauteurs = traverses.map((t) => Math.round(t.z)).sort((a, b) => a - b);
  assert.notEqual(hauteurs[0], hauteurs[1], 'deux traverses à la même cote sur une machine irrégulière');
});

test('une colonne au ras de la paroi produit quand même sa cale', () => {
  // Deux traverses de maintien avaient disparu en silence : centrées sur les
  // colonnes extrêmes, elles débordaient, et le bornage les rabotait à néant.
  // La caisse était juste et la machine n'était plus tenue par le haut.
  const auRas = {
    ...profilPlein,
    hautParX: [
      col(-crate.outer.lengthMm / 2, -600, 600, zSol + 1200),
      col(crate.outer.lengthMm / 2, -600, 600, zSol + 1200),
    ],
  };

  const traverses = blockingBoxes(crate, auRas).filter((b) => b.name.startsWith('traverse_'));
  assert.equal(traverses.length, 2, 'les deux traverses doivent survivre au bornage');
  for (const t of traverses) {
    assert.ok(t.width > 1 && t.height > 1, `${t.name} rabotée`);
  }
});

test('aucune cale ne sort de la caisse ni ne traverse le plancher', () => {
  const { outer, skid, floorThicknessMm } = crate;
  for (const b of blockingBoxes(crate, profilPlein)) {
    assert.ok(b.x >= -outer.lengthMm / 2 - 1e-6 && b.x + b.width <= outer.lengthMm / 2 + 1e-6, `${b.name} en X`);
    assert.ok(b.y >= -outer.widthMm / 2 - 1e-6 && b.y + b.depth <= outer.widthMm / 2 + 1e-6, `${b.name} en Y`);
    assert.ok(b.z >= skid.heightMm + floorThicknessMm - 1e-6, `${b.name} traverse le plancher`);
    assert.ok(b.z + b.height <= outer.heightMm + 1e-6, `${b.name} traverse le chapeau`);
  }
});

test('le calage n’agrandit jamais la caisse', () => {
  const avant = boxesEnvelope(crateBoxes(crate));
  const apres = boxesEnvelope([...crateBoxes(crate), ...blockingBoxes(crate, profilPlein)]);
  assert.deepEqual(apres.size, avant.size);
});

test('pas de colonne exploitable, pas de butée inventée', () => {
  const cales = blockingBoxes(crate, { basParX: [], basParY: [], hautParX: [], topMm: zSol + 1303 });
  assert.equal(cales.filter((b) => b.name.startsWith('butee_')).length, 0);
  assert.ok(cales.some((b) => b.name.startsWith('lisse_')), 'les lisses, elles, ne dépendent que de la caisse');
});

test('une machine qui touche déjà la paroi ne reçoit pas de cale dégénérée', () => {
  const colle = {
    ...profilPlein,
    basParX: [col(0, -crate.outer.widthMm / 2, crate.outer.widthMm / 2)],
  };
  for (const b of blockingBoxes(crate, colle)) {
    assert.ok(b.width > 1 && b.depth > 1 && b.height > 1, `${b.name} dégénérée`);
  }
});
