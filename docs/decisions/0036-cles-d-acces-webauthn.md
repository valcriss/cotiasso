# 0036 — Clés d'accès (WebAuthn) pour se connecter et vérifier son identité

Statut : **Retenu** (6 novembre 2026). Complète l'[ADR 0007](0007-authentification-conception.md) (authentification) et la partie second facteur du lot 1.2 (TOTP). Rend l'application plus agréable sur téléphone, en particulier une fois ajoutée à l'écran d'accueil (iPhone, Android).

## Contexte

Le trésorier doit aujourd'hui saisir un mot de passe, puis un code à 6 chiffres, à chaque nouvelle session (120 minutes d'inactivité, 12 heures au plus). Sur un téléphone, c'est lourd. Une **clé d'accès** (*passkey*, WebAuthn) remplace ces deux gestes par un seul : le déverrouillage de l'appareil (empreinte, visage, code) ou une clé de sécurité physique. Elle ne peut pas être hameçonnée : elle est liée au nom de domaine du site.

Vocabulaire : un site web ne lit jamais l'empreinte ni le visage, il reçoit seulement une signature. On parle donc de **clé d'accès**, le terme que les trois grands écosystèmes (Apple, Google, Microsoft) emploient eux-mêmes, et jamais de « Face ID » à l'écran : cela fonctionne aussi sur Android, Windows, Mac et avec une clé physique.

## Décision

### Deux usages, au choix de l'association

Un réglage de l'association (Paramètres › Sécurité, droit `settings.association:admin`) fixe le mode, parmi trois :

| Mode | Effet |
|---|---|
| **Désactivées** (défaut) | Rien ne change. Les clés déjà enregistrées sont conservées mais inutilisables. |
| **À la place du code** (`SECOND_FACTOR`) | Mot de passe, puis une clé d'accès **ou** le code TOTP. |
| **Connexion complète** (`FULL`) | En plus : on peut se connecter par la clé d'accès seule, sans mot de passe ni code. |

Un second réglage, **« Connexion sans saisir l'adresse email »** (`usernameless`), n'existe que dans le mode complet : la clé d'accès est alors la première étape et l'appareil propose le compte. Désactivé, la personne saisit d'abord son email, puis utilise sa clé. Le réglage est refusé dans les autres modes.

Les deux réglages sont une nouvelle section de paramètres `security` (versionnée, validée par zod, ajout seul), **hors API générique** : l'activation a une précondition (voir « Domaine »). L'audit garde `settings.updated` avec les clés modifiées.

### Règles

- **Facultatif pour chacun.** Aucun rôle ne se voit imposer une clé d'accès. Un rôle qui exige un second facteur (`requiresMfa`) est satisfait par un code TOTP **ou** par une clé d'accès, au choix de la personne.
- **Le mot de passe n'est jamais supprimé** d'un compte, même en mode complet : repasser à un mode moins ouvert ou désactiver les clés ne bloque personne. Le TOTP, les codes de secours et la commande `reset-mfa` restent disponibles.
- **Une clé d'accès vaut deux facteurs.** Toutes les cérémonies exigent la **vérification de l'utilisateur** (`userVerification: required`, et le serveur contrôle le drapeau) : possession de l'appareil + déverrouillage. Une clé de sécurité sans code PIN est donc refusée à l'enregistrement, avec un message qui le dit.
- **Une clé d'accès enregistrée active le second facteur du compte**, comme le TOTP : après le mot de passe, une session reste partielle (`VERIFICATION_REQUIRED`) tant qu'elle n'est pas vérifiée. `MfaStatus.enabled` = TOTP actif **ou** clé d'accès utilisable ; `totp` et `passkey` donnent le détail. L'exigence est toujours recalculée à chaque requête : passer le mode à « Désactivées » ou perdre le domaine retire aussitôt aux clés leur valeur de second facteur.
- **Se connecter par clé d'accès** (mode complet) ouvre une session dont `mfaVerifiedAt` est posé : elle est complète, rôles exigeant le MFA compris. Compte désactivé, clé révoquée, domaine différent : refus générique.
- **Codes de secours** : la première clé d'accès d'un compte sans code de secours en génère (affichés une seule fois), et un code de secours est accepté pour toute personne qui a un second facteur, TOTP ou clé d'accès. La réinitialisation par un administrateur (`POST /users/:id/mfa/reset`) et la commande `reset-mfa` **révoquent aussi les clés d'accès**.
- **Ajouter une clé** exige le **mot de passe actuel** quand la session est complète (un cookie volé ne doit pas suffire à installer un accès durable) ; pas pendant l'inscription forcée d'une session partielle (le mot de passe vient d'être saisi). **Révoquer** exige aussi le mot de passe, et est refusé si c'est le dernier second facteur d'un compte dont un rôle l'exige.
- **Aucun secret n'est stocké** : seulement la clé publique, l'identifiant, un compteur et des métadonnées. Pas de nouvelle clé à sauvegarder ; les tables partent avec la base.

### Domaine : ce que les autres associations doivent savoir

Une clé d'accès est liée au **nom de domaine** (l'*RP ID*). Si le domaine change, **toutes les clés cessent de fonctionner** (le mot de passe et le TOTP prennent le relais). Donc :

- L'adresse publique est lue dans `PUBLIC_URL` (déjà utilisée par les emails, désormais **lue même sans SMTP**). Le nom d'hôte devient le RP ID, l'origine est celle de l'adresse. **HTTPS obligatoire**, sauf `localhost` (développement).
- **Garde-fou à l'activation** : `PUT /security/passkeys` refuse un mode autre que « Désactivées » si `PUBLIC_URL` est absent, invalide ou non HTTPS, avec un message en trois temps. L'écran affiche le domaine retenu (« Les clés d'accès seront liées à *compta.asso.fr* »).
- **Détection d'un changement de domaine** : chaque clé garde le RP ID de son enregistrement. Seules les clés dont le RP ID est celui d'aujourd'hui sont utilisables ; l'écran des paramètres compte et signale les autres, et la personne les voit marquées « à refaire » dans Mon compte.
- Documentation : `docs/exploitation.md` (section dédiée), `.env.prod.example`, `CHANGELOG.md`.

### Conception technique

- **Bibliothèque** : `@simplewebauthn/server` (API) et `@simplewebauthn/browser` (web), versions exactes. Le format CBOR/COSE rend l'écriture à la main déraisonnable (contrairement au TOTP) : c'est la seule dépendance ajoutée.
- **Tables** (migration `add_passkeys`) :
  - `PasskeyCredential` : `credentialId` unique (base64url), `publicKey`, `counter` (BigInt), `transports`, `deviceType`, `backedUp`, `label`, `rpId`, `createdAt`, `lastUsedAt`, `revokedAt`. **Jamais supprimée** (déclencheur SQL) : on la révoque ; une clé révoquée ne se réactive pas ; identifiant, clé publique, RP ID et propriétaire sont immuables. `TRUNCATE` refusé.
  - `WebauthnChallenge` : défi à **usage unique** et à durée courte (5 minutes), lié à un but (`REGISTRATION`, `AUTHENTICATION`), à un utilisateur et à une session le cas échéant. Consommé par une mise à jour conditionnelle (`usedAt` nul) : le rejeu est impossible, même en concurrence. Les défis périmés sont purgés à la création du suivant.
- **Identifiant de l'utilisateur côté WebAuthn** : les 16 octets de son UUID (opaque, sans donnée personnelle).
- **Clés « découvrables »** (`residentKey: required`) à l'enregistrement, pour que le choix « sans saisir l'email » reste réversible sans refaire les clés.
- **Anti-énumération** : `login/options` avec un email inconnu (ou sans clé) renvoie une liste d'identifiants **leurre**, dérivée de l'email par HMAC (stable d'un appel à l'autre). Limite connue : le nombre d'identifiants renvoyés distingue un compte qui a deux clés ou plus d'un compte inconnu ; acceptée, d'autant que l'adresse n'est pas un secret (annuaire de l'association).
- **Anti-brute-force** : mêmes limites que la connexion (`LoginThrottleService`) sur les options et sur les vérifications ; échecs consignés par IP (et par email quand il est connu).
- **Routes** (toutes déclarent leur accès) :
  - `GET /auth/methods` (public) : mode effectif et `usernameless`, de quoi afficher le bouton de connexion.
  - `GET /security/passkeys` (`settings.association:view`) et `PUT /security/passkeys` (`settings.association:admin`) : réglages, domaine retenu, nombre de clés, clés d'un autre domaine.
  - `POST /auth/passkeys/login/options` et `/login/verify` (publics) : connexion complète.
  - `POST /auth/passkeys/verify/options` et `/verify` (session partielle) : second facteur.
  - `POST /auth/passkeys/register/options` et `/register/verify` (session partielle ou complète) : ajout.
  - `GET /auth/passkeys` (état et liste), `PATCH /auth/passkeys/:id` (renommer), `POST /auth/passkeys/:id/revoke`.
- **Audit** (libellés dans `audit-labels.ts`) : `auth.passkey.registered`, `auth.passkey.renamed`, `auth.passkey.revoked`, `auth.passkey.verified` ; la connexion complète s'écrit `auth.login.success` avec `method: "passkey"`. Jamais d'identifiant de clé, de réponse du navigateur ni de défi dans le journal.
- **Web** : bouton « Se connecter avec une clé d'accès » sur la page de connexion (affiché seulement si le mode l'autorise **et** que le navigateur gère WebAuthn), choix « clé d'accès » sur la page de vérification et sur la page d'inscription forcée, rubrique « Clés d'accès » dans Mon compte (liste, ajout, renommage, retrait), onglet Paramètres › Sécurité. Entrée de lexique « clé d'accès » (`ui/glossary.ts`), partagée avec l'aide.

### Libellés (pédagogie)

- Bouton : « Se connecter avec une clé d'accès », avec en aide « Utilisez le déverrouillage de votre appareil (empreinte, visage ou code), ou une clé de sécurité. »
- Définition du lexique : « Une clé d'accès permet de se connecter en déverrouillant son téléphone ou son ordinateur, sans mot de passe à retaper. Elle ne peut pas être volée par un faux site. »
- Erreurs en trois temps (annulation par la personne, appareil non compatible, clé déjà enregistrée, domaine différent, vérification de l'utilisateur absente).

## Ce qui n'est pas fait (volontairement)

- **Aucune obligation** d'utiliser une clé d'accès, par rôle ou pour tous.
- **Pas de suppression du mot de passe** d'un compte.
- **Pas d'attestation** (`attestationType: none`) : on n'impose pas de marque d'appareil.
- **Pas de gestion des clés d'un autre utilisateur** par un administrateur, hors la réinitialisation globale du second facteur.
- **Validation sur appareils réels** (iPhone en application ajoutée à l'écran d'accueil, Android) : non automatisable ici ; à faire à la main avant publication (procédure dans `docs/exploitation.md`). Les tests d'intégration utilisent un authentificateur simulé, qui ne remplace pas ce contrôle.
- Les clés synchronisées (iCloud, Google) sont stockées chez le fournisseur de la personne : la rubrique d'aide le dit sans en faire un défaut bloquant. Aucune affirmation de conformité n'est faite.

## Découpage en tâches

- [x] **1.** **Conception** — cet ADR, la feuille de route, le cadrage.
- [x] **2.** **Configuration et base** — `PUBLIC_URL` lue sans SMTP (`AppEnv.publicUrl`), calcul du RP ID et de l'origine ; migration `add_passkeys` (tables, déclencheurs, `TRUNCATE`) ; modèles Prisma.
- [x] **3.** **Réglages** — section `security` (schéma zod), `PasskeyPolicyService` (mode effectif, domaine), `GET`/`PUT /security/passkeys`, garde-fou d'activation, `GET /auth/methods`.
- [x] **4.** **Second facteur** — `MfaStatus` enrichi (`totp`, `passkey`, `enabled`), codes de secours valables pour les deux, réinitialisation qui révoque les clés.
- [x] **5.** **Cérémonies** — service et contrôleur : enregistrement, vérification (second facteur), connexion complète, liste, renommage, révocation ; défis à usage unique.
- [x] **6.** **Tests d'intégration** avec un authentificateur simulé (voir plus bas) : enregistrement, rejeu du défi, mauvais domaine, compte désactivé, révocation, modes, anti-énumération, audit.
- [x] **7.** **Web — réglages** : onglet Paramètres › Sécurité.
- [x] **8.** **Web — connexion et vérification** : bouton de connexion, vérification et inscription forcée.
- [x] **9.** **Web — Mon compte** : rubrique « Clés d'accès ».
- [x] **10.** **Documentation** — `docs/exploitation.md`, `.env.prod.example`, `CHANGELOG.md`, `CLAUDE.md`, cadrage, lexique et aide.
- [ ] **11.** **Validation manuelle** sur iPhone (application ajoutée à l'écran d'accueil), Android et ordinateur : à faire par le trésorier pilote avant publication.

Les tâches 1 à 10 sont faites dans la première livraison ; la tâche 11 reste à faire par une personne, sur de vrais appareils, avant d'annoncer la fonction aux utilisateurs.

## Conséquences

- Une migration de plus et une dépendance de plus (`@simplewebauthn/*`).
- `MfaService.statusFor` lit un réglage et compte les clés à chaque requête : deux petites lectures en parallèle des existantes.
- `MfaStatus` gagne deux champs ; les clients qui ne les lisent pas ne changent pas.
- Les installations existantes ne changent pas : le mode par défaut est « Désactivées » et `PUBLIC_URL` n'est exigé qu'à l'activation.
