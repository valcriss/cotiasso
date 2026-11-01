# ADR 0014 — Trésorerie : comptes financiers, soldes et transactions

Statut : retenu (1er novembre 2026, lots 2b.1 et 2b.2). Applique le cadrage §9 et le modèle de données §2.

## Décisions

1. **Compte financier** (`FinancialAccount`) : banque ou caisse, en **euro** (périmètre initial, contrainte en base). Il est rattaché à un **compte comptable de trésorerie (classe 5)**, utilisé par un seul compte financier, et à un **journal créé pour lui** (BQ-n ou CA-n, du même type que le compte). Compte comptable, journal, type et devise sont **définitifs**. Un compte utilisé **s'archive**, ne se réactive pas et ne se supprime jamais.
2. **Trois soldes distincts, jamais confondus** : le **solde d'ouverture** (information datée, **sans écriture associée** : le solde comptable d'ouverture vient des à-nouveaux ou de la reprise, 2b.6), le **solde calculé** (ouverture + transactions), le **solde comptable** (écritures comptabilisées sur le compte de trésorerie), plus le **dernier solde de relevé** avec son écart par rapport au solde calculé à la même date. Rien n'est présenté comme « rapproché » : le rapprochement est le lot 2b.5.
3. **Relevé** (`BankStatement`) : solde de clôture d'une période, en **ajout seul** ; une correction se fait par un nouveau relevé. Le fichier justificatif s'y rattachera avec les documents (lien générique).
4. **Transaction** : mouvement financier **distinct de l'écriture**, montant **signé** non nul (encaissement positif, décaissement négatif), jamais sur un compte archivé ni avant l'ouverture du compte. L'**identifiant externe et sa source vont par paire** et sont **uniques par compte** (idempotence des imports, 2b.3). Une transaction **manuelle** se modifie (version optimiste) et se supprime tant qu'elle n'est pas comptabilisée ; une transaction **importée** garde son montant, sa date et son identifiant inchangés et ne se supprime pas : seules la qualification et les informations descriptives se modifient.
5. **Qualification** : projet et compte de contrepartie *proposés* sur la transaction (le compte de contrepartie diffère du compte de trésorerie ; un projet archivé est refusé). Ils préremplissent l'écriture, ne la créent pas. Les autres dimensions de statut (présence sur relevé, comptabilisation partielle ou totale, rapprochement) viennent avec 2b.3 à 2b.5 et ne sont pas simulées ici.
6. **Droits** : consultation `financial-accounts:view`, saisie `transactions:manage`, soldes de relevé `imports:post`, création et archivage des comptes `settings.accounting:admin`.

## Hors de cette tranche

Import OFX et détection de doublons (2b.3), virements internes et liaison à l'écriture (2b.4), rapprochement bancaire (2b.5), reprise et imports en masse (2b.6), membre sur une transaction (lot 3), justificatifs.
