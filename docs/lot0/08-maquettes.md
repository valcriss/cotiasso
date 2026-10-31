# 0.8 — Maquettes (brouillon v0.1)

Direction visuelle retenue au cadrage (§7) : barre latérale bleu très pâle et contenu blanc, icônes avec libellés, menu repliable, thème bleu et blanc, statuts par texte et pictogramme (jamais la couleur seule). Bibliothèque : Angular Material ([ADR 0001](../decisions/0001-stack-technique.md)). Libellés en français, sentence case, verbe à l'infinitif sur les actions.

La maquette visuelle de l'écran 1 a été présentée en conversation ; ce document fixe le contenu de chaque écran et les états à prévoir.

## Principes transverses

- Layout : barre latérale (132–220 px, repliable en icônes avec infobulles) + zone centrale + panneau latéral contextuel à droite.
- Le menu n'affiche que les entrées autorisées ; l'accès par URL reste refusé côté serveur (matrice des droits).
- Exercice actif visible dans l'en-tête des vues comptables.
- Un blocage est toujours expliqué à l'écran (ex. « Projet obligatoire pour comptabiliser »).
- Brouillons conservés ; une action qui échoue ne perd pas la saisie.
- Tableaux navigables au clavier, utilisables sur tablette ; mobile : consultation et tâches courtes.
- Accessibilité : contraste AA, focus visible, statuts avec icône et texte.

## Écran 1 — Compte et traitement d'une transaction

**Zone centrale** : en-tête du compte (nom, solde calculé, dernier solde de relevé avec date, exercice), actions « Importer OFX » et « Ajouter », filtres (période, montant, origine, membre, projet, état), tableau (date, libellé, montant, statut).

**Statuts affichés** (dimensions séparées) : présente sur relevé · à qualifier · partiellement comptabilisée · comptabilisée · rapprochée.

**Panneau latéral** (sans quitter la liste) : membre facultatif, projet (ou ventilation multi-projets avec contrôle du total), proposition comptable modifiable, justificatifs, liens comptables, historique.

**Actions** : « Enregistrer le brouillon » ; « Comptabiliser » (bloqué avec raison si projet manquant, exercice clos ou droit absent).

**États à maquetter** : liste vide, import en cours, doublon probable, transaction déjà comptabilisée (champs financiers verrouillés), erreur de validation.

## Écran 2 — Import OFX

Étapes : 1 dépôt du fichier (format et taille contrôlés) · 2 compte cible et période détectés · 3 analyse sans écriture : trois groupes **Nouvelles**, **Doublons probables**, **Rapprochements proposés**, plus **Erreurs** · 4 choix ligne par ligne (importer, ignorer, rapprocher) · 5 confirmation et compte rendu.

Règles visibles : un fichier déjà importé est signalé ; aucun doublon n'est écarté sans décision ; une variante OFX non prise en charge est refusée avec le motif.

## Écran 3 — Validation d'une écriture

Vue de l'écriture : exercice, journal, date, libellé, référence, lignes (compte, débit, crédit, tiers, projet). Totaux débit/crédit et indicateur d'équilibre en direct. Panneau : pièces liées, lien avec la transaction, historique.

Actions : « Comptabiliser » (numéro attribué à la validation), « Contrepasser » sur une écriture validée (motif obligatoire), jamais « Modifier ». Blocages expliqués : déséquilibre, exercice clos ou en clôture, projet manquant, compte inactif.

## Écran 4 — Paramètres et modules

Sections : Association, Apparence, Comptabilité (exercices, plan, journaux), TVA, Cotisations, Projets, Utilisateurs et rôles, Workflows, Modules, Notifications, Exploitation.

**Modules** : carte par module (immobilisations, constatés d'avance, factures non parvenues, fonds dédiés, modes de TVA) avec état : **actif** · **inactif** · **indisponible** (motif : non livré, non validé ou prérequis manquant). Activation avec date d'effet et confirmation ; désactivation refusée avec explication si des données en dépendent.

## Écrans à maquetter ensuite

Accès effectifs d'un utilisateur · fiche membre et campagne de cotisation · fiche projet (budget, financements, documents) · rapprochement bancaire · clôture d'exercice · assistant initial.

## À valider

0. **Tranché (31 octobre 2026)** : le panneau latéral est la zone de traitement des transactions. Les écrans 1, 2 et 3 ont été maquettés visuellement en conversation.
1. ~~Panneau latéral ou page de détail ?~~ Panneau latéral retenu.
2. Niveau de détail du solde : afficher solde calculé et dernier solde de relevé côte à côte ?
3. Mobile : quelles tâches doivent rester possibles (consultation, dépôt de pièce, demande de dépense) ?
4. Ordre de maquettage des écrans restants.
