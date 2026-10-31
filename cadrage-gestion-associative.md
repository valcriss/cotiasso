# Document de cadrage — Gestion associative et comptabilité

Version : 1.0 — 31 octobre 2026  
Statut : cadrage fonctionnel et technique préalable au développement  
Nom du produit : à définir  
Licence du projet : MIT

## 1. Objet et lecture du document

Ce document décrit une application web de gestion associative, de suivi des comptes et de comptabilité, distribuable en marque blanche. Il consolide les décisions prises et précise une cible cohérente pour sa réalisation.

Les mentions suivantes distinguent le niveau de décision :

- **Retenu** : exigence ou orientation explicitement convenue.
- **Proposé** : recommandation de conception à confirmer avant implémentation.
- **À décider** : information ou arbitrage encore nécessaire.

Le document ne constitue pas une attestation de conformité comptable ou fiscale. Les modèles comptables et cas de clôture devront être validés sur le périmètre réellement pris en charge. Les règles dépendant de la réglementation doivent être vérifiées dans leur version applicable lors de l'implémentation.

## 2. Vision et objectifs

### 2.1 Finalité

Fournir aux associations un outil simple au quotidien, capable de relier :

1. Les comptes bancaires et les mouvements de trésorerie.
2. Les écritures et les états comptables.
3. Les membres, adhésions et cotisations.
4. Les projets, financements, budgets et documents.
5. Les droits et circuits d'approbation adaptés à chaque structure.

L'utilisateur doit pouvoir saisir une opération métier compréhensible sans manipuler systématiquement des débits et crédits. Le moteur doit néanmoins conserver une comptabilité fiable en partie double.

### 2.2 Résultats attendus

- Connaître la trésorerie de chaque compte et de l'association.
- Identifier les opérations restant à qualifier, comptabiliser ou rapprocher.
- Produire un bilan et un compte de résultat lisibles et vérifiables.
- Préparer les documents nécessaires aux échanges avec les financeurs.
- Suivre le budget et les justificatifs de chaque projet.
- Suivre les cotisations attendues et leurs règlements.
- Permettre la passation à un nouveau bureau ou trésorier.
- Distribuer le même logiciel à d'autres associations sans branche de code spécifique.

### 2.3 Indicateurs de réussite

- Chaque montant d'un rapport est explicable jusqu'aux écritures et pièces disponibles.
- Aucun import répété ne crée silencieusement de doublons.
- Les écarts bancaires et les opérations non traitées sont visibles.
- Une association peut exporter toutes ses données et restaurer une sauvegarde.
- Les utilisateurs ne voient que les informations autorisées.
- Les règles de l'association sont configurables sans développement particulier.

## 3. Décisions structurantes

| Sujet | Décision | Statut |
| --- | --- | --- |
| Distribution | Projet open source sous licence MIT | Retenu |
| Déploiement | Une installation indépendante par association | Retenu |
| Personnalisation | Marque blanche et page de configuration de l'association | Retenu |
| Backend | Framework Node.js | Retenu |
| Framework précis | NestJS avec adaptateur Fastify | Proposé |
| Base de données | PostgreSQL | Proposé |
| Accès aux données | Prisma, avec SQL explicite si nécessaire | Proposé |
| Frontend | Angular / TypeScript | Proposé |
| Architecture | Monolithe modulaire avec domaine comptable indépendant | Proposé |
| Comptabilité | Moteur en partie double et génération d'un bilan | Retenu |
| Banque | Plusieurs comptes, import OFX et saisie manuelle | Retenu |
| Membres | Gestion des membres et des cotisations | Retenu |
| Projets | Suivi documentaire, budgétaire et comptable | Retenu |
| Affectation projet | Obligatoire pour charges et produits avant validation ; fonctionnement permanent | Retenu comme règle de l'association initiale |
| Membre sur une transaction | Rattachement facultatif | Retenu |
| Droits | Droits globaux et droits par projet avec héritage | Retenu |
| Fonctions associatives | Président, trésorier, membre du bureau, autres fonctions configurables | Retenu |
| Workflows | Optionnels et configurables | Retenu |
| TVA | Assujettissement configurable | Retenu |
| Historique | Reprise de toutes les opérations depuis la création | Retenu pour l'association initiale |

L'existence d'une option configurable n'implique pas que tous ses modes soient disponibles dès le premier incrément. Une configuration non prise en charge doit être explicitement indisponible, jamais acceptée avec un traitement incomplet.

## 4. Périmètre et limites

### 4.1 Périmètre cible

- Configuration et identité de l'association.
- Utilisateurs, membres, mandats, rôles et permissions.
- Campagnes de cotisations, échéances et règlements.
- Comptes bancaires et caisses.
- Transactions, imports, ventilation et rapprochement.
- Comptabilité générale et analytique.
- Projets et budgets.
- Subventions et financeurs.
- Demandes de dépenses et remboursements de frais.
- Documents et versions.
- Workflows facultatifs.
- Rapports, exports, clôture et archivage.
- Sauvegarde, restauration et mises à jour.

### 4.2 Fonctions proposées hors première version

- Synchronisation bancaire automatique.
- Paiement en ligne et intégration avec des prestataires de collecte.
- Portail membre complet en libre-service.
- Paie et déclarations sociales.
- Télétransmission fiscale et dépôt automatique des comptes.
- Facturation électronique et connexion à une plateforme agréée.
- Comptabilité multidevise.
- Consolidation de plusieurs associations.
- Éditeur de code ou de scripts métier dans la configuration.

La facturation de vente, les reçus fiscaux, les immobilisations automatisées et la préparation des déclarations de TVA nécessitent un arbitrage spécifique. Un reçu de règlement ne doit pas être présenté comme un reçu fiscal.

## 5. Utilisateurs, membres et fonctions

### 5.1 Séparation des concepts

- **Membre** : personne enregistrée dans l'association ; un compte de connexion n'est pas obligatoire.
- **Utilisateur** : identité permettant de se connecter ; elle peut être liée à un membre.
- **Fonction** : responsabilité associative, par exemple président ou trésorier.
- **Mandat** : exercice d'une fonction entre deux dates.
- **Rôle applicatif** : ensemble de permissions globales ou limitées à un projet.

Une personne peut cumuler plusieurs fonctions et rôles. La fin d'un mandat ne doit pas supprimer son historique. Le transfert de droits doit être explicite et tracé ; l'association peut choisir d'associer certains rôles à certaines fonctions.

### 5.2 Profils par défaut proposés

| Profil | Permissions initiales proposées |
| --- | --- |
| Président | Consultation générale, documents du bureau, approbations configurées |
| Trésorier | Gestion des comptes, cotisations, comptabilité, rapports et clôture |
| Membre du bureau | Tableaux de bord et documents autorisés, autres permissions explicites |
| Responsable de projet | Gestion opérationnelle de ses projets, budgets et documents selon délégation |
| Contributeur | Dépôt de pièces et demandes sur les projets autorisés |
| Lecteur | Consultation des ressources autorisées |
| Administrateur technique | Configuration et gestion des accès ; permissions métier distinctes |

Ces profils sont des modèles modifiables, pas des privilèges imposés par le logiciel. Le président ne reçoit pas automatiquement le droit de modifier ou clôturer la comptabilité.

## 6. Droits globaux et héritage par projet

### 6.1 Principes retenus

- Refus par défaut en l'absence d'autorisation.
- Vérification côté backend sur chaque opération et ressource.
- Permissions par action : consulter, créer, modifier, soumettre, approuver, comptabiliser, clôturer, exporter, administrer.
- Portée globale ou limitée à un projet.
- Héritage des permissions globales sur les projets.
- Héritage des permissions du projet sur ses dossiers et documents.

### 6.2 Politique de résolution proposée

1. Appliquer les interdictions impératives : utilisateur désactivé, exercice clos, action incompatible avec l'état métier.
2. Rechercher une permission globale ou locale autorisant l'action.
3. Appliquer les restrictions de confidentialité explicites du document ou dossier.
4. Vérifier les règles propres à l'action, par exemple l'interdiction de s'auto-approuver.
5. Refuser si aucune autorisation effective ne subsiste.

Les restrictions documentaires priment sur une autorisation générale de lecture des projets, sauf permission distincte d'accès aux documents restreints. La liste des rôles bénéficiant de cette permission reste configurable.

### 6.3 Exigences complémentaires

- Écran « Accès effectifs » expliquant les permissions et leur origine.
- Les listes, résultats de recherche, aperçus, téléchargements et exports respectent les mêmes droits.
- Un lien entre plusieurs objets ne rend pas automatiquement un document accessible à tous leurs lecteurs.
- L'accès à une écriture financière n'ouvre pas nécessairement l'accès à tous ses justificatifs sensibles.
- Les montants agrégés peuvent également être sensibles : les rapports doivent respecter les portées autorisées.
- Les changements de rôles sont audités.
- Le rôle d'administrateur applicatif n'empêche pas l'exploitant disposant d'un accès direct au serveur ou à la base d'accéder techniquement aux données ; cette limite doit être documentée.

## 7. Navigation et expérience utilisateur

### 7.1 Direction visuelle retenue

Navigation inspirée des principes de Confluence : menu simple à gauche, icônes accompagnées de libellés, espace de travail central et navigation contextuelle. Thème bleu et blanc, sans reproduction de marque ou d'éléments propriétaires.

- Barre latérale bleu très pâle et contenu blanc.
- Texte bleu nuit, actions principales et sélection en bleu.
- Icônes homogènes ; bibliothèque et licence à sélectionner.
- Menu repliable, avec infobulles en mode icônes.
- Nom et logo de l'association en haut.
- Profil et paramètres en bas.
- Exercice actif visible dans les vues comptables ; les transactions restent consultables sur plusieurs exercices.
- Sous-menus limités à la rubrique utile.
- Couleurs complétées par du texte et des pictogrammes pour les statuts.

### 7.2 Arborescence cible

| Entrée | Sous-ensembles |
| --- | --- |
| Vue d'ensemble | Indicateurs, alertes, tâches et échéances |
| Comptes | Comptes et caisses, transactions, imports, rapprochements |
| Comptabilité | Écritures, journaux, plan comptable, exercices, clôture |
| Membres & cotisations | Membres, fonctions, campagnes, tarifs, règlements |
| Projets | Synthèse, documents, budget, financements, comptabilité, échéances |
| Subventions | Financeurs, demandes, attributions, versements et comptes rendus |
| Rapports | Bilan, résultat, balance, grand livre, budgets et analyses |
| Documents | Recherche et classement transversal |
| Paramètres | Association, marque blanche, règles, utilisateurs, droits et workflows |

Le menu s'adapte aux permissions. Une fonctionnalité ne doit pas être rendue accessible par sa seule URL si elle est masquée dans le menu.

### 7.3 Parcours quotidien

Depuis un compte : solde, actions « Ajouter une transaction » et « Importer un OFX », puis liste filtrable. Un panneau latéral permet de traiter une transaction sans perdre la liste : informations, membre, projet, ventilation, justificatifs et liens comptables.

Les formulaires doivent conserver les brouillons, expliquer les blocages et éviter les validations silencieuses. Les tableaux doivent être navigables au clavier et utilisables sur tablette ; les tâches courtes doivent rester possibles sur mobile.

## 8. Paramètres de l'association et marque blanche

### 8.1 Assistant initial

1. Création du premier administrateur.
2. Identité et coordonnées de l'association.
3. Logo, nom affiché et palette.
4. Dates des exercices et référentiel comptable.
5. Régime de TVA pris en charge.
6. Règles des cotisations.
7. Comptes bancaires et caisses.
8. Création du projet permanent de fonctionnement.
9. Rôles et activation éventuelle des workflows.
10. Choix du mode de démarrage : reprise historique ou situation d'ouverture.

### 8.2 Rubriques

| Rubrique | Paramètres |
| --- | --- |
| Identité | Nom, adresse, contacts, RNA/SIREN si applicable |
| Apparence | Logo, nom de l'application, couleurs, pieds de page |
| Comptabilité | Exercices, plan de comptes, journaux, comptes par défaut, séquences |
| TVA | Mode, date d'effet, taux et comptes selon fonctions disponibles |
| Cotisations | Périodes, tarifs, échéances, renouvellement et prorata éventuel |
| Projets | Affectation obligatoire ou facultative, fonctionnement, ventilation |
| Documents | Modèles, mentions, limites et catégories |
| Utilisateurs | Rôles, permissions, mandats et accès |
| Workflows | Activation, opérations concernées et règles |
| Notifications | Échéances, rappels, expéditeur et configuration email |
| Exploitation | Sauvegardes, exports, version et contrôles de santé |

### 8.3 Historisation

Les paramètres structurants sont versionnés ou datés. Une évolution ne modifie pas les cotisations émises, écritures validées, circuits en cours ou documents archivés. Les paramètres déjà utilisés peuvent être verrouillés ou applicables uniquement à une période future.

La configuration reste déclarative et validée : aucun script arbitraire n'est exécuté pour personnaliser une association. Les secrets d'infrastructure restent hors des exports ordinaires et du dépôt source.

## 9. Comptes et transactions

### 9.1 Comptes financiers

Gestion de plusieurs comptes bancaires et caisses, avec nom, type, devise, références utiles, dates d'activité et compte comptable associé. Le périmètre initial proposé est l'euro.

Un compte utilisé est archivé plutôt que supprimé. Le système distingue le solde initial, le solde calculé à partir des transactions et le dernier solde fourni par un relevé, chacun avec sa date. Un solde non contrôlé ne doit pas être présenté comme rapproché.

### 9.2 Transactions

Champs principaux : compte, date d'opération, date de valeur si disponible, montant signé, libellé, référence, origine, identifiant externe, membre éventuel, projet proposé et justificatifs.

- Saisie manuelle et import OFX.
- Recherche et filtres par période, montant, origine, membre, projet et état de traitement.
- Ventilation d'une transaction.
- Détection des doublons et rapprochement avec une saisie manuelle.
- Transactions de remboursement et annulations clairement reliées.

Les dimensions de statut doivent rester distinctes : présence sur un relevé, qualification, comptabilisation partielle ou totale et rapprochement. Une transaction peut être importée et encore non comptabilisée.

### 9.3 Distinction avec la comptabilité

Une transaction représente un mouvement financier. Une écriture représente un événement comptable. Elles ne sont pas fusionnées dans une seule table.

| Cas | Traitement attendu |
| --- | --- |
| Achat immédiatement payé | Préparation puis validation de l'écriture depuis la transaction |
| Facture déjà enregistrée | Création ou association de l'écriture de règlement |
| Paiement partiel | Plusieurs règlements liés à une dette ou créance |
| Paiement groupé | Répartition d'un mouvement entre plusieurs objets métier |
| Virement interne | Deux transactions reliées au même transfert, sans charge ni produit |
| Amortissement | Écriture sans mouvement bancaire |

La liaison vers la banque se fait sur les lignes comptables de trésorerie. La répartition entre factures, cotisations ou membres utilise des affectations de règlement distinctes. Les montants affectés ne doivent jamais dépasser les montants disponibles.

### 9.4 Modifications

Une transaction manuelle non comptabilisée est modifiable. Une fois liée à une écriture validée, les changements financiers nécessitent une correction contrôlée. Les champs informatifs peuvent rester modifiables avec audit.

Les données brutes importées sont conservées sans réécriture ; une qualification ou correction utilisateur est enregistrée séparément. Supprimer une préparation d'import ne doit pas supprimer une écriture validée.

## 10. Import OFX et rapprochement

### 10.1 Parcours d'import

1. Déposer un fichier et contrôler son format et sa taille.
2. Identifier le compte cible et les dates couvertes.
3. Analyser le fichier sans valider d'écritures.
4. Afficher les lignes nouvelles, doublons probables, rapprochements proposés et erreurs.
5. Confirmer les choix.
6. Créer les transactions et enregistrer le compte rendu d'import.

Le parseur doit traiter les variantes OFX prises en charge, les encodages, séparateurs décimaux, signes et dates. Les variantes non supportées doivent être rejetées explicitement. Les XML externes ne doivent pas permettre de chargement de ressources ou d'entités distantes.

### 10.2 Détection des doublons

- Exploiter l'identifiant bancaire lorsqu'il est fourni, dans le périmètre du compte et de la source.
- Utiliser une comparaison secondaire date/montant/référence/libellé pour proposer les rapprochements.
- Ne pas fusionner automatiquement deux paiements légitimes de même montant le même jour.
- Reconnaître les saisies manuelles déjà présentes.
- Prévoir des clés d'idempotence et contraintes SQL pour protéger contre les doubles soumissions.
- Les corrections ou annulations présentes dans un relevé doivent être explicites et auditables.

### 10.3 Rapprochement

Le rapprochement contrôle les mouvements et le solde sur une période, avec relevé justificatif. Il met en évidence les écritures de trésorerie sans transaction associée, les mouvements non comptabilisés et les écarts.

Les décalages de date et opérations en circulation doivent pouvoir être expliqués. Le rapprochement bancaire, l'affectation d'un paiement et le lettrage des dettes/créances sont trois mécanismes distincts.

## 11. Moteur comptable

### 11.1 Objets et invariants

Une écriture possède un exercice, un journal, une date comptable, un libellé, une référence, un état et plusieurs lignes.

Chaque ligne possède un compte, un débit ou crédit et, lorsque nécessaire, un tiers et une ventilation analytique.

Invariants proposés :

- Débit total égal au crédit total à la validation.
- Montants exacts, non négatifs sur les colonnes débit/crédit ; une ligne ne porte pas les deux simultanément.
- Compte utilisable et journal autorisé.
- Date incluse dans un exercice ouvert.
- Validation atomique avec numérotation et audit.
- Écriture validée non modifiable directement.
- Contrepassation reliée à l'original et correction traçable.
- Contrôle des doubles validations et des accès concurrents.

Les montants sont stockés en décimal exact ou en unités monétaires entières selon une convention unique. La proposition est PostgreSQL NUMERIC avec une bibliothèque décimale côté TypeScript. Les API transportent les décimaux sous forme de chaînes. Les règles d'arrondi sont explicites, notamment pour la TVA et les ventilations.

### 11.2 Numérotation et piste d'audit

Séquence attribuée à la validation selon une règle documentée par journal/exercice. L'unicité doit être garantie en base, y compris en concurrence. L'horodatage technique ne remplace pas la date comptable.

L'audit conserve auteur, action, objet, date, justification et liens de correction, sans enregistrer de secrets. Il ne faut pas présenter un simple historique applicatif comme un archivage probant ou une certification.

### 11.3 Référentiel et états

Plan comptable associatif français comme référence initiale, versionné et personnalisable dans les limites compatibles avec les rapports. Les comptes utilisés sont désactivables, pas supprimables.

Les états proviennent du même grand livre validé. Les affectations de comptes vers les rubriques de rapport sont centralisées et versionnées. Tout compte non classé ou résultat incohérent doit déclencher un contrôle visible.

### 11.4 Exercice et clôture

Les dates d'exercice sont configurables et indépendantes des cotisations. Prévoir les exercices initiaux ou de transition de durée particulière sans supposer systématiquement douze mois.

Parcours proposé : contrôles, rapprochements, ajustements, génération des états, clôture et ouverture suivante. Le report des comptes de bilan et le traitement du résultat doivent éviter tout double report.

Clôture technique, affectation du résultat et approbation des comptes en AG sont distinguées. Une réouverture exceptionnelle, si retenue, exige une permission spécifique, un motif et une traçabilité des états rendus obsolètes.

## 12. TVA et traitements particuliers

### 12.1 Modes de TVA

L'assujettissement est configurable. Modes proposés : non assujettie, assujettie et activité mixte. La prise en charge effective du mode mixte et de la déductibilité partielle reste à spécifier.

- Date d'effet et taux historisés.
- Montants HT, TVA et TTC cohérents.
- Comptes de TVA configurables.
- Arrondis reproductibles.
- Activation sans recalcul des écritures historiques.

La comptabilisation de TVA, la préparation de déclarations et leur télétransmission sont des fonctions différentes. Le logiciel ne doit pas annoncer un régime pris en charge si les cas nécessaires ne sont pas implémentés et vérifiés.

### 12.2 Immobilisations et autres ajustements

À décider : registre des immobilisations et génération des amortissements dès la V1, ou saisie d'écritures d'ajustement vérifiées par une personne compétente.

Il faut identifier avant le développement les besoins en charges/produits constatés d'avance, factures non parvenues, créances, dettes, provisions, contributions volontaires et fonds dédiés. L'absence d'un assistant spécialisé ne dispense pas de pouvoir traiter les cas nécessaires au bilan réel de l'association.

## 13. Membres, adhésions et cotisations

### 13.1 Fiche membre

Identifiant interne, coordonnées utiles, catégorie, statut, dates d'entrée/sortie, fonctions et mandats, documents, adhésions, cotisations, règlements et remboursements.

Collecter seulement les données nécessaires. Un membre sorti peut conserver un historique comptable sans conserver indéfiniment toutes ses coordonnées dans la base active.

### 13.2 Périodes configurables

- Campagne commune à tous les membres.
- Adhésion individuelle de durée définie, proposée pour d'autres associations.
- Tarifs multiples, exonérations et prorata éventuel selon configuration.

Pour l'association initiale : campagne commune du **29 septembre au 28 septembre de l'année suivante inclus**. Exemple : 29/09/2025–28/09/2026. Une adhésion tardive ne déplace pas automatiquement la date de fin.

Les campagnes possèdent des dates explicites et ne sont pas recalculées lors d'un changement de règle. La politique de renouvellement, le traitement d'un changement de calendrier et les cas de date exceptionnelle doivent être définis.

### 13.3 Attendu, dû et payé

Distinguer : inscription, adhésion effective, cotisation attendue, éventuelle créance comptable et règlement. La création d'une cotisation attendue ne doit pas produire automatiquement une créance sans règle métier validée.

Fonctions attendues : paiements partiels, un paiement pour plusieurs membres, un membre payant pour un autre, trop-perçu, remboursement et annulation motivée.

Le lien entre une transaction et un membre est facultatif et ne vaut pas règlement automatique d'une cotisation. Le payeur et le bénéficiaire de l'adhésion peuvent être différents.

Les rappels et reçus simples sont configurables. Les reçus fiscaux restent une fonction séparée à cadrer.

## 14. Projets et suivi analytique

### 14.1 Fiche projet

Nom, code, objet, responsable, dates, statut, participants, droits, budget, documents, financements et échéances.

Statuts proposés : préparation, actif, terminé, archivé. Un projet utilisé en comptabilité n'est pas supprimé. Une correction autorisée reste possible après sa fin sans réécrire les comptes historiques.

Le projet peut couvrir plusieurs exercices ; ses rapports doivent permettre une vue globale et une vue annuelle.

### 14.2 Affectations

- Membre facultatif sur une transaction.
- Projet facultatif pendant la préparation ou l'import.
- Projet obligatoire pour les charges et produits avant validation dans la configuration initiale.
- Projet permanent « Fonctionnement de l'association » pour les opérations générales.
- Pas d'affectation analytique forcée sur un simple virement entre comptes.
- Ventilation entre plusieurs projets avec contrôle du total.

Le projet renseigné sur la transaction préremplit la proposition comptable. L'affectation analytique définitive est portée par les lignes de charge/produit, pas uniquement par les lignes de banque. Les écarts entre proposition et affectation définitive sont visibles. Une modification après validation suit une correction analytique contrôlée et tracée.

### 14.3 Budget

Budget prévisionnel par poste et période, versions et date d'approbation éventuelle. Distinguer : budget, engagements, charges/produits comptabilisés et encaissements/décaissements.

Une dépense engagée puis comptabilisée ne doit pas être comptée deux fois. Le « reste disponible » indique sa formule et son périmètre. Les coûts communs peuvent être ventilés selon une règle explicite et vérifiable.

## 15. Subventions et financeurs

Une subvention est distincte d'un projet : un projet peut recevoir plusieurs subventions et une convention peut concerner plusieurs projets si nécessaire.

Champs : financeur, référence, objet, montants demandés et accordés, dates de décision, période financée, convention, conditions, échéancier, versements et obligations de compte rendu.

Parcours : demande, instruction, accord/refus, encaissements, suivi de l'utilisation, compte rendu et clôture.

- L'attribution et le versement ne sont pas confondus.
- Les versements peuvent être échelonnés et traverser plusieurs exercices.
- Les justificatifs de dépenses peuvent être reliés au financement avec un montant affecté.
- Le logiciel doit prévenir une affectation excessive d'une dépense aux financements, sauf montage explicitement documenté et autorisé.
- Les reliquats, remboursements et traitements de fin d'exercice sont explicites.
- Les éventuels fonds dédiés ne sont pas calculés à partir du seul solde bancaire : ils dépendent du cadre comptable et des conditions du financement.

Le compte rendu destiné à un financeur n'est pas nécessairement identique au compte de résultat général de l'association. Prévoir des modèles de restitution distincts.

## 16. Dépenses et remboursements

Une demande contient demandeur, bénéficiaire du paiement, date, motif, montants, projet(s), justificatifs et statut.

Elle peut concerner un achat à réaliser, une facture à payer ou une avance personnelle à rembourser. Ces cas doivent être distingués.

Avec workflow : soumission et approbations selon les règles. Sans workflow : traitement direct par un utilisateur autorisé. Dans les deux cas, le règlement et la validation comptable restent des étapes métier identifiables.

Prévoir les paiements partiels, refus, annulations, remboursements groupés et association avec une transaction bancaire existante. L'approbation ne prouve pas le paiement.

## 17. Workflows optionnels et configurables

### 17.1 Périmètre

Activation par association et par type d'opération : dépenses, remboursements, engagements ou documents si retenu.

Configuration : étapes ordonnées, validateurs par rôle/personne/responsabilité de projet, conditions de montant, suppléants, notifications et règle d'auto-approbation.

### 17.2 Modes

| Mode | Comportement |
| --- | --- |
| Désactivé | Action directe si les permissions et contrôles métier sont satisfaits |
| Activé | Action soumise au circuit applicable et à ses conditions |

L'absence de workflow ne désactive jamais l'équilibre comptable, les permissions, le verrouillage des exercices ni la traçabilité.

### 17.3 Versionnement et situations limites

- Une demande conserve la version du workflow utilisée lors de sa soumission.
- Les modifications s'appliquent aux nouvelles demandes.
- Toute migration d'une demande en cours est explicite et auditée.
- La désactivation d'un workflow avec demandes en cours exige de choisir leur traitement ; aucune approbation automatique silencieuse.
- Le départ d'un validateur, l'absence de suppléant et les conflits de rôles doivent être signalés.
- Les notifications ne constituent pas la source de vérité : l'état dans l'application fait foi.
- Une seule approbation effective par étape malgré des clics concurrents.

Le niveau de complexité du moteur doit rester borné : règles déclaratives prédéfinies, sans langage de script arbitraire en V1.

## 18. Documents et suivi documentaire

- Dépôt, téléchargement privé, classement, tags, recherche et versions.
- Rattachements multiples vers membre, projet, subvention, transaction, demande ou écriture.
- Conservation d'un seul document logique, avec versions immuables.
- Un remplacement conserve l'ancienne version et les liens historiques pertinents.
- Catégories proposées : convention, devis, facture, relevé, compte rendu, procès-verbal et autre justificatif.
- Échéances et pièces attendues par projet ou financement.
- Notes expliquant les pièces manquantes lors de la reprise.

Contrôles : taille, types autorisés, nom sûr, détection de contenu à risque selon le déploiement, absence d'exécution et accès authentifié. Le nom d'origine est informatif et ne sert pas directement de chemin sur le serveur.

Une empreinte de fichier aide à détecter les doublons et altérations ; elle ne constitue pas à elle seule un archivage à valeur probante. La suppression d'un lien ne doit pas supprimer un document encore utilisé ailleurs.

## 19. Rapports et exports

### 19.1 États attendus

| Rapport | Contenu |
| --- | --- |
| Bilan | Actif/passif, rubriques associatives, montants et comparaison N/N−1 |
| Compte de résultat | Charges, produits, résultat et comparaison N/N−1 |
| Balance générale | Soldes et mouvements par compte |
| Grand livre et journaux | Détail contrôlable des écritures validées |
| Projet | Budget, engagements, réalisé comptable, paiements et financements |
| Subvention | Attribution, versements, dépenses affectées et pièces |
| Cotisations | Attendus, règlements, restes et anomalies |
| Trésorerie | Soldes par compte et évolution sur une période |

Une annexe aux comptes peut nécessiter des informations qualitatives et des tableaux complémentaires. Prévoir une rédaction manuelle structurée plutôt que promettre une génération intégralement automatique.

### 19.2 Qualité des restitutions

- Identité, période, date de génération, pagination et unité monétaire.
- Statut provisoire clairement visible avant arrêté/clôture selon le processus retenu.
- Modèle et version de calcul identifiables.
- Même source de calcul pour écran, PDF et tableur.
- Navigation du total vers les comptes et écritures.
- Traitement explicite d'une absence d'exercice précédent.
- Rapports figés archivés lors des étapes importantes ; nouvelles générations identifiées si corrections.

### 19.3 Formats

PDF, CSV et format tableur à sélectionner. Export complet incluant données structurées, documents, manifeste et version du schéma.

L'export FEC est proposé comme fonctionnalité à spécifier et vérifier séparément si nécessaire. Sa disponibilité ne constitue pas une certification du logiciel. Les exports tableur doivent neutraliser les contenus utilisateur pouvant être interprétés comme des formules malveillantes.

## 20. Reprise depuis la création

### 20.1 Parcours retenu pour l'association initiale

1. Identifier la date de création et les premiers comptes.
2. Créer les exercices et campagnes utiles.
3. Importer les relevés et compléter les mouvements manuels.
4. Reconstituer espèces, apports, dettes, créances et matériel si nécessaire.
5. Qualifier les opérations et ventiler les projets.
6. Relier les membres, cotisations et subventions.
7. Joindre les pièces disponibles et signaler les manquants.
8. Contrôler la banque et les états de chaque exercice.
9. Vérifier les ajustements puis clôturer chronologiquement.

Le premier solde bancaire importé n'est pas automatiquement une recette. La reprise doit expliquer son origine. Aucun compte d'équilibrage arbitraire ne doit masquer une information manquante.

### 20.2 Exigences

- Préparation séparée des écritures définitives.
- Import en masse avec compte rendu et reprise après erreur.
- Possibilité d'abandonner un lot non validé.
- Aucun effacement en cascade des écritures validées.
- Tableau de progression par exercice, compte et anomalie.
- Vérification comptable des premiers états complets avant utilisation comme référence.

Pour les autres associations, une reprise par situation d'ouverture pourra être proposée comme autre mode de démarrage.

## 21. Architecture technique proposée

### 21.1 Principes

Monolithe modulaire TypeScript, API HTTP documentée, base relationnelle et stockage documentaire privé. Pas de microservices, de bus d'événements externe ou d'event sourcing obligatoire au démarrage.

Le domaine comptable ne dépend pas des contrôleurs HTTP ni de Prisma. Les cas d'usage orchestrent les règles, permissions, transactions et écritures en base. Les adaptateurs réalisent les accès SQL, fichiers, emails et générations de documents.

### 21.2 Modules

| Module | Responsabilité |
| --- | --- |
| Identity & Access | Authentification, utilisateurs, rôles et permissions |
| Association | Identité, marque blanche, paramètres versionnés |
| Membership | Membres, mandats, campagnes, cotisations |
| Treasury | Comptes, transactions, imports et rapprochements |
| Accounting | Plan, écritures, exercices, validation et clôture |
| Projects | Projets, budgets, engagements et analytique |
| Funding | Financeurs, subventions et comptes rendus |
| Expenses | Dépenses et remboursements |
| Documents | Fichiers, versions, liens et droits |
| Workflows | Définitions, instances, décisions et suppléances |
| Reporting | Calculs, PDF et exports |
| Operations | Sauvegardes, audit, tâches et santé |

Les liens entre modules passent par des interfaces et identifiants explicites. Les écritures comptables ne doivent pas être modifiées directement par les modules banque ou cotisations.

### 21.3 Persistance et concurrence

- PostgreSQL et migrations versionnées.
- Contraintes de référence, unicité, signe et cohérence au plus près des données.
- Contrôles d'équilibre interlignes réalisés dans une transaction protégée ; un simple contrôle de champ ne suffit pas.
- Validation et clôture utilisent une stratégie de verrouillage cohérente pour empêcher une validation simultanée sur un exercice en cours de clôture.
- Contrôle de version optimiste sur les objets modifiables.
- Idempotence des imports, paiements, validations et traitements asynchrones.
- Générations longues et emails exécutés hors transaction comptable ; file de tâches persistante si nécessaire.
- Dates métier stockées comme dates ; horodatages techniques en UTC, affichés dans le fuseau configuré.

## 22. Modèle conceptuel de données

Les noms suivants sont indicatifs et ne constituent pas un schéma SQL définitif.

| Ensemble | Entités principales |
| --- | --- |
| Association | AssociationSettings, SettingsVersion, Branding |
| Accès | User, Role, Permission, GlobalRoleAssignment, ProjectRoleAssignment |
| Membres | Member, Function, Mandate, MembershipCampaign, Membership, Fee, PaymentAllocation |
| Trésorerie | FinancialAccount, BankStatement, Transaction, ImportBatch, ImportLine, Transfer, Reconciliation |
| Comptabilité | FiscalYear, Journal, Account, JournalEntry, JournalLine, CorrectionLink, TreasuryMatch |
| Projets | Project, BudgetVersion, BudgetLine, Commitment, AnalyticalAllocation |
| Financements | Funder, Grant, GrantSchedule, GrantProjectAllocation, FundingExpenseAllocation |
| Dépenses | ExpenseClaim, ExpenseLine, Settlement |
| Documents | Document, DocumentVersion, DocumentLink, DocumentAccessRule |
| Workflows | WorkflowDefinitionVersion, WorkflowInstance, StepInstance, ApprovalDecision |
| Rapports | ReportTemplateVersion, ReportSnapshot, ExportJob |
| Traçabilité | AuditEvent, BackgroundJob, BackupRecord |

Relations structurantes :

- Un utilisateur peut être lié à un membre ; tous les membres n'ont pas de connexion.
- Un membre possède plusieurs mandats et adhésions dans le temps.
- Une campagne possède plusieurs cotisations ; les règlements sont affectés explicitement.
- Un compte financier est relié à un compte de trésorerie comptable.
- Une écriture possède plusieurs lignes ; seules ses lignes de trésorerie sont rapprochées des transactions.
- Une ligne de charge/produit peut avoir plusieurs allocations analytiques dont le total est contrôlé.
- Un projet possède plusieurs budgets versionnés et financements.
- Un document possède plusieurs versions et liens, avec permissions résolues explicitement.
- Une instance de workflow référence une définition figée.

Une installation ne contient qu'une association : aucune infrastructure de cloisonnement SaaS multi-associations n'est requise. Cela n'exonère pas du cloisonnement des accès entre projets et utilisateurs.

## 23. Sécurité et données personnelles

- Comptes nominatifs, désactivation et récupération de compte sécurisée.
- Authentification solide ; proposition de MFA pour comptes sensibles.
- Sessions protégées, protection CSRF selon le mécanisme retenu, limitation des tentatives et validation des entrées.
- HTTPS au niveau du reverse proxy.
- Secrets hors dépôt, logs et exports ordinaires.
- Téléchargements documentaires soumis à autorisation ; liens temporaires si utilisés.
- Sauvegardes chiffrées selon la destination, clés conservées séparément et restauration documentée.
- Journal d'audit protégé des modifications ordinaires et accès restreint.
- Collecte minimale, information des personnes, politique de conservation et traitement des demandes d'accès.
- Suppression/anonymisation tenant compte des obligations de conservation des pièces comptables.
- Aucune télémétrie contenant des données associatives activée silencieusement ; diagnostic externe soumis à un choix explicite.

Les durées de conservation doivent être établies par catégorie et vérifiées pour l'association. Prévoir une conservation durable des comptes, livres et justificatifs ; la référence publique consultée indique au moins dix ans pour ces documents financiers. Une politique distincte s'applique aux coordonnées et documents des membres.

## 24. Déploiement, sauvegardes et mises à jour

### 24.1 Distribution

Image(s) Docker versionnée(s), fichier Docker Compose d'exemple, configuration d'environnement documentée, volumes persistants pour base et documents. Éviter la dépendance à une étiquette flottante pour les installations de production.

Le reverse proxy et le nom de domaine sont configurables. Les mises à jour ne doivent pas écraser la marque blanche ou les paramètres.

### 24.2 Sauvegarde

Sauvegarder un ensemble cohérent : base, documents, configuration nécessaire et version du logiciel. Prévoir la cohérence entre base et fichiers pendant une sauvegarde, par instantané ou suspension contrôlée des écritures documentaires.

Fréquence, destination et rétention configurables. Copie hors serveur recommandée. Alertes d'échec et historique des restaurations. Une sauvegarde sans test de restauration n'est pas une preuve de récupération possible.

Objectifs de perte de données acceptable et de délai de remise en service : à décider avec les exploitants.

### 24.3 Mise à jour

Notes de version, contrôle de compatibilité, sauvegarde préalable, migrations et vérification de santé. Toute migration irréversible doit être signalée. Revenir à une ancienne image ne suffit pas à annuler une migration de base.

### 24.4 Passation

Transfert des responsabilités, modification des accès, récupération des sauvegardes et documentation d'exploitation. Les départs du bureau ne suppriment ni l'attribution des écritures ni les décisions historiques.

## 25. Qualité et stratégie de validation

### 25.1 Tests prioritaires

- Calculs décimaux et arrondis.
- Équilibre, contrepassation, numérotation et invariants.
- Concurrence entre validation et clôture.
- Imports OFX réels anonymisés ou fictifs, réimports et doublons légitimes.
- Paiements partiels, groupés, remboursements et virements internes.
- Ventilations analytiques et absence de double comptage budgétaire.
- Permissions et héritage, y compris recherche, documents et exports.
- Workflows activés/désactivés, suppléance et modification de règles.
- Clôture, reports et comparaison N/N−1.
- Sauvegarde et restauration sur une instance vierge.

### 25.2 Jeu de référence

Construire un exercice fictif complet avec cotisations, subvention accordée puis versée, dépenses, dette impayée, virement interne, remboursement, projet pluriannuel et ajustements nécessaires. Les écritures et états attendus sont vérifiés par une personne compétente en comptabilité associative.

### 25.3 Critères d'acceptation représentatifs

| ID | Scénario | Résultat attendu |
| --- | --- | --- |
| CA-01 | Réimport du même OFX | Aucun mouvement dupliqué sans décision explicite |
| CA-02 | Import d'une opération déjà saisie | Proposition de rapprochement ; historique conservé |
| CA-03 | Validation déséquilibrée | Refus sans écriture partiellement enregistrée |
| CA-04 | Validation pendant clôture | Résultat cohérent : opération validée avant fermeture ou refusée |
| CA-05 | Virement entre comptes | Aucun produit ni charge créé |
| CA-06 | Charge sans projet avec obligation active | Validation bloquée, brouillon autorisé |
| CA-07 | Paiement pour deux cotisations | Affectations contrôlées sans duplication de recette |
| CA-08 | Workflow désactivé | Traitement direct soumis aux droits et contrôles comptables |
| CA-09 | Changement de workflow | Les demandes en cours conservent leur version |
| CA-10 | Lecteur d'un seul projet | Aucun accès indu aux autres projets ou pièces |
| CA-11 | Modification d'un tarif | Cotisations déjà émises inchangées |
| CA-12 | Clôture et ouverture suivante | Reports cohérents, aucun double report |
| CA-13 | Export des états | Totaux identiques à l'écran et aux données validées |
| CA-14 | Restauration complète | Données, documents et liens récupérés sur instance vierge |

## 26. Licence MIT et gouvernance open source

- Fichier LICENSE à la racine, titulaire du copyright à identifier.
- README, guide d'installation, mise à jour, sauvegarde et restauration.
- Guide de contribution, politique de sécurité et canal privé de signalement.
- Vérification des licences des dépendances, polices, icônes et modèles distribués.
- Conservation des notices tierces requises ; la licence du projet ne remplace pas celles des composants.
- Données de démonstration fictives ; aucun secret ou document d'association dans le dépôt.
- CI pour contrôles, tests et fabrication des images.
- Politique de versions, migrations et durée de maintenance à définir.
- Personnalisations en configuration afin de limiter les forks nécessaires.

Le nom, le logo et une éventuelle politique de marque nécessitent une décision distincte de la licence du code. La disponibilité du code ne vaut pas engagement de support ou de conformité pour chaque usage.

## 27. Découpage de réalisation proposé

Ces lots définissent un ordre de construction, sans estimation calendaire tant que les arbitrages comptables ne sont pas faits.

| Lot | Livrables | Condition de sortie |
| --- | --- | --- |
| 0 — Conception | Cas métier, référentiel, modèles de rapports, schéma et politique de droits | Cas de référence et décisions prioritaires validés |
| 1 — Socle | Installation, paramètres, identité, accès, audit, documents et sauvegarde | Instance installable et restaurable |
| 2 — Comptes et comptabilité | Comptes, transactions, OFX, moteur, projets minimaux, rapprochement et états | Parcours bancaire complet avec contrôles comptables |
| 3 — Membres | Campagnes, cotisations, affectations et remboursements | Paiements simples, partiels et groupés vérifiés |
| 4 — Projets et financements | Budgets, subventions, documentation et droits détaillés | Suivi projet comptable et documentaire cohérent |
| 5 — Circuits et finition | Workflows configurables, notifications, reprise complète, clôture et durcissement | Exercice complet vérifié et documentation de distribution |

Les interfaces d'héritage des droits, d'analytique et de workflow sont anticipées dans le modèle dès le socle. Les traitements comptables indispensables ne sont pas repoussés à un lot ultérieur si l'association en a besoin pour sa première clôture.

## 28. Risques et mesures de maîtrise

| Risque | Mesure |
| --- | --- |
| Interface simple masquant des erreurs comptables | Invariants, contrôles et jeu de référence vérifié |
| Périmètre trop large | Lots livrables et limites de prise en charge explicites |
| Confusion banque/comptabilité | Modèles séparés et liens contrôlés |
| Historique incomplet | Anomalies visibles, pièces manquantes expliquées et reprise progressive |
| Doublons d'import ou de paiement | Idempotence, contraintes et rapprochement assisté |
| Fuite par héritage de droits | Politique explicite et tests sur toutes les voies d'accès |
| TVA annoncée mais partiellement traitée | Modes disponibles limités aux cas effectivement vérifiés |
| Rapports inadaptés aux financeurs | Modèles distincts et recueil des conventions réelles |
| Perte de données ou mise à jour défaillante | Sauvegardes cohérentes, restauration testée et procédure de migration |
| Dépendance au développeur initial | Documentation, exports et passation |

## 29. Décisions restantes

| Priorité | Question | Orientation proposée |
| --- | --- | --- |
| Avant modèle détaillé | Nom du produit et copyright | À choisir |
| Avant démarrage technique | Validation de NestJS, Fastify, PostgreSQL, Prisma et Angular | Stack proposée, seul Node est confirmé |
| Avant première reprise | Date de création, exercices, comptes, formats et volumes disponibles | Inventaire des sources |
| Avant règles comptables | Dates exactes des exercices de l'association initiale | Indépendantes de la campagne de cotisation |
| Avant module TVA | Régimes et cas pris en charge, déductibilité, déclarations | Définir un périmètre vérifiable |
| Avant première clôture | Matériel, amortissements, subventions conditionnelles et autres ajustements nécessaires | Recenser les cas réels |
| Avant cotisations | Quand l'adhésion devient effective et quand une créance est reconnue | Règles distinctes de l'encaissement |
| Avant droits détaillés | Permissions par défaut, restrictions documentaires et suppléants | Matrice explicite à valider |
| Avant workflows | Types couverts en V1, nombre d'étapes et règles de quorum éventuelles | Circuits simples sans scripts |
| Avant rapports | Modèles attendus par les financeurs et niveau d'annexe | Recueillir demandes et conventions |
| Avant ouverture aux utilisateurs | Politique de conservation, sauvegarde, MFA et reprise après incident | Documenter et tester |
| Avant distribution | Versions maintenues, support, système email et publication des images | Politique publique du projet |

## 30. Configuration initiale de l'association pilote

| Paramètre | Valeur connue |
| --- | --- |
| Installation | Instance dédiée à l'association |
| Historique | Reprise de toutes les opérations depuis la création |
| Cotisations | Campagne commune du 29 septembre au 28 septembre inclus |
| Projet permanent | Fonctionnement de l'association |
| Affectation projet | Obligatoire pour les charges et produits à la validation |
| Membre lié à une transaction | Facultatif |
| Comptes | Plusieurs comptes et caisses possibles |
| Import | OFX et saisie manuelle indispensables |
| Subventions | Oui ; suivi et restitutions nécessaires |
| Fonctions | Président, trésorier et membres du bureau |
| Droits | Globaux et par projet avec héritage |
| Workflow | Optionnel ; activation et règles à définir |
| TVA | Valeur réelle à confirmer ; paramètre configurable |
| Exercice comptable | Dates à confirmer |

## 31. Références de travail

Références consultées lors du cadrage ; vérifier les versions applicables au moment de l'implémentation.

- [Comptabilité associative — Associations.gouv.fr](https://associations.gouv.fr/la-comptabilite-associative)
- [Subventions versées aux associations — Service Public](https://www.service-public.gouv.fr/associations/vosdroits/F3180)
- [Règlement ANC 2018-06 — Autorité des normes comptables](https://www.anc.gouv.fr/reglement-ndeg-2018-06-du-5-decembre-2018)
- [Conservation des documents d'une association — Service Public](https://www.service-public.gouv.fr/particuliers/vosdroits/F32081)
- [Durées de conservation des données — CNIL](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees)
- [Documentation NestJS](https://docs.nestjs.com/)
- [Documentation Prisma](https://www.prisma.io/docs/)
- [Documentation PostgreSQL](https://www.postgresql.org/docs/)

Les obligations ne résultent pas du seul fait de recevoir une subvention. Le montant, la nature des financements, les conventions, l'activité et les statuts doivent être examinés. L'application vise la production d'états fiables ; elle ne remplace ni l'analyse de ces obligations ni la vérification des traitements comptables particuliers.
