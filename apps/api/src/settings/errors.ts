export interface SettingsIssue {
  path: string;
  message: string;
}

export class SettingsValidationError extends Error {
  constructor(readonly issues: SettingsIssue[]) {
    super("Paramètres invalides.");
    this.name = "SettingsValidationError";
  }
}

export class ModuleNotFoundError extends Error {
  constructor() {
    super("Module introuvable.");
    this.name = "ModuleNotFoundError";
  }
}

export class ModuleUnavailableError extends Error {
  constructor(reason: string) {
    super(`Module indisponible. ${reason}`.trim());
    this.name = "ModuleUnavailableError";
  }
}

export class ModuleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleStateError";
  }
}
