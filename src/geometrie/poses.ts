import type { VertexCloud } from '../mesh/obj.js';
import type { PoseInput } from '../moteur/etude.js';
import { naiveFootprint, orientedFootprint, type Axis, type OrientedFootprint } from './emprise.js';
import { resolveUnit, type UnitChoice, type UnitResolution } from './unites.js';

/**
 * Les poses (PROJECT.md §6.2).
 *
 * **Trois poses, pas six.** Les six permutations du triplet ne valent que pour
 * une boîte alignée sur les axes du fichier. Dès qu'on optimise le lacet, la
 * permutation (longueur, largeur) dans le plan est déjà absorbée par le
 * balayage : il ne reste que le choix de l'axe machine qui pointe vers le haut.
 * Le retournement à 180° ne change aucune dimension.
 *
 * S'y ajoute **une ligne de référence** : la boîte naïve alignée sur le repère
 * du STEP. Ce n'est pas une pose de plus, c'est l'avant.
 */

const AXES: Axis[] = ['x', 'y', 'z'];

/**
 * Les poses sont ordonnées à partir de l'axe déclaré vertical : la pose A est
 * toujours la machine debout, telle que l'utilisateur la voit. Numéroter les
 * poses dans l'ordre X, Y, Z du fichier donnerait une pose A couchée dès que le
 * modèle est en Y-up, et le tableau deviendrait illisible.
 */
function orderedAxes(declaredUp: Axis): Axis[] {
  return [declaredUp, ...AXES.filter((a) => a !== declaredUp)];
}

export interface PosesResult {
  unit: UnitResolution;
  /** La boîte naïve, dans le repère du fichier. */
  reference: OrientedFootprint;
  /** Les trois poses, emprise orientée. */
  oriented: Array<{ axis: Axis; footprint: OrientedFootprint }>;
  /** Prêt à passer au moteur. */
  poses: PoseInput[];
  /** Gain d'emprise au sol de la meilleure pose par rapport à la référence, en %. */
  areaGainPct: number;
}

/**
 * Construit la référence et les trois poses à partir d'un nuage de sommets.
 *
 * `declaredUp` est l'axe vertical saisi par l'utilisateur — beaucoup de CAO sont
 * en Y-up, et sans ce réglage la machine est couchée dès l'import et tout le
 * raisonnement s'effondre (§11).
 */
export function buildPoses(
  cloud: VertexCloud,
  declaredUp: Axis = 'z',
  unitChoice: UnitChoice = 'auto'
): PosesResult {
  if (cloud.count === 0) throw new Error('Nuage de sommets vide : aucune pose calculable.');

  // L'unité se décide sur les dimensions brutes, avant toute mise à l'échelle.
  const raw = naiveFootprint(cloud, declaredUp, 1);
  const unit = resolveUnit(unitChoice, Math.max(raw.lengthMm, raw.widthMm, raw.heightMm));

  const naive = naiveFootprint(cloud, declaredUp, unit.scale);
  const reference: OrientedFootprint = {
    ...naive,
    yawDeg: 0,
    areaMm2: naive.lengthMm * naive.widthMm,
  };

  const oriented = orderedAxes(declaredUp).map((axis) => ({
    axis,
    footprint: orientedFootprint(cloud, axis, unit.scale),
  }));

  const poses: PoseInput[] = [
    {
      pose: 'reference',
      label: 'CAD frame (naive)',
      footprint: { lengthMm: reference.lengthMm, widthMm: reference.widthMm, heightMm: reference.heightMm },
      lying: false,
    },
    ...oriented.map(({ axis, footprint }, i) => ({
      pose: (['A', 'B', 'C'] as const)[i]!,
      // Court : le tableau est lu de biais, pas étudié. L'axe reste indiqué
      // parce que c'est la seule information qui distingue deux poses couchées.
      label: `Pose ${(['A', 'B', 'C'] as const)[i]}, ${i === 0 ? 'upright' : `laid on ${axis.toUpperCase()}`}`,
      footprint: {
        lengthMm: footprint.lengthMm,
        widthMm: footprint.widthMm,
        heightMm: footprint.heightMm,
      },
      lying: axis !== declaredUp,
    })),
  ];

  // Le gain se mesure à emprise au sol égale d'axe vertical : c'est la pose
  // debout orientée qu'on compare à la boîte naïve, pas la meilleure des trois.
  // Comparer une machine couchée à une machine debout mélangerait deux effets.
  const uprightOriented = oriented.find((o) => o.axis === declaredUp)!.footprint;
  const areaGainPct = (1 - uprightOriented.areaMm2 / reference.areaMm2) * 100;

  return { unit, reference, oriented, poses, areaGainPct };
}
