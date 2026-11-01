export interface AccountingIssue {
  path: string;
  message: string;
}

export class AccountingValidationError extends Error {
  constructor(readonly issues: AccountingIssue[]) {
    super("Données comptables invalides.");
    this.name = "AccountingValidationError";
  }
}

export class AccountingNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} introuvable.`);
    this.name = "AccountingNotFoundError";
  }
}

/** Conflit métier : doublon, chevauchement, exercice qui n'est plus modifiable. */
export class AccountingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingConflictError";
  }
}
