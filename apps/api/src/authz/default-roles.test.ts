import { describe, expect, it } from "vitest";
import { ADMIN_ROLE_KEY, DEFAULT_ROLES, LOCKOUT_PERMISSION } from "./default-roles.js";
import { ALL_PERMISSIONS, isPermission } from "./permissions.js";

const role = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!;
const has = (key: string, permission: (typeof ALL_PERMISSIONS)[number]) => role(key).permissions.includes(permission);

describe("rôles par défaut (matrice des droits v0.2)", () => {
  it("n'utilise que des permissions du catalogue, sans doublon, et des clés uniques", () => {
    expect(new Set(DEFAULT_ROLES.map((r) => r.key)).size).toBe(DEFAULT_ROLES.length);
    for (const r of DEFAULT_ROLES) {
      expect(r.permissions.every(isPermission)).toBe(true);
      expect(new Set(r.permissions).size).toBe(r.permissions.length);
      expect(r.key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("donne l'administration des utilisateurs à l'administrateur technique", () => {
    expect(has(ADMIN_ROLE_KEY, LOCKOUT_PERMISSION)).toBe(true);
  });

  it("ne donne aucun droit métier à l'administrateur technique", () => {
    const business = ["entries:post", "entries:create", "fiscal-years:close", "transactions:manage", "members:manage"] as const;
    for (const permission of business) expect(has(ADMIN_ROLE_KEY, permission)).toBe(false);
  });

  it("ne donne pas au président le droit de modifier ou clôturer la comptabilité", () => {
    for (const permission of ["entries:create", "entries:post", "fiscal-years:close", "settings.accounting:admin"] as const) {
      expect(has("president", permission)).toBe(false);
    }
  });

  it("réserve la comptabilisation, la clôture et les exports de rapports au trésorier", () => {
    for (const permission of ["entries:post", "fiscal-years:close", "reports:export"] as const) {
      expect(has("treasurer", permission)).toBe(true);
      for (const other of DEFAULT_ROLES.filter((r) => r.key !== "treasurer")) {
        expect(other.permissions).not.toContain(permission);
      }
    }
  });

  it("n'attribue l'export complet des données à aucun rôle par défaut", () => {
    for (const r of DEFAULT_ROLES) expect(r.permissions).not.toContain("data:export");
  });

  it("limite le lecteur aux synthèses de projet et aux documents", () => {
    expect(role("reader").permissions.toSorted()).toEqual(["documents:view", "projects:view"]);
  });
});
