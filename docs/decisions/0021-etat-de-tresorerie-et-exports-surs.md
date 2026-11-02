# ADR 0021 — État de trésorerie et exports sûrs

Statut : retenu (2 novembre 2026, lot 2c.2). Décisions prises en autonomie sur la base des priorités de la [feuille de route](../roadmap.md) ; à faire relire par le trésorier du pilote.

## Décisions

1. **État de trésorerie** : pour chaque compte de classe 5 mouvementé d'un exercice, le **solde de départ** (écritures d'à-nouveaux ou d'ouverture, kind `OPENING` ou journal d'à-nouveaux), les **encaissements** (débits), les **décaissements** (crédits) et le **solde de clôture** (départ + encaissements − décaissements), avec l'exercice précédent en regard (colonne absente s'il n'existe pas). **Même source que les autres états** (CA-13) : lignes des écritures comptabilisées ou contrepassées, ce qui garantit que le total de clôture égale les « disponibilités » du bilan quand les soldes de départ sont reportés. Un virement interne apparaît comme un décaissement d'un compte et un encaissement de l'autre (le total des deux s'annule) : l'état le dit. Droit `reports:view`.
2. **Exports : CSV**, côté serveur, pour les trois états de synthèse et les trois états de lecture (grand livre, balance, livre-journal). Le CSV s'ouvre dans tout tableur ; **aucune dépendance** de génération de classeur n'est ajoutée (surface d'attaque et maintenance). Format : UTF-8 avec marque d'ordre des octets (accents corrects dans Excel), séparateur `;`, décimale `,`, montants **jamais entre guillemets ni en notation scientifique**, fins de ligne `\r\n`, `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
3. **Neutralisation des formules** : toute cellule **texte** (libellés saisis par les utilisateurs, noms de comptes…) commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot est préfixée d'une apostrophe, pour qu'un tableur ne l'interprète jamais comme une formule (injection CSV). Les montants sont des chaînes décimales produites par l'application, formatés à part.
4. **PDF** : par **impression du navigateur** (bouton « Imprimer / enregistrer en PDF » et feuille de style d'impression qui masque la navigation). Aucun moteur PDF embarqué : pas de dépendance, rendu fidèle à l'écran, et le résultat reste le calcul unique. Une génération serveur de PDF pourra suivre si un besoin d'archivage le justifie.
5. **Droits** : les exports d'états de synthèse suivent `reports:view` ; ceux des états de lecture suivent `entries:view` (ils détaillent les écritures). Les mêmes plafonds de taille que les états à l'écran s'appliquent (refus 422 plutôt qu'une troncature silencieuse).
6. **Audit** : `report.exported` (type d'état, exercice) pour chaque export, sans contenu.

## Hors de cette tranche

Classeur `.xlsx` natif, PDF généré côté serveur, export FEC, exports planifiés.
