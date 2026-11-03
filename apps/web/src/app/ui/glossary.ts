/**
 * Lexique de l'application (#12) : **une seule source** pour l'aide contextuelle (`app-help-hint`) et la page « Aide et lexique ».
 * Règle (design.md) : tout terme qui n'est pas du langage courant a une entrée ici, avec sa définition en une à trois phrases et
 * un exemple. `simple` est le mot de l'affichage Simple ; `accounting`, le mot que dira l'expert-comptable (affichage Comptable).
 */
export interface GlossaryEntry {
  /** Mot de l'affichage Simple. */
  simple: string;
  /** Mot comptable correspondant, expliqué à côté pour que la personne s'y retrouve face à un expert. */
  accounting?: string;
  definition: string;
  example: string;
}

export const GLOSSARY = {
  mouvement: {
    simple: 'Mouvement',
    accounting: 'Transaction bancaire',
    definition: 'Une entrée ou une sortie d’argent sur un compte (banque ou caisse), telle qu’elle apparaît sur votre relevé.',
    example: 'Le prélèvement de 52 € de l’assurance, ou la cotisation de 30 € reçue par virement.',
  },
  classer: {
    simple: 'Classer un mouvement',
    accounting: 'Qualifier une transaction',
    definition: 'Dire à quoi correspond un mouvement : cotisation, assurance, don… C’est ce qui permet de le ranger dans les comptes.',
    example: 'Un prélèvement « MAIF » se classe dans « Assurance ».',
  },
  enregistre: {
    simple: 'Enregistré dans les comptes',
    accounting: 'Comptabilisé (écriture comptabilisée)',
    definition:
      'Le mouvement figure dans la comptabilité : il compte dans les rapports (ce que vous avez reçu et dépensé). Tant qu’il est seulement classé, il n’y compte pas encore.',
    example: 'Après « Classer et enregistrer », la dépense apparaît dans le compte de résultat.',
  },
  brouillon: {
    simple: 'Brouillon',
    accounting: 'Écriture en brouillon',
    definition:
      'Une opération préparée mais pas encore définitive : on peut la modifier ou la supprimer, et elle ne compte pas encore dans les rapports. Une personne autorisée la relit, puis l’enregistre.',
    example: 'Sans le droit d’enregistrer, vos saisies restent en brouillon jusqu’à la relecture du trésorier.',
  },
  verifie: {
    simple: 'Vérifié avec la banque',
    accounting: 'Rapprochement bancaire',
    definition:
      'Vous avez comparé vos enregistrements au relevé de la banque et ils concordent. C’est ce qui permet de repérer un oubli, un doublon ou une erreur.',
    example: 'À la fin du mois, vous cochez les mouvements présents sur le relevé jusqu’à ce que l’écart soit nul.',
  },
  solde: {
    simple: 'Solde d’après vos enregistrements',
    accounting: 'Solde calculé',
    definition:
      'Ce que vous devriez avoir sur le compte d’après ce que vous avez enregistré : le départ plus tous les mouvements. Il peut différer de celui de la banque tant que tout n’est pas enregistré.',
    example: '900 € au départ + 100 € reçus − 30 € dépensés = 970 €.',
  },
  periode: {
    simple: 'Période',
    accounting: 'Exercice',
    definition:
      'L’année pour laquelle vous tenez vos comptes (souvent l’année civile), de la première à la dernière date. Quand elle est terminée, on la clôture ; l’expert-comptable parle d’« exercice ».',
    example: 'Du 1er janvier au 31 décembre 2026.',
  },
  cloture: {
    simple: 'Clôturer la période',
    accounting: 'Clôture de l’exercice',
    definition: 'Arrêter définitivement les comptes d’une période : plus rien ne peut y être ajouté, et les soldes sont reportés sur la période suivante.',
    example: 'En janvier, après avoir tout vérifié, on clôture l’année précédente avant l’assemblée générale.',
  },
  projet: {
    simple: 'Projet',
    accounting: 'Axe analytique',
    definition:
      'Un regroupement d’opérations autour d’une action (festival, ateliers…) pour savoir ce qu’elle coûte et ce qu’elle rapporte. « Fonctionnement » regroupe le courant de l’association.',
    example: 'Les achats et les recettes du festival vont dans le projet « Festival ».',
  },
  categorie: {
    simple: 'Catégorie',
    accounting: 'Compte de charges ou de produits',
    definition: 'Un mot courant (« cotisation », « assurance »…) qui dit à quoi sert l’argent. Le logiciel sait quel compte comptable y correspond.',
    example: '« Assurance » correspond au compte 616 ; vous n’avez pas à le connaître.',
  },
  saison: {
    simple: 'Saison de cotisation',
    definition: 'La période pendant laquelle les adhésions sont valables, avec ses tarifs. On en crée une par saison.',
    example: 'Saison « Adhésions 2026-2027 », du 29 septembre au 28 septembre.',
  },
  reliquat: {
    simple: 'Reliquat',
    definition: 'La part d’une subvention reçue (ou accordée) qui n’a pas été dépensée. À la clôture, on indique ce qu’il devient.',
    example: 'Subvention de 3 000 €, dépenses affectées de 2 600 € : le reliquat est de 400 €.',
  },
  affectation: {
    simple: 'Affecter une dépense à une subvention',
    definition: 'Choisir quelles dépenses du projet une subvention a servi à payer, pour préparer le compte rendu au financeur.',
    example: 'Affecter la facture de l’imprimeur (800 €) à la subvention de la mairie.',
  },
  tiers: {
    simple: 'Tiers',
    definition: 'Une personne ou un organisme avec qui l’association a des comptes à régler : un adhérent qui doit sa cotisation, un fournisseur à payer, un financeur.',
    example: 'Le fournisseur à qui vous devez encore une facture.',
  },
  justificatif: {
    simple: 'Justificatif (pièce jointe)',
    definition: 'La facture, le ticket ou le reçu qui prouve une opération. Il n’est jamais obligatoire pour enregistrer, mais précieux pour l’expert-comptable.',
    example: 'Une photo du ticket de caisse, ou la facture en PDF.',
  },
  partieDouble: {
    simple: 'Partie double',
    accounting: 'Débit et crédit',
    definition: 'Chaque opération est notée deux fois dans les comptes : où l’argent est passé et pourquoi. Le logiciel s’en charge ; vous n’avez rien à saisir de plus.',
    example: 'Une dépense de 25 € : 25 € sortent de la banque, 25 € vont dans « Assurance ».',
  },
  annuler: {
    simple: 'Annuler une opération',
    accounting: 'Contrepassation',
    definition: 'On n’efface jamais une opération enregistrée : on ajoute une opération inverse qui l’annule. L’historique reste lisible pour tout le monde.',
    example: 'Une dépense saisie par erreur : « Annuler l’opération » ajoute son contraire.',
  },
  resultat: {
    simple: 'Excédent ou déficit',
    accounting: 'Résultat de l’exercice',
    definition: 'Excédent : l’association a reçu plus qu’elle n’a dépensé sur la période. Déficit : l’inverse. C’est la différence entre les produits (reçu) et les charges (dépensé).',
    example: '12 000 € reçus − 10 500 € dépensés = excédent de 1 500 €.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
