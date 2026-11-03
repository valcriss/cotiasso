# Second audit — point de vue d'un·e trésorier·ère sans connaissance comptable

Date : 2 novembre 2026. Fait **après** les parcours simplifiés de l'[ADR 0028](decisions/0028-parcours-simplifies-pour-tresoriers-novices.md).

**Méthode et limites.** Lecture du code des écrans (vue d'ensemble, démarrage, saisie « reçu / dépensé », comptes, transactions, import OFX, membres, campagnes, subventions, installation, 2FA, menu). L'application n'a **pas été lancée** et **aucune personne réelle n'a été observée** : ce qui suit est une hypothèse à confirmer avec le [protocole de test d'usage](test-usage-tresoriers.md). Les points marqués *(à vérifier)* n'ont été lus qu'en partie.

## Ce qui est déjà bien (à ne pas casser)

Deux affichages, « J'ai reçu / J'ai dépensé de l'argent », liste « À faire », statuts en une seule situation par mouvement, erreurs à trois temps, explication des conséquences avant les actions irréversibles, aperçu « Ce que verra l'expert-comptable ».

## A. Priorité haute — ce qui fait perdre ou bloque un novice

1. **Les dates sont en `2026-11-02` partout** (≈ 21 affichages, 43 champs `<input type="date">` natifs, aucun sélecteur de date Material). Un bénévole lit « 02/11/2026 ». → Un pipe/format commun `jj/mm/aaaa` pour tout affichage, et un sélecteur de date français.
2. **Bug probable de date par défaut** : `operation-dialog.ts` propose `new Date().toISOString().slice(0, 10)`, c'est la date **UTC**. Entre minuit et 1 h/2 h (heure de Paris) la saisie se fait « la veille ». → Date locale.
3. **Cotisation = deux parcours disjoints.** « J'ai reçu de l'argent › Cotisation » enregistre l'argent, mais ne dit pas **de qui** ; il faut ensuite aller dans Membres › Campagnes › Règlements. Un trésorier veut un seul geste : « Cotisation de Marie Dupont ». → Quand la catégorie est « Cotisation » (ou « Subvention »), demander **le membre** (ou le financeur) dans la même boîte et rattacher d'office (le mécanisme `auto-book` existe déjà côté API).
4. **L'import bancaire est une impasse pour qui n'a pas d'OFX.** Le bouton dit « Importer un relevé OFX », sans dire ce que c'est ni où le trouver. Les banques proposent souvent CSV/PDF, refusés. → Texte : « Fichier téléchargé depuis le site de votre banque (rubrique *Télécharger / Exporter*, format *OFX* ou *Money*) », avec les 3-4 banques courantes ; message clair si le fichier est d'un autre format ; à terme, import CSV avec choix des colonnes.
5. **Classer 80 lignes importées une par une est le vrai coût du quotidien.** Il existe la sélection + « Classer la sélection », mais pas d'aide à la décision. → **Proposer** (jamais appliquer en silence, cf. ADR 0019) la catégorie utilisée la dernière fois pour un libellé identique, avec un bouton « Accepter les propositions (12) ». Classement **dans la ligne** (liste déroulante) plutôt que boîte de dialogue par mouvement, et enchaînement « classer et passer au suivant ».
6. **Le mot « Transactions » et plusieurs libellés bancaires restent en affichage simple** : « Transactions de … », « Libellé », « Réf. », pastille « Rapprochée du relevé », « Importée », bouton « Rapprocher » et « Solde de relevé » sur la carte du compte (alors que la page s'appelle « Vérification avec la banque »). → « Mouvements », « Description », « Numéro de la banque », « Vérifier avec la banque », « Solde sur mon relevé ».
7. **`Rapports` renvoie vers Paramètres quand rien n'existe** (`income-statement.page.ts` : « Aucun exercice n'est encore créé : créez-le dans Paramètres › Comptabilité ») alors que le chemin simple est l'assistant **Démarrer**. Idem partout où « exercice » reste dans un message (≈ 169 occurrences dans le code web : à passer en revue pour l'affichage simple, « période » ou « année comptable »).
8. **L'assistant « Démarrer » n'est pas dans le menu.** Il n'est atteint que par la carte de la vue d'ensemble ; une fois masquée, impossible de le retrouver, par exemple pour ajouter la caisse. → Entrée de menu (ou lien « Réglages de départ ») tant qu'il reste des étapes, et lien depuis Comptes › « Nouveau compte ».
9. **Installation : le jeton est « dans les journaux du serveur »**, sans la commande. Un bénévole ne sait pas lire des logs Docker. → Afficher sur la page la commande exacte (`docker compose logs api | grep -i jeton`), ou fournir un script `scripts/install-token.sh`, et un lien vers le guide d'installation.

## B. Priorité moyenne — compréhension

10. **Aucune aide contextuelle ni glossaire** : pas une seule icône « ? » ou info-bulle hors menu replié. Mots à définir en un clic : *brouillon, enregistré dans les comptes, période, projet, catégorie, solde, vérifié avec la banque, reliquat, affectation*. → Composant `HelpHint` (icône + court texte) et une page « Aide / Lexique » dans le menu.
11. **Un mot, une chose** : le menu dit « Projets », la saisie dit « Pour quelle activité ? » avec « Fonctionnement général ». Choisir **un** terme (« Activité » me semble plus parlant pour une association ; sinon « Projet » partout).
12. **Le gros chiffre de chaque carte de compte n'a pas de légende.** C'est le solde *calculé d'après vos saisies*, pas forcément celui de la banque. → « Solde d'après vos enregistrements » sous le chiffre ; si l'écart avec le dernier relevé est non nul, le dire en rouge en phrase (« Votre banque indique 120,00 € de plus »).
13. **« Pas encore vérifié » sur chaque compte** peut inquiéter à tort. → Neutre, avec « À quoi ça sert ? » et un bouton « Vérifier maintenant ».
14. **Aperçu d'écriture trop technique** dans la boîte de saisie : « partie double », colonnes Débit/Crédit, numéros de compte. Utile à l'expert, intimidant pour le novice. → Replié par défaut (`<details>` « Voir ce que verra l'expert-comptable »).
15. **Saisie : la date hors période est refusée seulement à l'envoi.** → Avertissement dès le choix de la date (« Cette date est avant le début de votre période : créez-la dans Démarrer »).
16. **Corriger une erreur = annuler puis ressaisir.** Pour un montant faux, un geste unique « Corriger » (annule et rouvre le formulaire prérempli) serait plus naturel.
17. **« Brouillon » vs « Enregistré »** : pour qui n'a pas le droit de comptabiliser, la notion reste floue. → Phrase fixe dans la liste : « En brouillon : en attente de validation par [rôle], rien n'est encore compté ».
18. **Cotisations — vocabulaire** : « campagne », « adhésion effective », trois modes d'adhésion effective (à l'encaissement / à la validation / à la date de début), « dates jamais recalculées ». → « Saison de cotisation », un seul réglage par défaut (« Le membre est à jour dès qu'il a payé »), les autres modes sous « Options avancées ».
19. **Cotisations — gestes manquants** : pas de colonne/filtre **« à jour / en retard »** dans la liste des membres (la question n°1 d'un trésorier) ; inscription **un membre à la fois** (pas de « Renouveler tous les membres actuels » ni de copie de la saison précédente avec ses tarifs) ; la liste « Cotisations restant dues » est un texte, sans modèle de mail de relance ni « copier les adresses ».
20. **Subventions — parcours long** : demandée → à l'étude → accordée/refusée → échéances → versements → dépenses affectées → compte rendu → clôture avec reliquat. → Une **frise d'avancement** en haut de la fiche avec « prochaine étape » en bouton ; créer le financeur **depuis** la boîte de subvention ; une phrase d'exemple sur « affecter une dépense à une subvention ».
21. **Ancre manquante pour l'assemblée générale** : le vrai livrable du trésorier est le rapport financier. → Un bouton « Préparer le dossier de l'assemblée » (compte de résultat, bilan, budget réalisé, liste des subventions) en un fichier à imprimer ; les rapports figés et le PV existent déjà, il manque la porte d'entrée.
22. **Noms des rapports** : « Compte de résultat », « Bilan » *(à vérifier si un sous-titre simple existe)* → « Ce que nous avons gagné et dépensé », « Ce que nous possédons et devons ».

## C. Confort et finitions

23. **Filtres des mouvements** : champs « Du / Au » vides et bouton **Filtrer** obligatoire. → Raccourcis (Ce mois, Ce trimestre, Cette période), filtrage immédiat, filtre « À classer » activé d'office avec compteur (« 14 à classer »).
24. **Pagination « Charger la suite »** sur de longues listes : prévoir recherche plus visible et défilement continu.
25. **Rangée d'actions chargée** (jusqu'à 4 boutons par ligne) : un bouton principal + menu « … ».
26. **Texte d'explication des trois situations toujours affiché** au-dessus du tableau : le réduire après la première lecture (bandeau fermable, mémorisé).
27. **Vue d'ensemble** : ajouter « N mouvements à classer » cliquable, les 5 dernières opérations, les cotisations en retard, et une aide de fin d'année (« Votre période se termine dans 21 jours : voici la marche à suivre »).
28. **États de chargement** : « Chargement… » en texte brut → squelettes ; évite le saut de mise en page.
29. **Téléphone** *(à vérifier)* : le tableau des mouvements a 8 colonnes ; la saisie à la caisse se fait souvent depuis un mobile. → Disposition en cartes sous 600 px.
30. **Pièces justificatives** : on ne peut pas joindre la facture ou le ticket **au moment** de « J'ai dépensé de l'argent » ; il faut passer par Documents. → Champ « Joindre la facture (photo ou PDF) » dans la boîte.
31. **Rôles et droits** *(à vérifier)* : s'assurer que l'écran Rôles affiche des phrases (« Peut enregistrer des opérations ») et non des codes `ressource:action`.

## Plan suggéré

| Lot | Contenu | Effort |
| --- | --- | --- |
| 1 — rapide, sans risque | 1, 2, 6, 7, 8, 9, 11, 12, 13, 14, 15, 23, 26 | petit |
| 2 — gestes du quotidien | 3, 4 (texte), 5, 16, 19, 24, 25, 27, 30 | moyen |
| 3 — aide et parcours | 10, 17, 18, 20, 21, 22, 29 | moyen à gros |
| 4 — à décider | import CSV (4), propositions de catégorie (5, ADR 0019 à amender) | décision de l'utilisateur |

## À faire en parallèle

Dérouler le [test d'usage](test-usage-tresoriers.md) avec 2-3 trésorier·ères : c'est le seul moyen de classer ces points par douleur réelle. Je parie sur 3, 5, 1 et 4 ; une observation pourrait m'infirmer.
