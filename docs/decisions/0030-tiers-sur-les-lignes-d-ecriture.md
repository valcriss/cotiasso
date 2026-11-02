# ADR 0030 — Tiers sur les lignes d'écriture

Statut : retenu (3 novembre 2026), décisions prises avec l'utilisateur avant la réalisation (élément 2.2 de la feuille de route, cadrage §11.1 : « chaque ligne possède un compte, un débit ou crédit et, lorsque nécessaire, un tiers »). **À relire** par un expert-comptable pour les comptes de tiers. Complète l'[ADR 0010](0010-ecritures-comptabilisation-et-contrepassation.md) (écritures), l'[ADR 0011](0011-cloture-exercice-et-a-nouveaux.md) (à-nouveaux) et l'[ADR 0029](0029-situation-d-ouverture-mode-de-demarrage.md) (situation d'ouverture).

## Décisions

1. **Un tiers = la personne ou l'organisme concerné par une ligne.** Table `ThirdParty` : type `MEMBER` (fiche liée à un adhérent), `FUNDER` (liée à un financeur), `SUPPLIER` ou `OTHER` (nom propre). Un adhérent ou un financeur n'a **qu'une** fiche tiers (index unique) ; créer le tiers d'un adhérent déjà désigné renvoie la fiche existante. Un fournisseur ou autre tiers a un **nom unique sans tenir compte de la casse** (index en base) : le doublon est refusé avec « choisissez-le plutôt ».
2. **Le nom d'un adhérent ou d'un financeur est lu en direct**, jamais recopié : renommer un financeur se répercute, et **un membre anonymisé devient « Ancien membre »** partout où il est cité comme tiers (RGPD, ADR 0023). Une personne anonymisée ne peut plus être désignée.
3. **Jamais supprimé, archivé définitivement** (comme un financeur ou un projet) : déclencheur SQL — pas de `DELETE`, ni changement de type ou de lien, ni réactivation ; `TRUNCATE` refusé ; contrainte de cohérence type/liens. Un tiers archivé reste lisible dans les écritures déjà saisies mais n'est plus proposé ni accepté sur un brouillon.
4. **Facultatif partout, jamais une règle de comptabilisation.** `JournalLine.thirdPartyId` (clé étrangère `RESTRICT`) peut être renseigné sur n'importe quelle ligne, mais **aucune obligation SQL n'est ajoutée à la comptabilisation** : l'existant n'est pas bloqué et un novice n'est pas arrêté. Le tiers d'une ligne comptabilisée est **immuable** avec la ligne (garde existant) ; la contrepassation **reprend** le tiers. Sur un brouillon, le tiers doit exister et ne pas être archivé (409 lisible).
5. **Exigé là où on le demande déjà** : dans la **situation d'ouverture** (ADR 0029), chaque ligne « on vous doit / vous devez » désigne un tiers — une fiche existante, ou un nom saisi (la fiche est alors créée, ou retrouvée par son nom, **dans la même transaction** que l'écriture ; fournisseur pour « facture reçue, pas encore payée », « autre » sinon). Sans tiers ni nom : 400.
6. **Le suivi par personne survit à la clôture.** L'écriture d'à-nouveaux (ADR 0011) reporte désormais **une ligne par compte et par tiers** pour les classes 1 à 5 (plus une ligne pour la part sans tiers), de sorte que les soldes par personne d'un exercice clôturé se retrouvent à l'identique dans le suivant. Le résultat reporté s'ajoute à la part sans tiers du compte choisi ; l'aperçu de clôture compte les **comptes** reportés (pas les lignes).
7. **Soldes par tiers : lecture seule tirée des écritures.** `GET /reports/third-parties[?fiscalYearId=]` (`entries:view`, exercice ouvert le plus récent par défaut) : par tiers, sur les comptes de classe 4 de l'exercice (écritures comptabilisées **et** contrepassées, jamais un brouillon), « elle vous doit » (solde débiteur) ou « vous lui devez » (solde créditeur), détail par compte, totaux ; les lignes de classe 4 **sans tiers** sont comptées à part, **hors du tableau** ; `carryWarning` si l'exercice précédent n'est pas clôturé (soldes non reportés, comme le bilan, ADR 0020). Les soldes nuls ne sont pas listés. Aucun solde n'est stocké.
8. **Lettrage hors lot.** Solder une créance par son encaissement (rapprocher l'écriture d'un règlement et celle de la créance) reste un mécanisme distinct, à venir ; ce lot ne le fait pas.
9. **Droits** : lecture `entries:view` ; création `entries:create` (on crée un tiers en saisissant) ; corriger le nom ou la note d'un fournisseur et archiver `settings.accounting:admin`. Aucune permission nouvelle. **Un tiers de type adhérent montre le nom de la personne à toute personne qui lit les écritures** (l'expert-comptable en a besoin) : choix explicite, à relire avec la politique de données personnelles.
10. **Avertissement dans la progression** (ADR 0027) : `THIRD_PARTY_MISSING` (« à vérifier », jamais bloquant) compte, par exercice, les lignes comptabilisées de classe 4 sans tiers et renvoie vers l'écran Tiers.
11. **Audit** : `third-party.created`, `third-party.updated`, `third-party.archived`, sans donnée personnelle (le type seulement).

## Web

- Éditeur d'écriture : colonne « Qui ? » sur les lignes de comptes de tiers (classe 4) et celles qui ont déjà un tiers ; bouton « Ajouter un tiers » (boîte `third-party-dialog.ts` : fournisseur, autre, adhérent ou financeur à choisir dans leur liste, sans ressaisie) ; l'écriture comptabilisée affiche le nom.
- Onglet **Tiers** de la Comptabilité (`accounting/third-parties.page.ts`) : « elle vous doit / vous lui devez » par personne et par exercice, avertissement de report, lignes sans tiers signalées, liste de tous les tiers avec archivage confirmé (« cela ne se défait pas »).
- Situation de départ : pour chaque ligne, choix d'une fiche existante ou d'un nom à créer.

## Hors de ce lot

- Lettrage des créances et des dettes ; relances automatiques ; export CSV des soldes par tiers (le CSV sûr existe, ADR 0021, à brancher).
- Tiers obligatoire sur les comptes de classe 4 (rejeté par la décision : trop contraignant pour un novice et pour l'existant).
- Tiers sur les mouvements bancaires et dans la saisie guidée « J'ai reçu / J'ai dépensé de l'argent ».
- Fusion de deux tiers (doublon créé par erreur) : non faite ; on archive le doublon.
