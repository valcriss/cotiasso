import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { Account, FiscalYear, Journal } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import {
  accountImport,
  accountInput,
  accountPatch,
  fiscalYearInput,
  fiscalYearPatch,
  journalInput,
  journalPatch,
  parse,
} from "./schemas.js";

export interface FiscalYearView {
  id: string;
  label: string;
  start: string;
  end: string;
  status: FiscalYear["status"];
}

export interface JournalView {
  id: string;
  code: string;
  label: string;
  type: Journal["type"];
  active: boolean;
}

export interface AccountView {
  id: string;
  number: string;
  label: string;
  active: boolean;
  reportLine: string | null;
}

/** Retire les clés non fournies : Prisma les interprète comme « ne pas modifier » (exactOptionalPropertyTypes). */
function provided<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);

const fiscalYearView = (year: FiscalYear): FiscalYearView => ({
  id: year.id,
  label: year.label,
  start: day(year.start),
  end: day(year.end),
  status: year.status,
});
const journalView = ({ id, code, label, type, active }: Journal): JournalView => ({ id, code, label, type, active });
const accountView = ({ id, number, label, active, reportLine }: Account): AccountView => ({
  id,
  number,
  label,
  active,
  reportLine,
});

/** Doublon ou chevauchement détecté par la base (filet de sécurité derrière les contrôles du service, en concurrence). */
function isConstraintViolation(error: unknown): boolean {
  const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  return /P2002|23505|23P01|duplicate key|no_overlap|Unique constraint/i.test(text);
}

/**
 * Exercices, journaux et plan de comptes. Les garanties structurelles (pas de chevauchement, pas de suppression,
 * numéro et code définitifs) sont dans la base ; le service produit des erreurs lisibles et alimente l'audit.
 */
@Injectable()
export class AccountingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // --- Exercices ---

  async listFiscalYears(): Promise<FiscalYearView[]> {
    return (await this.prisma.fiscalYear.findMany({ orderBy: { start: "asc" } })).map(fiscalYearView);
  }

  async createFiscalYear(body: unknown, actorId: string): Promise<FiscalYearView> {
    const input = parse(fiscalYearInput, body);
    await this.assertNoOverlap(input.start, input.end);
    const year = await this.guard(() =>
      this.prisma.fiscalYear.create({
        data: { label: input.label, start: asDate(input.start), end: asDate(input.end), createdBy: actorId },
      }),
    );
    await this.audit.record({
      action: "fiscal-year.created",
      objectType: "FiscalYear",
      objectId: year.id,
      actorId,
      details: { label: year.label, start: input.start, end: input.end },
    });
    return fiscalYearView(year);
  }

  async updateFiscalYear(id: string, body: unknown, actorId: string): Promise<FiscalYearView> {
    const patch = parse(fiscalYearPatch, body);
    const current = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Exercice");
    if (current.status !== "OPEN") {
      throw new AccountingConflictError("Un exercice en cours de clôture ou clôturé ne se modifie plus.");
    }

    const start = patch.start ?? day(current.start);
    const end = patch.end ?? day(current.end);
    if (start > end) throw new AccountingConflictError("La fin de l'exercice précède son début.");
    await this.assertNoOverlap(start, end, id);
    const stranded = await this.prisma.journalEntry.count({
      where: { fiscalYearId: id, OR: [{ date: { lt: asDate(start) } }, { date: { gt: asDate(end) } }] },
    });
    if (stranded > 0) {
      throw new AccountingConflictError(`Ces dates excluraient ${stranded} écriture(s) de l'exercice.`);
    }

    const updated = await this.guard(() =>
      this.prisma.fiscalYear.update({
        where: { id },
        data: { ...provided({ label: patch.label }), start: asDate(start), end: asDate(end) },
      }),
    );
    await this.audit.record({
      action: "fiscal-year.updated",
      objectType: "FiscalYear",
      objectId: id,
      actorId,
      details: { fields: Object.keys(provided(patch)) },
    });
    return fiscalYearView(updated);
  }

  private async assertNoOverlap(start: string, end: string, ignoreId?: string): Promise<void> {
    const clash = await this.prisma.fiscalYear.findFirst({
      where: { start: { lte: asDate(end) }, end: { gte: asDate(start) }, ...(ignoreId && { id: { not: ignoreId } }) },
    });
    if (clash) {
      throw new AccountingConflictError(
        `Ces dates chevauchent l'exercice « ${clash.label} » (${day(clash.start)} au ${day(clash.end)}).`,
      );
    }
  }

  // --- Journaux ---

  async listJournals(): Promise<JournalView[]> {
    return (await this.prisma.journal.findMany({ orderBy: { code: "asc" } })).map(journalView);
  }

  async createJournal(body: unknown, actorId: string): Promise<JournalView> {
    const input = parse(journalInput, body);
    if (await this.prisma.journal.findUnique({ where: { code: input.code } })) {
      throw new AccountingConflictError(`Le code de journal « ${input.code} » existe déjà.`);
    }
    const journal = await this.guard(() => this.prisma.journal.create({ data: { ...input, createdBy: actorId } }));
    await this.audit.record({
      action: "journal.created",
      objectType: "Journal",
      objectId: journal.id,
      actorId,
      details: { code: journal.code, type: journal.type },
    });
    return journalView(journal);
  }

  async updateJournal(id: string, body: unknown, actorId: string): Promise<JournalView> {
    const patch = parse(journalPatch, body);
    if (!(await this.prisma.journal.findUnique({ where: { id } }))) throw new AccountingNotFoundError("Journal");
    const journal = await this.prisma.journal.update({ where: { id }, data: provided(patch) });
    await this.audit.record({
      action: "journal.updated",
      objectType: "Journal",
      objectId: id,
      actorId,
      details: { fields: Object.keys(provided(patch)) },
    });
    return journalView(journal);
  }

  // --- Plan de comptes ---

  async listAccounts(): Promise<AccountView[]> {
    return (await this.prisma.account.findMany({ orderBy: { number: "asc" } })).map(accountView);
  }

  async createAccount(body: unknown, actorId: string): Promise<AccountView> {
    const input = parse(accountInput, body);
    if (await this.prisma.account.findUnique({ where: { number: input.number } })) {
      throw new AccountingConflictError(`Le compte ${input.number} existe déjà.`);
    }
    const account = await this.guard(() =>
      this.prisma.account.create({
        data: { number: input.number, label: input.label, reportLine: input.reportLine ?? null, createdBy: actorId },
      }),
    );
    await this.audit.record({
      action: "account.created",
      objectType: "Account",
      objectId: account.id,
      actorId,
      details: { number: account.number },
    });
    return accountView(account);
  }

  async updateAccount(id: string, body: unknown, actorId: string): Promise<AccountView> {
    const patch = parse(accountPatch, body);
    if (!(await this.prisma.account.findUnique({ where: { id } }))) throw new AccountingNotFoundError("Compte");
    const account = await this.prisma.account.update({ where: { id }, data: provided(patch) });
    await this.audit.record({
      action: "account.updated",
      objectType: "Account",
      objectId: id,
      actorId,
      details: { number: account.number, fields: Object.keys(provided(patch)) },
    });
    return accountView(account);
  }

  /**
   * Import du plan de comptes, tout ou rien. Les numéros déjà présents sont laissés tels quels (jamais écrasés) :
   * relancer le même import ne crée ni doublon ni modification.
   */
  async importAccounts(body: unknown, actorId: string): Promise<{ created: number; skipped: number }> {
    const { accounts } = parse(accountImport, body);
    const numbers = accounts.map((account) => account.number);
    const duplicates = numbers.filter((number, index) => numbers.indexOf(number) !== index);
    if (duplicates.length > 0) {
      throw new AccountingConflictError(
        `Numéros en double dans le fichier : ${[...new Set(duplicates)].slice(0, 5).join(", ")}.`,
      );
    }

    const existing = new Set(
      (await this.prisma.account.findMany({ where: { number: { in: numbers } }, select: { number: true } })).map(
        (account) => account.number,
      ),
    );
    const fresh = accounts.filter((account) => !existing.has(account.number));
    if (fresh.length > 0) {
      await this.guard(() =>
        this.prisma.account.createMany({ data: fresh.map((account) => ({ ...account, createdBy: actorId })) }),
      );
    }
    await this.audit.record({
      action: "account.imported",
      objectType: "Account",
      actorId,
      details: { created: fresh.length, skipped: accounts.length - fresh.length },
    });
    return { created: fresh.length, skipped: accounts.length - fresh.length };
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isConstraintViolation(error)) {
        throw new AccountingConflictError(
          "Cette opération entre en conflit avec une donnée existante. Actualisez et recommencez.",
        );
      }
      throw error;
    }
  }
}
