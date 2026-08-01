import type { PoseId, PoseResult, ShippingMode, Study, Triplet } from '../domain/types.js';
import { ASSUMPTIONS } from '../domain/assumptions.js';
import { buildCrate, isStackable } from './structure.js';
import { checkAll, cheapestFit } from './verdict.js';
import { costForGabarit, costOversize, costSplit } from './chiffrage.js';

/**
 * La fonction cœur du projet (PROJECT.md §12) :
 *
 *     (emprises, masse) → dimensions de caisse + verdicts + coûts + délais
 *
 * Pure, testable, zéro CAO. 80 % de la démo est sécurisé ici, avant d'avoir
 * touché à un STEP.
 *
 * Elle ne reçoit **que des triplets**. Le calcul des emprises orientées est le
 * travail de l'étape suivante : une fois les trois emprises obtenues, tout le
 * reste est de l'arithmétique, et le maillage n'est plus jamais retouché (§6.2).
 */

export interface PoseInput {
  pose: PoseId;
  label: string;
  footprint: Triplet;
  /**
   * La machine est-elle couchée dans cette pose ?
   *
   * Sert au drapeau « couchage interdit » du §5 — bain d'huile, axes
   * précontraints. Une case à cocher, et l'objection du seul mécanicien de la
   * salle est anticipée.
   */
  lying: boolean;
}

export interface StudyInput {
  /**
   * La référence naïve **plus** les trois poses.
   *
   * La référence n'est pas une pose de plus : c'est l'avant. C'est le delta
   * entre elle et la meilleure pose qui est le produit (§6.2).
   */
  poses: PoseInput[];
  massKg: number;
  forbidLying?: boolean;
  /**
   * Mode d'acheminement. Défaut : maritime — c'est le contexte du problème
   * (conteneurs, NIMP-15, hors gabarit OOG), et c'est là que le franchissement
   * de seuil coûte le plus cher.
   */
  mode?: ShippingMode;
}

/** Évalue une pose : caisse, verdicts, chiffrage. */
function evaluatePose(
  input: PoseInput,
  massKg: number,
  forbidLying: boolean,
  mode: ShippingMode
): PoseResult {
  const crate = buildCrate(input.footprint, massKg);
  const checks = checkAll(crate);

  const forbidden =
    forbidLying && input.lying
      ? 'Couchage interdit : bain d’huile, axes précontraints ou consigne constructeur.'
      : undefined;

  // Une pose interdite est calculée quand même, et affichée barrée. Masquer une
  // ligne, c'est priver l'utilisateur de l'information qui lui permettrait de
  // rediscuter la contrainte avec son bureau d'études.
  const retained = forbidden ? undefined : cheapestFit(checks, mode);

  const costing = retained
    ? costForGabarit(crate, retained)
    : { ...costOversize(crate) };

  return {
    pose: input.pose,
    label: input.label,
    footprint: input.footprint,
    crate,
    checks,
    retained,
    costing,
    stackable: isStackable(crate) && (retained?.gabarit.stackable ?? false),
    forbidden,
  };
}

/** Mentions obligatoires en sortie, et pas seulement dans le discours (§7.5, §7.6). */
function notices(anySolidWood: boolean): string[] {
  const list = [
    'Avant-projet de caisse. Ne vaut ni plan de fabrication, ni plan d’élingage.',
    'Les cotes de gabarit et la grille de prix sont indicatives et affichées dans les hypothèses. Un devis de transitaire reste un devis de transitaire.',
  ];
  if (anySolidWood) {
    list.push(
      'Bois massif — patins, plancher, montants : traitement NIMP-15 requis à l’export. Les panneaux dérivés en sont exemptés.'
    );
  }
  return list;
}

/**
 * Étude complète.
 *
 * Si aucune pose ne passe, les **deux** issues du §6.5 sont chiffrées : hors
 * gabarit assumé, et démontage en deux caisses. L'outil ne choisit pas.
 */
export function study(input: StudyInput): Study {
  const { massKg, forbidLying = false, mode = 'maritime' } = input;

  if (input.poses.length === 0) {
    throw new Error('Aucune pose à évaluer.');
  }

  const poses = input.poses.map((p) => evaluatePose(p, massKg, forbidLying, mode));

  // La référence naïve ne concourt pas : elle sert de point de comparaison, pas
  // de solution. La retenir comme « meilleure » viderait la démonstration de son
  // sens — c'est précisément ce qu'on cherche à améliorer.
  const candidates = poses.filter((p) => p.pose !== 'reference' && p.retained && !p.forbidden);
  const best = candidates.sort((a, b) => a.costing.totalEur - b.costing.totalEur)[0];

  const study: Study = {
    massKg,
    poses,
    best,
    assumptions: [...ASSUMPTIONS],
    notices: notices(poses.some((p) => p.crate.hasSolidWood)),
  };

  if (!best) {
    // Avant de conclure au hors gabarit, on regarde l'autre mode : il arrive
    // qu'un semi-remorque passe de quelques millimètres là où aucun conteneur
    // n'entre. C'est une proposition, pas une décision — la destination n'est
    // pas une variable d'ajustement.
    const other: ShippingMode = mode === 'maritime' ? 'route' : 'maritime';
    const alternatives = poses
      .filter((p) => p.pose !== 'reference' && !p.forbidden)
      .map((p) => ({ pose: p, check: cheapestFit(p.checks, other) }))
      .filter((a): a is { pose: PoseResult; check: NonNullable<typeof a.check> } => a.check !== undefined)
      .map((a) => ({ ...a, costing: costForGabarit(a.pose.crate, a.check) }))
      .sort((a, b) => a.costing.totalEur - b.costing.totalEur);

    const alternative = alternatives[0];
    if (alternative) {
      study.otherMode = {
        mode: other,
        pose: alternative.pose.pose,
        label: alternative.pose.label,
        gabaritLabel: alternative.check.gabarit.label,
        marginMm: alternative.check.tightestMarginMm,
        costing: alternative.costing,
      };
    }

    // Aucune pose ne passe : on retient la pose la plus compacte comme base de
    // chiffrage du repli, celle qui minimise le volume de caisse.
    const tightest = poses
      .filter((p) => p.pose !== 'reference')
      .sort(
        (a, b) =>
          a.crate.outer.lengthMm * a.crate.outer.widthMm * a.crate.outer.heightMm -
          b.crate.outer.lengthMm * b.crate.outer.widthMm * b.crate.outer.heightMm
      )[0]!;

    study.fallbacks = {
      oversize: costOversize(tightest.crate),
      split: costSplit(tightest.footprint, massKg),
    };
  }

  return study;
}

/**
 * Le delta, qui est le produit.
 *
 * « Retourner le non en proposition » : « ça ne passe pas » vaut zéro, « couchée
 * ça passe, et voilà ce que ça économise » vaut le déplacement (§15).
 */
export function savings(study: Study): { eur: number; days: number } | undefined {
  const reference = study.poses.find((p) => p.pose === 'reference');
  if (!reference || !study.best) return undefined;
  return {
    eur: reference.costing.totalEur - study.best.costing.totalEur,
    days: reference.costing.leadTimeDays - study.best.costing.leadTimeDays,
  };
}
