import { describe, expect, it } from "vitest";
import { clearSessionCookie, parseCookies, serializeSessionCookie, sessionCookieName } from "./cookies.js";

describe("cookies", () => {
  it("utilise le préfixe __Host- uniquement avec Secure", () => {
    expect(sessionCookieName(true)).toBe("__Host-cotiasso_session");
    expect(sessionCookieName(false)).toBe("cotiasso_session");
  });

  it("sérialise un cookie httpOnly, SameSite=Lax, limité à la racine", () => {
    const cookie = serializeSessionCookie("__Host-cotiasso_session", "abc", { secure: true, maxAgeSeconds: 60 });
    expect(cookie).toBe("__Host-cotiasso_session=abc; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60");
  });

  it("omet Secure en développement HTTP", () => {
    expect(serializeSessionCookie("c", "v", { secure: false })).not.toContain("Secure");
  });

  it("expire immédiatement un cookie supprimé", () => {
    expect(clearSessionCookie("c", true)).toContain("Max-Age=0");
  });

  it("lit les cookies d'un en-tête, la première valeur l'emportant", () => {
    expect(parseCookies("a=1; b=deux%20mots; a=2")).toEqual({ a: "1", b: "deux mots" });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("sans-egal; =vide")).toEqual({});
    expect(parseCookies("a=%E0%A4%A; b=ok")).toEqual({ b: "ok" });
  });
});
