import test from 'node:test';
import assert from 'node:assert/strict';
import { crateBoxes, boxesEnvelope } from './caisse.js';
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
