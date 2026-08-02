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
  /** Tous les pavés de toutes les caisses, déjà décalés. */
  boxes: Box[];
  /** Décalage appliqué à chaque caisse, suivant X, dans l'ordre des rangs. */
  offsets: number[];
}

/**
 * Aligne les caisses côte à côte, dans l'ordre des rangs.
 *
 * L'ensemble est centré sur l'origine : la scène reste cadrée quel que soit le
 * nombre de caisses.
 */
export function sceneDecoupe(d: Decoupe): ScenePartagee {
  const largeurs = d.caisses.map((c) => c.crate.outer.lengthMm);
  const total = largeurs.reduce((a, l) => a + l, 0) + ECART_CAISSES_MM * (d.caisses.length - 1);

  let curseur = -total / 2;
  const offsets = largeurs.map((l) => {
    const centre = curseur + l / 2;
    curseur += l + ECART_CAISSES_MM;
    return centre;
  });

  const boxes = d.caisses.flatMap((c, i) =>
    crateBoxes(c.crate).map((b) => ({ ...b, name: `caisse${i + 1}_${b.name}`, x: b.x + offsets[i]! }))
  );

  return { boxes, offsets };
}

/**
 * Couche un groupe de pièces : la plus petite dimension passe sur Z.
 *
 * Ne s'applique **pas** à la caisse qui garde la pose étudiée : là, la hauteur
 * est la hauteur, c'est tout le propos des poses.
 */
export function coucherAPlat(
  min: [number, number, number],
  max: [number, number, number]
): (p: [number, number, number]) => [number, number, number] {
  const d: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const axe: 0 | 1 | 2 = d[0] <= d[1] && d[0] <= d[2] ? 0 : d[1] <= d[2] ? 1 : 2;

  if (axe === 2) return (p) => p;
  if (axe === 0) return (p) => [-p[2], p[1], p[0]];
  return (p) => [p[0], -p[2], p[1]];
}

/**
 * Quart de tour autour de Z si le grand côté est tombé sur Y.
 *
 * La caisse est **toujours** construite avec sa longueur suivant X — c'est ainsi
 * que le verdict la mesure, longueur contre longueur utile. Si les pièces sont
 * plus longues suivant Y, elles sortent de leur caisse par le flanc. Sur un
 * robot KUKA, ça faisait 2 195 mm dehors.
 *
 * Le défaut ne touchait que la première caisse : les autres passaient déjà par
 * un recouchage qui corrigeait au passage.
 */
export function alignerSurX(
  points: Array<[number, number, number]>
): (p: [number, number, number]) => [number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const dx = Math.max(...xs) - Math.min(...xs);
  const dy = Math.max(...ys) - Math.min(...ys);

  return dy > dx ? (p) => [-p[1], p[0], p[2]] : (p) => p;
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
