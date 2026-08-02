import test from 'node:test';
import assert from 'node:assert/strict';
import { crateBoxes, boxesEnvelope } from './caisse.js';
import { blockingBoxes } from './calage.js';
import { machineProfile } from '../geometrie/tranches.js';
import { BUTEE_LARGEUR_MM } from '../domain/assumptions.js';
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

test('un jeu court se comble d’une pièce, de la paroi jusqu’à la machine', () => {
  const interieurY = crate.outer.widthMm / 2 - crate.panelThicknessMm - 45;
  // Machine presque contre la paroi : le jeu tient en une seule cale.
  const serre = {
    ...profilPlein,
    basParX: [col(0, -interieurY + 80, interieurY - 80)],
    basParY: [],
  };

  const cotesA = blockingBoxes(crate, serre).filter((b) => b.name.startsWith('butee_long_a'));
  assert.equal(cotesA.length, 1, 'une seule pièce pour un jeu court');
  const b = cotesA[0]!;
  assert.ok(Math.abs(b.y - -interieurY) < 1e-6, 'ne part pas de la paroi');
  assert.ok(Math.abs(b.y + b.depth - (-interieurY + 80)) < 1e-6, 'n’atteint pas la machine');
});

test('un jeu profond se comble de deux pièces, avec le vide entre elles', () => {
  // Un bloc de bois plein de trois mètres n'existe pas en caisserie. Sur la
  // machine de démonstration couchée, une butée de pignon faisait exactement
  // cela avant correction.
  const interieurY = crate.outer.widthMm / 2 - crate.panelThicknessMm - 45;
  const cales = blockingBoxes(crate, profilPlein).filter((b) => b.name.startsWith('butee_long_a'));

  assert.ok(cales.length >= 2, 'attendu deux pièces');
  const paroi = cales.find((b) => b.name.endsWith('_paroi'))!;
  const machine = cales.find((b) => b.name.endsWith('_machine'))!;

  assert.ok(Math.abs(paroi.y - -interieurY) < 1e-6, 'la pièce de paroi ne touche pas la paroi');
  assert.ok(Math.abs(machine.y + machine.depth - -600) < 1e-6, 'la pièce de machine ne touche pas la machine');
  assert.ok(machine.y > paroi.y + paroi.depth, 'les deux pièces devraient laisser un vide');

  // Et surtout : le volume de bois s'effondre par rapport au bloc plein.
  const plein = (-600 - -interieurY) * 300 * paroi.height;
  const reel = (paroi.depth + machine.depth) * 300 * paroi.height;
  assert.ok(reel < plein / 2, `${Math.round(reel / 1e6)} dm³ contre ${Math.round(plein / 1e6)} dm³ en plein`);
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
      Math.abs(b.x + b.width / 2 - 1400) < BUTEE_LARGEUR_MM,
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

test('une traverse ne se pose que sur une partie haute, et repose dessus', () => {
  // Une traverse posée au droit d'une partie basse descendrait jusqu'à elle et
  // deviendrait un poteau d'un mètre quatre-vingts. Vu sur la machine de
  // démonstration : une « traverse » de 382 à 2 217 mm.
  const irregulier = {
    ...profilPlein,
    hautParX: [
      ...Array.from({ length: 6 }, (_, k) => col(-1000 + k * 50, -600, 600, zSol + 600)),
      ...Array.from({ length: 6 }, (_, k) => col(700 + k * 50, -600, 600, zSol + 1303)),
    ],
    topMm: zSol + 1303,
  };

  const traverses = blockingBoxes(crate, irregulier).filter((b) => b.name.startsWith('traverse_'));
  assert.ok(traverses.length >= 1, 'la partie haute doit recevoir sa traverse');
  for (const t of traverses) {
    assert.ok(t.z >= zSol + 1303 - 1e-6, `traverse posée à ${Math.round(t.z)}, sous la partie haute`);
    assert.ok(t.height < 200, `traverse de ${Math.round(t.height)} mm : c’est un poteau, pas une traverse`);
  }
});

test('une colonne au ras de la paroi produit quand même sa cale', () => {
  // Deux traverses de maintien avaient disparu en silence : centrées sur les
  // colonnes extrêmes, elles débordaient, et le bornage les rabotait à néant.
  // La caisse était juste et la machine n'était plus tenue par le haut.
  // Les colonnes du profil sont fines (50 mm) : une cale de 300 mm en couvre
  // plusieurs, et elle est remesurée sur celles qu'elle couvre vraiment.
  const bande = (centre: number) =>
    Array.from({ length: 8 }, (_, k) => col(centre + (k - 4) * 50, -600, 600, zSol + 1200));

  const auRas = {
    ...profilPlein,
    hautParX: [...bande(-crate.outer.lengthMm / 2 + 200), ...bande(crate.outer.lengthMm / 2 - 200)],
  };

  const traverses = blockingBoxes(crate, auRas).filter((b) => b.name.startsWith('traverse_'));
  assert.ok(traverses.length >= 2, 'les traverses des colonnes extrêmes doivent survivre au bornage');
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

test('aucune cale ne traverse la machine, sur une géométrie irrégulière', () => {
  // Invariant de bout en bout : nuage → placement → profil → cales, puis on
  // vérifie qu'aucun sommet de la machine n'est à l'intérieur d'une cale.
  // C'est ce test qui manquait : trois défauts successifs — cale déplacée hors
  // de sa colonne, colonnes agrégées par leur centre au lieu de leur
  // chevauchement, matière rare écartée du relevé — ont chacun produit des
  // cales traversantes qu'aucun test ne voyait.
  const pts: Array<[number, number, number]> = [];
  const ajouter = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    for (const x of [x0, (x0 + x1) / 2, x1])
      for (const y of [y0, (y0 + y1) / 2, y1])
        for (const z of [z0, (z0 + z1) / 2, z1]) pts.push([x, y, z]);
  };

  // Un socle large et bas, une colonne étroite et haute décalée, un bras en
  // porte-à-faux : les trois formes qui piègent un calage.
  ajouter(-1200, 1200, -700, 700, 0, 300);
  ajouter(600, 900, -200, 200, 300, 1800);
  ajouter(-400, 900, -150, 150, 1500, 1800);

  const cloud: VertexCloud = { count: pts.length, xyz: Float64Array.from(pts.flat()) };
  const machine = buildCrate({ lengthMm: 2400, widthMm: 1400, heightMm: 1800 }, 2_000);
  const floorTop = machine.skid.heightMm + machine.floorThicknessMm;

  const placement = placeForPose(cloud, 'z', 0, 1, floorTop);
  const cales = blockingBoxes(machine, machineProfile(cloud, 'z', placement, 1, floorTop));
  assert.ok(cales.length > 0, 'la géométrie doit produire des cales');

  for (const b of cales) {
    for (const [px, py, pz] of pts) {
      const x = px + placement.translateMm[0];
      const y = py + placement.translateMm[1];
      const z = pz + placement.translateMm[2];
      const dedans =
        x > b.x + 1 && x < b.x + b.width - 1 &&
        y > b.y + 1 && y < b.y + b.depth - 1 &&
        z > b.z + 1 && z < b.z + b.height - 1;
      assert.ok(!dedans, `${b.name} traverse la machine en ${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}`);
    }
  }
});
