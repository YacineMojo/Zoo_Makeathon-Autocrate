import type { VertexCloud } from '../mesh/obj.js';
import type { Placement } from './placement.js';
import { alignedCloud, type Axis } from './emprise.js';
import { rotate } from './placement.js';

/**
 * Où la machine occupe vraiment l'espace, hauteur par hauteur.
 *
 * Pour caler une machine, sa boîte englobante ne suffit pas : une machine
 * couchée ne touche le plancher que par une partie de son emprise, et poser des
 * cales contre la boîte les ferait flotter dans le vide à côté de la pièce.
 *
 * On tranche donc le nuage **une fois placé** — pose et lacet appliqués, machine
 * posée sur son plancher — et on relève l'étendue occupée dans la tranche. C'est
 * grossier, et c'est assumé : un avant-projet de calage dit où mettre les cales,
 * pas comment les clouer.
 */

/** Étendue occupée dans une tranche horizontale, en coordonnées caisse. */
export interface Slice {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Nombre de sommets dans la tranche. En dessous d'une poignée, la mesure ne vaut rien. */
  count: number;
}

export interface MachineSlices {
  /** Juste au-dessus du plancher : c'est là que se posent les butées. */
  bas?: Slice;
  /** Juste sous le chapeau : c'est là que se posent les traverses de maintien. */
  haut?: Slice;
  /** Cote du dessus de la machine, en coordonnées caisse. */
  topMm: number;
}

/**
 * Tranche le nuage placé entre deux cotes.
 *
 * `undefined` si la tranche est trop pauvre pour qu'on en tire quoi que ce
 * soit : mieux vaut ne pas proposer de cale que d'en proposer une contre trois
 * sommets isolés.
 */
function slice(
  cloud: VertexCloud,
  up: Axis,
  placement: Placement,
  scale: number,
  zMin: number,
  zMax: number
): Slice | undefined {
  const aligned = alignedCloud(cloud, up, scale);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (let i = 0; i < aligned.xyz.length; i += 3) {
    const [x, y, z] = rotate(
      [aligned.xyz[i] as number, aligned.xyz[i + 1] as number, aligned.xyz[i + 2] as number],
      [0, 0, 1],
      placement.yawDeg
    );

    const wx = x + placement.translateMm[0];
    const wy = y + placement.translateMm[1];
    const wz = z + placement.translateMm[2];

    if (wz < zMin || wz > zMax) continue;

    count++;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }

  return count >= 4 ? { minX, maxX, minY, maxY, count } : undefined;
}

/** Épaisseur des tranches examinées, en bas et en haut. */
export const SLICE_MM = 250;

/**
 * Relève les deux tranches qui servent au calage.
 *
 * `floorTopMm` est la cote du dessus du plancher : la machine y repose.
 */
export function machineSlices(
  cloud: VertexCloud,
  up: Axis,
  placement: Placement,
  scale: number,
  floorTopMm: number
): MachineSlices {
  const topMm = floorTopMm + placement.size[2];

  return {
    bas: slice(cloud, up, placement, scale, floorTopMm, floorTopMm + SLICE_MM),
    haut: slice(cloud, up, placement, scale, topMm - SLICE_MM, topMm),
    topMm,
  };
}
