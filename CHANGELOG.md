# Notes de version

Ce fichier s'adresse à la personne qui héberge l'instance et aux administrateurs : il dit **ce qui change** d'une version à l'autre et **ce qu'il faut savoir avant de mettre à jour**. Il s'affiche dans **Paramètres › Exploitation**.

Une section par version, la plus récente en premier : `## <version> — <date>`. Tant que rien n'est publié, tout figure sous `## Non publié`. Les listes sont des phrases courantes, pas des messages de commit. Format lu par l'application : titres `##` (version), `###` (rubrique), puces `-`.

## Non publié

### À savoir avant de mettre à jour

- Les migrations de base de données ne sont pas réversibles : lancez `scripts/update.sh <version>`, qui sauvegarde et vérifie avant de changer de version. Pour revenir en arrière, on restaure la sauvegarde faite juste avant.
- Nouveau dans l'image `backup` : la copie hors site automatique (variables `OFFSITE_*` de `.env.prod`, facultatives). Sans elle, rien ne change.

### Nouveautés

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
