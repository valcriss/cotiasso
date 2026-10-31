# CLAUDE.md

Application web de gestion associative et de comptabilité en partie double, en marque blanche, licence MIT. Une installation = une association (pas de multi-tenant).

**État du projet : lot 0 (conception) en brouillons dans `docs/lot0/`, non validés par le trésorier du pilote ; implémentation du lot 1 démarrée sur décision de l'utilisateur (31 octobre 2026). Les livrables du lot 0 restent la référence fonctionnelle mais peuvent évoluer à la validation.**

## Commandes

Outils épinglés dans `mise.toml` (Node 26.12.1, pnpm 12.16.1) : préfixer par `mise exec --` si les shims ne sont pas actifs.

- `pnpm install` : installe le monorepo.
- `pnpm -r typecheck` / `pnpm -r test` / `pnpm -r build` : vérifie, teste, compile tous les paquets.
- Paquets : `packages/accounting-domain` (TypeScript pur, Vitest). Les apps `apps/api` et `apps/web` restent à créer.

## Documents de référence

- [cadrage-gestion-associative.md](cadrage-gestion-associative.md) : cadrage fonctionnel et technique v1.0 (source de vérité). Les mentions *Retenu* / *Proposé* / *À décider* y distinguent le niveau de décision ; ne jamais traiter un *Proposé* comme acquis.
- [docs/decoupage.md](docs/decoupage.md) : découpage en lots/epics, dépendances et questions ouvertes (document de travail).
- `docs/decisions/` : une décision d'architecture ou de règle métier par fichier (ADR), à créer au fil de l'eau.

## Stack (validée — voir [ADR 0001](docs/decisions/0001-stack-technique.md))

Node.js, NestJS + Fastify, PostgreSQL, Prisma + SQL brut pour les zones critiques, Angular + Angular Material, pg-boss, monorepo pnpm. Monolithe modulaire, domaine comptable (`packages/accounting-domain`) indépendant de HTTP et de Prisma. Distribution Docker / Compose.

## Règles non négociables du domaine

- Comptabilité en partie double : débit = crédit à la validation, atomique, numérotation unique garantie en base, écriture validée non modifiable (contrepassation reliée).
- Montants : PostgreSQL NUMERIC + lib décimale côté TS ; décimaux en chaînes dans l'API ; jamais de `number` flottant pour de l'argent.
- Transaction (mouvement bancaire) ≠ écriture comptable : tables séparées. Rapprochement bancaire, affectation de paiement et lettrage sont trois mécanismes distincts.
- Données brutes d'import conservées sans réécriture ; imports idempotents, pas de doublons silencieux.
- Autorisation : refus par défaut, vérifiée côté backend à chaque opération (listes, recherche, exports, téléchargements inclus). Rôles = modèles modifiables, pas de privilèges codés en dur.
- Fonctions optionnelles (TVA, immobilisations, constatés d'avance, factures non parvenues, fonds dédiés…) = modules activables par association ([ADR 0002](docs/decisions/0002-modules-activables-et-regles-comptables.md)). Exercices et TVA sont paramétrables, jamais codés en dur pour l'association pilote.
- Un mode de TVA ou un module n'est activable qu'une fois implémenté ET validé sur le jeu de référence ; sinon « indisponible » ([ADR 0003](docs/decisions/0003-perimetre-tva-et-modules-ajustement.md)).
- Les décisions Q1 à Q10 du cadrage sont tranchées dans `docs/decisions/` (ADR 0001 à 0006) ; les relire avant toute conception.
- Cotisations : produit constaté à l'encaissement, pas de créance comptable par défaut.
- Configuration déclarative uniquement (pas de scripts). Option non prise en charge = explicitement indisponible, jamais acceptée avec traitement partiel.
- Aucune affirmation de conformité comptable/fiscale (TVA, FEC, reçus fiscaux) sans périmètre vérifié.
- Pas de secrets, données ou documents d'association dans le dépôt.

## Conventions de travail

- Langue : français pour la documentation, les libellés UI et les échanges ; identifiants de code en anglais (noms d'entités du §22 du cadrage).
- Documentation en Markdown, en gardant les statuts Retenu/Proposé/À décider.
- Toute décision prise avec l'utilisateur est reportée dans `docs/decisions/` et reflétée dans le cadrage.
- Ne pas committer ni pousser sans demande explicite.
- Quand des commandes de build/test existeront, les documenter ici.
