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
 * horizontal, enveloppe convexe 2D, puis balayer 180 rotations et garder la
 * **largeur** minimale — voir `minimalWidthRectangle` pour la raison, qui n'est
 * pas évidente. L'axe vertical ne bouge pas, donc la hauteur est gratuite.
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
 * Longueur au-delà de laquelle plus aucun gabarit ne prend la caisse.
 *
 * La plus courte des longueurs utiles de la table des gabarits — un conteneur
 * 40 pieds — moins ce que la caisse ajoute autour de la machine. En deçà, la
 * longueur n'est jamais la cote qui décide.
 */
export const USABLE_LENGTH_MM = 11_700;

export interface Rectangle {
  lengthMm: number;
  widthMm: number;
  yawDeg: number;
  areaMm2: number;
}

/**
 * Rectangle englobant retenu, par balayage à pas fixe.
 *
 * **On minimise la largeur, pas l'aire.** C'est une correction de fond, et elle
 * mérite son paragraphe.
 *
 * Le verdict ne dépend jamais de l'aire au sol : il dépend d'une seule cote,
 * celle qui touche le gabarit. La hauteur est fixée par la pose et le lacet n'y
 * change rien. La longueur ne borne qu'à douze mètres, et aucune machine mise
 * en caisse ne s'en approche. **Il ne reste que la largeur**, et c'est donc
 * elle, et elle seule, que le lacet doit réduire.
 *
 * Minimiser l'aire est un proxy, et un proxy qui trahit. Mesuré sur nos
 * fichiers :
 *
 *     machine-demo, axe X   aire min 3100 × 1900   largeur min 3635 × 1725
 *     KUKA KR 600,  axe Y   aire min 3168 × 2201   largeur min 3627 × 2090
 *
 * 175 mm et 111 mm de largeur abandonnés pour gagner des mètres cubes d'air
 * dont notre propre énoncé dit qu'ils ne sont pas le sujet. Sur le KUKA, ces
 * 111 mm font passer la caisse de 2431 à 2320 mm : sous les 2340 mm d'ouverture
 * de porte d'un conteneur 40 pieds. La même machine change de gabarit.
 *
 * L'aire ne sert plus que de départage entre deux angles de même largeur.
 *
 * 180 pas de 0,5° sur 90° suffisent : au-delà, un rectangle se répète à ses
 * côtés près.
 */
export function minimalWidthRectangle(hull: Array<[number, number]>, stepDeg = 0.5): Rectangle {
  const candidates = sweepRectangles(hull, stepDeg);

  // On écarte d'abord les angles qui rendraient la caisse plus longue que le
  // plus long gabarit : gagner de la largeur en devenant intransportable n'est
  // pas un gain.
  const transportables = candidates.filter((r) => r.lengthMm <= USABLE_LENGTH_MM);
  const pool = transportables.length > 0 ? transportables : candidates;

  return pool.reduce((a, b) => {
    if (Math.abs(b.widthMm - a.widthMm) > 0.5) return b.widthMm < a.widthMm ? b : a;
    return b.areaMm2 < a.areaMm2 ? b : a;
  });
}

/** Tous les rectangles englobants du balayage, un par angle. */
export function sweepRectangles(hull: Array<[number, number]>, stepDeg = 0.5): Rectangle[] {
  if (hull.length === 0) throw new Error('Enveloppe vide : aucune emprise calculable.');

  const out: Rectangle[] = [];

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

    // La longueur est la plus grande des deux, **et elle doit finir sur X** :
    // `crateBoxes` construit la caisse avec sa longueur suivant X. Si le grand
    // côté tombait sur Y, la machine serait posée en travers de sa propre
    // caisse — un quart de tour d'écart, invisible dans les chiffres et
    // catastrophique dans le viewer.
    //
    // Un quart de tour de plus échange les deux axes : à `deg + 90`, le `u`
    // du balayage vaut l'ancien `v`.
    out.push(
      a >= b
        ? { lengthMm: a, widthMm: b, yawDeg: deg, areaMm2: area }
        : { lengthMm: b, widthMm: a, yawDeg: deg + 90, areaMm2: area }
    );
  }

  return out;
}

/**
 * Nuage réorienté pour qu'un axe machine pointe sur le +Z du monde.
 *
 * Sans cette étape, le balayage travaille dans un plan de projection — (X, Z)
 * pour une pose Y en haut, par exemple — dont la relation au plan XY du monde
 * n'est pas toujours une rotation : pour l'axe Y, c'est une **réflexion**, et le
 * signe du lacet s'inverse en silence. La machine tourne alors du mauvais côté
 * et déborde de sa caisse sans qu'aucun calcul ne s'en plaigne.
 *
 * On aligne donc d'abord, et tout le reste se fait dans le repère du monde, où
 * il n'y a plus qu'un seul cas à raisonner.
 */
export function alignedCloud(cloud: VertexCloud, up: Axis, scale = 1): VertexCloud {
  const xyz = new Float64Array(cloud.xyz.length);

  for (let i = 0; i < cloud.xyz.length; i += 3) {
    const x = (cloud.xyz[i] as number) * scale;
    const y = (cloud.xyz[i + 1] as number) * scale;
    const z = (cloud.xyz[i + 2] as number) * scale;

    switch (up) {
      case 'z':
        xyz[i] = x;
        xyz[i + 1] = y;
        xyz[i + 2] = z;
        break;
      case 'x':
        // Rotation de -90° autour de Y : +X part sur +Z.
        xyz[i] = -z;
        xyz[i + 1] = y;
        xyz[i + 2] = x;
        break;
      case 'y':
        // Rotation de +90° autour de X : +Y part sur +Z.
        xyz[i] = x;
        xyz[i + 1] = -z;
        xyz[i + 2] = y;
        break;
    }
  }

  return { count: cloud.count, xyz };
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

  // Aligner d'abord, balayer ensuite : le lacet rendu est alors une rotation
  // autour du Z du monde, directement utilisable pour placer la machine.
  const aligned = alignedCloud(cloud, up, scale);

  const projected: Array<[number, number]> = new Array(aligned.count);
  for (let i = 0, j = 0; i < aligned.xyz.length; i += 3, j++) {
    projected[j] = [aligned.xyz[i] as number, aligned.xyz[i + 1] as number];
  }

  const hull = convexHull2d(projected);
  const rect = minimalWidthRectangle(hull.length >= 3 ? hull : projected, stepDeg);

  return {
    lengthMm: rect.lengthMm,
    widthMm: rect.widthMm,
    heightMm: verticalExtent(aligned, 'z'),
    yawDeg: rect.yawDeg,
    areaMm2: rect.areaMm2,
  };
}
