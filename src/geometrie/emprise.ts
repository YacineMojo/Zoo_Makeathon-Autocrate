import type { VertexCloud } from '../mesh/obj.js';
import type { Triplet } from '../domain/types.js';

/**
 * Emprise orientée (PROJECT.md §6.1).
 *
 * Le STEP est modélisé dans un **repère arbitraire**. Une boîte englobante
 * alignée sur les axes du fichier, pour une machine dessinée de travers, est
 * visiblement trop grosse. C'est la source du gain, et c'est la réplique de la
 * démo :
 *
 * > Votre CAO est dans un repère arbitraire. La caisse, elle, doit être alignée
 * > sur la machine.
 *
 * Méthode, triviale et à ne pas surestimer : projeter les sommets dans le plan
 * horizontal, enveloppe convexe 2D, puis balayer 180 rotations et garder l'aire
 * minimale. L'axe vertical ne bouge pas, donc la hauteur est gratuite.
 *
 * Pas de rotating calipers : la force brute à 0,5° est exacte à la précision qui
 * nous intéresse, et tient en trente lignes qu'on peut relire.
 */

/** Axe vertical de la machine dans le repère du fichier (§11). */
export type Axis = 'x' | 'y' | 'z';

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** Les deux axes du plan horizontal, l'axe vertical étant retiré. */
function planeAxes(up: Axis): [0 | 1 | 2, 0 | 1 | 2] {
  const u = AXIS_INDEX[up];
  return ([0, 1, 2] as const).filter((i) => i !== u) as unknown as [0 | 1 | 2, 0 | 1 | 2];
}

export interface OrientedFootprint extends Triplet {
  /** Rotation appliquée autour de l'axe vertical, en degrés. */
  yawDeg: number;
  /** Aire au sol, en mm². Sert à comparer une orientation à une autre. */
  areaMm2: number;
}

/**
 * Enveloppe convexe 2D, par la chaîne monotone d'Andrew.
 *
 * L'aire minimale d'un rectangle englobant ne dépend que de l'enveloppe : les
 * points intérieurs ne peuvent rien changer. Passer de 174 000 sommets à
 * quelques dizaines de points d'enveloppe rend le balayage à 0,5° instantané.
 */
export function convexHull2d(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return [...points];

  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (pts: Array<[number, number]>): Array<[number, number]> => {
    const chain: Array<[number, number]> = [];
    for (const p of pts) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, p) <= 0) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop(); // le dernier point est repris par l'autre demi-chaîne
    return chain;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

/**
 * Rectangle englobant d'aire minimale, par balayage à pas fixe.
 *
 * 180 rotations de 0,5° couvrent tout : au-delà de 90°, un rectangle se répète à
 * ses côtés près, et la permutation (longueur, largeur) n'est pas une
 * information nouvelle. On balaie tout de même 180 pas sur 90° pour rester à
 * 0,5° de résolution.
 */
export function minimalAreaRectangle(
  hull: Array<[number, number]>,
  stepDeg = 0.5
): { lengthMm: number; widthMm: number; yawDeg: number; areaMm2: number } {
  if (hull.length === 0) throw new Error('Enveloppe vide : aucune emprise calculable.');

  let best = { lengthMm: Infinity, widthMm: Infinity, yawDeg: 0, areaMm2: Infinity };

  for (let deg = 0; deg < 90; deg += stepDeg) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (const [x, y] of hull) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const a = maxU - minU;
    const b = maxV - minV;
    const area = a * b;

    if (area < best.areaMm2) {
      // Par convention la longueur est la plus grande des deux : la caisse n'a
      // pas d'orientation privilégiée, seul le couple de dimensions compte.
      best = {
        lengthMm: Math.max(a, b),
        widthMm: Math.min(a, b),
        yawDeg: deg,
        areaMm2: area,
      };
    }
  }

  return best;
}

/** Étendue du nuage le long de l'axe vertical. La hauteur est gratuite : le lacet ne la change pas. */
function verticalExtent(cloud: VertexCloud, up: Axis): number {
  const u = AXIS_INDEX[up];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < cloud.xyz.length; i += 3) {
    const v = cloud.xyz[i + u] as number;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/** Boîte englobante alignée sur les axes du fichier — la référence naïve, l'« avant » (§6.2). */
export function naiveFootprint(cloud: VertexCloud, up: Axis, scale = 1): Triplet {
  const [a, b] = planeAxes(up);
  const extent = (axis: 0 | 1 | 2) => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < cloud.xyz.length; i += 3) {
      const v = cloud.xyz[i + axis] as number;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min;
  };

  const da = extent(a) * scale;
  const db = extent(b) * scale;

  return {
    lengthMm: Math.max(da, db),
    widthMm: Math.min(da, db),
    heightMm: verticalExtent(cloud, up) * scale,
  };
}

/** Emprise orientée : la boîte alignée sur la machine, pas sur le fichier. */
export function orientedFootprint(
  cloud: VertexCloud,
  up: Axis,
  scale = 1,
  stepDeg = 0.5
): OrientedFootprint {
  if (cloud.count === 0) throw new Error('Nuage de sommets vide : aucune emprise calculable.');

  const [a, b] = planeAxes(up);
  const projected: Array<[number, number]> = new Array(cloud.count);
  for (let i = 0, j = 0; i < cloud.xyz.length; i += 3, j++) {
    projected[j] = [cloud.xyz[i + a] as number, cloud.xyz[i + b] as number];
  }

  const hull = convexHull2d(projected);
  const rect = minimalAreaRectangle(hull.length >= 3 ? hull : projected, stepDeg);

  return {
    lengthMm: rect.lengthMm * scale,
    widthMm: rect.widthMm * scale,
    heightMm: verticalExtent(cloud, up) * scale,
    yawDeg: rect.yawDeg,
    areaMm2: rect.areaMm2 * scale * scale,
  };
}
