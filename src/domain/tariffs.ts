/**
 * Grille de prix et de délais (PROJECT.md §6.6).
 *
 * **Assumée comme indicative, et affichée avec ses valeurs.** Elle n'a pas
 * vocation à être juste au centime : elle a vocation à rendre visible un
 * rapport d'échelle. Un devis de transitaire reste un devis de transitaire.
 *
 * Deux régimes, nommés comme tels :
 *
 * - le **continu** — le m³ d'air transporté. Ligne secondaire, honnête, faible.
 * - le **discret** — le franchissement de seuil. Argument principal : passer
 *   d'un 40' standard à un flat rack coûte un facteur, pas un pourcentage.
 *
 * La colonne délai est gratuite à coder et très difficile à balayer : un convoi
 * exceptionnel, c'est une autorisation à plusieurs semaines ; un OOG, une
 * disponibilité de booking.
 */

export interface Tariff {
  /** Forfait de transport pour ce gabarit — le régime discret. */
  thresholdEur: number;
  /** Délai d'acheminement en jours, autorisations comprises. */
  leadTimeDays: number;
}

export const TARIFFS: Readonly<Record<string, Tariff>> = {
  '40-std': { thresholdEur: 4_300, leadTimeDays: 5 },
  '40-hc': { thresholdEur: 4_900, leadTimeDays: 5 },
  semi: { thresholdEur: 2_400, leadTimeDays: 3 },
};

/** Hors gabarit maritime : flat rack ou OOG. Booking rare, délai subi. */
export const OVERSIZE_TARIFF: Tariff = { thresholdEur: 11_000, leadTimeDays: 21 };

/** Convoi exceptionnel routier : ce n'est plus du fret, c'est de l'autorisation. */
export const CONVOY_TARIFF: Tariff = { thresholdEur: 18_000, leadTimeDays: 42 };

/** Régime continu : le m³ effectivement transporté. */
export const VOLUME_EUR_PER_M3 = 38;

/**
 * Fabrication de la caisse.
 *
 * Décomposée en deux postes plutôt qu'un prix au m³, parce qu'une caisse plate
 * et une caisse cubique de même volume ne coûtent pas la même chose : le prix
 * suit la surface de panneaux et le linéaire de bois, pas le vide au milieu.
 */
export const CRATE_PANEL_EUR_PER_M2 = 42;
export const CRATE_WOOD_EUR_PER_M3 = 620;
/** Main-d'œuvre et fournitures, forfaitaire. */
export const CRATE_FIXED_EUR = 350;

/** Surcoût d'étude et de manutention quand on scinde en deux caisses (§6.5). */
export const SPLIT_ENGINEERING_EUR = 2_800;
/** Jours perdus à décider, démonter et reconditionner. */
export const SPLIT_EXTRA_DAYS = 7;
