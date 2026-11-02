# Test d'usage avec des trésoriers novices

Statut : protocole proposé (2 novembre 2026), **à dérouler avec 2 ou 3 personnes qui n'ont aucune connaissance comptable**. C'est le seul moyen de valider l'audit de l'[ADR 0028](decisions/0028-parcours-simplifies-pour-tresoriers-novices.md), qui reposait sur la lecture du code. Ce document est la feuille de route 1.6.

## Principe

On regarde une personne **faire** des tâches de trésorier, **sans lui expliquer** l'application. Ce n'est pas elle qu'on teste, c'est l'écran : chaque hésitation, chaque question, chaque mot incompris est une anomalie de conception, à corriger.

## Préparation

- **Participants** : 2 ou 3 bénévoles d'association, de préférence jamais confrontés à de la comptabilité en partie double. Pas de collègue du projet. 45 à 60 minutes chacun, séparément.
- **Instance** : une installation vierge, en affichage Simple (défaut), avec des **données fictives** (aucune donnée réelle d'association). Compte du participant : rôles Administrateur technique + Trésorier (case « Je suis aussi le trésorier »). Prévoir la double authentification déjà activée, ou compter l'inscription comme une tâche.
- **Matériel fictif** : un fichier OFX d'exemple (voir `apps/api/test/fixtures/ofx/`), un chèque de cotisation (photo ou papier), une facture d'assurance, la liste de 3 adhérents.
- **Animateur** : une personne qui observe et note, **ne guide pas**. Une seconde personne peut chronométrer. Enregistrer l'écran et la voix si le participant y consent (écrit), sinon notes seules.
- **Consigne orale unique** : « Vous êtes le nouveau trésorier de l'association. Je vais vous demander de faire des tâches avec ce logiciel. Dites à voix haute ce que vous pensez et ce que vous cherchez. Je ne répondrai pas aux questions sur le logiciel : s'il y a un blocage, dites-le et on passera à la suite. »

## Les tâches (dans cet ordre)

| # | Tâche donnée au participant | Ce qu'on veut vérifier | Réussite |
| --- | --- | --- | --- |
| 1 | « Installez l'association : vous avez une banque et une année de comptes qui commence en janvier. » | La page **Démarrer** se comprend sans lexique (période, catégories, compte). | Les 3 étapes terminées seul·e. |
| 2 | « Un adhérent vous a remis un chèque de 30 € pour sa cotisation. Enregistrez-le. » | « J'ai reçu de l'argent », choix de la **catégorie**, aperçu « Ce que verra l'expert-comptable ». | Opération enregistrée, bonne catégorie. |
| 3 | « Vous avez payé 120 € d'assurance. Enregistrez-le. » | « J'ai dépensé de l'argent ». | Idem. |
| 4 | « Vous venez de recevoir le relevé de la banque (fichier). Intégrez-le et mettez tout en ordre. » | **Import**, mots « à relier », **Classer et enregistrer**, enregistrement en masse. | Tous les mouvements classés et enregistrés. |
| 5 | « Vous vous êtes trompé de montant sur l'assurance. Corrigez. » | **Annuler l'opération** (et sa confirmation), puis ré-enregistrement. | Opération annulée puis refaite correctement. |
| 6 | « Le relevé de la banque indique tel solde. Vérifiez que vos comptes concordent. » | **Vérification avec la banque** (écart, cases). | Vérification validée ou écart expliqué. |
| 7 | « Rattachez le chèque de Marie à sa cotisation de l'année. » | **Membres › Règlements**, case « L'enregistrer aussi dans les comptes ». | Cotisation marquée payée, une seule saisie d'argent. |
| 8 | « L'assemblée générale approche : préparez ce qu'il faut montrer sur les comptes de l'année. » | **Rapports** (compte de résultat, bilan), impression. | Les deux états ouverts et compris dans les grandes lignes. |
| 9 | « Enregistrez une dépense datée d'il y a trois ans. » (exercice absent) | Message d'erreur à trois temps, sait quoi faire. | Comprend la cause et la marche à suivre. |

## Ce qu'on note, tâche par tâche

- **Réussie seule** / réussie après une relance de l'animateur / abandonnée.
- **Temps passé** et nombre de clics « perdus » (retours en arrière, mauvais menu).
- **Mots incompris** (le participant les cite, ou les interprète de travers : « contrepartie », « comptabiliser », « exercice »…).
- **Phrases qui ont aidé** (le participant lit un texte d'aide et agit juste).
- **Moments de peur** : « je n'ose pas valider », « si je me trompe ? ». Les conséquences annoncées avant une action irréversible étaient-elles lues et suffisantes ?
- **Attentes trompées** : le participant cherche un bouton là où il n'y en a pas.

## Grille de lecture (à remplir après chaque séance)

| Tâche | Seul·e ? | Mots bloquants | Écran concerné | Correction proposée |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| … | | | | |

## Critères de succès du lot

- Au moins **7 tâches sur 9** réussies **sans aucune aide** par au moins 2 participants sur 3.
- **Aucune** tâche abandonnée par tous les participants.
- Les tâches 2, 3 et 4 (le quotidien) sont réussies sans aide par **tous**.
- Aucun mot comptable n'est cité comme « bloquant » par plus d'un participant (sinon : le remplacer ou l'expliquer sur place).

## Après les séances

1. Regrouper les observations par écran, classer en **bloquant** / **gênant** / **cosmétique**.
2. Corriger les bloquants dans la foulée (vocabulaire, ordre des champs, messages) ; garder la trace dans l'[ADR 0028](decisions/0028-parcours-simplifies-pour-tresoriers-novices.md) (section « Suites » et « Hors de ce lot »).
3. Rejouer la tâche concernée avec un participant différent.
4. Ne jamais conserver d'enregistrement ou de note qui identifie une personne dans le dépôt : seuls les enseignements anonymisés y entrent.
