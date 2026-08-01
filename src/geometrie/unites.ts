/**
 * Le garde-fou de l'unité (PROJECT.md §11).
 *
 * « Un STEP est censé être en millimètres, mais on tombera sur des modèles en
 * pouces ou en mètres. Si l'emprise vaut 1,8 au lieu de 1800, on déclare une
 * caisse de 2 cm et on passe pour un amateur en direct. »
 *
 * Trois lignes de contrôle de vraisemblance, et un sélecteur visible. Ce fichier
 * ne devine jamais en silence : il retourne toujours ce qu'il a décidé et
 * pourquoi, pour que l'interface puisse l'afficher.
 */

export type UnitChoice = 'auto' | 'mm' | 'm' | 'in';

const FACTOR: Record<Exclude<UnitChoice, 'auto'>, number> = {
  mm: 1,
  m: 1_000,
  in: 25.4,
};

/**
 * Fenêtre de vraisemblance pour la plus grande dimension d'une machine
 * expédiée en caisse. En deçà, c'est une pièce ; au-delà, ce n'est plus une
 * caisse mais un convoi de génie civil.
 */
export const PLAUSIBLE_MIN_MM = 300;
export const PLAUSIBLE_MAX_MM = 25_000;

export interface UnitResolution {
  unit: Exclude<UnitChoice, 'auto'>;
  scale: number;
  /** La plus grande dimension une fois convertie, en mm. */
  largestMm: number;
  /** Vrai si la valeur retenue tombe dans la fenêtre de vraisemblance. */
  plausible: boolean;
  /** Explication destinée à l'écran. Jamais un choix silencieux. */
  note: string;
}

/**
 * Décide de l'unité du fichier.
 *
 * `largestRaw` est la plus grande dimension telle qu'elle sort du maillage,
 * sans conversion.
 *
 * En mode `auto`, l'ordre d'essai n'est pas neutre : le millimètre d'abord,
 * parce que c'est la convention du STEP et qu'une valeur plausible en mm doit
 * être crue. Le mètre ensuite, le pouce en dernier.
 */
export function resolveUnit(choice: UnitChoice, largestRaw: number): UnitResolution {
  const plausible = (mm: number) => mm >= PLAUSIBLE_MIN_MM && mm <= PLAUSIBLE_MAX_MM;

  if (choice !== 'auto') {
    const scale = FACTOR[choice];
    const largestMm = largestRaw * scale;
    return {
      unit: choice,
      scale,
      largestMm,
      plausible: plausible(largestMm),
      note: plausible(largestMm)
        ? `Unité ${choice} imposée. Plus grande dimension : ${Math.round(largestMm)} mm.`
        : `Unité ${choice} imposée, mais la plus grande dimension vaut ${Math.round(largestMm)} mm — hors de la fenêtre ${PLAUSIBLE_MIN_MM}–${PLAUSIBLE_MAX_MM} mm. Vérifiez l’unité du fichier.`,
    };
  }

  for (const unit of ['mm', 'm', 'in'] as const) {
    const largestMm = largestRaw * FACTOR[unit];
    if (plausible(largestMm)) {
      return {
        unit,
        scale: FACTOR[unit],
        largestMm,
        plausible: true,
        note:
          unit === 'mm'
            ? `Unité déduite : millimètre. Plus grande dimension : ${Math.round(largestMm)} mm.`
            : `Unité déduite : ${unit === 'm' ? 'mètre' : 'pouce'} — la lecture en millimètres donnait ${largestRaw.toFixed(1)} mm, invraisemblable pour une machine. Plus grande dimension : ${Math.round(largestMm)} mm.`,
      };
    }
  }

  // Aucune interprétation ne tombe dans la fenêtre : on ne choisit pas à la
  // place de l'utilisateur, on retient le millimètre et on le dit fort.
  return {
    unit: 'mm',
    scale: 1,
    largestMm: largestRaw,
    plausible: false,
    note: `Aucune unité vraisemblable : ${largestRaw.toFixed(1)} mm en lecture directe, ${(largestRaw / 1000).toFixed(3)} m, ${(largestRaw * 25.4).toFixed(0)} mm si pouces. Sélectionnez l’unité à la main.`,
  };
}
