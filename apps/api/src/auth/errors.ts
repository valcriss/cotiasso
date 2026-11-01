import type { PasswordIssue } from "./password-policy.js";

export class InvalidEmailError extends Error {
  constructor() {
    super("Adresse email invalide.");
    this.name = "InvalidEmailError";
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("Un compte existe déjà avec cette adresse email.");
    this.name = "DuplicateEmailError";
  }
}

export class WeakPasswordError extends Error {
  constructor(readonly issues: PasswordIssue[]) {
    super(`Mot de passe refusé : ${issues.join(", ")}.`);
    this.name = "WeakPasswordError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("Utilisateur introuvable.");
    this.name = "UserNotFoundError";
  }
}

export class InvalidSetupTokenError extends Error {
  constructor() {
    super("Jeton d'installation invalide.");
    this.name = "InvalidSetupTokenError";
  }
}

export class AlreadySetUpError extends Error {
  constructor() {
    super("L'installation est déjà initialisée.");
    this.name = "AlreadySetUpError";
  }
}

export class InvalidPasswordTokenError extends Error {
  constructor() {
    super("Lien invalide ou expiré.");
    this.name = "InvalidPasswordTokenError";
  }
}

export class WrongCurrentPasswordError extends Error {
  constructor() {
    super("Le mot de passe actuel est incorrect.");
    this.name = "WrongCurrentPasswordError";
  }
}

export class SelfDisableError extends Error {
  constructor() {
    super("Vous ne pouvez pas désactiver votre propre compte.");
    this.name = "SelfDisableError";
  }
}

export class InvalidMfaCodeError extends Error {
  constructor() {
    super("Code invalide ou expiré.");
    this.name = "InvalidMfaCodeError";
  }
}

export class MfaAlreadyEnabledError extends Error {
  constructor() {
    super("L'authentification à deux facteurs est déjà activée.");
    this.name = "MfaAlreadyEnabledError";
  }
}

export class MfaNotPendingError extends Error {
  constructor() {
    super("Aucune activation de l'authentification à deux facteurs n'est en cours.");
    this.name = "MfaNotPendingError";
  }
}

export class MfaRequiredByRoleError extends Error {
  constructor() {
    super("Un de vos rôles exige l'authentification à deux facteurs : elle ne peut pas être désactivée.");
    this.name = "MfaRequiredByRoleError";
  }
}
