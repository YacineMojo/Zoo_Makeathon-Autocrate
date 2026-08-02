import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrate, isStackable, blockingAllowanceMm3 } from './structure.js';
import { blockingBoxes } from '../engine/calage.js';
import { WOOD_DENSITY_KG_M3 } from '../domain/assumptions.js';
import { checkGabarit, checkAll, cheapestFit, explain } from './verdict.js';
import { study, savings, type PoseInput } from './etude.js';
import { GABARITS } from '../domain/gabarits.js';
import type { Triplet } from '../domain/types.js';

const gabarit = (id: string) => GABARITS.find((g) => g.id === id)!;

/**
 * Hauteur de machine donnant une caisse d'une hauteur voulue.
 *
 * Les tests de seuil doivent porter sur le seuil, pas sur la valeur du moment
 * des jeux de calage. On déduit donc l'écart caisse/machine du moteur lui-même :
 * si une hypothèse change, le test suit au lieu de casser.
 */
function machinePourCaisse(hauteurCaisseMm: number, massKg: number): number {
  const sonde = buildCrate({ lengthMm: 2000, widthMm: 1500, heightMm: 1000 }, massKg);
  return hauteurCaisseMm - (sonde.outer.heightMm - 1000);
}

/** Idem en largeur. */
function machinePourCaisseLargeur(largeurCaisseMm: number, massKg: number): number {
  const sonde = buildCrate({ lengthMm: 2000, widthMm: 1500, heightMm: 1000 }, massKg);
  return largeurCaisseMm - (sonde.outer.widthMm - 1500);
}

/* ------------------------------------------------------------------ caisse */

test('la caisse est plus grande que la machine, dans les trois dimensions', () => {
  const machine: Triplet = { lengthMm: 2000, widthMm: 1500, heightMm: 1800 };
  const crate = buildCrate(machine, 2_000);

  assert.ok(crate.outer.lengthMm > machine.lengthMm);
  assert.ok(crate.outer.widthMm > machine.widthMm);
  assert.ok(crate.outer.heightMm > machine.heightMm);
});

test('la hauteur hors tout est la somme explicite de ses postes', () => {
  // Si cette égalité casse, c'est qu'un poste a été ajouté sans être compté
  // dans le verdict — exactement l'erreur silencieuse que redoute le §6.4.
  const crate = buildCrate({ lengthMm: 2000, widthMm: 1500, heightMm: 1800 }, 2_000);
  assert.equal(
    crate.outer.heightMm,
    crate.skid.heightMm + crate.floorThicknessMm + crate.inner.heightMm + crate.panelThicknessMm
  );
});

test('les patins grossissent avec la masse, et la caisse monte avec eux', () => {
  const machine: Triplet = { lengthMm: 2000, widthMm: 1500, heightMm: 1800 };
  const leger = buildCrate(machine, 800);
  const lourd = buildCrate(machine, 20_000);

  assert.ok(lourd.skid.heightMm > leger.skid.heightMm);
  assert.ok(lourd.outer.heightMm > leger.outer.heightMm);
});

test('une masse ou une emprise absurde est refusée, pas silencieusement acceptée', () => {
  assert.throws(() => buildCrate({ lengthMm: 0, widthMm: 1, heightMm: 1 }, 100), /Emprise/);
  assert.throws(() => buildCrate({ lengthMm: 1, widthMm: 1, heightMm: 1 }, 0), /Masse/);
});

/* ----------------------------------------------------------------- verdict */

test('c’est la caisse qui est confrontée au gabarit, pas la machine', () => {
  // Machine à 2,30 m : elle « rentrerait » dans un 40' standard (2,39 m).
  // Sa caisse, patins compris, non. C'est tout l'objet du §6.4.
  const machine: Triplet = { lengthMm: 3000, widthMm: 1800, heightMm: 2300 };
  const crate = buildCrate(machine, 4_000);

  assert.ok(machine.heightMm < gabarit('40-std').maxHeightMm);
  assert.ok(crate.outer.heightMm > gabarit('40-std').maxHeightMm);
  assert.equal(checkGabarit(crate, gabarit('40-std')).fits, false);
});

test('la porte est vérifiée séparément du volume intérieur', () => {
  // Cible : une caisse plus basse que la hauteur intérieure du 40' HC (2690)
  // mais plus haute que son ouverture de porte (2580).
  const hc = gabarit('40-hc');
  const machine: Triplet = { lengthMm: 3000, widthMm: 1600, heightMm: 2388 };
  const crate = buildCrate(machine, 2_000);

  assert.ok(
    crate.outer.heightMm < hc.maxHeightMm && crate.outer.heightMm > hc.doorHeightMm!,
    `hauteur de caisse ${crate.outer.heightMm} mm hors de la fenêtre visée`
  );

  const check = checkGabarit(crate, hc);
  assert.equal(check.fits, false);
  assert.deepEqual(check.reasons, ['porte-hauteur']);
});

test('la charge utile est une raison de refus à part entière', () => {
  const crate = buildCrate({ lengthMm: 3000, widthMm: 1600, heightMm: 1500 }, 30_000);
  const check = checkGabarit(crate, gabarit('40-std'));
  assert.ok(check.reasons.includes('charge'));
});

test('la marge la plus faible est rendue, y compris quand ça passe', () => {
  const crate = buildCrate({ lengthMm: 3000, widthMm: 1600, heightMm: 1200 }, 2_000);
  const check = checkGabarit(crate, gabarit('40-std'));
  assert.equal(check.fits, true);
  assert.ok(check.tightestMarginMm > 0);
});

/* -------------------------------------------------- le seuil, à 3 cm près */

test('trois centimètres font basculer le verdict et multiplient la facture', () => {
  // C'est la thèse du projet (§2) : « le coût réel n'est pas le m³ d'air
  // transporté, c'est le franchissement de seuil ».
  const base = { lengthMm: 2000, widthMm: 1500 };
  const juste = machinePourCaisse(gabarit('semi').maxHeightMm, 2_000);
  const dessous = buildCrate({ ...base, heightMm: juste }, 2_000);
  const dessus = buildCrate({ ...base, heightMm: juste + 30 }, 2_000);

  assert.equal(dessus.outer.heightMm - dessous.outer.heightMm, 30);

  const passe = cheapestFit(dessous, checkAll(dessous));
  const passePlus = cheapestFit(dessus, checkAll(dessus));

  assert.ok(passe, 'la caisse basse doit trouver un gabarit');
  assert.equal(passe.gabarit.id, 'semi');
  assert.equal(passePlus, undefined, 'trois centimètres plus haut, plus aucun gabarit');
});

test('le franchissement de seuil coûte un facteur, pas un pourcentage', () => {
  const base = { lengthMm: 2000, widthMm: 1500 };
  const poses = (heightMm: number): PoseInput[] => [
    { pose: 'A', label: 'Pose A', footprint: { ...base, heightMm }, lying: false },
  ];

  // Mode route : c'est le gabarit au plafond le plus haut (2,75 m), donc le
  // dernier seuil avant le hors gabarit. C'est là que la marche est la plus nette.
  const juste = machinePourCaisse(gabarit('semi').maxHeightMm, 2_000);
  const dessous = study({ poses: poses(juste), massKg: 2_000, mode: 'route' });
  const dessus = study({ poses: poses(juste + 30), massKg: 2_000, mode: 'route' });

  assert.ok(dessous.best, 'sous le seuil, une pose passe');
  assert.equal(dessus.best, undefined, 'au-dessus, aucune');
  assert.ok(dessus.fallbacks, 'et les deux issues du §6.5 sont chiffrées');

  const avant = dessous.best.costing.totalEur;
  const apres = dessus.fallbacks.oversize.totalEur;
  assert.ok(apres > 2 * avant, `attendu un facteur, obtenu ${avant} € → ${apres} €`);

  // Le délai est l'argument qu'on ne peut pas balayer : rater une fenêtre
  // d'expédition coûte plus cher que le fret (§2).
  assert.ok(dessus.fallbacks.oversize.leadTimeDays > 3 * dessous.best.costing.leadTimeDays);
});

/* ------------------------------------------------------------------ étude */

test('les deux issues sont chiffrées quand aucune pose ne passe', () => {
  const enorme: Triplet = { lengthMm: 6000, widthMm: 3200, heightMm: 3400 };
  const result = study({
    poses: [{ pose: 'A', label: 'Pose A', footprint: enorme, lying: false }],
    massKg: 12_000,
  });

  assert.equal(result.best, undefined);
  assert.ok(result.fallbacks);
  assert.ok(result.fallbacks.oversize.totalEur > 0);
  assert.ok(result.fallbacks.split.totalEur > 0);
  // Le démontage suppose une hypothèse de partage : elle est rendue, pas cachée.
  assert.ok(result.fallbacks.split.assumedHalves.lengthMm < enorme.lengthMm);
});

test('au-delà de la largeur réglementaire, c’est du convoi exceptionnel', () => {
  const large: Triplet = { lengthMm: 6000, widthMm: 3200, heightMm: 3400 };
  const etroit: Triplet = { lengthMm: 6000, widthMm: 1500, heightMm: 3400 };

  const a = study({ poses: [{ pose: 'A', label: 'A', footprint: large, lying: false }], massKg: 12_000 });
  const b = study({ poses: [{ pose: 'A', label: 'A', footprint: etroit, lying: false }], massKg: 12_000 });

  assert.match(a.fallbacks!.oversize.label, /convoy/i);
  assert.ok(a.fallbacks!.oversize.leadTimeDays > b.fallbacks!.oversize.leadTimeDays);
});

test('quand aucun conteneur ne passe, une solution routière est proposée avant le convoi', () => {
  // Caisse à 2,73 m : au-dessus de tout gabarit maritime, sous le plafond du
  // semi-remorque. Annoncer un convoi exceptionnel ici serait faux.
  const machine: Triplet = { lengthMm: 3000, widthMm: 1300, heightMm: 2517 };
  const result = study({
    poses: [{ pose: 'C', label: 'Pose C', footprint: machine, lying: true }],
    massKg: 2_350,
  });

  assert.equal(result.best, undefined, 'rien ne passe en maritime');
  assert.ok(result.otherMode, 'mais la route est proposée');

  // Et la pose elle-même porte sa solution : la colonne du tableau ne doit pas
  // afficher « hors gabarit » sur une ligne dont le bandeau dit qu'elle passe.
  const pose = result.poses.find((p) => p.pose === 'C')!;
  assert.ok(pose.otherMode, 'la pose porte l’option de l’autre mode');
  assert.equal(pose.otherMode.gabarit.gabarit.id, 'semi');
  assert.ok(pose.otherMode.costing.totalEur < pose.costing.totalEur);
  assert.equal(result.otherMode.mode, 'route');
  assert.equal(result.otherMode.gabaritLabel, 'Road trailer');
  assert.ok(result.otherMode.marginMm > 0);

  // Et elle coûte bien moins que le hors gabarit qu'on aurait annoncé sinon.
  assert.ok(result.otherMode.costing.totalEur < result.fallbacks!.oversize.totalEur / 2);
});

test('la référence naïve ne peut pas être retenue comme meilleure pose', () => {
  const petit: Triplet = { lengthMm: 1500, widthMm: 1200, heightMm: 1000 };
  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: petit, lying: false },
      { pose: 'A', label: 'Pose A', footprint: { ...petit, heightMm: 1100 }, lying: false },
    ],
    massKg: 1_500,
  });

  assert.equal(result.best?.pose, 'A');
});

test('couchage interdit : la pose est écartée mais reste calculée et affichée', () => {
  // Debout : caisse à 2,51 m — passe en High Cube, pas en 40' standard.
  // Couchée : caisse à 1,41 m — le 40' standard s'ouvre, et il est moins cher.
  const debout: Triplet = { lengthMm: 1500, widthMm: 1200, heightMm: 2300 };
  const couchee: Triplet = { lengthMm: 2300, widthMm: 1500, heightMm: 1200 };

  const poses: PoseInput[] = [
    { pose: 'A', label: 'Debout', footprint: debout, lying: false },
    { pose: 'B', label: 'Couchée', footprint: couchee, lying: true },
  ];

  const libre = study({ poses, massKg: 1_500 });
  const bride = study({ poses, massKg: 1_500, forbidLying: true });

  assert.equal(libre.best?.pose, 'B', 'sans contrainte, la pose couchée gagne');
  // Couchée, la caisse tombe sous 2,20 m et six mètres cubes : le groupage la
  // prend, et il est bien moins cher qu'un conteneur complet. C'est exactement
  // le seuil que rencontre un constructeur qui expédie cinq machines par an.
  assert.equal(libre.best?.retained?.gabarit.id, 'lcl');
  assert.equal(bride.best?.pose, 'A', 'avec la contrainte, on retombe sur la pose debout');
  // Debout, 2,51 m : trop haute pour le groupage comme pour un 40' standard.
  assert.equal(bride.best?.retained?.gabarit.id, '40-hc');
  assert.ok(bride.best!.costing.totalEur > libre.best!.costing.totalEur * 2);

  const ecartee = bride.poses.find((p) => p.pose === 'B')!;
  assert.ok(ecartee.forbidden, 'la pose interdite porte son motif');
  assert.ok(ecartee.crate.outer.heightMm > 0, 'et reste calculée : on n’efface pas la ligne');
});

test('le delta référence → meilleure pose est la sortie qui compte', () => {
  const naif: Triplet = { lengthMm: 2400, widthMm: 2000, heightMm: 2600 };
  const optimise: Triplet = { lengthMm: 2600, widthMm: 1500, heightMm: 1200 };

  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: naif, lying: false },
      { pose: 'B', label: 'Pose B', footprint: optimise, lying: true },
    ],
    massKg: 2_000,
  });

  const delta = savings(result)!;
  assert.ok(delta.eur > 0, 'la pose optimisée doit économiser');
  assert.ok(delta.days >= 0);
});

/* ------------------------------------------------------- cas KUKA KR 600 */

test('KUKA KR 600 : coucher la machine déplace la contrainte de la hauteur vers la largeur', () => {
  // Emprise **naïve** mesurée sur le vrai STEP pendant le spike, en mm.
  // C'est la boîte alignée sur le repère du fichier : celle du §6.2, l'« avant ».
  const mesure = { l: 2517, w: 1303, h: 2941 };
  const massKg = 2_350;

  const result = study({
    poses: [
      {
        pose: 'reference',
        label: 'Repère CAO (naïf)',
        footprint: { lengthMm: mesure.l, widthMm: mesure.w, heightMm: mesure.h },
        lying: false,
      },
      {
        pose: 'B',
        label: 'Pose B — couchée',
        footprint: { lengthMm: mesure.h, widthMm: mesure.l, heightMm: mesure.w },
        lying: true,
      },
    ],
    massKg,
  });

  const reference = result.poses.find((p) => p.pose === 'reference')!;
  const couchee = result.poses.find((p) => p.pose === 'B')!;

  // Debout, la caisse fait plus de 3,15 m : aucun gabarit, dans aucun mode.
  assert.equal(reference.retained, undefined);
  assert.ok(reference.crate.outer.heightMm > 3_100);
  // La contrainte la plus serrée est l'ouverture de porte (2 580 mm), plus
  // basse que la hauteur intérieure (2 690 mm). C'est exactement la
  // distinction du §6.4 : une charge peut rentrer dans le volume et ne pas
  // passer les portes.
  assert.equal(reference.checks.find((c) => c.gabarit.id === '40-hc')!.tightestOn, 'porte-hauteur');

  // Couchée, la hauteur cesse d'être le problème : elle tombe sous 1,6 m.
  assert.ok(couchee.crate.outer.heightMm < 1_600);

  // Mais la contrainte se déplace sur la largeur, et **ça ne passe toujours
  // pas** : 2 517 mm d'emprise naïve donnent une caisse de 2 747 mm, contre
  // 2 350 mm de largeur intérieure de conteneur.
  assert.equal(couchee.retained, undefined);
  assert.match(couchee.checks.find((c) => c.gabarit.id === '40-std')!.tightestOn, /largeur/);
  assert.ok(couchee.crate.outer.widthMm > 2_350);

  // C'est précisément la raison d'être de l'étape suivante. Cette emprise est
  // celle du **repère du fichier**, et une machine dessinée de travers y produit
  // une boîte visiblement trop grosse (§6.1) : « votre CAO est dans un repère
  // arbitraire, la caisse doit être alignée sur la machine ». Pour qu'un
  // conteneur s'ouvre, l'emprise orientée doit ramener la largeur machine sous
  // 2 120 mm — 2 350 moins les 230 mm de calage, montants et panneaux.
  assert.equal(result.best, undefined);
  assert.ok(result.fallbacks, 'les deux issues sont chiffrées en attendant');
  assert.equal(savings(result), undefined);
});

/* ------------------------------------------------------------ gerbabilité */

test('une caisse haute et lourde n’est pas déclarée gerbable', () => {
  const trapue = buildCrate({ lengthMm: 3000, widthMm: 2000, heightMm: 900 }, 2_000);
  const elancee = buildCrate({ lengthMm: 1200, widthMm: 1000, heightMm: 2400 }, 12_000);

  assert.equal(isStackable(trapue), true);
  assert.equal(isStackable(elancee), false);
});

/* ------------------------------------------------------------- mentions */

test('les mentions obligatoires sont dans la sortie, pas seulement dans le discours', () => {
  const result = study({
    poses: [{ pose: 'A', label: 'A', footprint: { lengthMm: 1500, widthMm: 1200, heightMm: 1000 }, lying: false }],
    massKg: 1_000,
  });

  assert.ok(result.notices.some((n) => /ISPM-15/.test(n)));
  assert.ok(result.notices.some((n) => /lifting plan/.test(n)));
  assert.ok(result.assumptions.length > 0);
});

/* ------------------------------------------------- nuances du lot A */

test('une marge faible est annoncée comme serrée, pas comme un simple « passe »', () => {
  // 19 mm de marge, c'est un panneau qui gondole. L'annoncer sans nuance est le
  // genre de chose qui fait revenir une caisse du port.
  // Vingt millimètres sous l'ouverture de porte : la marge est serrée par
  // construction, quelles que soient les épaisseurs de calage du moment.
  const largeur = machinePourCaisseLargeur(gabarit('40-std').doorWidthMm! - 20, 2_000);
  const large = buildCrate({ lengthMm: 3000, widthMm: largeur, heightMm: 1200 }, 2_000);
  const juste = checkGabarit(large, gabarit('40-std'));

  assert.equal(juste.fits, true);
  assert.equal(juste.confidence, 'juste');
  assert.ok(juste.tightestMarginMm < 50);
  assert.match(explain(juste), /just fits.*crate maker/);

  const confortable = checkGabarit(buildCrate({ lengthMm: 3000, widthMm: 1200, heightMm: 1200 }, 2_000), gabarit('40-std'));
  assert.equal(confortable.confidence, 'confortable');
});

test('un refus par charge utile est invariant par orientation, et le dit', () => {
  // 45 t dans une caisse d'un mètre cube : aucune pose n'y changera rien, et un
  // flat rack non plus. Proposer du hors gabarit ici serait mensonger.
  const petit: Triplet = { lengthMm: 1200, widthMm: 900, heightMm: 800 };
  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: petit, lying: false },
      { pose: 'A', label: 'Pose A', footprint: petit, lying: false },
    ],
    massKg: 45_000,
  });

  assert.equal(result.best, undefined);
  assert.ok(result.overloaded, 'le refus par masse doit être nommé');
  assert.ok(result.overloaded.grossKg > result.overloaded.maxPayloadKg);
  assert.equal(result.fallbacks, undefined, 'et aucun hors gabarit ne doit être proposé');
});

test('rien à arbitrer quand toutes les poses tombent dans le même gabarit', () => {
  // Recommander de coucher une machine pour 38 € de contreplaqué apprend au
  // lecteur à ignorer nos recommandations.
  const petit: Triplet = { lengthMm: 1500, widthMm: 1200, heightMm: 1000 };
  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: petit, lying: false },
      { pose: 'A', label: 'Pose A', footprint: petit, lying: false },
      { pose: 'B', label: 'Pose B', footprint: { lengthMm: 1500, widthMm: 1000, heightMm: 1200 }, lying: true },
    ],
    massKg: 1_500,
  });

  assert.ok(result.best);
  assert.equal(result.arbitrage, 'aucun');
  assert.equal(savings(result), undefined, 'et donc aucun « 0 € économisés » à afficher');
});

test('il y a un arbitrage dès que le gabarit ou le délai change', () => {
  const debout: Triplet = { lengthMm: 1500, widthMm: 1200, heightMm: 2400 };
  const couchee: Triplet = { lengthMm: 2400, widthMm: 1500, heightMm: 1200 };

  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: debout, lying: false },
      { pose: 'B', label: 'Pose B', footprint: couchee, lying: true },
    ],
    massKg: 1_500,
  });

  assert.equal(result.arbitrage, 'gabarit');
  assert.ok(savings(result)!.eur > 0);
});

test('le calage est compté dans la tare, et l’estimation reste conservatrice', () => {
  // La tare entre dans la charge utile du gabarit : un calage non pesé
  // sous-estimait la masse brute de près d'un tiers.
  const machine: Triplet = { lengthMm: 3100, widthMm: 2000, heightMm: 1900 };
  const crate = buildCrate(machine, 4_000);

  const sansCalage =
    crate.tareKg - (blockingAllowanceMm3(crate.inner, crate.clearanceMm) / 1e9) * WOOD_DENSITY_KG_M3;
  assert.ok(sansCalage < crate.tareKg, 'la tare doit inclure le calage');
  assert.ok(crate.grossKg === Math.round(4_000 + crate.tareKg));

  // Et l'estimation doit majorer ce qui sera réellement dessiné.
  const dessine = blockingBoxes(crate, {
    basParX: [
      { center: -1000, min: -700, max: 700, topMm: 500, count: 40 },
      { center: 1000, min: -700, max: 700, topMm: 500, count: 40 },
    ],
    basParY: [{ center: 0, min: -1400, max: 1400, topMm: 500, count: 40 }],
    hautParX: [{ center: 0, min: -700, max: 700, topMm: 2000, count: 40 }],
    topMm: 2000,
  }).reduce((a, b) => a + b.width * b.depth * b.height, 0);

  assert.ok(
    dessine <= blockingAllowanceMm3(crate.inner, crate.clearanceMm),
    `${Math.round(dessine / 1e6)} dm³ dessinés pour ${Math.round(blockingAllowanceMm3(crate.inner, crate.clearanceMm) / 1e6)} dm³ estimés`
  );
});

/* --------------------------------------------------- découpage par corps */

/** Un corps parallélépipédique placé, tel que le viewer le verrait. */
const corps = (name: string, x: [number, number], y: [number, number], z: [number, number]) => ({
  name,
  min: [x[0], y[0], z[0]] as [number, number, number],
  max: [x[1], y[1], z[1]] as [number, number, number],
  volumeMm3: (x[1] - x[0]) * (y[1] - y[0]) * (z[1] - z[0]),
});

test('le découpage désigne les corps qui portent le dépassement', () => {
  // Un socle bas et large, plus deux corps qui montent trop haut. La coupe doit
  // porter sur ces deux-là, et sur eux seuls.
  const bodies = [
    corps('socle', [-1000, 1000], [-800, 800], [0, 600]),
    corps('armoire', [-900, -400], [-700, 700], [0, 1400]),
    corps('colonne', [700, 900], [-100, 100], [0, 3000]),
    corps('poutre', [-800, 900], [-100, 100], [2800, 3000]),
  ];

  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: { lengthMm: 2000, widthMm: 1600, heightMm: 3000 }, lying: false },
      { pose: 'A', label: 'Pose A', footprint: { lengthMm: 2000, widthMm: 1600, heightMm: 3000 }, lying: false, bodies },
    ],
    massKg: 2_000,
  });

  assert.equal(result.best, undefined, 'debout, rien ne passe');
  assert.ok(result.decoupe, 'le découpage doit être proposé');

  assert.equal(result.decoupe.corpsTotal, 4);
  assert.ok(result.decoupe.caisses.length >= 2);
  for (const c of result.decoupe.caisses) assert.ok(c.retained, `la caisse ${c.rang + 1} doit passer`);

  // Les deux corps hauts doivent finir dans une caisse autre que la première.
  const hautes = result.decoupe.caisses.slice(1).flatMap((c) => c.corps);
  assert.ok(hautes.includes('colonne') && hautes.includes('poutre'));
});

test('le découpage est moins cher que le hors gabarit, sinon il ne vaut rien', () => {
  const bodies = [
    corps('socle', [-1000, 1000], [-800, 800], [0, 600]),
    corps('mat', [0, 200], [-100, 100], [0, 3200]),
  ];

  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: { lengthMm: 2000, widthMm: 1600, heightMm: 3200 }, lying: false },
      { pose: 'A', label: 'Pose A', footprint: { lengthMm: 2000, widthMm: 1600, heightMm: 3200 }, lying: false, bodies },
    ],
    massKg: 2_000,
  });

  assert.ok(result.decoupe);
  assert.ok(
    result.decoupe.totalEur < result.fallbacks!.oversize.totalEur,
    `${result.decoupe.totalEur} € contre ${result.fallbacks!.oversize.totalEur} € hors gabarit`
  );
});

test('une pose écartée ne sert pas de base au découpage', () => {
  // Une pose interdite passe souvent très bien : la prendre pour base faisait
  // disparaître toute proposition dès que le couchage était interdit.
  const debout = { lengthMm: 1600, widthMm: 1400, heightMm: 3000 };
  const couchee = { lengthMm: 3000, widthMm: 1600, heightMm: 1400 };
  const bodies = [
    corps('socle', [-800, 800], [-700, 700], [0, 600]),
    corps('colonne', [600, 800], [-100, 100], [0, 3000]),
  ];

  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: debout, lying: false },
      { pose: 'A', label: 'Pose A', footprint: debout, lying: false, bodies },
      { pose: 'B', label: 'Pose B', footprint: couchee, lying: true, bodies },
    ],
    massKg: 2_000,
    forbidLying: true,
  });

  assert.equal(result.best, undefined);
  assert.ok(result.decoupe, 'le découpage doit se baser sur la pose autorisée');
  assert.ok(result.decoupe.caisses.slice(1).flatMap((c) => c.corps).includes('colonne'));
});

test('rien à découper quand la machine passe déjà', () => {
  const bodies = [corps('bloc', [-600, 600], [-500, 500], [0, 900])];
  const result = study({
    poses: [
      { pose: 'A', label: 'Pose A', footprint: { lengthMm: 1200, widthMm: 1000, heightMm: 900 }, lying: false, bodies },
    ],
    massKg: 1_000,
  });

  assert.ok(result.best);
  assert.equal(result.decoupe, undefined);
});

test('le découpage dit sur quelle pose il a été calculé', () => {
  // Sans cela, la scène est construite avec le placement d'une autre pose : la
  // caisse attend les pièces couchées, le maillage arrive debout, et il sort de
  // la caisse d'un mètre. Vu sur un KUKA KR 6.
  const debout = { lengthMm: 1600, widthMm: 1400, heightMm: 3000 };
  const couchee = { lengthMm: 3000, widthMm: 1600, heightMm: 1400 };
  const bodies = [
    corps('socle', [-800, 800], [-700, 700], [0, 600]),
    corps('colonne', [600, 800], [-100, 100], [0, 3000]),
  ];

  const result = study({
    poses: [
      { pose: 'reference', label: 'Repère CAO', footprint: debout, lying: false },
      { pose: 'A', label: 'Pose A', footprint: debout, lying: false, bodies },
      { pose: 'B', label: 'Pose B', footprint: couchee, lying: true, bodies },
    ],
    massKg: 2_000,
    caisses: 2,
  });

  assert.ok(result.decoupe);
  assert.ok(['A', 'B'].includes(result.decoupe.pose!), `pose « ${result.decoupe.pose} » inattendue`);
});
