import type { VertexCloud } from '../mesh/obj.js';
import type { Placement } from './placement.js';
import { alignedCloud, type Axis } from './emprise.js';
import { rotate } from './placement.js';

/**
 * Où la machine occupe vraiment l'espace, position par position.
 *
 * Pour caler une machine, sa boîte englobante ne suffit pas — mais **une seule
 * boîte pour toute la tranche basse ne suffit pas non plus**. Couchée, la
 * machine de démonstration ne touche le plancher que sur une bande de 160 mm à
 * une extrémité : une butée posée ailleurs le long de la même paroi s'appuie
 * sur la caisse et sur rien d'autre. Elle a l'air d'une cale et n'en est pas.
 *
 * On découpe donc la tranche en **colonnes**, et on relève dans chacune ce que
 * la machine y occupe réellement. Une colonne vide ne reçoit pas de cale.
 *
 * C'est toujours grossier, et c'est toujours assumé : un avant-projet de calage
 * dit où mettre les cales, pas comment les clouer.
 */

/** Une colonne du profil : ce que la machine occupe dans cette bande. */
export interface Column {
  /** Centre de la colonne, sur l'axe de découpe. */
  center: number;
  /** Étendue occupée sur l'axe transverse. */
  min: number;
  max: number;
  /** Cote la plus haute atteinte par la machine dans cette colonne. */
  topMm: number;
  count: number;
}

export interface MachineProfile {
  /**
   * Colonnes le long de X, mesurées dans la bande basse.
   * Servent aux butées contre les deux grands côtés.
   */
  basParX: Column[];
  /**
   * Colonnes le long de Y, mesurées dans la bande basse.
   * Servent aux butées contre les deux pignons.
   */
  basParY: Column[];
  /**
   * Colonnes le long de X, sur toute la hauteur.
   * Servent aux traverses de maintien : chacune sait à quelle cote la machine
   * s'arrête sous elle.
   */
  hautParX: Column[];
  /** Cote du dessus de la machine, en coordonnées caisse. */
  topMm: number;
}

/** Hauteur de la bande basse examinée : c'est la hauteur utile d'une butée. */
export const BANDE_BASSE_MM = 200;
/**
 * Largeur d'une colonne du profil.
 *
 * Fine, et volontairement plus fine qu'une cale : une cale doit pouvoir être
 * mesurée sur **son emprise exacte**, pas sur la colonne où elle a été
 * pressentie. Le recadrage d'une cale dans le volume utile la déplace, et une
 * mesure prise ailleurs la fait traverser la machine — 59 mm de pénétration
 * relevés sur un robot KR 6.
 */
export const COLONNE_MM = 50;
/**
 * En deçà, la colonne est trop pauvre pour qu'on y **appuie** quoi que ce soit.
 *
 * Ce seuil ne vaut que pour les butées : on ne cale pas contre trois sommets
 * isolés. Il ne doit surtout pas s'appliquer à la mesure des hauteurs — une
 * colonne écartée devient de la matière invisible, et une traverse posée
 * dessus la traverse. C'est ce qui s'est produit : une traverse descendue à
 * 382 mm au lieu de 2 022, parce que la matière au-dessus tenait dans un bac
 * de deux sommets.
 */
const SOMMETS_MINIMUM = 3;

/** Applique pose, lacet et translation, et rend les sommets en coordonnées caisse. */
function placedPoints(
  cloud: VertexCloud,
  up: Axis,
  placement: Placement,
  scale: number
): Float64Array {
  const aligned = alignedCloud(cloud, up, scale);
  const out = new Float64Array(aligned.xyz.length);

  for (let i = 0; i < aligned.xyz.length; i += 3) {
    const [x, y, z] = rotate(
      [aligned.xyz[i] as number, aligned.xyz[i + 1] as number, aligned.xyz[i + 2] as number],
      [0, 0, 1],
      placement.yawDeg
    );
    out[i] = x + placement.translateMm[0];
    out[i + 1] = y + placement.translateMm[1];
    out[i + 2] = z + placement.translateMm[2];
  }

  return out;
}

/**
 * Découpe un nuage placé en colonnes le long d'un axe.
 *
 * `axe` vaut 0 pour découper suivant X — la colonne relève alors l'étendue en Y —
 * et 1 pour découper suivant Y.
 */
function colonnes(
  points: Float64Array,
  axe: 0 | 1,
  zMin: number,
  zMax: number,
  minimum = SOMMETS_MINIMUM,
  largeurMm = COLONNE_MM
): Column[] {
  const transverse = axe === 0 ? 1 : 0;
  const bacs = new Map<number, { min: number; max: number; topMm: number; count: number }>();

  for (let i = 0; i < points.length; i += 3) {
    const z = points[i + 2] as number;
    if (z < zMin || z > zMax) continue;

    const a = points[i + axe] as number;
    const t = points[i + transverse] as number;
    const clef = Math.floor(a / largeurMm);

    const bac = bacs.get(clef);
    if (!bac) {
      bacs.set(clef, { min: t, max: t, topMm: z, count: 1 });
    } else {
      if (t < bac.min) bac.min = t;
      if (t > bac.max) bac.max = t;
      if (z > bac.topMm) bac.topMm = z;
      bac.count++;
    }
  }

  return [...bacs.entries()]
    .filter(([, b]) => b.count >= minimum)
    .map(([clef, b]) => ({ center: (clef + 0.5) * largeurMm, min: b.min, max: b.max, topMm: b.topMm, count: b.count }))
    .sort((a, b) => a.center - b.center);
}

/**
 * Relève le profil qui sert au calage.
 *
 * `floorTopMm` est la cote du dessus du plancher : la machine y repose.
 */
/**
 * Agrège les colonnes couvertes par une plage.
 *
 * C'est ce qui permet à une cale d'être mesurée sur l'emprise qu'elle occupe
 * vraiment : `min` est l'approche la plus proche sous elle, `topMm` la cote la
 * plus basse à laquelle la machine s'arrête. Les deux sont les choix prudents.
 */
export function agreger(colonnes: Column[], de: number, a: number): Column | undefined {
  const dedans = chevauchantes(colonnes, de, a);
  if (dedans.length === 0) return undefined;

  return {
    center: (de + a) / 2,
    min: Math.min(...dedans.map((c) => c.min)),
    max: Math.max(...dedans.map((c) => c.max)),
    topMm: Math.min(...dedans.map((c) => c.topMm)),
    count: dedans.reduce((n, c) => n + c.count, 0),
  };
}

/**
 * Colonnes **chevauchant** une plage, et non colonnes dont le centre y tombe.
 *
 * La nuance vaut dix millimètres de pénétration : une traverse de 70 mm posée à
 * cheval sur des colonnes de 50 n'en contient parfois qu'un seul centre, et la
 * matière de la colonne voisine — plus haute — passait alors à travers elle.
 */
function chevauchantes(colonnes: Column[], de: number, a: number): Column[] {
  const demi = COLONNE_MM / 2;
  return colonnes.filter((c) => c.center + demi > de && c.center - demi < a);
}

/**
 * Cote la plus haute atteinte par la machine sous une plage.
 *
 * C'est le contraire du choix prudent de `agreger` : une traverse doit reposer
 * sur le point le **plus haut** qui passe dessous, sinon elle le traverse.
 */
export function sommetSous(colonnes: Column[], de: number, a: number): number | undefined {
  const dedans = chevauchantes(colonnes, de, a);
  return dedans.length === 0 ? undefined : Math.max(...dedans.map((c) => c.topMm));
}

export function machineProfile(
  cloud: VertexCloud,
  up: Axis,
  placement: Placement,
  scale: number,
  floorTopMm: number
): MachineProfile {
  return profilDepuisPoints(placedPoints(cloud, up, placement, scale), floorTopMm, floorTopMm + placement.size[2]);
}

/**
 * Même relevé, à partir de sommets **déjà placés**.
 *
 * Le découpage en a besoin : chaque caisse contient un sous-ensemble de pièces,
 * recouchées et recentrées dans leur propre caisse. Repartir du nuage d'origine
 * et de la pose de la machine entière donnerait le profil de la mauvaise
 * géométrie — et un calage posé contre du vide.
 */
export function profilDepuisPoints(
  points: Float64Array,
  floorTopMm: number,
  topMm: number
): MachineProfile {
  return {
    basParX: colonnes(points, 0, floorTopMm, floorTopMm + BANDE_BASSE_MM),
    basParY: colonnes(points, 1, floorTopMm, floorTopMm + BANDE_BASSE_MM),
    // Aucun seuil ici : la mesure des hauteurs doit voir toute la matière, même
    // isolée. Une colonne écartée est de la matière qu'une traverse traverse.
    hautParX: colonnes(points, 0, floorTopMm, topMm, 1),
    topMm,
  };
}
