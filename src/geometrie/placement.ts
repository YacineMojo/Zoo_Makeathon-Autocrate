import type { VertexCloud } from '../mesh/obj.js';
import { alignedCloud, type Axis } from './emprise.js';

/**
 * Placement de la machine dans la caisse.
 *
 * L'emprise orientée dit **quelles dimensions** occupe la machine dans une pose.
 * Pour la matérialiser dans une scène Zoo, il faut en plus dire **comment l'y
 * mettre** : quelle rotation, et quelle translation pour qu'elle repose sur le
 * plancher, centrée.
 *
 * La rotation se compose en deux temps, dans cet ordre :
 *
 *   1. amener l'axe machine choisi sur le Z du monde — c'est la pose ;
 *   2. tourner autour de Z du lacet trouvé par le balayage — c'est l'orientation.
 *
 * On l'applique aussi côté client, aux sommets, pour recalculer la boîte
 * résultante. C'est ce qui permet de **vérifier** que le placement reproduit
 * bien l'emprise annoncée, au lieu de l'espérer.
 */

export interface Placement {
  /** Axe de la première rotation, en coordonnées monde. */
  alignAxis: [number, number, number];
  alignAngleDeg: number;
  /** Lacet autour de Z, appliqué ensuite. */
  yawDeg: number;
  /**
   * Les deux rotations composées en une seule.
   *
   * `set_object_transform` prend une liste de transformations, mais la
   * documentation ne dit pas si deux rotations successives se composent ou si
   * la seconde écrase la première — et le drapeau `set` ne lève pas
   * l'ambiguïté. On ne parie pas : on envoie une rotation unique, dont on
   * vérifie par test qu'elle est équivalente aux deux.
   */
  rotationAxis: [number, number, number];
  rotationAngleDeg: number;
  /** Translation finale, en mm : centre en X/Y, base posée à `floorTopMm`. */
  translateMm: [number, number, number];
  /** Boîte occupée après placement complet, en mm, dans le repère monde. */
  size: [number, number, number];
}

/** Rotation amenant l'axe donné sur le +Z du monde. */
function alignment(up: Axis): { axis: [number, number, number]; angleDeg: number } {
  switch (up) {
    case 'z':
      return { axis: [0, 0, 1], angleDeg: 0 };
    case 'x':
      // Rotation de -90° autour de Y : +X part sur +Z.
      return { axis: [0, 1, 0], angleDeg: -90 };
    case 'y':
      // Rotation de +90° autour de X : +Y part sur +Z.
      return { axis: [1, 0, 0], angleDeg: 90 };
  }
}

/** Quaternion d'une rotation axe-angle. */
function quaternion(axis: [number, number, number], angleDeg: number): [number, number, number, number] {
  const half = ((angleDeg * Math.PI) / 180) / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/** Composition de deux rotations : `b` après `a`. */
function composeAxisAngle(
  a: { axis: [number, number, number]; angleDeg: number },
  b: { axis: [number, number, number]; angleDeg: number }
): { axis: [number, number, number]; angleDeg: number } {
  const [ax, ay, az, aw] = quaternion(a.axis, a.angleDeg);
  const [bx, by, bz, bw] = quaternion(b.axis, b.angleDeg);

  const x = bw * ax + bx * aw + by * az - bz * ay;
  const y = bw * ay - bx * az + by * aw + bz * ax;
  const z = bw * az + bx * ay - by * ax + bz * aw;
  const w = bw * aw - bx * ax - by * ay - bz * az;

  const sin = Math.hypot(x, y, z);
  if (sin < 1e-12) return { axis: [0, 0, 1], angleDeg: 0 };

  const angleDeg = (2 * Math.atan2(sin, w) * 180) / Math.PI;
  return { axis: [x / sin, y / sin, z / sin], angleDeg };
}

/** Rotation d'un point autour d'un axe unitaire, formule de Rodrigues. */
export function rotate(
  p: [number, number, number],
  axis: [number, number, number],
  angleDeg: number
): [number, number, number] {
  if (angleDeg === 0) return p;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [kx, ky, kz] = axis;
  const [x, y, z] = p;

  const dot = kx * x + ky * y + kz * z;
  const crossX = ky * z - kz * y;
  const crossY = kz * x - kx * z;
  const crossZ = kx * y - ky * x;

  return [
    x * c + crossX * s + kx * dot * (1 - c),
    y * c + crossY * s + ky * dot * (1 - c),
    z * c + crossZ * s + kz * dot * (1 - c),
  ];
}

/**
 * Calcule le placement d'une machine pour une pose.
 *
 * `floorTopMm` est la cote du dessus du plancher de caisse : patins plus
 * plancher. La machine y repose, elle ne flotte pas.
 *
 * Le signe du lacet n'est pas une évidence : le balayage tourne le *repère* de
 * `+yaw`, ce qui revient à tourner l'*objet* de `-yaw`. On l'applique donc en
 * négatif, et le test le vérifie sur le résultat plutôt que sur l'intention.
 */
export function placeForPose(
  cloud: VertexCloud,
  up: Axis,
  yawDeg: number,
  scale: number,
  floorTopMm: number
): Placement {
  const align = alignment(up);
  const objectYawDeg = -yawDeg;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  // Même alignement que celui qui a servi à calculer l'emprise : le lacet est
  // donc bien une rotation autour du Z du monde, et non d'un plan de projection.
  const aligned = alignedCloud(cloud, up, scale);

  for (let i = 0; i < aligned.xyz.length; i += 3) {
    const [x, y, z] = rotate(
      [aligned.xyz[i] as number, aligned.xyz[i + 1] as number, aligned.xyz[i + 2] as number],
      [0, 0, 1],
      objectYawDeg
    );

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const composed = composeAxisAngle(align, { axis: [0, 0, 1], angleDeg: objectYawDeg });

  return {
    alignAxis: align.axis,
    alignAngleDeg: align.angleDeg,
    yawDeg: objectYawDeg,
    rotationAxis: composed.axis,
    rotationAngleDeg: composed.angleDeg,
    translateMm: [-(minX + maxX) / 2, -(minY + maxY) / 2, floorTopMm - minZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/**
 * Place les corps d'un maillage comme la machine elle-même.
 *
 * Les huit sommets de chaque boîte subissent la pose, le lacet et la
 * translation, puis on reprend la boîte du résultat. Une boîte tournée n'est
 * plus une boîte : on prend son encombrement, ce qui majore légèrement — dans
 * le sens prudent.
 */
export function placeBodies(
  bodies: Array<{ name: string; min: [number, number, number]; max: [number, number, number] }>,
  up: Axis,
  placement: Placement,
  scale: number
): Array<{ name: string; min: [number, number, number]; max: [number, number, number]; volumeMm3: number }> {
  return bodies.map((b) => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

    for (const x of [b.min[0], b.max[0]]) {
      for (const y of [b.min[1], b.max[1]]) {
        for (const z of [b.min[2], b.max[2]]) {
          const aligne = alignedCloud({ count: 1, xyz: Float64Array.from([x, y, z]) }, up, scale);
          const p = rotate([aligne.xyz[0]!, aligne.xyz[1]!, aligne.xyz[2]!], [0, 0, 1], placement.yawDeg);
          for (let a = 0; a < 3; a++) {
            const v = p[a]! + placement.translateMm[a]!;
            if (v < min[a]!) min[a] = v;
            if (v > max[a]!) max[a] = v;
          }
        }
      }
    }

    return {
      name: b.name,
      min,
      max,
      volumeMm3: (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]),
    };
  });
}
