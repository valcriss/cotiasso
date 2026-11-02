# Test d'usage avec des trésoriers novices

Statut : protocole proposé (2 novembre 2026), **mis à jour le 3 novembre 2026** pour couvrir la situation de départ ([ADR 0029](decisions/0029-situation-d-ouverture-mode-de-demarrage.md)), les tiers ([ADR 0030](decisions/0030-tiers-sur-les-lignes-d-ecriture.md)), les rapports figés et l'approbation des comptes ([ADR 0031](decisions/0031-rapports-figes-et-approbation-des-comptes.md)), la clôture guidée et l'exploitation ([ADR 0026](decisions/0026-exploitation-copie-hors-site-mise-a-jour-et-notes-de-version.md)). **À dérouler avec 2 ou 3 personnes qui n'ont aucune connaissance comptable.** C'est le seul moyen de valider l'audit de l'[ADR 0028](decisions/0028-parcours-simplifies-pour-tresoriers-novices.md), qui reposait sur la lecture du code. Ce document est la feuille de route 1.6.

Le protocole comporte **deux séances** par participant (le quotidien, puis la fin d'année) et une **annexe courte** pour la personne qui héberge l'application.

## Principe

On regarde une personne **faire** des tâches de trésorier, **sans lui expliquer** l'application. Ce n'est pas elle qu'on teste, c'est l'écran : chaque hésitation, chaque question, chaque mot incompris est une anomalie de conception, à corriger.

## Préparation

- **Participants** : 2 ou 3 bénévoles d'association, de préférence jamais confrontés à de la comptabilité en partie double. Pas de collègue du projet. **Deux séances de 45 minutes** chacun, séparément (séance A : démarrer et le quotidien ; séance B : la fin d'année), le même jour avec une pause, ou à deux jours d'écart.
- **Instance A (séance A)** : une installation vierge, en affichage Simple (défaut), avec des **données fictives** (aucune donnée réelle d'association). Compte du participant : rôles Administrateur technique + Trésorier (case « Je suis aussi le trésorier »). Prévoir la double authentification déjà activée, ou compter l'inscription comme une tâche.
- **Instance B (séance B)** : une installation **préparée à l'avance** avec une année de comptes fictive complète (période 2025, quelques dizaines de mouvements enregistrés, un compte bancaire vérifié avec la banque, trois adhérents, deux fournisseurs, une subvention). Pour que chaque participant reparte d'un état identique : la préparer une fois, la sauvegarder (`backup.sh once`), puis la **restaurer** avant chaque séance (`docs/exploitation.md`, « Restaurer »). Ne jamais y mettre de données réelles.
- **Matériel fictif** : un fichier OFX d'exemple (voir `apps/api/test/fixtures/ofx/`), un chèque de cotisation (photo ou papier), une facture d'assurance, la liste de 3 adhérents, **un relevé de situation au 1er janvier** (voir la tâche 2) et un procès-verbal d'assemblée générale fictif (PDF d'une page, pour la tâche 12).
- **Animateur** : une personne qui observe et note, **ne guide pas**. Une seconde personne peut chronométrer. Enregistrer l'écran et la voix si le participant y consent (écrit), sinon notes seules.
- **Consigne orale unique** : « Vous êtes le nouveau trésorier de l'association. Je vais vous demander de faire des tâches avec ce logiciel. Dites à voix haute ce que vous pensez et ce que vous cherchez. Je ne répondrai pas aux questions sur le logiciel : s'il y a un blocage, dites-le et on passera à la suite. »

## Les tâches (dans cet ordre)

### Séance A — démarrer et le quotidien (instance A)

| # | Tâche donnée au participant | Ce qu'on veut vérifier | Réussite |
| --- | --- | --- | --- |
| 1 | « Installez l'association : vous n'avez pas de relevés anciens à reprendre, vous avez une banque et une année de comptes qui commence en janvier. » | La page **Démarrer** se comprend sans lexique : le **choix du mode** (« Je pars d'une situation de départ » ou « Je reprends mon historique »), la période, les catégories, le compte. Le participant choisit-il le bon mode sans aide ? | Les étapes terminées seul·e, mode « situation de départ » choisi. |
| 2 | « Au 1er janvier, voici votre situation (fiche remise) : 1 500 € en banque, Marie Dupont doit encore sa cotisation de 30 €, et vous devez 120 € à l'imprimeur Martin. Indiquez-la. » | La boîte **Votre situation de départ** : argent repris des comptes, « ce qu'on vous doit », « ce que vous devez », **fonds de l'association** calculé (compréhension de « le fonds », choix du compte, explication de l'origine), aperçu « Ce que verra l'expert-comptable ». | Situation enregistrée seul·e, avec les deux personnes nommées et une origine écrite pour le fonds. |
| 3 | « Un adhérent vous a remis un chèque de 30 € pour sa cotisation. Enregistrez-le. » | « J'ai reçu de l'argent », choix de la **catégorie**, aperçu « Ce que verra l'expert-comptable ». | Opération enregistrée, bonne catégorie. |
| 4 | « Vous avez payé 120 € d'assurance. Enregistrez-le. » | « J'ai dépensé de l'argent ». | Idem. |
| 5 | « Vous venez de recevoir le relevé de la banque (fichier). Intégrez-le et mettez tout en ordre. » | **Import**, mots « à relier », **Classer et enregistrer**, enregistrement en masse. | Tous les mouvements classés et enregistrés. |
| 6 | « Vous vous êtes trompé de montant sur l'assurance. Corrigez. » | **Annuler l'opération** (et sa confirmation), puis ré-enregistrement. | Opération annulée puis refaite correctement. |
| 7 | « Le relevé de la banque indique tel solde. Vérifiez que vos comptes concordent. » | **Vérification avec la banque** (écart, cases). | Vérification validée ou écart expliqué. |
| 8 | « Rattachez le chèque de Marie à sa cotisation de l'année. » | **Membres › Règlements**, case « L'enregistrer aussi dans les comptes ». | Cotisation marquée payée, une seule saisie d'argent. |
| 9 | « Vous avez reçu une facture de 80 € de l'imprimeur Martin, que vous paierez le mois prochain. Retrouvez ensuite combien vous lui devez en tout, et qui vous doit encore de l'argent. » | **Les tiers** : saisir une facture non payée avec « Qui ? » (écriture à la main), puis l'onglet **Tiers**. **Attention : cette page est dans Comptabilité, masquée du menu en affichage Simple.** On observe si la personne la trouve ; si non, c'est un défaut de navigation à corriger (à noter « bloquant »), pas une erreur du participant. | Les deux sommes retrouvées par personne, seul·e ou, à défaut, après avoir été orienté·e (noter alors ce qui a manqué). |
| 10 | « Enregistrez une dépense datée d'il y a trois ans. » (exercice absent) | Message d'erreur à trois temps, sait quoi faire. | Comprend la cause et la marche à suivre. |

### Séance B — la fin d'année (instance B, restaurée)

| # | Tâche donnée au participant | Ce qu'on veut vérifier | Réussite |
| --- | --- | --- | --- |
| 11 | « L'assemblée générale approche : préparez ce qu'il faut montrer sur les comptes de l'année. Vous voulez en garder une copie qui ne bougera plus. » | **Rapports** (compte de résultat, bilan, impression) puis **Rapports figés › Figer maintenant** : le participant comprend-il « figer », « provisoire », et que l'ancienne version reste consultable ? | Les deux états ouverts et compris dans les grandes lignes ; une version figée, repérée dans la liste. |
| 12 | « L'année est terminée. Clôturez-la, puis notez que l'assemblée générale a approuvé les comptes le 14 juin (procès-verbal fourni). » | La **clôture guidée** (trois étapes, compte du résultat proposé, conséquences annoncées), l'annonce que les comptes sont **figés automatiquement**, puis **Approuver par l'assemblée** et le dépôt du procès-verbal. Distingue-t-il la clôture (technique) de l'approbation (assemblée) ? | Exercice clôturé, comptes approuvés avec la date, procès-verbal déposé. |
| 13 | « Vous vous apercevez qu'une facture de 50 € avait été oubliée dans l'année qui vient d'être clôturée. Que faites-vous ? » | Le participant comprend qu'on ne rouvre pas un exercice clôturé, et comment corriger (écriture dans l'exercice ouvert, ou nouvelle version des rapports avec un motif si l'exercice n'est pas clôturé). On observe la compréhension, pas forcément la réussite. | Explique oralement la marche à suivre ; aucune tentative de contournement dangereuse. |

## Ce qu'on note, tâche par tâche

- **Réussie seule** / réussie après une relance de l'animateur / abandonnée.
- **Temps passé** et nombre de clics « perdus » (retours en arrière, mauvais menu).
- **Mots incompris** (le participant les cite, ou les interprète de travers : « contrepartie », « comptabiliser », « exercice »…). Mots à guetter depuis les nouveautés : « situation de départ », « fonds de l'association » / « fonds associatifs », « tiers », « arrêté provisoire », « figer », « version », « clôturer » et « approuver » (la différence entre les deux), « empreinte ».
- **Phrases qui ont aidé** (le participant lit un texte d'aide et agit juste).
- **Moments de peur** : « je n'ose pas valider », « si je me trompe ? ». Les conséquences annoncées avant une action irréversible étaient-elles lues et suffisantes ?
- **Attentes trompées** : le participant cherche un bouton là où il n'y en a pas.

## Grille de lecture (à remplir après chaque séance)

| Tâche | Seul·e ? | Mots bloquants | Écran concerné | Correction proposée |
| --- | --- | --- | --- | --- |
| A1 (mode de démarrage) | | | | |
| A2 (situation de départ) | | | | |
| A3 … A10 | | | | |
| B11 (rapports figés) | | | | |
| B12 (clôture et approbation) | | | | |
| B13 (correction après clôture) | | | | |

## Critères de succès du lot

- **Séance A** : au moins **8 tâches sur 10** réussies **sans aucune aide** par au moins 2 participants sur 3.
- **Séance B** : au moins **2 tâches sur 3** réussies sans aide par au moins 2 participants sur 3 ; la tâche 13 (correction après clôture) est **expliquée correctement** par au moins 2 participants sur 3.
- **Aucune** tâche abandonnée par tous les participants.
- Les tâches **3, 4 et 5** (le quotidien) sont réussies sans aide par **tous**.
- La tâche **2** (situation de départ) : au moins 2 participants sur 3 comprennent ce qu'est « le fonds de l'association » après l'avoir rempli (le dire avec leurs mots).
- Aucun mot comptable n'est cité comme « bloquant » par plus d'un participant (sinon : le remplacer ou l'expliquer sur place).
- La page Tiers (tâche 9) est **trouvée sans aide** par au moins 2 participants sur 3, sinon le menu ou la navigation sont à revoir avant d'aller plus loin.

## Après les séances

1. Regrouper les observations par écran, classer en **bloquant** / **gênant** / **cosmétique**.
2. Corriger les bloquants dans la foulée (vocabulaire, ordre des champs, messages) ; garder la trace dans l'[ADR 0028](decisions/0028-parcours-simplifies-pour-tresoriers-novices.md) (section « Suites » et « Hors de ce lot »).
3. Rejouer la tâche concernée avec un participant différent.
4. Ne jamais conserver d'enregistrement ou de note qui identifie une personne dans le dépôt : seuls les enseignements anonymisés y entrent.

## Annexe — la personne qui héberge l'application (15 minutes, 1 personne)

Ce public est technique, mais pas comptable. On vérifie que l'exploitation tient dans [exploitation.md](exploitation.md) **sans aide**. Instance de test dédiée, jamais de données réelles.

| # | Tâche | Ce qu'on veut vérifier | Réussite |
| --- | --- | --- | --- |
| H1 | « Vous craignez de tout perdre si le serveur tombe en panne. Mettez en place une copie de secours ailleurs. » | La **copie hors site** : variables `OFFSITE_*` de `.env.prod.example` (un stockage de test, ou un dossier local), état « Copie hors site » dans **Paramètres › Exploitation**. | La copie est configurée et l'écran passe à « à jour ». |
| H2 | « Une nouvelle version sort. Que lisez-vous avant de mettre à jour ? » | Les **notes de version** (Paramètres › Exploitation), la rubrique « À savoir avant de mettre à jour ». | La rubrique est trouvée et lue. |
| H3 | « Mettez à jour vers la version 9.9.9 (fictive). » | `scripts/update.sh` : sauvegarde, vérification, puis changement de version ; arrêt sans rien modifier si la sauvegarde échoue (couper la base ou la phrase de passe pour le provoquer). Le retour en arrière est-il compris ? | Mise à jour réussie, ou échec compris et rien n'a été modifié. |
| H4 | « Le seul administrateur a perdu son téléphone et ses codes de secours. Comment le dépanner ? » | La commande `reset-mfa` (sans SQL), trouvée dans `docs/exploitation.md` ou `CLAUDE.md`. | Compte dépanné, sans rien casser. |

Critère : H1 à H4 réussies par la personne **sans appeler au secours** ; toute question posée à l'animateur est une phrase manquante dans la documentation, à ajouter.
