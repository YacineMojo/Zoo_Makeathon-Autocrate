import type { Box } from './box.js';
import type { Crate } from '../domain/types.js';
import type { Column, MachineProfile } from '../geometrie/tranches.js';
import { agreger, sommetSous } from '../geometrie/tranches.js';
import {
  BUTEE_HAUTEUR_MM,
  BUTEES_PAR_PAROI,
  CALE_ENTRETOISE_MM,
  CALE_PLEINE_MAX_MM,
  BUTEE_LARGEUR_MM,
  LISSE_MM,
  STUD_SECTION_MM,
  TRAVERSE_MM,
} from '../domain/assumptions.js';

/**
 * Le calage (PROJECT.md §6.3).
 *
 * Jusqu'ici, « calage » désignait 60 mm de vide autour de la machine. Ces 60 mm
 * gardent leur sens — c'est l'épaisseur d'une cale — mais le vide devient des
 * pièces.
 *
 * **Une cale qui ne touche pas la pièce n'est pas une cale.** C'est la règle qui
 * gouverne tout ce fichier, et elle a coûté une réécriture : une première
 * version mesurait une seule boîte pour toute la tranche basse, et posait des
 * butées là où la machine n'était pas. Elles s'appuyaient sur la paroi et sur
 * rien d'autre — elles avaient l'air de cales sans en être.
 *
 * Chaque butée est désormais posée dans une **colonne** où la machine est
 * réellement présente à cette hauteur, et va de la paroi jusqu'à la machine
 * mesurée *dans cette colonne*. Là où la machine n'est pas, il n'y a pas de cale.
 *
 * **Ce que ces pièces sont, et ce qu'elles ne sont pas.** Un *principe de
 * calage* : position et encombrement, rien d'autre. Pas de nomenclature, pas de
 * clouage, pas de section justifiée par un calcul. La caisserie reste dans la
 * boucle, et le §3 tient sur cette phrase.
 *
 * **Ce qu'on ne sait pas, et qu'on n'invente pas.** Où la machine accepte
 * d'être poussée. Un carter de tôle et un bâti fonte se ressemblent dans un
 * maillage. Sans matière ni arbre d'assemblage, on cale contre l'enveloppe.
 *
 * **Pas de diagonale.** Un contreventement digne de ce nom est oblique, et notre
 * modèle ne produit que des pavés alignés sur les axes. Plutôt que de baptiser
 * « contreventement » une pièce horizontale, on pose ce qu'on pose vraiment :
 * une lisse de rive à mi-hauteur, qui raidit le panneau.
 */

/** Hauteur minimale en dessous de laquelle une butée ne vaut pas la peine. */
const BUTEE_HAUTEUR_MINI_MM = 40;
/** En deçà de ce jeu, il n'y a rien à caler : la machine touche déjà. */
const JEU_MINIMAL_MM = 15;
/**
 * Hauteur maximale d'une traverse de maintien.
 *
 * Au-delà, ce n'est plus une traverse mais un poteau : elle descendrait au droit
 * d'une partie basse et n'appuierait sur rien d'utile.
 */
const TRAVERSE_HAUTEUR_MAX_MM = 400;
/** Nombre de traverses posées sur une machine. */
const TRAVERSES_MAX = 3;

/**
 * Place un pavé de largeur `taille` autour de `centre`, sans sortir du volume.
 *
 * Les colonnes extrêmes tombent au ras des faces intérieures : une cale centrée
 * dessus déborde, et le bornage final la rabotait jusqu'à la faire disparaître.
 * Deux traverses de maintien ont ainsi été perdues en silence — la caisse était
 * juste, et la machine n'était plus tenue par le haut.
 */
function caler(centre: number, taille: number, min: number, max: number): number {
  return Math.min(Math.max(centre - taille / 2, min), max - taille);
}

/**
 * Un jeu à combler, en une ou deux pièces selon sa profondeur.
 *
 * Une machine peut être loin d'une paroi — trois mètres sur notre machine de
 * démonstration couchée. Un bloc de bois plein de trois mètres n'existe pas en
 * caisserie : on pose une pièce contre la machine, une contre la paroi, et on
 * laisse le vide entre les deux. Le remplissage intermédiaire est l'affaire du
 * caissier, et l'outil n'a pas à le dessiner.
 */
function combler(
  nom: string,
  depuis: number,
  jeu: number,
  autres: { transverse: number; largeur: number; z: number; hauteur: number },
  suivantX: boolean
): Box[] {
  const pavé = (debut: number, epaisseur: number, suffixe: string): Box =>
    suivantX
      ? {
          name: `${nom}${suffixe}`,
          x: debut,
          y: autres.transverse,
          z: autres.z,
          width: epaisseur,
          depth: autres.largeur,
          height: autres.hauteur,
        }
      : {
          name: `${nom}${suffixe}`,
          x: autres.transverse,
          y: debut,
          z: autres.z,
          width: autres.largeur,
          depth: epaisseur,
          height: autres.hauteur,
        };

  if (jeu <= CALE_PLEINE_MAX_MM) return [pavé(depuis, jeu, '')];

  // Deux pièces, le vide au milieu.
  return [
    pavé(depuis, CALE_ENTRETOISE_MM, '_paroi'),
    pavé(depuis + jeu - CALE_ENTRETOISE_MM, CALE_ENTRETOISE_MM, '_machine'),
  ];
}

export function blockingBoxes(crate: Crate, profile: MachineProfile): Box[] {
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

  /* ── butées au sol, contre les deux grands côtés ────────────────────────── */

  retenir(profile.basParX).forEach((pressentie, i) => {
    // La cale est d'abord **placée**, puis **remesurée sur l'emprise qu'elle
    // occupe**. Sans cela, le recadrage dans le volume utile la déplace hors de
    // la colonne où elle a été mesurée, et elle traverse la machine — 59 mm de
    // pénétration relevés sur un KR 6.
    const x = caler(pressentie.center, BUTEE_LARGEUR_MM, interieur.minX, interieur.maxX);
    const c = agreger(profile.basParX, x, x + BUTEE_LARGEUR_MM);
    if (!c) return;

    const hauteur = hauteurButee(c, zFloorTop);

    const jeuA = c.min - interieur.minY;
    if (jeuA >= JEU_MINIMAL_MM) {
      boxes.push(
        ...combler(`butee_long_a_${i + 1}`, interieur.minY, jeuA, { transverse: x, largeur: BUTEE_LARGEUR_MM, z: zFloorTop, hauteur }, false)
      );
    }

    const jeuB = interieur.maxY - c.max;
    if (jeuB >= JEU_MINIMAL_MM) {
      boxes.push(
        ...combler(`butee_long_b_${i + 1}`, c.max, jeuB, { transverse: x, largeur: BUTEE_LARGEUR_MM, z: zFloorTop, hauteur }, false)
      );
    }
  });

  /* ── butées au sol, contre les deux pignons ─────────────────────────────── */

  retenir(profile.basParY).forEach((pressentie, i) => {
    const y = caler(pressentie.center, BUTEE_LARGEUR_MM, interieur.minY, interieur.maxY);
    const c = agreger(profile.basParY, y, y + BUTEE_LARGEUR_MM);
    if (!c) return;

    const hauteur = hauteurButee(c, zFloorTop);

    const jeuA = c.min - interieur.minX;
    if (jeuA >= JEU_MINIMAL_MM) {
      boxes.push(
        ...combler(`butee_pignon_a_${i + 1}`, interieur.minX, jeuA, { transverse: y, largeur: BUTEE_LARGEUR_MM, z: zFloorTop, hauteur }, true)
      );
    }

    const jeuB = interieur.maxX - c.max;
    if (jeuB >= JEU_MINIMAL_MM) {
      boxes.push(
        ...combler(`butee_pignon_b_${i + 1}`, c.max, jeuB, { transverse: y, largeur: BUTEE_LARGEUR_MM, z: zFloorTop, hauteur }, true)
      );
    }
  });

  /* ── traverses de maintien haut ─────────────────────────────────────────── */

  // Chaque traverse descend jusqu'à la cote où la machine s'arrête **sous
  // elle**, et non jusqu'au sommet global : au droit d'une partie basse, une
  // traverse calée sur le point le plus haut ne toucherait rien.
  // Les traverses sont ce qui empêche la machine de **se soulever**. Les butées
  // la retiennent latéralement, le plancher la porte, mais rien ne s'oppose au
  // mouvement vertical sans elles — et un transport, ça saute.
  //
  // On en pose donc partout où c'est utile : au droit de matière, avec un jeu
  // suffisant pour qu'une traverse ait un sens, et pas si haut qu'elle
  // deviendrait un poteau descendu au droit d'une partie basse.
  const sommetsHauts = profile.hautParX.filter((c) => {
    const jeu = zRoof - c.topMm;
    return jeu >= JEU_MINIMAL_MM && jeu <= TRAVERSE_HAUTEUR_MAX_MM && c.topMm > zFloorTop;
  });

  retenir(sommetsHauts, TRAVERSES_MAX).forEach((pressentie, i) => {
    const x = caler(pressentie.center, TRAVERSE_MM, interieur.minX, interieur.maxX);
    // Même règle qu'au sol : la traverse est remesurée sur son emprise. Elle
    // doit reposer sur le point le plus **haut** qui passe dessous, sinon elle
    // le traverse.
    const sommet = sommetSous(profile.hautParX, x, x + TRAVERSE_MM);
    if (sommet === undefined || zRoof - sommet < JEU_MINIMAL_MM) return;

    boxes.push({
      name: `traverse_haute_${i + 1}`,
      x,
      y: interieur.minY,
      z: sommet,
      width: TRAVERSE_MM,
      depth: interieur.maxY - interieur.minY,
      height: zRoof - sommet,
    });
  });

  /* ── lisses de rive ─────────────────────────────────────────────────────── */

  // Une lisse à mi-hauteur par grand côté, contre les montants. Elle ne dépend
  // que de la caisse : aucune hypothèse sur la machine, et donc aucun risque de
  // la caler contre du vide.
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

  // Bornage final au volume intérieur. Une machine couchée peut ne reposer que
  // sur une bande tout au bord du plancher : sans ce garde-fou, une cale en
  // sortirait. Le contrôle d'encombrement l'avait attrapée à 25 mm.
  return boxes
    .map((b) => intersecter(b, interieur, zFloorTop, zRoof))
    .filter((b): b is Box => b !== undefined);
}

/**
 * Hauteur d'une butée dans une colonne donnée.
 *
 * Inutile de monter plus haut que la machine : une butée qui dépasse la pièce
 * qu'elle retient ne retient rien de plus, et se voit dans le rendu.
 */
function hauteurButee(c: Column, zFloorTop: number): number {
  return Math.max(BUTEE_HAUTEUR_MINI_MM, Math.min(BUTEE_HAUTEUR_MM, c.topMm - zFloorTop));
}

/**
 * Retient au plus `n` colonnes, réparties sur l'étendue occupée.
 *
 * Poser une cale dans chaque colonne encombrerait sans rien tenir de plus. On
 * garde les extrêmes — c'est là que la machine risque de partir — et on répartit
 * le reste.
 */
function retenir(colonnes: Column[], n = BUTEES_PAR_PAROI): Column[] {
  if (colonnes.length <= n) return colonnes;
  const pas = (colonnes.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => colonnes[Math.round(i * pas)]!);
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

/** Les cales sont en bois massif : elles comptent pour la mention NIMP-15 (§7.5). */
export function isBlocking(name: string): boolean {
  return /^(butee_|traverse_|cale_|lisse_)/.test(name);
}
