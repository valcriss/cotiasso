# Design de l'application

Guide de conception de l'interface. Il complète le cadrage fonctionnel et l'[ADR 0012](docs/decisions/0012-theme-apparence-et-accent.md) (thème). Toute nouvelle page ou tout nouvel écran le suit ; en cas d'écart, le justifier ici d'abord.

## 1. À qui s'adresse l'application

**À un·e trésorier·ère d'association bénévole, qui n'a aucune formation comptable.** Cette personne a peur de « mal faire », de casser quelque chose ou de ne pas comprendre un terme. Elle ouvre l'application quelques heures par mois, pas tous les jours : elle ne retient pas les écrans, elle doit les comprendre à chaque fois.

La comptabilité reste exacte et rigoureuse (c'est le rôle du logiciel), mais **la difficulté ne doit jamais retomber sur l'utilisateur**. L'application est un guide, pas seulement un outil de saisie.

### Principes pédagogiques

1. **Parler simple.** Préférer le mot courant au jargon : « argent qui entre / qui sort » avant « débit / crédit », « d'où vient ou où va cet argent ? » avant « compte de contrepartie ». Quand un terme comptable est incontournable (il servira face à un expert-comptable ou un commissaire aux comptes), on le garde **et on l'explique** à côté, jamais seul.
2. **Dire à quoi ça sert.** Chaque page commence par une phrase qui explique ce qu'on y fait et pourquoi (voir §3). Chaque champ non évident a une aide courte (texte sous le champ ou icône d'information), avec un exemple concret (« ex. Location de salle, 120,00 »).
3. **Guider plutôt que laisser chercher.** Un écran vide explique **quoi faire en premier** et propose le bouton qui convient (« Aucun compte financier. Ajoutez votre compte bancaire pour commencer. »). Les choix courants sont préremplis ; les valeurs par défaut sont les plus sûres.
4. **Empêcher l'erreur avant de la signaler.** Griser ce qui n'est pas possible *en disant pourquoi*, contrôler la saisie au fil de l'eau (totaux en direct, écart à équilibrer), proposer des listes plutôt que du texte libre quand c'est possible.
5. **Une erreur explique et oriente.** Tout message répond à trois questions : *qu'est-ce qui s'est passé*, *pourquoi*, *que faire maintenant*. Jamais de code technique ni de ton accusateur. Exemple : « Cette écriture n'est pas équilibrée : il manque 1,00 € au crédit. Ajustez un montant ou ajoutez une ligne. »
6. **Montrer les conséquences avant d'agir.** Les actions qui ne se défont pas (comptabiliser, clôturer, rapprocher) disent clairement ce qui va se passer et ce qui ne sera plus possible, et demandent une confirmation explicite. À l'inverse, tout ce qui est réversible (brouillon, analyse d'import) le dit : « rien n'est enregistré avant votre confirmation ».
7. **Rassurer.** Confirmer ce qui vient d'être fait (« Écriture comptabilisée : OD n° 12 »), dire qu'une erreur de saisie se corrige (brouillon, contrepassation), ne jamais laisser croire qu'un geste a tout cassé.
8. **Ne rien cacher d'important, ne rien montrer d'inutile.** Les écrans montrent l'essentiel ; les détails techniques (identifiants, empreintes, codes de journal) apparaissent à la demande, avec leur explication.
9. **Cohérence.** Le même geste se fait de la même façon partout (créer = bouton principal en haut à droite + boîte de dialogue ; voir §2 à §5). Un mot désigne une seule chose dans toute l'application. **Tout terme qui n'est pas du langage courant a une entrée dans le lexique** (`ui/glossary.ts`, source unique de la page « Aide et lexique » et de l'aide contextuelle `app-help-hint`) : définition en une à trois phrases, exemple, et mot comptable à côté.
10. **Tester avec la bonne personne.** Une fonction n'est « finie » que si une personne sans connaissance comptable peut l'utiliser sans aide. Si une explication orale est nécessaire, c'est l'écran qui est à revoir.

### Règles pour qui écrit un écran

- Tout écran a : un **titre**, une **phrase de description**, un **état vide** utile, des **libellés en langage courant**, des **messages d'erreur à trois temps** (principe 5).
- Tout nouveau terme comptable est ajouté au **glossaire** (aide intégrée, à venir) avec une définition d'une phrase et un exemple.
- On n'affiche jamais une donnée brute sans l'avoir mise en forme (dates `12/03/2026` ou « 12 mars 2026 », montants `1 250,50 €`, états en français).
- Les actions possibles dépendent des droits de la personne : un bouton indisponible est masqué, pas grisé sans explication (le serveur reste l'autorité).

## 2. Structure d'une page

```
┌──────────────────────────────────────────────────────────────┐
│ [icône] Titre de la page                       [Action 1] [+ Créer] │  ← PageHeader + ActionBar
│ Une phrase qui explique à quoi sert la page.                 │
├──────────────────────────────────────────────────────────────┤
│ (onglets éventuels)                                          │
│ contenu : filtres, tableau ou cartes, détail en lecture      │
└──────────────────────────────────────────────────────────────┘
```

### PageHeader

- **Titre** (avec l'icône de la rubrique) et **une phrase de description**, claire, sans jargon, au présent (« Suivez… », « Retrouvez… »), 160 caractères au plus.
- Un seul en-tête par page. Les pages à onglets (Paramètres, Comptabilité) portent l'en-tête de **la zone** ; chaque onglet affiche sous les onglets sa propre **barre d'action** et, si utile, une phrase d'aide propre à l'onglet. Pas de second titre.
- Composant Angular unique, partagé (`PageHeader`) : titre, description, emplacement des actions. Il remplace tous les `h1`/`h2` de titre de page actuels.

### ActionBar (barre d'action)

- **Une barre d'outils sous le titre et la description** (jamais à droite du titre), présentée comme une carte : surface, bordure fine, ombre légère. Boutons alignés à gauche, **le bouton principal en premier**.
- **Un seul bouton principal** (plein, avec icône) : l'action la plus probable de la page (« Nouveau projet »). Les autres actions sont secondaires (contour). Au-delà de trois actions, les moins fréquentes passent dans un menu « Plus d'actions ».
- Les boutons absents faute de droit sont **masqués** ; sans aucun bouton, la barre n'est pas affichée.
- Pas de barre collante au défilement dans un premier temps.
- Les **filtres** ne sont pas dans la barre d'action : ils restent dans un bloc sous l'en-tête.

### Cartes et boutons

- **L'en-tête de page est lui aussi une carte** (titre + description), la barre d'outils étant une seconde carte juste dessous.
- **Arrondi très faible** : 4 px pour les cartes (`--app-radius`).
- **Le contenu occupe toute la largeur disponible** : aucune largeur maximale sur les pages ; seules les boîtes de dialogue et la page de connexion ont une largeur fixe.
- **Chaque zone de contenu est une carte** (panneau ou tableau : surface, bordure, ombre douce) posée sur le fond de page, jamais à plat. Un tableau est une carte par défaut ; dans un panneau il reste plat pour ne pas doubler le cadre.
- **Les boutons sont des rectangles aux angles arrondis** (8 px), pas des pilules : même famille de formes que les champs et les cartes. Les pastilles d'état (étiquettes) peuvent rester arrondies.
## 2 bis. Deux affichages : Simple et Comptable (ADR 0028)

L'application a deux affichages, au choix de chaque personne (menu « Apparence » › Affichage, gardé dans le navigateur). **Simple est le défaut et se conçoit en premier.**

- **Simple** : mots de tous les jours (« argent reçu / dépensé », « vérifié avec la banque », « annuler l'opération »), aucun numéro de compte, aucun code de journal, aucune saisie en débit/crédit. Le geste quotidien est **« J'ai reçu de l'argent » / « J'ai dépensé de l'argent »** : compte, montant, date, catégorie, description. La rubrique **Comptabilité** n'est pas dans le menu.
- **Comptable** : tout le vocabulaire et les écrans de l'expert (écritures, grand livre, balance, livre-journal, reprise, progression), le numéro de compte et le code de journal sur les cartes de compte.
- **Règles** : l'affichage n'est jamais un droit (le serveur vérifie toujours) ; un écran ne **demande** jamais la partie double à un trésorier, il la **montre** en lecture (« Ce que verra l'expert-comptable ») ; un mot comptable gardé à l'écran est expliqué à côté ; toute rubrique réservée à l'expert est marquée `expert` dans `navigation.ts` et reste accessible par son adresse.

## 3. Descriptions de page (proposition de texte)

Phrases à afficher sous chaque titre. Elles sont volontairement pédagogiques ; les ajuster à l'usage.

| Page | Titre | Description | Action principale (secondaires) |
| --- | --- | --- | --- |
| Vue d'ensemble | Vue d'ensemble | Le point de départ : l'argent dont dispose l'association, ce qui s'est passé ce mois-ci et ce qu'il vous reste à faire. | J'ai reçu de l'argent (J'ai dépensé de l'argent) |
| Démarrer | Démarrer | Trois étapes pour préparer votre association : la période de vos comptes, des catégories prêtes à l'emploi, puis votre compte bancaire. Aucune connaissance en comptabilité n'est nécessaire. | — |
| Comptes | Comptes | Vos comptes bancaires et votre caisse : combien il y a dessus et quels mouvements restent à enregistrer. | Nouveau compte (Importer un relevé) |
| Comptabilité › Écritures | Comptabilité | Chaque opération de l'association (achat, cotisation, subvention…) s'enregistre dans une écriture. Tant qu'elle est en brouillon, vous la corrigez librement ; une fois comptabilisée, on ne la modifie plus, on la contrepasse. | Nouvelle écriture |
| Comptabilité › Grand livre | Grand livre | Le détail de tous les mouvements, compte par compte, avec le solde après chaque ligne. | (Exporter, à venir) |
| Comptabilité › Balance | Balance | Le total de chaque compte sur l'exercice. Si le total des débits égale celui des crédits, votre comptabilité est cohérente. | (Exporter, à venir) |
| Comptabilité › Livre-journal | Livre-journal | Toutes les écritures dans l'ordre où elles ont été enregistrées, journal par journal. | (Exporter, à venir) |
| Membres et cotisations | Membres et cotisations | Qui adhère, qui a payé sa cotisation et pour quelle période. | Nouveau membre |
| Projets | Projets | Un projet regroupe les dépenses et recettes d'une même action (festival, ateliers…) pour savoir ce qu'elle coûte et rapporte. | Nouveau projet |
| Subventions | Subventions | Les aides que vous demandez ou recevez, et ce qui reste à justifier. | Nouvelle subvention |
| Rapports | Rapports | Les états de synthèse pour l'assemblée générale : bilan, compte de résultat, trésorerie. | — |
| Documents | Documents | Factures, relevés, comptes rendus : tous vos justificatifs au même endroit, retrouvables et liés aux opérations. | Déposer un document |
| Paramètres › Association | Paramètres | Le nom de l'association, ses coordonnées et son apparence, tels qu'ils s'affichent partout dans l'application. | (Enregistrer) |
| Paramètres › Comptabilité | Paramètres | La structure de votre comptabilité : exercices (périodes comptables), journaux (cahiers d'enregistrement) et plan de comptes. | Nouvel exercice / journal / compte, selon la section |
| Paramètres › Modules | Paramètres | Des fonctions facultatives à activer si vous en avez besoin (TVA, immobilisations…). Un module indisponible n'est pas encore prêt. | — |
| Paramètres › Utilisateurs | Paramètres | Les personnes qui peuvent se connecter et ce qu'elles ont le droit de faire. | Inviter un utilisateur |
| Paramètres › Rôles | Paramètres | Un rôle regroupe des droits (ex. « Trésorier »). Attribuez des rôles plutôt que des droits un par un. | Nouveau rôle |
| Paramètres › Journal d'audit | Paramètres | L'historique des actions importantes : qui a fait quoi, et quand. | — |
| Paramètres › Exploitation | Paramètres | La santé de l'installation : sauvegardes, version et marche à suivre pour restaurer. | Lancer une sauvegarde (procédure) |
| Mon compte | Mon compte | Votre mot de passe et la vérification en deux étapes qui protège votre accès. | — |

## 4. Formulaires : boîtes de dialogue

**Règle générale : créer ou modifier un élément se fait dans une boîte de dialogue**, ouverte depuis la barre d'action ou depuis la ligne concernée. La liste reste visible derrière.

### Patron `FormDialog` (Angular Material Dialog)

- **Structure** : titre (verbe + objet : « Nouveau projet », « Modifier le compte Caisse »), une courte phrase d'aide si nécessaire, le formulaire, pied de boîte « Annuler » (secondaire) et « Enregistrer » (principal).
- **Envoi** : le bouton est désactivé et indique l'attente pendant l'envoi ; la boîte **se ferme uniquement en cas de succès**.
- **Erreurs du serveur** : affichées **dans la boîte**, en haut du formulaire, avec le message à trois temps (§1) ; les erreurs de champ restent sous leur champ. La boîte ne se ferme pas, la saisie n'est pas perdue.
- **Modifications non enregistrées** : fermer (Échap, clic à côté, Annuler) un formulaire modifié demande « Abandonner les modifications ? ».
- **Largeurs normalisées** : petite (≈ 480 px, un à trois champs), moyenne (≈ 680 px, formulaire courant), large (≈ 920 px, formulaire à deux colonnes). **Plein écran sous 600 px de large.**
- **Accessibilité** : titre relié à la boîte (`aria-labelledby`), focus piégé dans la boîte puis rendu au bouton d'origine, fermeture à Échap, premier champ focalisé.
- **Succès** : bandeau temporaire (§5).

### Ce qui reste dans la page (pas dans une boîte)

- Les **filtres** et les recherches.
- Les **paramètres de réglage** (identité de l'association, apparence, règles de comptabilisation) : ce sont des formulaires de réglage avec leur bouton Enregistrer, pas la création d'un élément.
- Les **détails en lecture** (synthèse d'un projet, fiche d'un document, écriture comptabilisée).

### Exceptions : pages dédiées

Deux écrans sont trop vastes pour une boîte et ont **leur propre page**, avec le même en-tête et une barre d'action « Enregistrer / Comptabiliser / Retour à la liste » :

- **La saisie d'une écriture** (`/comptabilite/ecritures/nouvelle` et `/comptabilite/ecritures/:id`) : tableau de lignes, ventilation par projet, totaux en direct. Le brouillon se conserve à l'enregistrement ; la page prévient en cas de départ avec des modifications non enregistrées.
- **L'import d'un relevé OFX** (`/comptes/:id/import`) : analyse, tableau de décisions, confirmation. La page dit explicitement : « Rien n'est enregistré avant votre confirmation ».

Une exception de plus doit être décidée et notée ici.

## 5. Retours à l'utilisateur

- **Succès** : bandeau temporaire (snackbar, ≈ 5 s, fermable), en bas de l'écran, phrase de confirmation précise (« Projet FESTIVAL créé. »). Pas de message vert collé dans la page. Les bandeaux sont annoncés aux lecteurs d'écran (`role="status"`).
- **Erreur bloquante** : dans la boîte ou la page concernée (§4), persistante tant qu'elle n'est pas résolue.
- **Chargement** : indicateur discret et texte (« Chargement… ») ; un tableau vide n'est jamais affiché comme s'il était chargé.
- **État vide** : une phrase qui explique + le bouton de l'action à faire.

## 6. Mise en œuvre

### Composants partagés

`PageHeader`, `ActionBar`, `FormDialog` (+ service d'ouverture qui gère confirmation d'abandon, état d'envoi et erreurs), service de bandeau (`Notifier`) et un utilitaire de test des boîtes de dialogue. Styles dans la feuille globale `app-ui.scss`, couleurs et espacements via les jetons du thème (jamais de valeur en dur).

### Tests

Une boîte de dialogue se rend dans la couche de superposition (hors du composant testé) : les spécifications interrogent le conteneur de la couche, via un utilitaire commun (ouvrir, saisir, valider, lire les erreurs). Chaque formulaire couvre : ouverture, validation, succès (fermeture + bandeau), erreur serveur (boîte ouverte, saisie conservée), abandon confirmé.

### Recette d'un formulaire en boîte de dialogue

Composants dans `apps/web/src/app/ui/` : `PageHeader`, `ActionBar`, `FormDialog`, `ConfirmDialog`, services `Dialogs` (ouvrir une boîte, demander une confirmation) et `Notifier` (bandeau de succès). **Modèle de référence : `accounting/project-dialog.ts` et `accounting/projects.page.ts`.**

1. Un composant de boîte (`xxx-dialog.ts`) reçoit ses données par `MAT_DIALOG_DATA`, porte son `<form [formGroup]>` autour de `<app-form-dialog title=… [dirty]="form.dirty" [busy] [error] [details]>` et ferme la boîte avec `MatDialogRef.close(résultat)` **uniquement au succès**.
2. Un formulaire invalide ne part pas : marquer les champs (`markAllAsTouched`), dire quoi vérifier, afficher des `mat-error` en langage courant. Une erreur du serveur s'affiche dans la boîte (`describeHttpError`), la saisie est conservée.
3. La page ouvre la boîte avec `dialogs.open<Résultat>(Composant, { size: 'md', data })` ; si un résultat revient, elle appelle `notifier.success('Projet FESTIVAL créé.')` puis recharge sa liste.
4. Une action irréversible demande `dialogs.confirm({ title, message, confirmLabel, danger: true })` avant d'agir.

### Tests des boîtes de dialogue

Fournir `NO_MATERIAL_ANIMATIONS` (sinon la fermeture attend l'animation) et utiliser `DialogTester` (`apps/web/src/app/testing/dialog-harness.ts`) : `dialog`, `title`, `error`, `snackbar`, `type`, `click`, `submit`, `pressEscape`, `closeAll` (à appeler en `afterEach`). Une boîte se rend dans la couche de superposition : ne jamais l'interroger depuis la racine du composant.

### Ordre de réalisation

1. **Fondations** — *faites* : `PageHeader`, `ActionBar`, `FormDialog`, `ConfirmDialog`, `Dialogs`, `Notifier`, utilitaire de test, styles ; page pilote **Projets** convertie.
2. **Pages simples** — *faites* : Projets, Comptes, Paramètres (comptabilité, rôles, utilisateurs, association, modules, audit, exploitation), Mon compte.
3. **Pages lourdes** — *faites* : transactions, documents (le dépôt est en boîte ; versions et liens restent en ligne dans la fiche), clôture d’exercice, et les deux pages dédiées (écriture : `/comptabilite/ecritures/:id`, `nouvelle` pour créer ; import : `/comptes/:id/import`).
4. **En-têtes déployés** sur toutes les pages (y compris Vue d’ensemble et rubriques à venir) ; plus de message vert en page, sauf les formulaires de réglage (association, mot de passe) qui restent en ligne.

### Ce qui ne change pas

Les droits, les règles comptables et les API ne changent pas : ce chantier est purement d'interface. Les formulaires gardent leurs validations ; seuls leur emplacement et leur enrobage changent.
