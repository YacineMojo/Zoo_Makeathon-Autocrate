import type { Box } from './box.js';
import type { Crate } from '../domain/types.js';
import type { MachineSlices } from '../geometrie/tranches.js';
import { STUD_SECTION_MM } from '../domain/assumptions.js';

/**
 * Le calage (PROJECT.md §6.3).
 *
 * Jusqu'ici, « calage » désignait 60 mm de vide autour de la machine. Ces 60 mm
 * gardent leur sens — c'est l'épaisseur d'une cale — mais le vide devient des
 * pièces, posées contre la machine là où elle est réellement.
 *
 * **Ce que ces pièces sont, et ce qu'elles ne sont pas.** C'est un *principe de
 * calage* : position et encombrement, rien d'autre. Pas de nomenclature, pas de
 * clouage, pas de section justifiée par un calcul. La caisserie reste dans la
 * boucle, et le §3 tient sur cette phrase — l'outil cadre la discussion, il ne
 * remplace pas le métier.
 *
 * **Ce qu'on ne sait pas, et qu'on n'invente pas.** Où la machine accepte
 * d'être poussée. Un carter de tôle et un bâti fonte se ressemblent dans un
 * maillage. Sans matière ni arbre d'assemblage, on cale contre l'enveloppe, et
 * on le dit.
 *
 * Quatre familles, par ordre de solidité :
 *
 *   butées au sol           contre l'emprise réelle de la machine au plancher
 *   lisses de rive          raidisseurs de paroi, pure géométrie de caisse
 *   traverses de maintien   contre le dessus de la machine
 *   cales de coin           anti-glissement, aux quatre angles du plancher
 *
 * **Pas de diagonale.** Un contreventement digne de ce nom est oblique, et notre
 * modèle ne produit que des pavés alignés sur les axes. Plutôt que de baptiser
 * « contreventement » une pièce horizontale, on pose ce qu'on pose vraiment :
 * une lisse de rive à mi-hauteur, qui raidit le panneau. C'est moins flatteur et
 * c'est exact.
 */

/** Section d'une butée, dans le sens de la paroi. */
const BUTEE_LONGUEUR_MM = 300;
/** Hauteur d'une butée au sol. */
const BUTEE_HAUTEUR_MM = 150;
/** Section d'une lisse de rive. */
const LISSE_MM = 60;
/** Au-delà de cette portée, on double les butées d'un côté. */
const PORTEE_DOUBLE_BUTEE_MM = 2_000;
/** En deçà de ce jeu, il n'y a rien à caler : la machine touche déjà. */
const JEU_MINIMAL_MM = 15;

export function blockingBoxes(crate: Crate, slices: MachineSlices): Box[] {
  const { outer, inner, skid, panelThicknessMm: t, floorThicknessMm: floor } = crate;
  const st = STUD_SECTION_MM.thicknessMm;

  const zFloorTop = skid.heightMm + floor;
  const zRoof = zFloorTop + inner.heightMm;

  // Faces intérieures : panneau plus montant. C'est contre elles que les cales
  // prennent appui, pas contre le nu extérieur de la caisse.
  const interieur = {
    minX: -outer.lengthMm / 2 + t + st,
    maxX: outer.lengthMm / 2 - t - st,
    minY: -outer.widthMm / 2 + t + st,
    maxY: outer.widthMm / 2 - t - st,
  };

  const boxes: Box[] = [];

  /* ── butées au sol ──────────────────────────────────────────────────────── */

  if (slices.bas) {
    const s = slices.bas;

    // Le long des deux grands côtés : on cale en Y, sur toute l'épaisseur du
    // jeu entre la machine et la paroi.
    const posX = repartir(s.minX, s.maxX, s.maxX - s.minX > PORTEE_DOUBLE_BUTEE_MM ? 3 : 2);
    for (const [cote, jeu, y] of [
      ['a', s.minY - interieur.minY, interieur.minY],
      ['b', interieur.maxY - s.maxY, s.maxY],
    ] as const) {
      if (jeu < JEU_MINIMAL_MM) continue;
      posX.forEach((x, i) => {
        boxes.push({
          name: `butee_long_${cote}_${i + 1}`,
          x: x - BUTEE_LONGUEUR_MM / 2,
          y,
          z: zFloorTop,
          width: BUTEE_LONGUEUR_MM,
          depth: jeu,
          height: BUTEE_HAUTEUR_MM,
        });
      });
    }

    // Et de même sur les deux pignons, en X.
    const posY = repartir(s.minY, s.maxY, s.maxY - s.minY > PORTEE_DOUBLE_BUTEE_MM ? 3 : 2);
    for (const [cote, jeu, x] of [
      ['a', s.minX - interieur.minX, interieur.minX],
      ['b', interieur.maxX - s.maxX, s.maxX],
    ] as const) {
      if (jeu < JEU_MINIMAL_MM) continue;
      posY.forEach((y, i) => {
        boxes.push({
          name: `butee_pignon_${cote}_${i + 1}`,
          x,
          y: y - BUTEE_LONGUEUR_MM / 2,
          z: zFloorTop,
          width: jeu,
          depth: BUTEE_LONGUEUR_MM,
          height: BUTEE_HAUTEUR_MM,
        });
      });
    }
  }

  /* ── traverses de maintien haut ─────────────────────────────────────────── */

  const jeuHaut = zRoof - slices.topMm;
  if (slices.haut && jeuHaut >= JEU_MINIMAL_MM) {
    const s = slices.haut;
    // Positionnées au droit de la matière, pas au milieu de la caisse : une
    // traverse qui n'appuie sur rien ne maintient rien.
    repartir(s.minX, s.maxX, 2).forEach((x, i) => {
      boxes.push({
        name: `traverse_haute_${i + 1}`,
        x: x - STUD_SECTION_MM.depthMm / 2,
        y: interieur.minY,
        z: slices.topMm,
        width: STUD_SECTION_MM.depthMm,
        depth: interieur.maxY - interieur.minY,
        height: jeuHaut,
      });
    });
  }

  /* ── lisses de rive ─────────────────────────────────────────────────────── */

  // Une lisse à mi-hauteur par grand côté, contre les montants. Elle ne dépend
  // que de la caisse : aucune hypothèse sur la machine.
  for (const [cote, y] of [
    ['a', interieur.minY],
    ['b', interieur.maxY - LISSE_MM],
  ] as const) {
    boxes.push({
      name: `lisse_${cote}`,
      x: interieur.minX,
      y,
      z: zFloorTop + inner.heightMm / 2 - LISSE_MM / 2,
      width: interieur.maxX - interieur.minX,
      depth: LISSE_MM,
      height: LISSE_MM,
    });
  }

  /* ── cales de coin ──────────────────────────────────────────────────────── */

  if (slices.bas) {
    const s = slices.bas;
    for (const [nom, x, y] of [
      ['aa', s.minX, s.minY],
      ['ab', s.maxX - BUTEE_LONGUEUR_MM, s.minY],
      ['ba', s.minX, s.maxY - BUTEE_LONGUEUR_MM],
      ['bb', s.maxX - BUTEE_LONGUEUR_MM, s.maxY - BUTEE_LONGUEUR_MM],
    ] as const) {
      boxes.push({
        name: `cale_coin_${nom}`,
        x,
        y,
        z: zFloorTop,
        width: BUTEE_LONGUEUR_MM,
        depth: BUTEE_LONGUEUR_MM,
        height: BUTEE_HAUTEUR_MM / 2,
      });
    }
  }

  // Bornage final au volume intérieur.
  //
  // Une machine couchée peut ne reposer que sur une bande étroite tout au bord
  // du plancher : une cale de coin partant de cette bande sortait alors de la
  // caisse, et le contrôle d'encombrement l'a attrapée à 25 mm. Plutôt que de
  // corriger chaque famille de cale au cas par cas, on borne une fois pour
  // toutes — le calage est intérieur par définition.
  return boxes
    .map((b) => intersecter(b, interieur, zFloorTop, zRoof))
    .filter((b): b is Box => b !== undefined);
}

/** Intersection d'un pavé avec le volume intérieur. `undefined` s'il n'en reste rien. */
function intersecter(
  b: Box,
  interieur: { minX: number; maxX: number; minY: number; maxY: number },
  zMin: number,
  zMax: number
): Box | undefined {
  const x = Math.max(b.x, interieur.minX);
  const y = Math.max(b.y, interieur.minY);
  const z = Math.max(b.z, zMin);

  const width = Math.min(b.x + b.width, interieur.maxX) - x;
  const depth = Math.min(b.y + b.depth, interieur.maxY) - y;
  const height = Math.min(b.z + b.height, zMax) - z;

  // Une cale réduite à un trait ne cale rien : autant ne pas la produire.
  return width > 1 && depth > 1 && height > 1 ? { ...b, x, y, z, width, depth, height } : undefined;
}

/** `n` positions réparties entre deux bornes, sans coller aux extrémités. */
function repartir(min: number, max: number, n: number): number[] {
  if (n <= 1) return [(min + max) / 2];
  const marge = (max - min) / (2 * n);
  const utile = max - min - 2 * marge;
  return Array.from({ length: n }, (_, i) => min + marge + (i * utile) / (n - 1));
}

/** Les cales sont en bois massif : elles comptent pour la mention NIMP-15 (§7.5). */
export function isBlocking(name: string): boolean {
  return /^(butee_|traverse_|cale_|lisse_)/.test(name);
}
