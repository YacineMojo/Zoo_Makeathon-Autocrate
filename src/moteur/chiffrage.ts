import type { Costing, Crate, GabaritCheck, Triplet } from '../domain/types.js';
import { CONVOY_WIDTH_THRESHOLD_MM, OVERSIZE_LABEL } from '../domain/gabarits.js';
import {
  CONVOY_TARIFF,
  CRATE_FIXED_EUR,
  CRATE_PANEL_EUR_PER_M2,
  CRATE_WOOD_EUR_PER_M3,
  OVERSIZE_TARIFF,
  SPLIT_ENGINEERING_EUR,
  SPLIT_EXTRA_DAYS,
  TARIFFS,
  VOLUME_EUR_PER_M3,
} from '../domain/tariffs.js';
import { buildCrate, crateQuantities } from './structure.js';

/**
 * Coûts et délais (PROJECT.md §6.6).
 *
 * Deux régimes, nommés comme tels dans le type `Costing` :
 *
 * - **continu** : le m³ transporté. Ligne secondaire, faible, affichée par
 *   honnêteté.
 * - **discret** : le forfait du gabarit. Argument principal — franchir un seuil
 *   coûte un facteur, pas un pourcentage.
 *
 * Le délai est gratuit à coder et rend l'argument difficile à balayer : pour un
 * constructeur, rater une fenêtre d'expédition coûte plus cher que le fret (§2).
 */

const volumeM3 = (t: Triplet) => (t.lengthMm * t.widthMm * t.heightMm) / 1e9;

/** Prix de fabrication de la caisse. Suit la surface de panneaux et le linéaire de bois, pas le vide. */
export function crateCostEur(crate: Crate): number {
  const { panelM2, woodM3 } = crateQuantities(crate);
  return Math.round(panelM2 * CRATE_PANEL_EUR_PER_M2 + woodM3 * CRATE_WOOD_EUR_PER_M3 + CRATE_FIXED_EUR);
}

/** Chiffrage d'une caisse acheminée dans un gabarit standard. */
export function costForGabarit(crate: Crate, check: GabaritCheck): Costing {
  const tariff = TARIFFS[check.gabarit.id];
  if (!tariff) throw new Error(`Aucun tarif pour le gabarit ${check.gabarit.id}.`);

  const crateEur = crateCostEur(crate);
  const volumeEur = Math.round(volumeM3(crate.outer) * (tariff.volumeEurPerM3 ?? VOLUME_EUR_PER_M3));

  return {
    crateEur,
    thresholdEur: tariff.thresholdEur,
    volumeEur,
    totalEur: crateEur + tariff.thresholdEur + volumeEur,
    leadTimeDays: tariff.leadTimeDays,
  };
}

/**
 * Première branche du §6.5 : on assume le hors gabarit.
 *
 * Le régime bascule du maritime hors gabarit au convoi exceptionnel routier
 * au-delà de la largeur réglementaire : ce n'est plus une question de booking,
 * c'est une autorisation à plusieurs semaines.
 */
export function costOversize(crate: Crate): Costing & { label: string } {
  const convoy = crate.outer.widthMm > CONVOY_WIDTH_THRESHOLD_MM;
  const tariff = convoy ? CONVOY_TARIFF : OVERSIZE_TARIFF;

  const crateEur = crateCostEur(crate);
  const volumeEur = Math.round(volumeM3(crate.outer) * VOLUME_EUR_PER_M3);

  return {
    label: convoy ? 'Convoi exceptionnel (route)' : OVERSIZE_LABEL,
    crateEur,
    thresholdEur: tariff.thresholdEur,
    volumeEur,
    totalEur: crateEur + tariff.thresholdEur + volumeEur,
    leadTimeDays: tariff.leadTimeDays,
  };
}

/**
 * Seconde branche du §6.5 : le démontage en deux caisses.
 *
 * **L'outil ne découpe pas.** Il ne lit pas l'arbre d'assemblage, il ne décide
 * pas du découpage — c'est une décision d'ingénierie qui ne lui appartient pas.
 * Il pose une hypothèse explicite — partage en deux dans la plus grande
 * dimension, masse partagée à parts égales — la chiffre, et laisse choisir.
 */
export function costSplit(
  machine: Triplet,
  massKg: number
): Costing & { label: string; assumedHalves: Triplet } {
  // On coupe la plus grande dimension : c'est l'hypothèse la plus favorable au
  // gabarit, et la plus lisible. Elle est affichée, pas cachée.
  const dims: Array<[keyof Triplet, number]> = [
    ['lengthMm', machine.lengthMm],
    ['widthMm', machine.widthMm],
    ['heightMm', machine.heightMm],
  ];
  const [largest] = dims.reduce((a, b) => (b[1] > a[1] ? b : a));

  const half: Triplet = { ...machine, [largest]: machine[largest] / 2 };
  const halfCrate = buildCrate(half, massKg / 2);

  const crateEur = crateCostEur(halfCrate) * 2;
  const volumeEur = Math.round(volumeM3(halfCrate.outer) * 2 * VOLUME_EUR_PER_M3);

  // Deux caisses tiennent dans un même conteneur si chacune y tient : on ne
  // paie donc qu'une fois le seuil, mais on paie l'étude et le démontage.
  const checkTariff = TARIFFS['40-std']!;

  return {
    label: 'Démontage en deux caisses',
    assumedHalves: halfCrate.outer,
    crateEur,
    thresholdEur: checkTariff.thresholdEur,
    volumeEur,
    totalEur: crateEur + checkTariff.thresholdEur + volumeEur + SPLIT_ENGINEERING_EUR,
    leadTimeDays: checkTariff.leadTimeDays + SPLIT_EXTRA_DAYS,
  };
}
