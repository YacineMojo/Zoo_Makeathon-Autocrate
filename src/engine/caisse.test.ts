import test from 'node:test';
import assert from 'node:assert/strict';
import { crateBoxes, boxesEnvelope } from './caisse.js';
import { blockingBoxes } from './calage.js';
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

/** Tranches d'une machine qui ne repose que sur une partie de son emprise. */
const tranches = {
  bas: { minX: -1200, maxX: 1200, minY: -600, maxY: 600, count: 400 },
  haut: { minX: -900, maxX: 900, minY: -500, maxY: 500, count: 200 },
  topMm: crate.skid.heightMm + crate.floorThicknessMm + 1303,
};

test('les cales remplissent le jeu entre la machine et la paroi', () => {
  const cales = blockingBoxes(crate, tranches);
  const butees = cales.filter((b) => b.name.startsWith('butee_long_'));
  assert.ok(butees.length >= 4, `attendu au moins quatre butées longitudinales, obtenu ${butees.length}`);

  // Une butée doit toucher la paroi d'un côté et la machine de l'autre : elle
  // ne sert à rien si elle flotte entre les deux.
  const interieurY = crate.outer.widthMm / 2 - crate.panelThicknessMm - 45;
  for (const b of butees) {
    const contreParoi = Math.abs(b.y + b.depth - -interieurY) < 1 || Math.abs(b.y - interieurY) < 1;
    const contreMachine = Math.abs(b.y - tranches.bas.maxY) < 1 || Math.abs(b.y + b.depth - tranches.bas.minY) < 1;
    assert.ok(contreParoi || contreMachine, `${b.name} ne touche ni paroi ni machine`);
  }
});

test('aucune cale ne sort de la caisse ni ne traverse le plancher', () => {
  const { outer, skid, floorThicknessMm } = crate;
  for (const b of blockingBoxes(crate, tranches)) {
    assert.ok(b.x >= -outer.lengthMm / 2 - 1e-6 && b.x + b.width <= outer.lengthMm / 2 + 1e-6, `${b.name} en X`);
    assert.ok(b.y >= -outer.widthMm / 2 - 1e-6 && b.y + b.depth <= outer.widthMm / 2 + 1e-6, `${b.name} en Y`);
    assert.ok(b.z >= skid.heightMm + floorThicknessMm - 1e-6, `${b.name} traverse le plancher`);
    assert.ok(b.z + b.height <= outer.heightMm + 1e-6, `${b.name} traverse le chapeau`);
  }
});

test('le calage n’agrandit jamais la caisse', () => {
  // C'est la propriété qui compte : le verdict a été rendu sur l'encombrement
  // extérieur, et le calage est intérieur par construction.
  const avant = boxesEnvelope(crateBoxes(crate));
  const apres = boxesEnvelope([...crateBoxes(crate), ...blockingBoxes(crate, tranches)]);
  assert.deepEqual(apres.size, avant.size);
});

test('pas de tranche exploitable, pas de butée inventée', () => {
  // Mieux vaut ne rien proposer que de caler contre trois sommets isolés.
  const cales = blockingBoxes(crate, { topMm: tranches.topMm });
  assert.equal(cales.filter((b) => b.name.startsWith('butee_')).length, 0);
  assert.ok(cales.some((b) => b.name.startsWith('lisse_')), 'les lisses, elles, ne dépendent que de la caisse');
});

test('une machine qui ne repose que sur une bande au bord ne fait pas sortir les cales', () => {
  // Cas réel, attrapé par le contrôle d'encombrement : couchée, la machine de
  // démonstration ne touche le plancher que sur 160 mm, tout au bord. La cale
  // de coin partait de là vers l'extérieur et sortait de la caisse de 25 mm.
  const auBord = {
    ...tranches,
    bas: { minX: 1390, maxX: 1550, minY: -1000, maxY: 1000, count: 16 },
  };

  const { outer } = crate;
  for (const b of blockingBoxes(crate, auBord)) {
    assert.ok(b.x + b.width <= outer.lengthMm / 2 + 1e-6, `${b.name} sort en X`);
    assert.ok(b.y + b.depth <= outer.widthMm / 2 + 1e-6, `${b.name} sort en Y`);
  }
});

test('une machine qui touche déjà la paroi ne reçoit pas de cale de zéro d’épaisseur', () => {
  const colle = {
    ...tranches,
    bas: { minX: -1200, maxX: 1200, minY: -crate.outer.widthMm / 2, maxY: crate.outer.widthMm / 2, count: 400 },
  };
  for (const b of blockingBoxes(crate, colle)) {
    assert.ok(b.depth > 0 && b.width > 0, `${b.name} dégénérée`);
  }
});
