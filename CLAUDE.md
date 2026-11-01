# CLAUDE.md

Application web de gestion associative et de comptabilité en partie double, en marque blanche, licence MIT. Une installation = une association (pas de multi-tenant).

**État du projet : lot 0 (conception) en brouillons dans `docs/lot0/`, non validés par le trésorier du pilote ; implémentation du lot 1 démarrée sur décision de l'utilisateur (31 octobre 2026). Les livrables du lot 0 restent la référence fonctionnelle mais peuvent évoluer à la validation.**

## Commandes

Node épinglé dans `mise.toml` (26.12.1) ; gestionnaire de paquets : npm (workspaces). Préfixer par `mise exec --` si les shims ne sont pas actifs. Toutes les commandes se lancent à la racine :

- `npm install` : installe le monorepo.
- `npm run dev` : mode développement (watch) de chaque workspace qui en définit un.
- `npm run build` : compile tous les workspaces.
- `npm test` : lance les tests de tous les workspaces ; `npm run test:watch` en continu.
- `npm run typecheck` : vérification des types.
- `npm run clean` : supprime les sorties de build.
- `cp .env.example .env` (première fois), puis `npm run db:up` : démarre PostgreSQL en Docker via `docker-compose.dev.yml` (projet `cotiasso-dev`, port 5433) ; `npm run db:down` l'arrête (le volume de données est conservé). Après un `db:up` sur base vierge, appliquer les migrations avec `npm run db:migrate`.
- `npm run db:generate` (client Prisma, requis après `npm install` et tout changement de schéma) ; `npm run db:migrate` crée/applique une migration.
- `npm run test:integration` : tests sur la vraie base (nécessite `db:up` et les migrations appliquées). `npm test` n'a pas besoin de base.

CI : `.github/workflows/ci.yml` (GitHub Actions, Node 26.12.1, PostgreSQL 17 en service) rejoue sur chaque push vers `main` et chaque pull request : `npm ci`, `db:generate`, typecheck, tests, build, migrations, tests d'intégration. Toute nouvelle vérification locale doit être ajoutée à ce workflow.

Production : `Dockerfile` multi-étapes avec deux cibles, `api` (Node 26.12.1, utilisateur non root, applique `prisma migrate deploy` au démarrage puis lance `dist/main.js`) et `web` (nginx non privilégié sur le port 8080, sert l'Angular compilé et proxifie `/api/` vers `api:3000`). `docker-compose.yml` est l'exemple de déploiement : `cp .env.prod.example .env.prod`, renseigner `POSTGRES_PASSWORD` et `COTIASSO_VERSION`, puis `docker compose --env-file .env.prod up -d --build`. La base n'est jamais publiée ; le HTTPS est à la charge du reverse proxy placé devant `COTIASSO_HTTP_PORT`. `prisma` est une dépendance (pas une devDependency) de l'API car l'image l'exécute au démarrage. Le Compose de développement (`docker-compose.dev.yml`) reste distinct.

Workspaces :
- `packages/accounting-domain` : TypeScript pur, Vitest.
- `apps/api` : NestJS 12 + Fastify (ESM), Prisma 7 (adaptateur `pg`). `GET /health` vérifie la base. L'API écoute sur `API_HOST:API_PORT` (3000 par défaut).
- `apps/web` : Angular 22 + Angular Material 22 (thème Material 3 azure/bleu dans `src/styles.scss`, variables `--app-sidebar-*` pour la marque blanche), tests Vitest via `ng test`. `npm run dev -w @cotiasso/web` sert sur http://localhost:4200 (utiliser `localhost`, pas `127.0.0.1`) et proxifie `/api/*` vers l'API en retirant le préfixe `/api`. Polices et icônes sont hébergées localement (`@fontsource/roboto`, `material-icons`), jamais chargées depuis un CDN. Authentification côté web (`src/app/auth/`) : `AuthService` (signaux `user` et `setupRequired`, jeton CSRF gardé en mémoire uniquement, jamais en stockage navigateur), intercepteur `csrfInterceptor` (ajoute `x-csrf-token` aux requêtes modifiantes et renvoie vers `/connexion` sur un 401 de route protégée), gardes `authGuard`/`loginGuard`/`setupGuard`. Routes : `/connexion`, `/installation` (tant qu'aucun compte n'existe), et la zone authentifiée dans `Shell`. L'état initial se décide une fois (`initialize()`) ; un rechargement de page retrouve la session grâce au cookie. TypeScript est aligné sur 6.0.3 dans tout le dépôt : Angular 22 exige `>=6.0 <6.1` (compiler-cli et build), ce qui bloque TypeScript 7 tant qu'Angular ne le supporte pas. Migrer l'ensemble vers 7 en une fois quand ce sera possible, sans désaligner les workspaces.

Conventions de l'API :
- Injection explicite avec `@Inject(TOKEN)` partout : le code est exécuté par tsx/esbuild, qui n'émet pas `emitDecoratorMetadata`.
- Imports relatifs avec extension `.js` (ESM NodeNext).
- Authentification (`apps/api/src/auth/`, conception dans l'[ADR 0007](docs/decisions/0007-authentification-conception.md)) : hachage argon2id avec `node:crypto` (pas de dépendance native), politique de mot de passe locale, `UsersService` (création, vérification des identifiants à temps égal, changement de mot de passe). Les comptes ne se suppriment jamais (déclencheur SQL) : on les désactive. Les tests d'intégration créent des emails uniques en `@test.invalid` sans nettoyage.
- Sessions (tâche 2 du lot 1.2) : `AuthGuard` est global avec refus par défaut ; seules les routes marquées `@Public()` (login, health) s'ouvrent sans session. Cookie `__Host-cotiasso_session` (`httpOnly`, `Secure`, `SameSite=Lax`) ; sans HTTPS en développement, `COOKIE_SECURE=false` (déjà dans `.env.example`) et le nom perd son préfixe. Toute requête non GET/HEAD/OPTIONS exige l'en-tête `x-csrf-token` (valeur renvoyée par `/auth/login` et `/auth/me`). Endpoints : `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`. Durées : `SESSION_IDLE_MINUTES` (120) et `SESSION_MAX_HOURS` (12).
- Anti-brute-force : 5 échecs tolérés par compte et 20 par IP sur 15 min, puis délai doublé à chaque échec (plafonné à 15 min), renvoyé en `429` + `Retry-After`. Jamais de verrouillage définitif. En production, `TRUST_PROXY=true` côté API et nginx remplace `X-Forwarded-For` par l'IP réelle ; `TRUSTED_PROXY_CIDR` (dans `.env.prod`) désigne le reverse proxy HTTPS autorisé à fournir l'IP du client. Sans cela, un client ne peut pas falsifier son IP.
- Assistant initial (tâche 3, `apps/api/src/setup/`) : tant qu'aucun compte n'existe, l'API génère au démarrage un jeton à usage unique affiché **uniquement dans les logs** (`docker compose logs api`) ; seule son empreinte est stockée et chaque démarrage remplace les jetons inutilisés. `GET /setup/status` (public) indique si l'installation est requise ; `POST /setup` {token, email, displayName, password} crée le premier compte et ouvre sa session. Atomique (jeton verrouillé `FOR UPDATE`) : une seule création même en concurrence, et un mot de passe refusé ne consomme pas le jeton. Le compte créé reçoit le rôle « Administrateur technique » dans la même transaction. Les tests qui exigent une base sans utilisateur créent une base jetable via `test/integration/support/temp-database.ts`.
- Autorisation (lot 1.3, `apps/api/src/authz/`, [ADR 0008](docs/decisions/0008-autorisation-roles-et-permissions.md)) : **toute nouvelle route doit déclarer son accès** avec `@Public()`, `@Authenticated()` ou `@RequirePermission('ressource:action')` ; sans déclaration elle est refusée, et un test d'intégration échoue. Les permissions viennent du catalogue `permissions.ts` ; les rôles (modifiables, installés par `default-roles.ts`) sont en base. Ne jamais tester un nom de rôle dans le code. Au moins un compte actif doit garder `users:admin` : toute opération qui peut retirer des droits (révocation, modification de rôle, future désactivation de compte) prend `RolesService.lockLockout` puis appelle `assertAdministratorRemains` dans sa transaction. Les attributions de rôle ne se suppriment pas (déclencheur SQL). La portée projet est à ajouter avec l'entité Project.
- Les événements `auth.login.success`, `auth.login.failure` et `auth.logout` vont dans `AuditEvent`, jamais de secret.
- Le client Prisma généré (`apps/api/src/generated/`) n'est pas versionné.
- Les garanties comptables critiques s'écrivent en SQL dans les migrations (ex. `AuditEvent` en ajout seul par déclencheur), avec un test d'intégration.

## Documents de référence

- [cadrage-gestion-associative.md](cadrage-gestion-associative.md) : cadrage fonctionnel et technique v1.0 (source de vérité). Les mentions *Retenu* / *Proposé* / *À décider* y distinguent le niveau de décision ; ne jamais traiter un *Proposé* comme acquis.
- [docs/decoupage.md](docs/decoupage.md) : découpage en lots/epics, dépendances et questions ouvertes (document de travail).
- `docs/decisions/` : une décision d'architecture ou de règle métier par fichier (ADR), à créer au fil de l'eau.

## Stack (validée — voir [ADR 0001](docs/decisions/0001-stack-technique.md))

Node.js, NestJS + Fastify, PostgreSQL, Prisma + SQL brut pour les zones critiques, Angular + Angular Material, pg-boss, monorepo npm workspaces. Monolithe modulaire, domaine comptable (`packages/accounting-domain`) indépendant de HTTP et de Prisma. Distribution Docker / Compose.

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
