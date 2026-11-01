import type { ProjectStatus } from '../admin/admin-api.service';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PREPARATION: 'En préparation',
  ACTIVE: 'Actif',
  FINISHED: 'Terminé',
  ARCHIVED: 'Archivé',
};
