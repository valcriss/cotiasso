# Vérification sur téléphone (ticket #29)

Date : 3 novembre 2026. Méthode : application lancée en local (API + base de démonstration + front), parcourue avec Chromium sans interface à **360 × 740 px** (écran tactile, français), puis relue en captures. Six écrans : vue d'ensemble, comptes et mouvements, saisie « J'ai dépensé de l'argent », membres, aide, dossier de l'assemblée. Il ne remplace pas un essai sur de vrais téléphones.

## Défauts constatés et corrigés

| Écran | Constat | Correction |
| --- | --- | --- |
| Tous | La page entière défilait horizontalement (574 px de large pour 360) : un texte réservé aux lecteurs d'écran, positionné de façon absolue, sortait de la zone qui défile. | `.content { position: relative }` : ces éléments restent dans la zone qui défile. |
| Saisie d'une opération | Les champs Montant et Date, larges de 200 px chacun, ne tenaient pas côte à côte dans une boîte de 312 px et restaient étroits ; les textes d'aide recouvraient le champ suivant. | Sous 600 px, chaque champ prend toute la largeur ; les textes d'aide sous un champ passent à la ligne sans recouvrement (`subscriptSizing: 'dynamic'` par défaut). |
| Carte d'un compte | La carte, large d'au moins 320 px, dépassait de la zone visible : les phrases d'explication étaient coupées. | Largeur minimale `min(320px, 100%)` ; intitulé au-dessus de sa valeur sous 600 px. |
| Vue d'ensemble | La carte « Commençons par préparer votre association » ne disparaissait jamais tant que le mode de démarrage n'avait pas été choisi, alors que ce choix n'est pas obligatoire. | La carte suit la même règle que l'entrée « Démarrer » du menu (`SetupStatus`). |

## Constats sans correction
- Le menu reste une colonne d'icônes de 64 px : lisible, il prend 18 % de la largeur.
- Les champs de date natifs prennent le format du navigateur du téléphone (jj/mm/aaaa en français).
- Les tableaux larges défilent dans la zone de contenu ; une disposition en cartes des mouvements serait un confort de plus, à décider après un essai avec des trésoriers.

## À refaire avec de vrais téléphones
Cibles tactiles (44 px), saisie d'un montant au pouce, appareil photo pour la pièce jointe.
