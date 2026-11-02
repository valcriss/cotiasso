# Notes de version

Ce fichier s'adresse à la personne qui héberge l'instance et aux administrateurs : il dit **ce qui change** d'une version à l'autre et **ce qu'il faut savoir avant de mettre à jour**. Il s'affiche dans **Paramètres › Exploitation**.

Une section par version, la plus récente en premier : `## <version> — <date>`. Tant que rien n'est publié, tout figure sous `## Non publié`. Les listes sont des phrases courantes, pas des messages de commit. Format lu par l'application : titres `##` (version), `###` (rubrique), puces `-`.

## Non publié

### À savoir avant de mettre à jour

- Nouvelle migration (catégories d'opération). **Changement visible** : l'affichage par défaut est maintenant « Simple » ; chaque personne retrouve le menu complet via Apparence › Affichage › Comptable. Les droits ne changent pas.
- Les migrations de base de données ne sont pas réversibles : lancez `scripts/update.sh <version>`, qui sauvegarde et vérifie avant de changer de version. Pour revenir en arrière, on restaure la sauvegarde faite juste avant.
- Nouveau dans l'image `backup` : la copie hors site automatique (variables `OFFSITE_*` de `.env.prod`, facultatives). Sans elle, rien ne change.

### Nouveautés

- **Vocabulaire simplifié sur les derniers écrans** (affichage Simple) : le rapprochement bancaire devient « Vérification avec la banque », les virements internes « Déplacer de l'argent entre mes comptes », les rapports, l'import de relevé et les projets parlent de période, de dépenses et de recettes et d'opérations enregistrées. L'affichage Comptable garde les termes de l'expert.
- **Projet obligatoire expliqué** : quand une dépense ou une recette n'est rattachée à aucun projet, le message dit sur quelle ligne, pourquoi la règle existe et quoi faire ; l'éditeur d'écriture prévient avant la comptabilisation et propose de rattacher les lignes à « Fonctionnement » d'un clic.
- **Enregistrer d'un coup les mouvements classés** : un seul bouton enregistre dans les comptes tous les mouvements déjà classés d'un compte (ou ceux qu'on a cochés), dans l'ordre des dates. Si l'un est refusé (exercice fermé, par exemple), les autres passent quand même et un compte rendu explique chaque refus.
- **Parcours simplifiés, suite** : « Classer et enregistrer » un mouvement du relevé en choisissant seulement une catégorie, une situation lisible par mouvement (À classer, Classé, Enregistré, Vérifié avec la banque), catégories dans « Classer la sélection », rôle « Expert-comptable » en lecture seule (affichage comptable d'office), clôture d'exercice en trois étapes avec compte du résultat proposé, inscription à la double authentification expliquée pas à pas.
- Exploitation : `docker compose exec api node dist/cli/reset-mfa.js <email>` réinitialise la double authentification d'un compte depuis le serveur, sans SQL (voir docs/exploitation.md).
- **Parcours simplifiés pour les trésoriers débutants** : affichage « Simple » par défaut (la rubrique Comptabilité n'apparaît plus dans le menu, l'affichage « Comptable » la rend), vue d'ensemble avec l'argent disponible, le mois en cours et la liste « À faire », gestes « J'ai reçu de l'argent » / « J'ai dépensé de l'argent » qui enregistrent l'opération et sa comptabilité en une fois, catégories en mots courants, action « Annuler l'opération », assistant « Démarrer » (période, catégories, compte bancaire) et modèle de démarrage proposé (comptes et catégories courants, à faire relire par un expert-comptable). À l'installation, la personne peut aussi recevoir le rôle de trésorier.
- Reprise : onglet « Progression » de la Comptabilité, qui montre pour chaque exercice et chaque compte où en est la reprise (mouvements qualifiés, brouillons, écritures comptabilisées, rapprochement) et ce qu'il reste à régler, avec un lien vers l'écran concerné.
- Exploitation : copie hors site automatique des sauvegardes chiffrées (S3, SFTP, WebDAV…), état affiché dans Paramètres › Exploitation, script de mise à jour qui sauvegarde et vérifie avant de changer de version, notes de version dans l'application.
- Journal d'audit : export CSV avec les empreintes de la chaîne de contrôle.
- Relevés OFX : le fichier d'origine est conservé comme document restreint.
- Projets et financements : participants, budgets versionnés et approuvés, engagements, suivi budget / engagé / dépensé, financeurs, subventions, échéancier et versements, dépenses affectées et compte rendu pour le financeur, documents par projet.
- Droits par projet : une personne peut être limitée à un projet ; écran « Voir les accès ».
- Membres et cotisations : membres, fonctions, campagnes, tarifs, adhésions, règlements, rappels et reçus simples.
- États de synthèse : compte de résultat, bilan et état de trésorerie avec l'exercice précédent, exports CSV et impression.
- Trésorerie : comptes bancaires, import OFX, virements internes, rapprochement bancaire, lots de reprise.
- Comptabilité : exercices, journaux, plan de comptes, écritures, contrepassation, clôture avec à-nouveaux, projets et ventilation.
- Socle : comptes, rôles et droits, double authentification, journal d'audit, documents, paramètres et marque blanche, sauvegardes chiffrées.
