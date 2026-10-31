# ADR 0001 — Stack technique

Statut : accepté — 31 octobre 2026

## Décision

| Brique | Choix |
| --- | --- |
| Runtime / backend | Node.js, NestJS avec adaptateur Fastify |
| Base de données | PostgreSQL |
| Accès aux données | Prisma pour le CRUD ; SQL brut (migrations et `$queryRaw`) pour contraintes différées, `CHECK`, index partiels, verrous consultatifs, `SELECT … FOR UPDATE` |
| Frontend | Angular / TypeScript, Angular Material (thème bleu/blanc par variables, marque blanche) |
| Tâches de fond | pg-boss (file dans PostgreSQL, pas de Redis) |
| Authentification | Comptes locaux, argon2, sessions par cookie, MFA TOTP ; OIDC reporté |
| Tests | Vitest + Testcontainers (PostgreSQL réel) |
| Dépôt | Monorepo npm workspaces (remplace pnpm, décision du 31 octobre 2026) : `apps/api`, `apps/web`, `packages/accounting-domain` |

## Contraintes qui en découlent

- `accounting-domain` est du TypeScript pur : aucune dépendance à NestJS, Fastify ni Prisma.
- Les invariants comptables critiques (équilibre, numérotation unique, verrou exercice/clôture) sont garantis en base par du SQL écrit à la main, jamais par Prisma seul.
- Les montants circulent en chaînes décimales dans l'API ; bibliothèque décimale côté TypeScript.
- Les tests de concurrence (CA-04) tournent sur une vraie base PostgreSQL.

## Points non tranchés

- OIDC/SSO et MFA : tranchés dans l'[ADR 0005](0005-authentification-et-exploitation.md).
- Moteur de génération PDF, format tableur.
- Version majeure d'Angular et de NestJS, à figer à l'initialisation du dépôt.
