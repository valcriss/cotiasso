import { Inject, Injectable } from "@nestjs/common";
import { AuthorizationService } from "../authz/authorization.service.js";
import type { Permission } from "../authz/permissions.js";
import type { MfaStatus } from "./mfa.service.js";
import { MfaService } from "./mfa.service.js";
import type { PublicUser } from "./users.service.js";

export interface SessionResponse {
  user: PublicUser;
  /** Vide tant que le second facteur n'est pas vérifié ou activé : la session est alors partielle. */
  permissions: Permission[];
  mfa: MfaStatus;
  csrfToken: string;
  expiresAt: string;
}

/** Construit la réponse d'ouverture ou de consultation de session, identique pour la connexion, /me et l'installation. */
@Injectable()
export class SessionPresenter {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  async present(
    user: PublicUser,
    session: { csrfToken: string; expiresAt: Date; mfaVerifiedAt: Date | null },
    status?: MfaStatus,
  ): Promise<SessionResponse> {
    const mfa = status ?? (await this.mfa.statusFor(user.id, session.mfaVerifiedAt));
    const permissions = mfa.state === "OK" ? [...(await this.authorization.permissionsFor(user.id))] : [];
    return { user, permissions, mfa, csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() };
  }
}
