import type { Costing, Crate, GabaritCheck, ShippingMode, Triplet } from '../domain/types.js';
import { buildCrate } from './structure.js';
import { checkAll, cheapestFit } from './verdict.js';
import { costForGabarit } from './chiffrage.js';
import { SPLIT_ENGINEERING_EUR, SPLIT_EXTRA_DAYS } from '../domain/tariffs.js';

/**
 * Découper l'expédition en plusieurs caisses (PROJECT.md §6.5).
 *
 * **Ce que l'outil affirme, et ce qu'il n'affirme pas.** Il ne dit pas que ces
 * pièces se démontent : un corps distinct dans un maillage peut être une
 * soudure, un ensemble monobloc, ou un résidu de conversion. Il dit lesquels
 * portent le dépassement, ce que leur séparation coûterait, et à quoi ça
 * ressemble. L'ingénierie tranche.
 *
 * **On coupe par des plans, on ne cueille pas des pièces.** Une première
 * version retirait le corps qui réduisait le plus l'encombrement, un à la fois.
 * Elle ne trouvait jamais rien : une colonne et la poutre qu'elle porte montent
 * à la même cote, et en retirer une seule ne baisse la caisse d'aucun
 * millimètre. Les plans décrivent aussi mieux ce qu'un bureau d'études regarde —
 * non pas quelle pièce enlever, mais jusqu'où descendre.
 *
 * Deux hypothèses, explicites parce qu'elles sont discutables :
 *
 *   - un corps qui chevauche un plan part **avec le groupe du dessus**, entier :
 *     on ne coupe jamais une pièce en deux ;
 *   - la masse est répartie au prorata du volume des boîtes, faute de matière.
 */

/** Un corps, déjà placé dans le repère de la caisse pour la pose étudiée. */
export interface PlacedBody {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  volumeMm3: number;
}

export interface Caisse {
  /** Rang dans l'expédition, de la plus basse à la plus haute. */
  rang: number;
  corps: string[];
  boites: Array<{ name: string; min: [number, number, number]; max: [number, number, number] }>;
  footprint: Triplet;
  crate: Crate;
  checks: GabaritCheck[];
  retained?: GabaritCheck;
  costing: Costing;
  massKg: number;
}

export interface Decoupe {
  caisses: Caisse[];
  corpsTotal: number;
  /** Axe du repère caisse sur lequel la coupe est faite : 0 X, 1 Y, 2 Z. */
  axe: 0 | 1 | 2;
  /** Cotes des plans de coupe, en coordonnées caisse. */
  plansMm: number[];
  totalEur: number;
  leadTimeDays: number;
}

/** Au-delà, ce n'est plus un démontage, c'est une refonte du produit. */
export const CAISSES_MAX = 4;

/** Volume extérieur d'une caisse, en mm³. Sert à juger si un découpage sert. */
function volumeCaisse(c: Caisse): number {
  return c.crate.outer.lengthMm * c.crate.outer.widthMm * c.crate.outer.heightMm;
}

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
 * `libre` change tout. La caisse qui garde la pose étudiée garde sa hauteur.
 * Les autres se recouchent — une colonne de trois mètres se couche, et c'est la
 * première chose qu'un caissier fait. L'évaluer debout la déclarait hors
 * gabarit et faisait échouer toute proposition.
 */
function envelope(bodies: PlacedBody[], libre: boolean): Triplet {
  const [dx, dy, dz] = etendues(bodies);
  if (!libre) return { lengthMm: Math.max(dx, dy), widthMm: Math.min(dx, dy), heightMm: dz };

  const [h, l, L] = [dx, dy, dz].sort((a, b) => a - b);
  return { lengthMm: L!, widthMm: l!, heightMm: h! };
}

function caisse(
  bodies: PlacedBody[],
  massKg: number,
  mode: ShippingMode,
  libre: boolean,
  rang: number
): Caisse {
  const footprint = envelope(bodies, libre);
  const crate = buildCrate(footprint, Math.max(1, Math.round(massKg)));
  const checks = checkAll(crate);
  const retained = cheapestFit(crate, checks, mode);

  return {
    rang,
    corps: bodies.map((b) => b.name),
    boites: bodies.map((b) => ({ name: b.name, min: b.min, max: b.max })),
    footprint,
    crate,
    checks,
    retained,
    costing: retained
      ? costForGabarit(crate, retained)
      : { crateEur: 0, thresholdEur: 0, volumeEur: 0, totalEur: 0, leadTimeDays: 0 },
    massKg: Math.max(1, Math.round(massKg)),
  };
}

/**
 * Répartit les corps en `nb` groupes par des plans.
 *
 * Les plans sont posés à intervalles réguliers sur l'étendue occupée, et chaque
 * corps rejoint le groupe où tombe **son sommet** : un corps qui chevauche un
 * plan part donc avec le groupe du dessus, entier.
 */
function grouper(
  bodies: PlacedBody[],
  axe: 0 | 1 | 2,
  nb: number
): { groupes: PlacedBody[][]; plans: number[] } {
  const bas = Math.min(...bodies.map((b) => b.min[axe]));
  const haut = Math.max(...bodies.map((b) => b.max[axe]));
  const pas = (haut - bas) / nb;

  const plans = Array.from({ length: nb - 1 }, (_, k) => bas + pas * (k + 1));
  const groupes: PlacedBody[][] = Array.from({ length: nb }, () => []);

  for (const b of bodies) {
    let g = plans.findIndex((niveau) => b.max[axe] <= niveau + 1);
    if (g === -1) g = nb - 1;
    groupes[g]!.push(b);
  }

  return { groupes: groupes.filter((g) => g.length > 0), plans };
}

/**
 * L'axe **du repère caisse** sur lequel se joue le refus.
 *
 * Le verdict dit sur quoi il refuse — hauteur, largeur, porte. Reste à traduire
 * en axe : la hauteur est toujours Z, la largeur est celui de X ou Y qui est le
 * plus court. Confondre l'ordre du triplet (longueur, largeur, hauteur) avec
 * l'ordre du repère (X, Y, Z) fait couper au mauvais endroit sans qu'aucun
 * chiffre ne s'en plaigne.
 */
function axeBloquant(checks: GabaritCheck[], bodies: PlacedBody[]): 0 | 1 | 2 {
  const [dx, dy, dz] = etendues(bodies);
  const axeLarge: 0 | 1 = dx >= dy ? 0 : 1;
  const axeEtroit: 0 | 1 = dx >= dy ? 1 : 0;

  const raisons = new Set(checks.flatMap((v) => v.reasons));
  if (raisons.has('hauteur') || raisons.has('porte-hauteur')) return 2;
  if (raisons.has('largeur') || raisons.has('porte-largeur')) return axeEtroit;
  if (raisons.has('longueur')) return axeLarge;

  return dz >= Math.max(dx, dy) ? 2 : axeLarge;
}

/**
 * Propose un découpage.
 *
 * `cible` force un nombre de caisses ; sans lui, on cherche le plus petit qui
 * marche. Forcer sert à comparer : chaque caisse de plus est un forfait de
 * plus, et voir l'écart vaut mieux que le supposer.
 */
export function proposeDecoupe(
  bodies: PlacedBody[],
  massTotaleKg: number,
  mode: ShippingMode,
  cible?: number
): Decoupe | undefined {
  if (bodies.length < 2) return undefined;

  const volumeTotal = bodies.reduce((a, b) => a + b.volumeMm3, 0);
  if (volumeTotal <= 0) return undefined;

  const masse = (sous: PlacedBody[]) =>
    (sous.reduce((a, b) => a + b.volumeMm3, 0) / volumeTotal) * massTotaleKg;

  const entier = caisse(bodies, massTotaleKg, mode, false, 0);

  // **Les trois axes, pas un seul.** L'axe qui bloque est le bon candidat quand
  // quelque chose bloque ; quand rien ne bloque — découpage demandé par
  // l'utilisateur — il n'a plus de sens, et couper au hasard donne des
  // répartitions absurdes : un corps d'un côté, quatorze de l'autre. On essaie
  // donc les trois et on garde le moins cher.
  const bloquant = axeBloquant(entier.checks, bodies);
  const axes: Array<0 | 1 | 2> = [bloquant, ...([0, 1, 2] as const).filter((a) => a !== bloquant)];

  const essais = cible ? [cible] : Array.from({ length: CAISSES_MAX - 1 }, (_, k) => k + 2);
  const candidats: Decoupe[] = [];

  for (const axe of axes) {
    for (const nb of essais) {
      if (nb < 2 || nb > CAISSES_MAX) continue;

      const { groupes, plans } = grouper(bodies, axe, nb);
      if (groupes.length < nb) continue; // des plans sont tombés dans le vide

      // La caisse du bas garde la pose étudiée ; les autres se recouchent.
      const caisses = groupes.map((g, i) => caisse(g, masse(g), mode, i > 0, i));
      if (caisses.some((c) => !c.retained)) continue;

      // **Le découpage doit servir à quelque chose.** Le seul critère qui
      // compte est là : la plus grosse caisse obtenue doit être nettement plus
      // petite que la caisse unique. Sans lui, on produisait des répartitions
      // absurdes — un corps mince d'un côté, quatorze de l'autre, et une caisse
      // principale identique à celle qu'on voulait éviter.
      const plusGrosse = Math.max(...caisses.map((c) => volumeCaisse(c)));
      if (plusGrosse > volumeCaisse(entier) * 0.9) continue;

      candidats.push({
        caisses,
        corpsTotal: bodies.length,
        axe,
        plansMm: plans.map((v) => Math.round(v)),
        // Un forfait par caisse, plus l'étude et le démontage, une seule fois.
        totalEur: caisses.reduce((a, c) => a + c.costing.totalEur, 0) + SPLIT_ENGINEERING_EUR,
        leadTimeDays: Math.max(...caisses.map((c) => c.costing.leadTimeDays)) + SPLIT_EXTRA_DAYS,
      });
    }

    // Sans cible, on veut le plus petit nombre de caisses : dès qu'un axe donne
    // un résultat, inutile d'en essayer d'autres avec davantage de caisses.
    if (!cible && candidats.length > 0) break;
  }

  if (candidats.length === 0) return undefined;

  return candidats.sort(
    (a, b) => a.caisses.length - b.caisses.length || a.totalEur - b.totalEur
  )[0];
}
