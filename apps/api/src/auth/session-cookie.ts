import type { FastifyReply } from "fastify";
import type { AppEnv } from "../config/env.js";
import { clearSessionCookie, serializeSessionCookie, sessionCookieName } from "./cookies.js";

/** Pose le cookie de session sur la réponse. */
export function setSessionCookie(reply: FastifyReply, env: AppEnv, token: string): void {
  reply.header(
    "Set-Cookie",
    serializeSessionCookie(sessionCookieName(env.cookieSecure), token, {
      secure: env.cookieSecure,
      maxAgeSeconds: env.session.maxHours * 3600,
    }),
  );
}

export function removeSessionCookie(reply: FastifyReply, env: AppEnv): void {
  reply.header("Set-Cookie", clearSessionCookie(sessionCookieName(env.cookieSecure), env.cookieSecure));
}
