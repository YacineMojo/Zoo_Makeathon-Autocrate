import type { PoseId, PoseResult, ShippingMode, Study, Triplet } from '../domain/types.js';
import { ASSUMPTIONS } from '../domain/assumptions.js';
import { buildCrate, isStackable } from './structure.js';
import { checkAll, cheapestFit } from './verdict.js';
import { costForGabarit, costOversize, costSplit } from './chiffrage.js';
import { proposeDecoupe, type PlacedBody } from './decoupe.js';

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
  /**
   * Les corps distincts du maillage, déjà placés pour cette pose.
   *
   * Facultatif : sans eux l'étude fonctionne, elle propose seulement un
   * démontage moins bien renseigné.
   */
  bodies?: PlacedBody[];
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
  const retained = forbidden ? undefined : cheapestFit(crate, checks, mode);

  const costing = retained
    ? costForGabarit(crate, retained)
    : { ...costOversize(crate) };

  // Ce que la même pose donnerait dans l'autre mode : la colonne du tableau
  // doit pouvoir le dire elle-même, sans dépendre du bandeau.
  const autre: ShippingMode = mode === 'maritime' ? 'route' : 'maritime';
  const checkAutre = forbidden || retained ? undefined : cheapestFit(crate, checks, autre);

  return {
    pose: input.pose,
    label: input.label,
    footprint: input.footprint,
    crate,
    checks,
    retained,
    costing,
    otherMode: checkAutre ? { gabarit: checkAutre, costing: costForGabarit(crate, checkAutre) } : undefined,
    stackable: isStackable(crate) && (retained?.gabarit.stackable ?? false),
    forbidden,
  };
}

/** Mentions obligatoires en sortie, et pas seulement dans le discours (§7.5, §7.6). */
function notices(anySolidWood: boolean): string[] {
  const list = [
    'Avant-projet de caisse. Ne vaut ni plan de fabrication, ni plan d’élingage.',
    'Le calage est un principe : position et encombrement des cales. Il ne dit pas où la machine accepte d’être poussée — cela demande la matière et l’arbre d’assemblage, que l’outil n’a pas.',
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

  // Y a-t-il quelque chose à arbitrer ? Si la meilleure pose tombe dans le même
  // gabarit et le même délai que le repère CAO, l'écart n'est que du
  // contreplaqué. Recommander de coucher une machine pour quelques dizaines
  // d'euros apprend au lecteur à ignorer nos recommandations.
  const reference = poses.find((p) => p.pose === 'reference');
  const arbitrage: Study['arbitrage'] =
    best &&
    reference?.retained &&
    reference.retained.gabarit.id === best.retained!.gabarit.id &&
    reference.costing.leadTimeDays === best.costing.leadTimeDays
      ? 'aucun'
      : 'gabarit';

  // L'option la plus rapide parmi tout ce qui passe, toutes poses et tous
  // gabarits du mode confondus. Si elle est plus rapide que la moins chère, le
  // choix appartient à l'utilisateur, pas à l'outil.
  let faster: Study['faster'];
  if (best) {
    const options = poses
      .filter((p) => p.pose !== 'reference' && !p.forbidden)
      .flatMap((p) =>
        p.checks
          .filter((c) => c.fits && c.gabarit.mode === mode)
          .map((c) => ({ pose: p, check: c, costing: costForGabarit(p.crate, c) }))
      )
      .sort((a, b) => a.costing.leadTimeDays - b.costing.leadTimeDays || a.costing.totalEur - b.costing.totalEur);

    const rapide = options[0];
    if (rapide && rapide.costing.leadTimeDays < best.costing.leadTimeDays) {
      faster = {
        pose: rapide.pose.pose,
        label: rapide.pose.label,
        gabaritLabel: rapide.check.gabarit.label,
        costing: rapide.costing,
      };
    }
  }

  const study: Study = {
    massKg,
    poses,
    best,
    faster,
    arbitrage,
    assumptions: [...ASSUMPTIONS],
    notices: notices(poses.some((p) => p.crate.hasSolidWood)),
  };

  // Un refus par charge utile ne se règle par aucune orientation, et un flat
  // rack n'y change rien non plus : c'est un problème de masse. On le dit, au
  // lieu d'afficher un tableau de poses qui suggère qu'une pose sauverait la
  // mise.
  const tousSurcharges =
    !best &&
    poses.every((p) => p.checks.length > 0 && p.checks.every((c) => c.reasons.includes('charge')));

  if (tousSurcharges) {
    const plusCapable = poses[0]!.checks.reduce((a, c) =>
      c.gabarit.maxPayloadKg > a.gabarit.maxPayloadKg ? c : a
    );
    study.overloaded = {
      grossKg: poses[0]!.crate.grossKg,
      maxPayloadKg: plusCapable.gabarit.maxPayloadKg,
      gabaritLabel: plusCapable.gabarit.label,
    };
  }

  if (!best && !study.overloaded) {
    // Avant de conclure au hors gabarit, on regarde l'autre mode : il arrive
    // qu'un semi-remorque passe de quelques millimètres là où aucun conteneur
    // n'entre. C'est une proposition, pas une décision — la destination n'est
    // pas une variable d'ajustement.
    const other: ShippingMode = mode === 'maritime' ? 'route' : 'maritime';
    const alternative = poses
      .filter((p) => p.pose !== 'reference' && p.otherMode)
      .sort((a, b) => a.otherMode!.costing.totalEur - b.otherMode!.costing.totalEur)[0];

    if (alternative) {
      study.otherMode = {
        mode: other,
        pose: alternative.pose,
        label: alternative.label,
        gabaritLabel: alternative.otherMode!.gabarit.gabarit.label,
        marginMm: alternative.otherMode!.gabarit.tightestMarginMm,
        costing: alternative.otherMode!.costing,
      };
    }

    // Aucune pose ne passe : on retient la pose la plus compacte comme base de
    // chiffrage du repli, celle qui minimise le volume de caisse.
    //
    // Mais une pose **écartée** ne peut pas servir de base : elle est interdite,
    // pas seulement chère, et sa caisse passe souvent très bien — ce qui
    // faisait disparaître toute proposition de découpage dès que le couchage
    // était interdit.
    const eligibles = poses.filter((p) => p.pose !== 'reference' && !p.forbidden);
    const tightest = (eligibles.length > 0 ? eligibles : poses.filter((p) => p.pose !== 'reference'))
      .sort(
        (a, b) =>
          a.crate.outer.lengthMm * a.crate.outer.widthMm * a.crate.outer.heightMm -
          b.crate.outer.lengthMm * b.crate.outer.widthMm * b.crate.outer.heightMm
      )[0]!;

    study.fallbacks = {
      oversize: costOversize(tightest.crate),
      split: costSplit(tightest.footprint, massKg),
    };

    // Et si le maillage porte des corps distincts, on peut faire beaucoup mieux
    // qu'une coupe au milieu : dire **lesquels** portent le dépassement.
    const avecCorps = input.poses.find((p) => p.pose === tightest.pose)?.bodies;
    if (avecCorps && avecCorps.length > 1) {
      study.decoupe = proposeDecoupe(avecCorps, massKg, mode);
    }
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
  // Rien à annoncer quand il n'y a rien à arbitrer : « 0 € et 0 jours
  // économisés » est un message qui use la confiance pour rien.
  if (study.arbitrage === 'aucun') return undefined;
  return {
    eur: reference.costing.totalEur - study.best.costing.totalEur,
    days: reference.costing.leadTimeDays - study.best.costing.leadTimeDays,
  };
}
