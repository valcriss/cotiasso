/** Erreurs des clés d'accès : chaque message dit ce qui s'est passé, pourquoi et que faire (ADR 0036). */

export class PasskeysUnavailableError extends Error {
  constructor(message = "Les clés d'accès ne sont pas activées pour cette association. Un administrateur peut les activer dans Paramètres › Sécurité.") {
    super(message);
    this.name = "PasskeysUnavailableError";
  }
}

export class InvalidPasskeyChallengeError extends Error {
  constructor() {
    super("La demande a expiré ou a déjà servi. Chaque tentative ne dure que quelques minutes, par sécurité. Recommencez depuis le début.");
    this.name = "InvalidPasskeyChallengeError";
  }
}

export class InvalidPasskeyResponseError extends Error {
  constructor(message = "La clé d'accès n'a pas pu être vérifiée. Elle est peut-être inconnue, retirée ou liée à une autre adresse du site. Essayez une autre clé, ou utilisez votre mot de passe.") {
    super(message);
    this.name = "InvalidPasskeyResponseError";
  }
}

export class PasskeyEmailRequiredError extends Error {
  constructor() {
    super("Saisissez d'abord votre adresse email. L'association demande de l'indiquer avant d'utiliser une clé d'accès.");
    this.name = "PasskeyEmailRequiredError";
  }
}

export class NoUsablePasskeyError extends Error {
  constructor() {
    super("Aucune clé d'accès utilisable n'est enregistrée pour votre compte. Utilisez votre code de secours ou votre application d'authentification.");
    this.name = "NoUsablePasskeyError";
  }
}

export class PasskeyAlreadyRegisteredError extends Error {
  constructor() {
    super("Cet appareil a déjà une clé d'accès pour votre compte. Il est inutile d'en ajouter une seconde : utilisez celle-ci, ou retirez-la d'abord.");
    this.name = "PasskeyAlreadyRegisteredError";
  }
}

export class PasskeyNotFoundError extends Error {
  constructor() {
    super("Cette clé d'accès est introuvable. Elle a peut-être déjà été retirée. Rechargez la page.");
    this.name = "PasskeyNotFoundError";
  }
}

export class LastSecondFactorError extends Error {
  constructor() {
    super("C'est votre seule protection en deux étapes, et l'un de vos rôles l'exige. La retirer vous empêcherait de vous connecter. Ajoutez d'abord une autre clé d'accès ou activez un code, puis recommencez.");
    this.name = "LastSecondFactorError";
  }
}

export class UserVerificationMissingError extends Error {
  constructor() {
    super("L'appareil n'a pas confirmé que c'est bien vous (empreinte, visage ou code). Par sécurité, l'application l'exige. Recommencez en déverrouillant l'appareil, ou utilisez une clé de sécurité protégée par un code PIN.");
    this.name = "UserVerificationMissingError";
  }
}
