export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFileError";
  }
}

export class FileTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Le fichier dépasse la taille maximale autorisée (${Math.round(maxBytes / 1024 / 1024)} Mo).`);
    this.name = "FileTooLargeError";
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document introuvable.");
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentArchivedError extends Error {
  constructor() {
    super("Ce document est archivé : le réactiver avant de le modifier.");
    this.name = "DocumentArchivedError";
  }
}

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}

export class RestrictedAccessError extends Error {
  constructor() {
    super("Vous n'avez pas le droit de modifier le caractère restreint d'un document.");
    this.name = "RestrictedAccessError";
  }
}
