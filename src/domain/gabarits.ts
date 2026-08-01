import type { Gabarit } from './types.js';

/**
 * Les gabarits de transport, en constantes (PROJECT.md §6.4).
 *
 * « C'est littéralement une comparaison à des constantes. Le meilleur ratio
 * valeur/effort du projet est un `if`. »
 *
 * Les cotes intérieures varient de quelques centimètres d'un constructeur de
 * conteneur à l'autre. Les valeurs retenues sont les plus courantes du marché,
 * et elles sont affichées — c'est ce qui permet à un logisticien de les corriger
 * en connaissance de cause plutôt que de découvrir un chiffre caché.
 *
 * **Porte et volume sont deux contraintes distinctes.** Une charge peut tenir
 * dans le volume intérieur et ne pas passer les portes : les confondre est une
 * erreur silencieuse, et fatale en Q&A.
 *
 * Les gabarits de deux modes différents ne se comparent pas entre eux : le mode
 * d'acheminement est une entrée de l'étude. À l'intérieur d'un mode, on retient
 * le moins cher de ceux qui passent.
 */
export const GABARITS: ReadonlyArray<Gabarit> = [
  {
    id: '40-std',
    label: "Conteneur 40' standard",
    mode: 'maritime',
    maxLengthMm: 12_030,
    maxWidthMm: 2_350,
    maxHeightMm: 2_390,
    doorWidthMm: 2_340,
    doorHeightMm: 2_280,
    maxPayloadKg: 26_700,
    stackable: true,
  },
  {
    id: '40-hc',
    label: "Conteneur 40' High Cube",
    mode: 'maritime',
    maxLengthMm: 12_030,
    maxWidthMm: 2_350,
    maxHeightMm: 2_690,
    doorWidthMm: 2_340,
    doorHeightMm: 2_580,
    maxPayloadKg: 26_500,
    stackable: true,
  },
  {
    id: 'semi',
    label: 'Semi-remorque (route)',
    mode: 'route',
    maxLengthMm: 13_600,
    // Largeur chargeable réelle : 2,45 à 2,48 m selon la remorque. On retient la
    // valeur basse — une caisse dimensionnée sur l'optimiste ne monte pas.
    maxWidthMm: 2_450,
    // Hauteur de caisse transportable sous 4 m hors tout, plateau à ~1,20 m.
    maxHeightMm: 2_750,
    maxPayloadKg: 24_000,
    stackable: false,
  },
];

/**
 * Au-delà des gabarits standards : hors gabarit assumé.
 *
 * Ce n'est pas un gabarit de plus dans la liste, parce qu'il ne se teste pas —
 * il se subit. Il sert de branche de repli chiffrée (§6.5).
 */
export const OVERSIZE_LABEL = 'Flat rack / OOG ou convoi exceptionnel';

/**
 * Largeur au-delà de laquelle un transport routier bascule en convoi
 * exceptionnel en France, et où le délai cesse d'être une question de booking
 * pour devenir une question d'autorisation.
 */
export const CONVOY_WIDTH_THRESHOLD_MM = 2_550;
