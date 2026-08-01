/**
 * Vocabulaire du domaine.
 *
 * Toutes les longueurs sont en **millimètres**, toutes les masses en
 * **kilogrammes**, tous les montants en **euros**. Aucune fonction ne convertit
 * d'unité en interne : la conversion se fait une seule fois, à la lecture du
 * fichier (PROJECT.md §11).
 */

/** Triplet de dimensions, dans l'ordre longueur × largeur × hauteur. */
export interface Triplet {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

/** Une hypothèse affichée à l'écran, en lecture seule (PROJECT.md §7.4). */
export interface Assumption {
  id: string;
  label: string;
  value: string;
  /** Pourquoi cette valeur. Le jury ne peut pas juger l'exactitude ; il peut juger la lucidité. */
  rationale: string;
}

/** Les trois orientations possibles de la machine — quel axe pointe vers le haut (§6.2). */
export type PoseId = 'reference' | 'A' | 'B' | 'C';

/** Section d'un bois massif, en millimètres. */
export interface Section {
  heightMm: number;
  widthMm: number;
}

/** Structure de caisse dimensionnée à partir d'une emprise et d'une masse (§6.3). */
export interface Crate {
  /** Emprise de la machine qui a servi au dimensionnement. */
  machine: Triplet;
  /** Encombrement extérieur de la caisse — c'est **lui** qu'on confronte au gabarit (§6.4). */
  outer: Triplet;
  /** Volume intérieur libre, calage compris. */
  inner: Triplet;

  skid: Section;
  /** Nombre de patins sous le plancher. */
  skidCount: number;
  floorThicknessMm: number;
  panelThicknessMm: number;
  studSpacingMm: number;
  clearanceMm: number;

  /** Masse de la caisse vide, estimée. */
  tareKg: number;
  /** Masse machine + caisse. */
  grossKg: number;

  /** Bois massif présent : déclenche la mention NIMP-15 (§7.5). */
  hasSolidWood: boolean;
}

/**
 * Mode d'acheminement.
 *
 * Un conteneur et une semi-remorque ne sont pas deux offres concurrentes pour
 * le même envoi : elles ne vont pas au même endroit. Les comparer sur le prix
 * n'a pas de sens, et laisser un semi à 2 400 € « gagner » contre un 40 pieds
 * à 4 300 € pour une machine qui part en Asie serait une erreur grossière.
 * Le mode est donc une **entrée**, pas un résultat d'optimisation.
 */
export type ShippingMode = 'maritime' | 'route';

/** Un gabarit de transport et ses contraintes (§6.4). */
export interface Gabarit {
  id: string;
  label: string;
  mode: ShippingMode;
  /** Longueur utile de chargement. */
  maxLengthMm: number;
  /** Largeur utile de chargement. */
  maxWidthMm: number;
  /** Hauteur intérieure disponible. */
  maxHeightMm: number;
  /**
   * Ouverture de porte, quand elle est distincte de la section intérieure.
   *
   * Une charge peut rentrer dans le volume et ne pas passer les portes : les
   * deux contraintes sont vérifiées séparément, jamais confondues (§6.4).
   */
  doorWidthMm?: number;
  doorHeightMm?: number;
  /** Charge utile. */
  maxPayloadKg: number;
  /** Le gabarit lui-même est-il gerbable en pratique ? */
  stackable: boolean;
}

/** Pourquoi un gabarit est refusé. Utile en Q&A : « ça ne passe pas » ne suffit pas. */
export type RejectionReason =
  | 'longueur'
  | 'largeur'
  | 'hauteur'
  | 'porte-largeur'
  | 'porte-hauteur'
  | 'charge';

export interface GabaritCheck {
  gabarit: Gabarit;
  fits: boolean;
  reasons: RejectionReason[];
  /** Marge la plus faible, en mm. Négative si ça ne passe pas. C'est le chiffre du §2 : trois centimètres. */
  tightestMarginMm: number;
  /** Sur quelle dimension se joue cette marge. */
  tightestOn: RejectionReason;
}

/** Chiffrage d'une solution de transport (§6.6). */
export interface Costing {
  /** Fabrication de la caisse. */
  crateEur: number;
  /**
   * Régime **discret** : le forfait du gabarit. C'est l'argument principal —
   * franchir un seuil coûte un facteur, pas un pourcentage.
   */
  thresholdEur: number;
  /** Régime **continu** : le m³ transporté. Ligne secondaire, affichée pour être honnête. */
  volumeEur: number;
  totalEur: number;
  /** Délai d'acheminement, autorisations comprises. Gratuit à coder, difficile à balayer. */
  leadTimeDays: number;
}

/** Évaluation complète d'une pose. */
export interface PoseResult {
  pose: PoseId;
  label: string;
  /** Emprise de la machine dans cette pose. */
  footprint: Triplet;
  crate: Crate;
  /** Tous les gabarits testés, dans l'ordre du moins cher au plus cher. */
  checks: GabaritCheck[];
  /** Le premier gabarit qui passe, s'il y en a un. */
  retained?: GabaritCheck;
  costing: Costing;
  /** La caisse est-elle gerbable une fois chargée ? */
  stackable: boolean;
  /** Pose écartée par l'utilisateur : couchage interdit (§5). */
  forbidden?: string;
}

/** Les deux issues chiffrées quand aucune pose ne passe (§6.5). */
export interface Fallbacks {
  /** Hors gabarit assumé : flat rack, OOG, convoi exceptionnel. */
  oversize: Costing & { label: string };
  /**
   * Démontage en deux caisses.
   *
   * **L'outil ne découpe pas.** Il ne lit pas l'arbre d'assemblage et ne décide
   * pas du découpage : il chiffre l'hypothèse d'un partage en deux et laisse
   * choisir (§6.5).
   */
  split: Costing & { label: string; assumedHalves: Triplet };
}

/** Sortie complète du moteur. */
export interface Study {
  massKg: number;
  poses: PoseResult[];
  /** Meilleure pose retenue : la moins chère parmi celles qui passent. */
  best?: PoseResult;
  /** Renseigné uniquement si aucune pose ne passe. */
  fallbacks?: Fallbacks;
  /**
   * Aucune pose ne passe dans le mode demandé, mais une passe dans l'autre.
   *
   * Annoncer un convoi exceptionnel à 20 000 € alors qu'un semi-remorque passe
   * avec 21 mm de marge serait faux, et se ferait démonter en Q&A. Changer de
   * mode n'est pas toujours possible — une machine qui part en Asie ne part pas
   * par la route — mais c'est une décision qui appartient à l'utilisateur, pas
   * à l'outil. On la lui met sous les yeux.
   */
  otherMode?: {
    mode: ShippingMode;
    pose: PoseId;
    label: string;
    gabaritLabel: string;
    marginMm: number;
    costing: Costing;
  };
  assumptions: Assumption[];
  /** Mentions obligatoires en sortie (§7.5, §7.6). */
  notices: string[];
}
