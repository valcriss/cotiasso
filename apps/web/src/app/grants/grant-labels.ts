import type { FunderType, GrantResidual, GrantStatus } from '../admin/admin-api.service';

export const GRANT_STATUS_LABELS: Record<GrantStatus, string> = {
  REQUESTED: 'Demandée',
  UNDER_REVIEW: 'En instruction',
  GRANTED: 'Accordée',
  REFUSED: 'Refusée',
  CLOSED: 'Clôturée',
  CANCELLED: 'Annulée',
};

export const FUNDER_TYPE_LABELS: Record<FunderType, string> = {
  LOCAL_AUTHORITY: 'Collectivité',
  STATE: 'État',
  FOUNDATION: 'Fondation',
  COMPANY: 'Entreprise',
  OTHER: 'Autre',
};

export const RESIDUAL_LABELS: Record<GrantResidual, string> = {
  REFUND: 'À rembourser au financeur',
  KEPT_WITH_AGREEMENT: 'Conservé avec l’accord du financeur',
  NONE: 'Aucun reliquat',
};
