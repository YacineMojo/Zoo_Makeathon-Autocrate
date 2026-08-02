import type { Assumption } from './types.js';

/**
 * Les règles de l'art, paramétrées.
 *
 * **Ce fichier n'est pas une note de calcul bois** (PROJECT.md §6.3). Ce sont des
 * valeurs d'avant-projet, tenables en réunion, affichées à l'écran avec leur
 * justification pour que le lecteur sache exactement ce qu'il regarde.
 *
 * Toute valeur ici est susceptible d'être discutée par la caisserie — c'est
 * voulu : l'avant-projet cadre la discussion, il ne la remplace pas.
 */

/**
 * Sections du calage. Elles ne sont pas décoratives : elles **occupent le jeu**.
 *
 * C'est le piège que ce fichier a failli laisser passer. Une lisse de 60 mm
 * logée dans un jeu de 60 mm consomme la totalité de la garde, et il ne reste
 * rien pour ce que ces mêmes hypothèses annoncent — la tolérance de mise en
 * place. Sur le papier, la machine ne rentre plus dans sa caisse.
 *
 * Le jeu est donc défini comme une somme, et la somme est affichée.
 */
export const LISSE_MM = 45;
export const TRAVERSE_MM = 70;

/**
 * Tolérance de mise en place : ce qui reste libre une fois le calage posé.
 *
 * Une machine ne se descend pas au millimètre dans une caisse, et il faut
 * pouvoir passer les élingues.
 */
export const TOLERANCE_POSE_MM = 25;

/** Jeu de calage entre la machine et la paroi intérieure, sur chaque face. */
export const CLEARANCE_MM = LISSE_MM + TOLERANCE_POSE_MM;

/** Jeu au-dessus de la machine : traverse de maintien plus tolérance. */
export const TOP_CLEARANCE_MM = TRAVERSE_MM + TOLERANCE_POSE_MM;

/** Hauteur d'une butée au sol, et largeur d'une colonne de calage. */
export const BUTEE_HAUTEUR_MM = 150;
/** Largeur d'une butée, dans le sens de la paroi. */
export const BUTEE_LARGEUR_MM = 300;
/**
 * Au-delà de cette profondeur, on ne remplit plus le jeu de bois plein.
 *
 * Un bloc massif de trois mètres n'existe pas en caisserie : on pose une pièce
 * contre la machine, une contre la paroi, et on laisse le vide entre les deux.
 * Le remplissage intermédiaire est l'affaire du caissier.
 */
export const CALE_PLEINE_MAX_MM = 250;
/** Épaisseur des deux pièces d'un calage à vide. */
export const CALE_ENTRETOISE_MM = 120;
/** Nombre maximum de butées par paroi. */
export const BUTEES_PAR_PAROI = 3;

/** Contreplaqué de caisserie maritime. */
export const PANEL_THICKNESS_MM = 10;

/**
 * Section des patins selon la masse brute.
 *
 * C'est la ligne la plus importante du fichier : la hauteur de patin s'ajoute
 * intégralement à la hauteur hors tout, et 100 à 140 mm suffisent à faire
 * basculer un verdict de gabarit (§6.4).
 */
export const SKID_TABLE: ReadonlyArray<{ upToKg: number; heightMm: number; widthMm: number }> = [
  { upToKg: 1_000, heightMm: 75, widthMm: 100 },
  { upToKg: 3_000, heightMm: 100, widthMm: 100 },
  { upToKg: 6_000, heightMm: 120, widthMm: 150 },
  { upToKg: 12_000, heightMm: 140, widthMm: 150 },
  { upToKg: 25_000, heightMm: 180, widthMm: 200 },
  { upToKg: Infinity, heightMm: 200, widthMm: 250 },
];

/**
 * Section des montants du cadre.
 *
 * Les panneaux sont cloués sur la face extérieure des montants : les 45 mm
 * d'épaisseur s'ajoutent donc à l'encombrement, de chaque côté. C'est encore du
 * millimètre qui compte au moment du verdict.
 */
export const STUD_SECTION_MM = { thicknessMm: 45, depthMm: 70 };

/** Épaisseur du plancher posé sur les patins. */
export function floorThicknessMm(grossKg: number): number {
  return grossKg <= 3_000 ? 22 : 30;
}

/** Entraxe des montants, resserré quand la portée ou la masse augmentent. */
export function studSpacingMm(spanMm: number, massKg: number): number {
  if (massKg > 10_000 || spanMm > 4_000) return 400;
  if (massKg > 3_000 || spanMm > 2_500) return 500;
  return 600;
}

/** Nombre de patins : trois dès que la portée dépasse 2,4 m, puis un de plus tous les 1,5 m. */
export function skidCount(lengthMm: number): number {
  return Math.max(2, 2 + Math.ceil(Math.max(0, lengthMm - 2_400) / 1_500));
}

/** Masse volumique moyenne du bois de caisserie, résineux séché. */
export const WOOD_DENSITY_KG_M3 = 500;
/** Masse volumique du contreplaqué. */
export const PLYWOOD_DENSITY_KG_M3 = 650;

/**
 * Une caisse est déclarée gerbable si elle a un chapeau capable de reprendre une
 * charge, ce qu'on approxime par une limite de masse et d'élancement.
 */
export const STACKABLE_MAX_GROSS_KG = 8_000;
export const STACKABLE_MAX_SLENDERNESS = 1.6;

/**
 * Table affichée à l'écran.
 *
 * En lecture seule : le principe des hypothèses éditables est gardé, l'édition
 * ne l'est pas — c'est du state management pour zéro point au jury (§10).
 */
export const ASSUMPTIONS: ReadonlyArray<Assumption> = [
  {
    id: 'clearance',
    label: 'Side blocking clearance',
    value: `${CLEARANCE_MM} mm per face: ${LISSE_MM} of rail plus ${TOLERANCE_POSE_MM} of tolerance`,
    rationale:
      'The clearance is what the blocking occupies plus what has to stay free. Blocking that fills the whole gap leaves nothing to lower the machine through, and on paper it no longer fits its own crate.',
  },
  {
    id: 'top-clearance',
    label: 'Clearance above the machine',
    value: `${TOP_CLEARANCE_MM} mm: ${TRAVERSE_MM} of cross member plus ${TOLERANCE_POSE_MM} of tolerance`,
    rationale: 'Same rule vertically: the retaining cross member takes its share, and the tolerance covers lowering into the crate and passing the slings.',
  },
  {
    id: 'panel',
    label: 'Panel thickness',
    value: `${PANEL_THICKNESS_MM} mm plywood`,
    rationale: 'Marine crating plywood. A wood product, so outside the scope of ISPM-15.',
  },
  {
    id: 'skid',
    label: 'Skid height',
    value: '75 to 200 mm depending on gross mass',
    rationale:
      'Adds in full to the overall height. This is the item that tips a gauge verdict, and the reason the crate is checked against the gauge, never the machine.',
  },
  {
    id: 'floor',
    label: 'Floor thickness',
    value: '22 mm up to 3 t, 30 mm above',
    rationale: 'Floor nailed onto the skids, sized from the gross mass.',
  },
  {
    id: 'studs',
    label: 'Studs',
    value: `${STUD_SECTION_MM.thicknessMm} × ${STUD_SECTION_MM.depthMm} mm section, 400 to 600 mm spacing`,
    rationale:
      'Spacing tightens with span and mass. Panels are nailed to the outer face, so the stud thickness adds to the overall size on each side.',
  },
  {
    id: 'calage',
    label: 'Blocking',
    value: `${BUTEE_HAUTEUR_MM} mm stops, ${TRAVERSE_MM} mm cross members, ${LISSE_MM} mm rails`,
    rationale:
      'A blocking principle: where the blocks sit and how much room they take, measured against the real envelope of the machine slice by slice. Without material and an assembly tree no bearing point can be named, so the blocking bears on the envelope and the crate maker decides.',
  },
  {
    id: 'stackable',
    label: 'Stackability',
    value: `≤ ${(STACKABLE_MAX_GROSS_KG / 1000).toFixed(0)} t and slenderness ≤ ${STACKABLE_MAX_SLENDERNESS}`,
    rationale:
      'A preliminary approximation. Beyond that, load transfer through the cap needs a study this tool does not perform.',
  },
  {
    id: 'wood-density',
    label: 'Wood density',
    value: `${WOOD_DENSITY_KG_M3} kg/m³ softwood, ${PLYWOOD_DENSITY_KG_M3} kg/m³ plywood`,
    rationale: 'Used to estimate the crate tare, which counts against the gauge payload.',
  },
];
