import type { BudgetLineKind, BudgetStatus, ProjectStatus } from '../admin/admin-api.service';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PREPARATION: 'En préparation',
  ACTIVE: 'Actif',
  FINISHED: 'Terminé',
  ARCHIVED: 'Archivé',
};

export const BUDGET_KIND_LABELS: Record<BudgetLineKind, string> = {
  CHARGE: 'Dépense prévue (charge)',
  PRODUCT: 'Recette prévue (produit)',
};

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  DRAFT: 'En préparation',
  APPROVED: 'En vigueur',
  SUPERSEDED: 'Remplacé',
};
