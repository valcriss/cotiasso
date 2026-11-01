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
