# ADR 0023 — Membres, adhésions et cotisations

Statut : retenu (2 novembre 2026, lot 3). Applique le cadrage §13 et les ADR [0002](0002-modules-activables-et-regles-comptables.md) (cotisations : produit constaté à l'encaissement, **aucune créance comptable**) et [0004](0004-adhesion-effective-et-nom-de-travail.md) (trois modes d'adhésion effective). Décisions prises en autonomie sur la base des priorités de la [feuille de route](../roadmap.md) ; livré en trois tranches (3.1 membres, 3.2 campagnes et adhésions, 3.3 règlements).

## Décisions

### Tranche 3.1 — Membres

1. **Membre** (`Member`) : prénom, nom, coordonnées facultatives (email, téléphone, adresse), **catégorie** (liste configurable, `MemberCategory`), statut **actif** ou **sorti**, dates d'entrée et de sortie, note, lien **facultatif** avec un compte de connexion (`userId`, unique) : un membre n'a pas besoin d'un compte. **Jamais supprimé** (déclencheur SQL) : l'historique comptable et les adhésions s'y réfèrent.
2. **Données minimales** : seuls le prénom et le nom sont obligatoires. Un **email** n'existe qu'une fois parmi les membres non anonymisés (doublon refusé avec explication).
3. **Sortie et oubli** : un membre **sorti** (date de sortie) reste consultable ; il peut ensuite être **anonymisé** (prénom et nom remplacés par « Ancien membre », coordonnées et note effacées) : irréversible, réservé aux membres sortis, motif obligatoire, audité. Son historique d'adhésions et de règlements est conservé.
4. **Fonctions et mandats** (`MemberOffice`) : intitulé libre (Président, Trésorier, Secrétaire… avec suggestions), date de début, date de fin facultative, note ; les mandats en cours se voient sur la fiche et dans la liste. Un mandat se termine (date de fin) ou se corrige ; il ne dépend d'aucun droit d'accès (les droits restent dans les rôles).
5. **Droits** : consulter `members:view`, gérer `members:manage`. Chaque modification est auditée sans recopier les données personnelles (champs modifiés seulement).

### Tranche 3.2 — Campagnes, tarifs et adhésions

6. **Campagne** (`Campaign`) : dates **explicites** (pour l'association pilote : du 29/09 au 28/09 de l'année suivante, saisies, jamais calculées), sans chevauchement (contrainte SQL), **mode d'adhésion effective figé à la création** (`PAYMENT`, `VALIDATION` ou `START_DATE`, valeur par défaut tirée des paramètres de l'association) : changer le réglage ne touche pas les campagnes existantes.
7. **Tarifs** (`Tariff`) d'une campagne : libellé, montant, catégorie de membre facultative ; plusieurs tarifs, exonération possible (montant nul avec motif).
8. **Adhésion** (`Membership`) : un membre, une campagne, un tarif ; **montant attendu** figé à la création (le tarif peut changer ensuite) ; **une seule adhésion non annulée par membre et campagne** (index partiel). États : **en attente**, **effective** (date d'effet et **origine** conservées : règlement, validation ou date de début), **annulée** (motif obligatoire). Une adhésion tardive **ne déplace pas la fin** de campagne. L'état « effective » est **indépendant de la comptabilisation** et ne crée **aucune écriture ni créance** (CA-11).
9. **Validation** (mode `VALIDATION`) : action explicite d'un utilisateur `members:manage` ; le mode `START_DATE` rend l'adhésion effective à la création, à la date de début de campagne (ou à la date saisie si elle est postérieure).

### Tranche 3.3 — Règlements

10. **Affectation de règlement** (`PaymentAllocation`) : rattache une part d'une **transaction** à une adhésion. Elle est distincte du rapprochement bancaire et du lettrage (cadrage §13.3) et **ne crée aucune écriture** : la transaction se comptabilise normalement (produit à l'encaissement, compte de cotisations). Garanties en SQL : montant strictement positif ; pour une transaction d'**encaissement**, la somme des affectations actives **ne dépasse jamais** son montant ; un **remboursement** (affectation de type `REFUND`) se rattache à un **décaissement** et ne dépasse pas non plus son montant ; une affectation ne se modifie pas, elle s'**annule avec un motif** (historique conservé).
11. **Cas couverts** : paiement **partiel** (plusieurs affectations pour une adhésion), paiement **groupé** (une transaction répartie entre plusieurs adhésions, y compris pour d'autres membres que le payeur), **trop-perçu** (affecté au-delà de l'attendu : signalé « à rembourser ou à imputer », jamais masqué), **remboursement** et **annulation motivée**.
12. **Adhésion effective à l'encaissement** (mode `PAYMENT`) : devient effective quand les règlements nets **couvrent** le montant attendu, à la date du règlement qui la complète ; si une annulation fait repasser sous le montant attendu, elle redevient en attente (si son origine était un règlement). Une adhésion exonérée (attendu nul) est effective à la création.
13. **Rappels et reçus** : la liste des **cotisations restant dues** d'une campagne (avec export CSV sûr) tient lieu de rappel ; un **reçu simple** imprimable récapitule les règlements d'une adhésion et **précise qu'il n'est pas un reçu fiscal** (les reçus fiscaux restent une fonction à cadrer séparément).
14. **Audit** : `member.*`, `campaign.*`, `membership.*`, `payment.allocated`, `payment.allocation-cancelled`.

## Hors de cette tranche

Reçus fiscaux, adhésion individuelle de durée définie (autre mode que la campagne commune), prorata automatique, lien membre ↔ transaction hors règlement, tiers sur les lignes d'écriture, workflow de validation par le bureau (lot 5), relances par email (lot 5.3).
