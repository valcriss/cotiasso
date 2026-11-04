import type { ReimbursementDecision, ReimbursementStatus } from './reimbursements-api';

/** États d'une demande en mots courants (design.md : parler simple). */
export const STATUS_LABELS: Record<ReimbursementStatus, string> = {
  DRAFT: 'Brouillon, pas encore déposée',
  IN_CIRCUIT: 'En cours d’examen',
  RETURNED: 'À corriger',
  REFUSED: 'Refusée',
  CANCELLED: 'Annulée',
  PAID: 'Remboursée',
};

/** Ce que raconte une décision dans l'historique. */
export function decisionText(decision: ReimbursementDecision, stepLabel: string): string {
  const who = decision.actorName ?? 'Quelqu’un';
  switch (decision.outcome) {
    case 'APPROVED':
      return `${who} a donné son accord (${stepLabel}).`;
    case 'AUTO_APPROVED':
      return `Étape « ${stepLabel} » validée d’office : ${who} est habilité·e à la valider.`;
    case 'REFUSED':
      return `${who} a refusé la demande.`;
    case 'RETURNED':
      return `${who} a renvoyé la demande pour correction.`;
    case 'PROCESSED':
      return `${who} a remboursé la demande.`;
    case 'CANCELLED':
      return `${who} a annulé la demande.`;
  }
}

/** Montant à l'affichage : « 42,50 € ». */
export function euros(value: string): string {
  return `${value.replace('.', ',')} €`;
}
