import type { Costing, Crate, GabaritCheck, ShippingMode, Triplet } from '../domain/types.js';
import { buildCrate } from './structure.js';
import { checkAll, cheapestFit } from './verdict.js';
import { costForGabarit } from './chiffrage.js';
import { SPLIT_ENGINEERING_EUR, SPLIT_EXTRA_DAYS } from '../domain/tariffs.js';

/**
 * Quels corps portent le dépassement (PROJECT.md §6.5).
 *
 * **L'outil ne découpe toujours pas.** C'est la ligne du §6.5 et elle tient :
 * il ne lit pas l'arbre d'assemblage, il ne décide pas du découpage, il ne dit
 * pas qu'une pièce est démontable. Ce qu'il fait est plus modeste et plus utile
 * — il **révèle** : sur seize corps, trois portent la hauteur ; sans eux la
 * caisse principale rentre en conteneur ; voilà ce que coûtent les deux
 * expéditions. L'ingénierie tranche ensuite.
 *
 * C'est le « retourner le non en proposition » du §15, appliqué un cran plus
 * loin : au lieu de dire « ça ne passe pas, voici le prix du hors gabarit », on
 * dit « voilà ce qui coince, et voilà ce que ça vaut de le retirer ».
 *
 * Deux hypothèses, explicites parce qu'elles sont discutables :
 *
 *   - un corps distinct dans le maillage n'est pas une pièce démontable ;
 *   - la masse est répartie au prorata du volume des boîtes, faute de matière.
 */

/** Un corps, déjà placé dans le repère de la caisse pour la pose étudiée. */
export interface PlacedBody {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  volumeMm3: number;
}

export interface Decoupe {
  /** Corps qui dépassent le plan de coupe, et partent donc à part. */
  retires: string[];
  /**
   * Leurs boîtes, en coordonnées caisse.
   *
   * Le viewer en a besoin : annoncer une coupe en montrant une caisse entière
   * est la même contradiction que celle du tableau. On désigne à l'écran ce
   * qu'on désigne dans le texte.
   */
  retiresBoites: Array<{ name: string; min: [number, number, number]; max: [number, number, number] }>;
  corpsTotal: number;
  /** Cote du plan de coupe, en coordonnées caisse. */
  planDeCoupeMm: number;
  /** Axe du repère caisse sur lequel la coupe est faite : 0 X, 1 Y, 2 Z. */
  axe: 0 | 1 | 2;
  principale: Colis;
  seconde: Colis;
  totalEur: number;
  leadTimeDays: number;
}

export interface Colis {
  footprint: Triplet;
  crate: Crate;
  checks: GabaritCheck[];
  retained?: GabaritCheck;
  costing: Costing;
  massKg: number;
}

/** Au-delà, ce n'est plus un démontage, c'est une refonte du produit. */
const RETRAITS_MAX = 6;

/** Étendues brutes d'un ensemble de corps, suivant X, Y et Z de la caisse. */
function etendues(bodies: PlacedBody[]): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a] as number, b.min[a] as number);
      max[a] = Math.max(max[a] as number, b.max[a] as number);
    }
  }
  return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
}

/**
 * Encombrement d'un ensemble de corps.
 *
 * `libre` change tout. Pour la caisse principale, la pose est déjà choisie et on
 * ne la rejoue pas : la hauteur reste la hauteur. Pour la **seconde** caisse,
 * en revanche, les pièces déposées sont libres — une colonne de trois mètres se
 * couche, et c'est même la première chose qu'un caissier fait. L'évaluer debout
 * la déclarait hors gabarit et faisait échouer toute proposition de découpage.
 */
function envelope(bodies: PlacedBody[], libre = false): Triplet {
  const [dx, dy, dz] = etendues(bodies);
  if (!libre) return { lengthMm: Math.max(dx, dy), widthMm: Math.min(dx, dy), heightMm: dz };

  const [h, l, L] = [dx, dy, dz].sort((a, b) => a - b);
  return { lengthMm: L!, widthMm: l!, heightMm: h! };
}

function colis(bodies: PlacedBody[], massKg: number, mode: ShippingMode, libre = false): Colis {
  const footprint = envelope(bodies, libre);
  const crate = buildCrate(footprint, Math.max(1, Math.round(massKg)));
  const checks = checkAll(crate);
  const retained = cheapestFit(crate, checks, mode);
  return {
    footprint,
    crate,
    checks,
    retained,
    costing: retained ? costForGabarit(crate, retained) : { crateEur: 0, thresholdEur: 0, volumeEur: 0, totalEur: 0, leadTimeDays: 0 },
    massKg: Math.max(1, Math.round(massKg)),
  };
}

/**
 * Cherche le plus petit ensemble de corps dont le retrait fait passer le reste.
 *
 * **On coupe par un plan, on ne cueille pas des pièces.** Une première version
 * retirait, à chaque tour, le corps qui réduisait le plus l'encombrement. Elle
 * ne trouvait jamais rien, pour une raison qui saute aux yeux après coup :
 * plusieurs corps atteignent la même cote extrême — une colonne et la poutre
 * qu'elle porte montent à 3 100 mm toutes les deux — et en retirer un seul ne
 * baisse la caisse d'aucun millimètre.
 *
 * On essaie donc des **plans de coupe** successifs, du plus haut au plus bas :
 * à chaque niveau, tout ce qui dépasse part dans la seconde caisse. C'est aussi
 * ce qu'un bureau d'études regarde en premier — non pas « quelle pièce enlever »
 * mais « jusqu'où faut-il descendre ».
 */
export function proposeDecoupe(
  bodies: PlacedBody[],
  massTotaleKg: number,
  mode: ShippingMode
): Decoupe | undefined {
  if (bodies.length < 2) return undefined;

  const volumeTotal = bodies.reduce((a, b) => a + b.volumeMm3, 0);
  if (volumeTotal <= 0) return undefined;

  const masse = (sous: PlacedBody[]) =>
    (sous.reduce((a, b) => a + b.volumeMm3, 0) / volumeTotal) * massTotaleKg;

  const entier = colis(bodies, massTotaleKg, mode);
  if (entier.retained) return undefined; // rien à découper : ça passe déjà

  const axe = axeBloquant(entier, bodies);

  // Les cotes extrêmes des corps, du plus haut au plus bas : autant de plans de
  // coupe candidats.
  const niveaux = [...new Set(bodies.map((b) => Math.round(b.max[axe])))].sort((a, b) => b - a);

  for (const seuil of niveaux.slice(1)) {
    const retires = bodies.filter((b) => b.max[axe] > seuil + 1);
    const restants = bodies.filter((b) => b.max[axe] <= seuil + 1);

    if (restants.length === 0) break;
    if (retires.length > RETRAITS_MAX) break;

    const principale = colis(restants, masse(restants), mode);
    if (!principale.retained) continue;

    // Les pièces déposées se recouchent : la seconde caisse est libre de pose.
    const seconde = colis(retires, masse(retires), mode, true);
    if (!seconde.retained) continue;

    return {
      retires: retires.map((b) => b.name),
      retiresBoites: retires.map((b) => ({ name: b.name, min: b.min, max: b.max })),
      corpsTotal: bodies.length,
      planDeCoupeMm: Math.round(seuil),
      axe,
      principale,
      seconde,
      // Deux caisses, deux forfaits, plus l'étude et le démontage.
      totalEur: principale.costing.totalEur + seconde.costing.totalEur + SPLIT_ENGINEERING_EUR,
      leadTimeDays:
        Math.max(principale.costing.leadTimeDays, seconde.costing.leadTimeDays) + SPLIT_EXTRA_DAYS,
    };
  }

  return undefined;
}

/**
 * L'axe **du repère caisse** sur lequel se joue le refus.
 *
 * Le verdict dit sur quoi il refuse — hauteur, largeur, porte. Reste à traduire
 * en axe : la hauteur est toujours Z, la largeur est celui de X ou Y qui est le
 * plus court, la longueur le plus long. Confondre l'ordre du triplet
 * (longueur, largeur, hauteur) avec l'ordre du repère (X, Y, Z) fait retirer
 * les mauvais corps sans qu'aucun chiffre ne s'en plaigne.
 */
function axeBloquant(c: Colis, bodies: PlacedBody[]): 0 | 1 | 2 {
  const [dx, dy] = etendues(bodies);
  const axeLarge: 0 | 1 = dx >= dy ? 0 : 1;
  const axeEtroit: 0 | 1 = dx >= dy ? 1 : 0;

  const raisons = new Set(c.checks.flatMap((v) => v.reasons));
  if (raisons.has('hauteur') || raisons.has('porte-hauteur')) return 2;
  if (raisons.has('largeur') || raisons.has('porte-largeur')) return axeEtroit;
  if (raisons.has('longueur')) return axeLarge;

  // Refus par charge, ou aucune raison dimensionnelle : la plus grande cote.
  const [, , dz] = etendues(bodies);
  return dz >= Math.max(dx, dy) ? 2 : axeLarge;
}
