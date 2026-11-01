import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module.js";
import { DuplicateEmailError, InvalidEmailError, UserNotFoundError, WeakPasswordError } from "../../src/auth/errors.js";
import { UsersService } from "../../src/auth/users.service.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import type { TestingModule } from "@nestjs/testing";

const PASSWORD = "une phrase de passe correcte";

// Les comptes ne se suppriment pas (déclencheur SQL) : chaque test crée une adresse unique.
const uniqueEmail = () => `u-${randomUUID()}@test.invalid`;

describe("UsersService (base réelle)", () => {
  let moduleRef: TestingModule;
  let users: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    await moduleRef.init();
    users = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("crée un utilisateur actif sans exposer le hash", async () => {
    const email = uniqueEmail();
    const user = await users.createUser({ email: `  ${email.toUpperCase()} `, displayName: " Marie ", password: PASSWORD });
    expect(user).toMatchObject({ email, displayName: "Marie", status: "ACTIVE" });
    expect(user).not.toHaveProperty("passwordHash");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
  });

  it("refuse un doublon d'adresse, sans tenir compte de la casse", async () => {
    const email = uniqueEmail();
    await users.createUser({ email, displayName: "A", password: PASSWORD });
    await expect(users.createUser({ email: email.toUpperCase(), displayName: "B", password: PASSWORD })).rejects.toBeInstanceOf(
      DuplicateEmailError,
    );
  });

  it("refuse une adresse invalide et un mot de passe trop faible", async () => {
    await expect(users.createUser({ email: "pas-un-email", displayName: "A", password: PASSWORD })).rejects.toBeInstanceOf(
      InvalidEmailError,
    );
    const error = await users.createUser({ email: uniqueEmail(), displayName: "A", password: "court" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WeakPasswordError);
    expect((error as WeakPasswordError).issues).toContain("TOO_SHORT");
  });

  it("vérifie les identifiants d'un compte actif", async () => {
    const email = uniqueEmail();
    const created = await users.createUser({ email, displayName: "A", password: PASSWORD });
    await expect(users.verifyCredentials(email.toUpperCase(), PASSWORD)).resolves.toMatchObject({ id: created.id });
    await expect(users.verifyCredentials(email, "mauvais mot de passe")).resolves.toBeNull();
    await expect(users.verifyCredentials(uniqueEmail(), PASSWORD)).resolves.toBeNull();
    await expect(users.verifyCredentials("pas-un-email", PASSWORD)).resolves.toBeNull();
  });

  it("refuse la connexion d'un compte désactivé", async () => {
    const email = uniqueEmail();
    const created = await users.createUser({ email, displayName: "A", password: PASSWORD });
    await prisma.user.update({ where: { id: created.id }, data: { status: "DISABLED" } });
    await expect(users.verifyCredentials(email, PASSWORD)).resolves.toBeNull();
  });

  it("change le mot de passe en appliquant la politique", async () => {
    const email = uniqueEmail();
    const created = await users.createUser({ email, displayName: "A", password: PASSWORD });
    await expect(users.setPassword(created.id, "court")).rejects.toBeInstanceOf(WeakPasswordError);
    await users.setPassword(created.id, "un autre mot de passe valide");
    await expect(users.verifyCredentials(email, PASSWORD)).resolves.toBeNull();
    await expect(users.verifyCredentials(email, "un autre mot de passe valide")).resolves.not.toBeNull();
    await expect(users.setPassword(randomUUID(), PASSWORD)).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("garantit en base l'email normalisé, le hash argon2id et l'absence de suppression", async () => {
    const valid = "$argon2id$v=19$m=64,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    await expect(
      prisma.$executeRaw`INSERT INTO "User" ("id","email","displayName","passwordHash","updatedAt") VALUES (gen_random_uuid(), ${"Maj@Test.INVALID"}, 'x', ${valid}, now())`,
    ).rejects.toThrow(/User_email_normalized/);
    await expect(
      prisma.$executeRaw`INSERT INTO "User" ("id","email","displayName","passwordHash","updatedAt") VALUES (gen_random_uuid(), ${uniqueEmail()}, 'x', 'texte-clair', now())`,
    ).rejects.toThrow(/User_passwordHash_argon2id/);

    const created = await users.createUser({ email: uniqueEmail(), displayName: "A", password: PASSWORD });
    await expect(prisma.user.delete({ where: { id: created.id } })).rejects.toThrow(/ne se supprime pas/);
  });
});
