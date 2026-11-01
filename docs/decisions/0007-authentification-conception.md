# ADR 0007 — Authentification : conception détaillée

Statut : accepté — 1er novembre 2026. Précise l'[ADR 0005](0005-authentification-et-exploitation.md) (comptes locaux, MFA par rôle, OIDC optionnel).

## Décisions

| Sujet | Décision |
| --- | --- |
| Session | Stockée en base PostgreSQL, cookie `httpOnly`, `Secure`, `SameSite=Lax`. Révocable immédiatement (désactivation, changement de rôle, « déconnecter partout »). Pas de JWT. |
| Durée | Inactivité 2 h, durée maximale 12 h ; paramétrables par association. |
| Mot de passe | 12 caractères minimum, aucune règle de composition, refus d'une liste de mots de passe triviaux embarquée localement. Aucun envoi à un service externe. Haché avec argon2id. |
| Identifiant | Adresse email, normalisée en minuscules, unique. |
| Récupération | Lien de réinitialisation à usage unique et durée limitée, généré par un administrateur et transmis par lui ; envoi automatique par email seulement si SMTP est configuré (lot 5.3). |
| Premier administrateur | Au premier démarrage sans utilisateur, l'API génère un jeton à usage unique affiché dans les logs. L'assistant initial (cadrage §8.1) l'exige pour créer le compte, puis le jeton est invalidé. |
| Essais répétés | Délai croissant par compte et par adresse IP, sans verrouillage permanent (évite le déni de service sur un compte). Tentatives et blocages audités. |
| MFA | TOTP. 10 codes de secours à usage unique, affichés une fois, stockés hachés. Un administrateur peut réinitialiser le MFA d'un compte ; l'action est auditée. |
| CSRF | `SameSite=Lax` plus en-tête obligatoire sur les requêtes modifiantes (jeton lié à la session). |

## Conséquences

- Tables : `User`, `Session`, `PasswordResetToken`, `MfaCredential`, `MfaRecoveryCode`, `LoginAttempt`, `SetupToken`. Les événements d'authentification s'écrivent dans `AuditEvent`.
- Les mots de passe, jetons et codes de secours ne sont jamais journalisés ni stockés en clair ; les jetons sont comparés à temps constant.
- L'API ne démarre pas l'assistant initial hors du premier démarrage : sans jeton valide, la création du premier compte est refusée.
- Un administrateur ne peut ni se désactiver ni retirer son propre dernier rôle d'administration (évite de verrouiller l'installation).
- Le champ `SameSite=Lax` et l'en-tête CSRF supposent que le web et l'API partagent la même origine (proxy nginx `/api`, ADR 0001 et Dockerfile).

## Découpage du lot 1.2

1. Utilisateurs, hachage et politique de mot de passe.
2. Sessions, cookie, CSRF, anti-brute-force.
3. Assistant initial et premier administrateur.
4. Réinitialisation de mot de passe par administrateur.
5. MFA TOTP, codes de secours, obligation par rôle (après 1.3).
6. OIDC optionnel (tâche séparée).
