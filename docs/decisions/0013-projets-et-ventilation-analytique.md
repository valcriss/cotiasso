# ADR 0013 — Projets et ventilation analytique

Statut : retenu (1er novembre 2026, lot 2a.4). Applique le cadrage §14, le modèle de données §5 et CA-06.

## Décisions

1. **Projet** : code unique et définitif (`^[A-Z0-9-]{1,20}$`), nom, objet, état (préparation, actif, terminé, archivé), dates, responsable facultatif. Un projet ne se supprime jamais (déclencheur), il s'archive ; un projet archivé ne reçoit plus de ventilation, un projet terminé en reçoit encore (une correction reste possible après la fin).
2. **Projet permanent** « Fonctionnement de l'association » : créé par la migration, **unique** (index partiel), toujours actif, son code et son caractère permanent sont figés. Il reçoit les opérations générales.
3. **Ventilation analytique** (`AnalyticalAllocation`) : une ligne de **charge ou de produit** (comptes des classes 6 et 7, à l'exclusion de toute autre) se ventile entre un ou plusieurs projets, en parts positives, un projet une seule fois par ligne. Pas de ventilation forcée sur les lignes de trésorerie ni sur les virements.
4. **À la comptabilisation (base)** : si une ligne est ventilée, le total des parts **égale** son montant ; sinon elle est refusée. Si l'**obligation de projet** est active, une ligne de charge ou de produit sans ventilation est refusée (CA-06) ; **un brouillon reste toujours possible**. La règle est lue par la base (`accounting_project_required()`), la valeur par défaut est « obligatoire » (configuration initiale du cadrage).
5. **Paramètre** `accounting.projectRequired`, versionné comme les autres paramètres, modifiable sous `settings.accounting:admin` (`PUT /accounting/settings`) ; la rubrique ne passe pas par l'API générique des paramètres, qui ne porte que les droits d'association.
6. **Immuabilité** : la ventilation d'une écriture comptabilisée ne se modifie plus. La **contrepassation reprend la ventilation** de l'originale dans l'autre sens : par projet, l'original et sa contrepassation s'annulent. Une correction analytique après comptabilisation passe par la contrepassation (la « correction analytique contrôlée » dédiée du cadrage est à venir).
7. **Synthèse par projet** (`GET /projects/:id/summary`) : charges (classe 6, débits moins crédits) et produits (classe 7, crédits moins débits) ventilés sur le projet, par exercice et au total ; résultat = produits − charges. Mêmes lignes comptabilisées que le grand livre, aucune seconde source de calcul.
8. **Droits** : lecture `projects:view`, modification `projects:update`, **portée globale** pour l'instant.

## Hors de cette tranche

- **Portée projet des droits** (responsable de projet, contributeur, lecteur limités à leurs projets, agrégats filtrés par portée) : nécessite des attributions de rôle à portée dans le moteur de droits (ADR 0008) ; tranche à part.
- **Tiers** (`thirdPartyId` sur les lignes) : dépend des membres, financeurs et fournisseurs (lots 3 et suivants) ; reporté avec eux.
- Participants et budgets de projet (lots 4 et suivants), correction analytique dédiée.
