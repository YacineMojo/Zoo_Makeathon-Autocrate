import type { Box } from '../engine/box.js';
import type { Decoupe } from './decoupe.js';
import type { Placement } from '../geometrie/placement.js';
import { crateBoxes } from '../engine/caisse.js';

/**
 * La scène du découpage : les caisses côte à côte, chacune avec ses pièces.
 *
 * Le §6.5 dit que l'outil ne découpe pas, et il reste vrai de la **décision** :
 * l'outil ne prétend pas que ces pièces se démontent. Mais tant qu'à chiffrer
 * l'hypothèse, autant la montrer — et sur un concours d'API de CAO, générer
 * deux caisses garnies est plus parlant qu'un paragraphe.
 *
 * Chaque caisse est posée à sa place dans une scène commune : la principale
 * centrée, la seconde à côté, séparées d'un mètre pour qu'on les distingue.
 */

/** Écart entre deux caisses dans la scène. */
export const ECART_CAISSES_MM = 1_000;

export interface ScenePartagee {
  /** Tous les pavés des deux caisses, déjà décalés. */
  boxes: Box[];
  /** Décalage appliqué à chaque caisse, suivant X. */
  offsets: { principale: number; seconde: number };
}

export function sceneDecoupe(d: Decoupe): ScenePartagee {
  const lA = d.principale.crate.outer.lengthMm;
  const lB = d.seconde.crate.outer.lengthMm;

  const offsetA = -(lA + ECART_CAISSES_MM) / 2;
  const offsetB = (lB + ECART_CAISSES_MM) / 2;

  const decaler = (boxes: Box[], dx: number, suffixe: string): Box[] =>
    boxes.map((b) => ({ ...b, name: `${suffixe}_${b.name}`, x: b.x + dx }));

  return {
    boxes: [
      ...decaler(crateBoxes(d.principale.crate), offsetA, 'principale'),
      ...decaler(crateBoxes(d.seconde.crate), offsetB, 'seconde'),
    ],
    offsets: { principale: offsetA, seconde: offsetB },
  };
}

/**
 * Transformation à appliquer aux pièces qui partent dans la seconde caisse.
 *
 * Elles se recouchent : la plus petite dimension devient la hauteur, comme le
 * chiffrage l'a supposé. Sans cela on montrerait une colonne debout dans une
 * caisse dimensionnée pour elle couchée.
 */
export function coucher(
  min: [number, number, number],
  max: [number, number, number]
): { axe: 0 | 1 | 2; permuter: (p: [number, number, number]) => [number, number, number] } {
  const d: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const axe: 0 | 1 | 2 = d[0] <= d[1] && d[0] <= d[2] ? 0 : d[1] <= d[2] ? 1 : 2;

  // Rotation d'un quart de tour qui amène l'axe le plus court sur Z.
  const permuter =
    axe === 2
      ? (p: [number, number, number]): [number, number, number] => p
      : axe === 0
        ? (p: [number, number, number]): [number, number, number] => [-p[2], p[1], p[0]]
        : (p: [number, number, number]): [number, number, number] => [p[0], -p[2], p[1]];

  return { axe, permuter };
}

/** Placement d'un groupe de pièces au centre d'une caisse, posé sur son plancher. */
export function centrer(
  points: Array<[number, number, number]>,
  offsetX: number,
  floorTopMm: number
): (p: [number, number, number]) => [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a] as number, p[a] as number);
      max[a] = Math.max(max[a] as number, p[a] as number);
    }
  }

  const dx = offsetX - (min[0]! + max[0]!) / 2;
  const dy = -(min[1]! + max[1]!) / 2;
  const dz = floorTopMm - min[2]!;

  return (p) => [p[0] + dx, p[1] + dy, p[2] + dz];
}

/** Placement identité, utile quand les pièces sont déjà dans le repère voulu. */
export function decalerX(dx: number): (p: [number, number, number]) => [number, number, number] {
  return (p) => [p[0] + dx, p[1], p[2]];
}

export type { Placement };
