import { SetMetadata } from "@nestjs/common";

export const ALLOW_PARTIAL_SESSION = "allowPartialSession";

/**
 * Autorise une route pour une session dont le second facteur n'est pas encore vérifié ou activé
 * (état de la session, profil, vérification, inscription). Toute autre route est refusée tant que la session n'est pas complète.
 */
export const AllowPartialSession = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_PARTIAL_SESSION, true);
