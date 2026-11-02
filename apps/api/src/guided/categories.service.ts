import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError, AccountingNotFoundError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TEMPLATE_ACCOUNTS, TEMPLATE_CATEGORIES } from "./starter-template.js";

const label = z.string().trim().min(1, "Nom obligatoire.").max(80, "Nom trop long (80 caractères).");
const hint = z.string().trim().max(200, "Aide trop longue (200 caractères).");

const categoryInput = z
  .object({ direction: z.enum(["IN", "OUT"]), label, hint: hint.default(""), accountId: z.uuid("Compte invalide.") })
  .strict();
const categoryPatch = z
  .object({ label: label.optional(), hint: hint.optional(), accountId: z.uuid().optional(), active: z.boolean().optional() })
  .strict();

export interface CategoryView {
  id: string;
  direction: "IN" | "OUT";
  label: string;
  hint: string;
  active: boolean;
  /** Compte du plan comptable derrière la catégorie : montré en petit, pour l'expert-comptable. */
  account: { id: string; number: string; label: string };
}

export interface TemplateResult {
  accountsCreated: number;
  categoriesCreated: number;
}

const include = { account: { select: { id: true, number: true, label: true } } } as const;

/**
 * Catégories d'opération en langage courant (ADR 0028) : le trésorier choisit « Assurance », le logiciel sait que c'est le
 * compte 616. La catégorie ne contient aucune règle comptable : elle désigne seulement le compte de contrepartie.
 */
@Injectable()
export class CategoriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<CategoryView[]> {
    const rows = await this.prisma.operationCategory.findMany({
      where: includeInactive ? {} : { active: true },
      include,
      orderBy: [{ direction: "asc" }, { position: "asc" }, { label: "asc" }],
    });
    return rows.map(view);
  }

  async create(body: unknown, actorId: string): Promise<CategoryView> {
    const input = parse(categoryInput, body);
    await this.assertAccount(input.accountId, input.direction);
    const last = await this.prisma.operationCategory.aggregate({ where: { direction: input.direction }, _max: { position: true } });
    const row = await this.prisma.operationCategory
      .create({ data: { ...input, position: (last._max.position ?? 0) + 1, createdBy: actorId }, include })
      .catch(duplicate);
    await this.audit.record({ action: "operation-category.created", objectType: "OperationCategory", objectId: row.id, actorId, details: { direction: row.direction } });
    return view(row);
  }

  async update(id: string, body: unknown, actorId: string): Promise<CategoryView> {
    const patch = parse(categoryPatch, body);
    const current = await this.prisma.operationCategory.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Catégorie");
    if (patch.accountId) await this.assertAccount(patch.accountId, current.direction);
    const data = {
      ...(patch.label !== undefined && { label: patch.label }),
      ...(patch.hint !== undefined && { hint: patch.hint }),
      ...(patch.accountId !== undefined && { accountId: patch.accountId }),
      ...(patch.active !== undefined && { active: patch.active }),
    };
    const row = await this.prisma.operationCategory.update({ where: { id }, data, include }).catch(duplicate);
    await this.audit.record({ action: "operation-category.updated", objectType: "OperationCategory", objectId: id, actorId, details: { fields: Object.keys(patch) } });
    return view(row);
  }

  /**
   * Installe le modèle de démarrage : comptes manquants et catégories manquantes (le journal d'à-nouveaux « AN » existe déjà, créé par la migration). Rien n'est écrasé ni
   * dupliqué : relancer ne change rien. Tout ou rien.
   */
  async applyStarterTemplate(actorId: string): Promise<TemplateResult> {
    const result = await this.prisma.$transaction(async (db) => {
      const existing = await db.account.findMany({ select: { id: true, number: true } });
      const byNumber = new Map(existing.map((a) => [a.number, a.id]));
      let accountsCreated = 0;
      for (const account of TEMPLATE_ACCOUNTS) {
        if (byNumber.has(account.number)) continue;
        const created = await db.account.create({ data: { ...account, createdBy: actorId }, select: { id: true } });
        byNumber.set(account.number, created.id);
        accountsCreated++;
      }

      const present = await db.operationCategory.findMany({ select: { direction: true, label: true } });
      const key = (direction: string, text: string) => `${direction}:${text.toLowerCase()}`;
      const known = new Set(present.map((c) => key(c.direction, c.label)));
      let categoriesCreated = 0;
      const positions: Record<string, number> = { IN: 0, OUT: 0 };
      for (const category of TEMPLATE_CATEGORIES) {
        positions[category.direction]!++;
        if (known.has(key(category.direction, category.label))) continue;
        await db.operationCategory.create({
          data: {
            direction: category.direction,
            label: category.label,
            hint: category.hint,
            accountId: byNumber.get(category.accountNumber)!,
            position: positions[category.direction]!,
            createdBy: actorId,
          },
        });
        categoriesCreated++;
      }
      return { accountsCreated, categoriesCreated };
    });
    await this.audit.record({ action: "starter-template.applied", objectType: "Account", actorId, details: { ...result } });
    return result;
  }

  /** Une recette se range sous un compte de produits (7), une dépense sous un compte de charges (6). */
  private async assertAccount(accountId: string, direction: "IN" | "OUT"): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { number: true, active: true } });
    if (!account) throw new AccountingNotFoundError("Compte");
    if (!account.active) throw new AccountingConflictError("Ce compte est désactivé : choisissez-en un autre.");
    const expected = direction === "IN" ? "7" : "6";
    if (!account.number.startsWith(expected)) {
      throw new AccountingConflictError(
        direction === "IN"
          ? "Une catégorie d'argent reçu doit renvoyer à un compte de produits (numéro commençant par 7)."
          : "Une catégorie d'argent dépensé doit renvoyer à un compte de charges (numéro commençant par 6).",
      );
    }
  }
}

function duplicate(error: unknown): never {
  if (/P2002|Unique constraint|23505|duplicate key/i.test(`${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`)) {
    throw new AccountingConflictError("Une catégorie porte déjà ce nom.");
  }
  throw error;
}

function view(row: { id: string; direction: "IN" | "OUT"; label: string; hint: string; active: boolean; account: { id: string; number: string; label: string } }): CategoryView {
  return { id: row.id, direction: row.direction, label: row.label, hint: row.hint, active: row.active, account: row.account };
}
