export class LastAdministratorError extends Error {
  constructor() {
    super("Cette action retirerait le dernier compte actif pouvant administrer les utilisateurs.");
    this.name = "LastAdministratorError";
  }
}

export class RoleNotFoundError extends Error {
  constructor() {
    super("Rôle introuvable.");
    this.name = "RoleNotFoundError";
  }
}

export class AssignmentNotFoundError extends Error {
  constructor() {
    super("Attribution introuvable.");
    this.name = "AssignmentNotFoundError";
  }
}

export class DuplicateRoleError extends Error {
  constructor() {
    super("Un rôle existe déjà avec cette clé.");
    this.name = "DuplicateRoleError";
  }
}

export class InvalidRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRoleError";
  }
}
