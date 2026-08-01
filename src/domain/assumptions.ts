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

/** Jeu de calage entre la machine et la paroi intérieure, sur chaque face. */
export const CLEARANCE_MM = 60;

/** Jeu supplémentaire au-dessus de la machine : passage des élingues et du calage haut. */
export const TOP_CLEARANCE_MM = 80;

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
    label: 'Jeu de calage latéral',
    value: `${CLEARANCE_MM} mm par face`,
    rationale:
      'Passage du calage et tolérance de mise en place. Une machine ne se pose pas au millimètre dans une caisse.',
  },
  {
    id: 'top-clearance',
    label: 'Jeu au-dessus de la machine',
    value: `${TOP_CLEARANCE_MM} mm`,
    rationale: 'Calage haut et passage des élingues lors de la descente en caisse.',
  },
  {
    id: 'panel',
    label: 'Épaisseur des panneaux',
    value: `contreplaqué ${PANEL_THICKNESS_MM} mm`,
    rationale: 'Contreplaqué de caisserie maritime. Dérivé du bois : hors périmètre NIMP-15.',
  },
  {
    id: 'skid',
    label: 'Hauteur de patin',
    value: '75 à 200 mm selon la masse brute',
    rationale:
      "S'ajoute intégralement à la hauteur hors tout. C'est le poste qui fait basculer un verdict de gabarit, et la raison pour laquelle on confronte la caisse au gabarit, jamais la machine.",
  },
  {
    id: 'floor',
    label: 'Épaisseur de plancher',
    value: '22 mm jusqu’à 3 t, 30 mm au-delà',
    rationale: 'Plancher cloué sur patins, dimensionné à la masse brute.',
  },
  {
    id: 'studs',
    label: 'Montants',
    value: `section ${STUD_SECTION_MM.thicknessMm} × ${STUD_SECTION_MM.depthMm} mm, entraxe 400 à 600 mm`,
    rationale:
      'Entraxe resserré selon la portée et la masse. Les panneaux étant cloués sur la face extérieure, l’épaisseur des montants s’ajoute à l’encombrement de chaque côté.',
  },
  {
    id: 'stackable',
    label: 'Gerbabilité',
    value: `≤ ${(STACKABLE_MAX_GROSS_KG / 1000).toFixed(0)} t et élancement ≤ ${STACKABLE_MAX_SLENDERNESS}`,
    rationale:
      'Approximation d’avant-projet : au-delà, la reprise de charge du chapeau demande une étude que cet outil ne fait pas.',
  },
  {
    id: 'wood-density',
    label: 'Masse volumique du bois',
    value: `${WOOD_DENSITY_KG_M3} kg/m³ (résineux), ${PLYWOOD_DENSITY_KG_M3} kg/m³ (CP)`,
    rationale: 'Sert à estimer la tare de la caisse, qui compte dans la charge utile du gabarit.',
  },
];
