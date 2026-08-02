import type { Crate, Triplet } from '../domain/types.js';
import {
  BUTEE_HAUTEUR_MM,
  BUTEES_PAR_PAROI,
  CALE_ENTRETOISE_MM,
  CALE_PLEINE_MAX_MM,
  CLEARANCE_MM,
  COLONNE_MM,
  LISSE_MM,
  TRAVERSE_MM,
  PANEL_THICKNESS_MM,
  PLYWOOD_DENSITY_KG_M3,
  SKID_TABLE,
  STACKABLE_MAX_GROSS_KG,
  STACKABLE_MAX_SLENDERNESS,
  STUD_SECTION_MM,
  TOP_CLEARANCE_MM,
  WOOD_DENSITY_KG_M3,
  floorThicknessMm,
  skidCount,
  studSpacingMm,
} from '../domain/assumptions.js';

/**
 * Dimensionnement de la caisse (PROJECT.md §6.3).
 *
 * Que des boîtes. Aucun booléen, aucun congé, aucun assemblage réel — ni vis,
 * ni feuillure, ni équerre. Personne ne le remarquera sur un avant-projet, et
 * c'est ce qui rend la caisse générable en une session Zoo.
 *
 * La fonction est pure : mêmes entrées, mêmes sorties, aucune CAO. C'est le
 * morceau dont on est certain qu'il marchera (§12).
 */

const mm3ToM3 = (v: number) => v / 1e9;

/** Section de patin correspondant à une masse. */
function pickSkid(massKg: number) {
  const row = SKID_TABLE.find((r) => massKg <= r.upToKg) ?? SKID_TABLE[SKID_TABLE.length - 1]!;
  return { heightMm: row.heightMm, widthMm: row.widthMm };
}

/**
 * Construit la caisse autour d'une emprise.
 *
 * `machine` est l'emprise **dans la pose considérée** : la fonction ne sait rien
 * des poses et n'a pas à le savoir. Une fois les trois emprises obtenues, tout
 * le reste est de l'arithmétique sur un triplet (§6.2).
 */
export function buildCrate(machine: Triplet, massKg: number): Crate {
  if (machine.lengthMm <= 0 || machine.widthMm <= 0 || machine.heightMm <= 0) {
    throw new Error('Emprise machine invalide : les trois dimensions doivent être positives.');
  }
  if (massKg <= 0) {
    throw new Error('Masse invalide : un STEP ne porte pas de matériau, la masse est saisie (§5).');
  }

  // Les patins se dimensionnent à la masse de la machine : c'est elle qu'ils
  // portent, et c'est de toute façon la règle du métier — raison pour laquelle
  // le centre de gravité n'est pas nécessaire (§10).
  const skid = pickSkid(massKg);

  const clearance = CLEARANCE_MM;
  const studT = STUD_SECTION_MM.thicknessMm;

  // Volume intérieur libre : la machine plus son calage.
  const inner: Triplet = {
    lengthMm: machine.lengthMm + 2 * clearance,
    widthMm: machine.widthMm + 2 * clearance,
    heightMm: machine.heightMm + TOP_CLEARANCE_MM,
  };

  const floor = floorThicknessMm(massKg);

  // Encombrement extérieur. C'est **lui** qu'on confrontera au gabarit — jamais
  // l'emprise machine. Comparer la machine aux cotes de porte est une erreur
  // silencieuse et fatale en Q&A (§6.4).
  const outer: Triplet = {
    lengthMm: inner.lengthMm + 2 * (studT + PANEL_THICKNESS_MM),
    widthMm: inner.widthMm + 2 * (studT + PANEL_THICKNESS_MM),
    heightMm: skid.heightMm + floor + inner.heightMm + PANEL_THICKNESS_MM,
  };

  const skids = skidCount(outer.lengthMm);
  const spacing = studSpacingMm(Math.max(outer.lengthMm, outer.widthMm), massKg);

  // Tare : elle compte dans la charge utile du gabarit, donc on l'estime au lieu
  // de l'ignorer. Approximation volumique, cohérente avec un avant-projet.
  const skidVolumeMm3 = skids * skid.heightMm * skid.widthMm * outer.widthMm;
  const floorVolumeMm3 = outer.lengthMm * outer.widthMm * floor;

  const perimeterMm = 2 * (outer.lengthMm + outer.widthMm);
  const studCount = Math.ceil(perimeterMm / spacing);
  const studVolumeMm3 = studCount * studT * STUD_SECTION_MM.depthMm * inner.heightMm;

  const panelAreaMm2 =
    2 * outer.lengthMm * outer.heightMm +
    2 * outer.widthMm * outer.heightMm +
    outer.lengthMm * outer.widthMm;
  const panelVolumeMm3 = panelAreaMm2 * PANEL_THICKNESS_MM;

  // Le calage compte. Il pèse, et la tare entre dans la charge utile du
  // gabarit : l'ignorer sous-estimait la masse brute de près d'un tiers. Le
  // volume est estimé ici, sur les seules cotes de la caisse, pour que le
  // moteur reste pur ; la géométrie réelle est dessinée plus tard et reste
  // sous cette enveloppe.
  const blockingVolumeMm3 = blockingAllowanceMm3(inner, clearance);

  const solidWoodM3 = mm3ToM3(skidVolumeMm3 + floorVolumeMm3 + studVolumeMm3 + blockingVolumeMm3);
  const plywoodM3 = mm3ToM3(panelVolumeMm3);

  const tareKg = Math.round(solidWoodM3 * WOOD_DENSITY_KG_M3 + plywoodM3 * PLYWOOD_DENSITY_KG_M3);
  const grossKg = Math.round(massKg + tareKg);

  return {
    machine,
    outer,
    inner,
    skid,
    skidCount: skids,
    floorThicknessMm: floor,
    panelThicknessMm: PANEL_THICKNESS_MM,
    studSpacingMm: spacing,
    clearanceMm: clearance,
    tareKg,
    grossKg,
    // Patins, plancher et montants sont du bois massif : la mention NIMP-15
    // s'applique. Les panneaux dérivés en sont exemptés (§7.5).
    hasSolidWood: true,
  };
}

/**
 * Volume de bois du calage, estimé sur les seules cotes de la caisse.
 *
 * Deux lisses sur toute la longueur, jusqu'à six butées, deux traverses. Les
 * butées sont comptées dans leur cas le plus lourd : deux entretoises, parce
 * qu'une machine éloignée d'une paroi se cale en deux pièces et non d'un bloc.
 *
 * **Conservateur, et volontairement.** Cette estimation alimente la tare, donc
 * la charge utile du gabarit : mieux vaut annoncer une caisse un peu trop
 * lourde qu'un peu trop légère. Sur la machine de démonstration, l'estimation
 * donne 0,098 m³ pour 0,074 m³ réellement dessinés.
 */
export function blockingAllowanceMm3(inner: Triplet, clearanceMm: number): number {
  const lisses = 2 * inner.lengthMm * LISSE_MM * LISSE_MM;
  const profondeur = Math.max(Math.min(clearanceMm, CALE_PLEINE_MAX_MM), 2 * CALE_ENTRETOISE_MM);
  const butees = 2 * BUTEES_PAR_PAROI * COLONNE_MM * profondeur * BUTEE_HAUTEUR_MM;
  const traverses = 2 * TRAVERSE_MM * inner.widthMm * TRAVERSE_MM;
  return lisses + butees + traverses;
}

/** Surfaces et volumes qui servent au chiffrage. Séparé pour ne pas alourdir `Crate`. */
export function crateQuantities(crate: Crate): { panelM2: number; woodM3: number } {
  const { outer, inner, skid, skidCount: skids, floorThicknessMm: floor, studSpacingMm: spacing } = crate;

  const panelM2 =
    (2 * outer.lengthMm * outer.heightMm +
      2 * outer.widthMm * outer.heightMm +
      outer.lengthMm * outer.widthMm) /
    1e6;

  const studCount = Math.ceil((2 * (outer.lengthMm + outer.widthMm)) / spacing);
  const woodM3 = mm3ToM3(
    skids * skid.heightMm * skid.widthMm * outer.widthMm +
      outer.lengthMm * outer.widthMm * floor +
      studCount * STUD_SECTION_MM.thicknessMm * STUD_SECTION_MM.depthMm * inner.heightMm +
      // Le calage se fabrique et se pose : il se facture aussi.
      blockingAllowanceMm3(inner, crate.clearanceMm)
  );

  return { panelM2, woodM3 };
}

/**
 * Gerbabilité de la caisse chargée.
 *
 * Approximation d'avant-projet assumée : au-delà, la reprise de charge du
 * chapeau demande une étude que cet outil ne fait pas.
 */
export function isStackable(crate: Crate): boolean {
  const footprintMin = Math.min(crate.outer.lengthMm, crate.outer.widthMm);
  const slenderness = crate.outer.heightMm / footprintMin;
  return crate.grossKg <= STACKABLE_MAX_GROSS_KG && slenderness <= STACKABLE_MAX_SLENDERNESS;
}
