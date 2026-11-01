import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, UserStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { normalizeEmail } from "./email.js";
import { DuplicateEmailError, InvalidEmailError, UserNotFoundError, WeakPasswordError } from "./errors.js";
import { hashPassword, verifyPassword } from "./password-hasher.js";
import { checkPasswordPolicy } from "./password-policy.js";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  createdAt: Date;
}

/** Client Prisma ou transaction : permet de créer un utilisateur dans une transaction plus large. */
export type UserWriter = Pick<Prisma.TransactionClient, "user">;

export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
}

const PUBLIC_FIELDS = { id: true, email: true, displayName: true, status: true, createdAt: true } as const;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

@Injectable()
export class UsersService {
  /** Hash factice vérifié quand le compte n'existe pas, pour ne pas révéler son existence par le temps de réponse. */
  private dummyHash?: Promise<string>;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createUser(input: CreateUserInput, db: UserWriter = this.prisma): Promise<PublicUser> {
    const email = normalizeEmail(input.email);
    if (!email) throw new InvalidEmailError();

    const issues = checkPasswordPolicy(input.password, { email });
    if (issues.length > 0) throw new WeakPasswordError(issues);

    const passwordHash = await hashPassword(input.password);
    try {
      return await db.user.create({
        data: { email, displayName: input.displayName.trim(), passwordHash },
        select: PUBLIC_FIELDS,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateEmailError();
      throw error;
    }
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    return this.prisma.user.findUnique({ where: { email: normalized }, select: PUBLIC_FIELDS });
  }

  /** Renvoie l'utilisateur si l'email et le mot de passe correspondent à un compte actif, sinon null. */
  async verifyCredentials(email: string, password: string): Promise<PublicUser | null> {
    const normalized = normalizeEmail(email);
    const user = normalized ? await this.prisma.user.findUnique({ where: { email: normalized } }) : null;

    if (!user) {
      await verifyPassword(password, await this.getDummyHash());
      return null;
    }

    const result = await verifyPassword(password, user.passwordHash);
    if (!result.valid || user.status !== "ACTIVE") return null;

    if (result.needsRehash) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), version: { increment: 1 } },
      });
    }
    const { passwordHash: _omitted, updatedAt: _updatedAt, version: _version, ...publicUser } = user;
    return publicUser;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new UserNotFoundError();

    const issues = checkPasswordPolicy(password, { email: user.email });
    if (issues.length > 0) throw new WeakPasswordError(issues);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), version: { increment: 1 } },
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword("mot de passe factice pour égaliser les temps");
    return this.dummyHash;
  }
}
