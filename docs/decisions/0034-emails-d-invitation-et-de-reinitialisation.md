# 0034 — Emails d'invitation et de réinitialisation

Statut : **Retenu** (3 novembre 2026). Réalise la part « envoi par email » de la récupération prévue par l'[ADR 0007](0007-authentification-conception.md) (« envoi automatique par email seulement si SMTP est configuré ») ; première tranche du lot 5.3 (notifications email). Le logo vient de l'[ADR 0033](0033-logo-de-l-association.md).

## Décision

- **Deux emails seulement** : invitation (lien de 72 h) et réinitialisation de mot de passe (lien de 24 h). Ils ne partent que sur action d'un administrateur. **Pas de « mot de passe oublié » en libre-service** pour l'instant : il demanderait une réponse identique que le compte existe ou non et une limitation des demandes (à décider séparément).
- **Configuration déclarative** : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` et `PUBLIC_URL`, lues par `readEnv` (`AppEnv.smtp`). Sans `SMTP_HOST`, la fonction est **explicitement désactivée** et le parcours d'avant (lien affiché et transmis à la main) est inchangé. Tout ou rien : avec `SMTP_HOST`, `SMTP_FROM` (adresse seule) et `PUBLIC_URL` sont obligatoires et l'API refuse de démarrer sinon ; l'identifiant et le mot de passe vont ensemble.
- **`nodemailer`** envoie (une dépendance standard plutôt qu'un client SMTP écrit à la main : STARTTLS et authentification sont des zones où une erreur coûte cher). **Le chiffrement est exigé** (TLS direct, ou STARTTLS obligatoire), sauf vers `localhost` pour le développement. Délais de connexion bornés.
- **Le lien reste toujours renvoyé à l'administrateur** (secours : courrier indésirable, adresse erronée). La réponse de `POST /users` et de `POST /users/:id/password-reset` gagne un champ `mail` : `SENT`, `FAILED` (avec l'adresse) ou `NOT_CONFIGURED`. **Un échec d'envoi ne défait jamais la création du compte** ni l'émission du lien : il est annoncé à l'administrateur en trois temps (ce qui s'est passé, le compte est créé, transmettre le lien soi-même).
- **Confidentialité du lien** : le contenu d'un message n'est jamais journalisé ; seuls le code et le message du serveur de messagerie le sont. L'audit garde `user.mail.sent` et `user.mail.failed` avec le seul type (`invitation` ou `reset`), jamais le jeton ni l'adresse du lien. Le jeton reste dans le fragment (`#`) de l'adresse, comme à l'écran.
- **Contenu** (`apps/api/src/mail/templates.ts`, fonctions pures testées) : en-tête avec le **logo et le nom de l'association** (selon le choix « logo seul » ou « logo et nom »), une phrase qui dit qu'il s'agit d'**accéder à Cotiasso**, un bouton avec la couleur d'accent de l'association, la durée et la date limite en français (« jusqu'au vendredi 6 novembre à 14 h », heure de Paris), un lien en clair si le bouton ne marche pas, une consigne « vous ne connaissez pas cette association ? ignorez ce message », et en pied « Propulsé par Cotiasso » avec le symbole. Version texte et version HTML (tableaux et styles en ligne, sans script). Tout ce qui est saisi par une personne (nom de l'association, nom du destinataire, de l'administrateur) est échappé en HTML et réduit à une ligne, donc sans injection d'en-tête ni de balise.
- **Images intégrées au message** (pièces jointes en ligne `cid:`), jamais chargées à distance : le logo de l'association **si PNG ou JPEG** (un SVG, que la plupart des messageries n'affichent pas, est remplacé par le nom en texte, sans conversion) et le symbole de Cotiasso, embarqué en code (`mail/cotiasso-mark.ts`, généré par `scripts/generate-brand-icons.mjs`).
- **Expéditeur** : adresse `SMTP_FROM`, nom affiché = nom de l'association ; réponses à l'email de contact de l'association quand il est renseigné.

## Limites connues

- Pas de file d'attente ni de nouvel essai : un envoi se tente une fois, pendant la requête de l'administrateur. À reprendre avec pg-boss (ADR 0001) quand d'autres notifications (workflows) arriveront.
- Pas de remise garantie : SPF et DKIM relèvent de l'hébergeur de messagerie (voir `docs/exploitation.md`).
- Pas d'aperçu des emails dans l'interface ni de personnalisation du texte par l'association.
- Les emails sont rédigés en français uniquement.
