import type { Confidence, Crate, Gabarit, GabaritCheck, RejectionReason, ShippingMode } from '../domain/types.js';
import { MARGE_SERREE_MM } from '../domain/types.js';
import { GABARITS } from '../domain/gabarits.js';
import { costForGabarit } from './chiffrage.js';

/**
 * Le verdict gabarit (PROJECT.md §6.4).
 *
 * « C'est littéralement une comparaison à des constantes. Le meilleur ratio
 * valeur/effort du projet est un `if`. »
 *
 * Deux règles qui ne se négocient pas :
 *
 * 1. **C'est la caisse qu'on confronte au gabarit, pas la machine.** Calage,
 *    épaisseur de panneau et surtout patins font 100 à 200 mm qui font basculer
 *    le verdict.
 * 2. **Porte et volume intérieur sont vérifiés séparément.** Une charge peut
 *    rentrer dans le volume et ne pas passer les portes.
 */

/** Confronte une caisse à un gabarit. */
export function checkGabarit(crate: Crate, gabarit: Gabarit): GabaritCheck {
  const { outer, grossKg } = crate;

  // Chaque contrainte donne une marge signée : positive si ça passe. On les
  // garde toutes, y compris celles qui passent — c'est la marge la plus faible
  // qui intéresse l'utilisateur, pas seulement celles qui échouent.
  const margins: Array<{ reason: RejectionReason; marginMm: number }> = [
    { reason: 'longueur', marginMm: gabarit.maxLengthMm - outer.lengthMm },
    { reason: 'largeur', marginMm: gabarit.maxWidthMm - outer.widthMm },
    { reason: 'hauteur', marginMm: gabarit.maxHeightMm - outer.heightMm },
  ];

  if (gabarit.doorWidthMm !== undefined) {
    margins.push({ reason: 'porte-largeur', marginMm: gabarit.doorWidthMm - outer.widthMm });
  }
  if (gabarit.doorHeightMm !== undefined) {
    margins.push({ reason: 'porte-hauteur', marginMm: gabarit.doorHeightMm - outer.heightMm });
  }

  const reasons = margins.filter((m) => m.marginMm < 0).map((m) => m.reason);

  // La charge est une contrainte réelle mais sans marge en millimètres : on la
  // traite à part pour ne pas polluer le calcul de la marge la plus serrée.
  const overloaded = grossKg > gabarit.maxPayloadKg;
  if (overloaded) reasons.push('charge');

  const tightest = margins.reduce((a, b) => (b.marginMm < a.marginMm ? b : a));

  const fits = reasons.length === 0;
  const confidence: Confidence = !fits
    ? 'refusé'
    : tightest.marginMm < MARGE_SERREE_MM
      ? 'juste'
      : 'confortable';

  return {
    gabarit,
    fits,
    confidence,
    reasons,
    tightestMarginMm: Math.round(tightest.marginMm),
    tightestOn: tightest.reason,
  };
}

/**
 * Confronte une caisse à tous les gabarits, du moins cher au plus cher.
 *
 * L'ordre de `GABARITS` est l'ordre de préférence : le premier qui passe est
 * celui qu'on retient.
 */
export function checkAll(crate: Crate): GabaritCheck[] {
  return GABARITS.map((g) => checkGabarit(crate, g));
}

/**
 * Le gabarit retenu : le moins cher **au total** de ceux qui passent.
 *
 * Comparer les forfaits suffisait tant que tous les gabarits se payaient à la
 * boîte. Le groupage a changé cela : son forfait est de 280 € et son prix se
 * fait au mètre cube. Classer sur le forfait le ferait gagner systématiquement,
 * y compris quand une caisse volumineuse le rend deux fois plus cher qu'un
 * conteneur complet. On compare donc ce qui se paie : le total.
 *
 * Restreint à un mode d'acheminement quand il est donné. Sans restriction, un
 * semi-remorque l'emporterait sur un conteneur — ce qui n'a de sens que si la
 * machine part effectivement par la route. Le mode est une entrée de l'étude,
 * pas un résultat d'optimisation.
 */
export function cheapestFit(
  crate: Crate,
  checks: GabaritCheck[],
  mode?: ShippingMode
): GabaritCheck | undefined {
  return checks
    .filter((c) => c.fits && (mode === undefined || c.gabarit.mode === mode))
    .map((c) => ({ c, total: costForGabarit(crate, c).totalEur }))
    .sort((a, b) => a.total - b.total)[0]?.c;
}

/** Formulation lisible d'un refus. « Ça ne passe pas » vaut zéro (§15). */
export function explain(check: GabaritCheck): string {
  if (check.fits) {
    return check.confidence === 'juste'
      ? `passe de justesse — ${check.tightestMarginMm} mm en ${check.tightestOn}, à confirmer avec la caisserie`
      : `passe — marge la plus faible ${check.tightestMarginMm} mm en ${check.tightestOn}`;
  }
  const parts = check.reasons.map((r) => {
    switch (r) {
      case 'porte-largeur':
        return 'trop large pour les portes';
      case 'porte-hauteur':
        return 'trop haute pour les portes';
      case 'charge':
        return 'charge utile dépassée';
      default:
        return `${r} dépassée`;
    }
  });
  return `refusé — ${parts.join(', ')}`;
}
