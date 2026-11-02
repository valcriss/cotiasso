import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccountingConflictError } from "../accounting/errors.js";
import { parse } from "../accounting/schemas.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { triggerMessage } from "../treasury/db-refusal.js";
import { OPENING_KINDS, type OpeningKind } from "./starter-template.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date inexistante.");

const positiveAmount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Montant invalide (chiffres positifs, 2 décimales au plus).")
  .refine((value) => Number(value) > 0, "Le montant doit être supérieur à zéro.");

const MAX_ITEMS = 50;
const item = z.object({ kind: z.string().min(1), label: z.string().trim().min(1, "Dites de qui ou de quoi il s'agit.").max(80, "Texte trop long (80 caractères)."), amount: positiveAmount }).strict();

const recordInput = z
  .object({
    date: isoDate,
    receivables: z.array(item).max(MAX_ITEMS, `${MAX_ITEMS} lignes au plus.`).default([]),
    payables: z.array(item).max(MAX_ITEMS, `${MAX_ITEMS} lignes au plus.`).default([]),
    /** Montant du fonds de l'association vu par la personne : refusé s'il a changé depuis (on enregistre ce qu'elle a lu). */
    equityAmount: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/, "Montant invalide.").default("0"),
    equityAccountId: z.uuid("Compte invalide.").nullish(),
    explanation: z.string().trim().max(120, "Explication trop longue (120 caractères).").nullish(),
    /** Comptabiliser tout de suite (par défaut). Faux = l'écriture reste un brouillon à relire. */
    post: z.boolean().default(true),
  })
  .strict();

const modeInput = z.object({ mode: z.enum(["HISTORY", "OPENING"]).nullable() }).strict();

export type StartMode = "HISTORY" | "OPENING" | null;

export interface OpeningSituationView {
  mode: StartMode;
  /** Date proposée : celle à laquelle les comptes de banque et de caisse ont été ouverts. */
  date: string | null;
  accounts: { id: string; name: string; openedOn: string; openingBalance: string }[];
  /** Comptes dont le solde de départ est d'une autre date que celle de la situation : à aligner avant d'enregistrer. */
  misaligned: { id: string; name: string; openedOn: string }[];
  kinds: (Pick<OpeningKind, "key" | "side" | "label" | "hint"> & { available: boolean })[];
  equityAccounts: { id: string; number: string; label: string }[];
  suggestedEquityAccountId: string | null;
  /** Situation déjà enregistrée (brouillon ou comptabilisée) ; absente si aucune, ou si la dernière a été annulée. */
  existing: { entryId: string; date: string; status: "DRAFT" | "POSTED" } | null;
  /** Vrai si un exercice couvre la date proposée. */
  fiscalYear: boolean;
}

export interface OpeningSituationResult {
  entryId: string;
  posted: boolean;
  journalCode: string;
  number: number | null;
  /** Fonds de l'association repris (positif : l'association possède plus qu'elle ne doit). */
  equity: string;
  lines: number;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const frDate = (value: string) => value.split("-").reverse().join("/");

/**
 * Situation d'ouverture (ADR 0029) : l'autre mode de démarrage. Au lieu de reprendre l'historique, on photographie
 * l'association le jour où l'on commence — argent en banque et en caisse, sommes à recevoir, sommes à payer — dans UNE
 * écriture du journal d'à-nouveaux. L'écart (le « fonds de l'association ») est calculé par le logiciel, mais il se
 * confirme et s'explique : aucun compte d'équilibrage caché (cadrage §20.1).
 */
@Injectable()
export class OpeningSituationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async mode(): Promise<StartMode> {
    return ((await this.settings.current("start")) as { mode: StartMode }).mode;
  }

  /** Situation vivante : la plus récente dont l'écriture n'est pas contrepassée. */
  async existing(): Promise<OpeningSituationView["existing"]> {
    const row = await this.prisma.openingSituation.findFirst({
      where: { entry: { status: { not: "REVERSED" } } },
      orderBy: { createdAt: "desc" },
      select: { entryId: true, date: true, entry: { select: { status: true } } },
    });
    return row ? { entryId: row.entryId, date: day(row.date), status: row.entry.status === "POSTED" ? "POSTED" : "DRAFT" } : null;
  }

  async view(requestedDate?: string): Promise<OpeningSituationView> {
    const [mode, accounts, existing] = await Promise.all([
      this.mode(),
      this.prisma.financialAccount.findMany({ where: { archivedOn: null }, orderBy: { name: "asc" } }),
      this.existing(),
    ]);
    const date = requestedDate ? parse(isoDate, requestedDate) : this.commonDate(accounts);
    const planned = await this.prisma.account.findMany({ where: { active: true, OR: [{ number: { startsWith: "1" } }, { number: { in: [...new Set(OPENING_KINDS.map((k) => k.accountNumber))] } }] }, orderBy: { number: "asc" } });
    const equityAccounts = planned.filter((a) => a.number.startsWith("1")).map((a) => ({ id: a.id, number: a.number, label: a.label }));
    const present = new Set(planned.map((a) => a.number));
    return {
      mode,
      date,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, openedOn: day(a.openedOn), openingBalance: a.openingBalance.toFixed(2) })),
      misaligned: date ? accounts.filter((a) => !a.openingBalance.isZero() && day(a.openedOn) !== date).map((a) => ({ id: a.id, name: a.name, openedOn: day(a.openedOn) })) : [],
      kinds: OPENING_KINDS.map((k) => ({ key: k.key, side: k.side, label: k.label, hint: k.hint, available: present.has(k.accountNumber) })),
      equityAccounts,
      suggestedEquityAccountId: (equityAccounts.find((a) => a.number === "102") ?? equityAccounts.find((a) => a.number === "110"))?.id ?? null,
      existing,
      fiscalYear: date ? (await this.prisma.fiscalYear.count({ where: { start: { lte: asDate(date) }, end: { gte: asDate(date) } } })) > 0 : false,
    };
  }

  /** Date d'ouverture commune des comptes qui ont un solde de départ (la plus fréquente, sinon la plus ancienne). */
  private commonDate(accounts: { openedOn: Date; openingBalance: { isZero(): boolean } }[]): string | null {
    const counts = new Map<string, number>();
    for (const a of accounts) {
      if (a.openingBalance.isZero()) continue;
      counts.set(day(a.openedOn), (counts.get(day(a.openedOn)) ?? 0) + 1);
    }
    if (counts.size === 0) return accounts.length > 0 ? day(accounts.map((a) => a.openedOn).sort((x, y) => x.getTime() - y.getTime())[0]!) : null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  }

  /** Choix du mode de démarrage : on ne bascule pas vers un mode quand l'autre est déjà engagé. */
  async setMode(body: unknown, actorId: string): Promise<{ mode: StartMode }> {
    const { mode } = parse(modeInput, body);
    if (mode === "OPENING") {
      const started = await this.prisma.recoveryBatchItem.count();
      if (started > 0) {
        throw new AccountingConflictError("Une reprise de l'historique est déjà commencée (des écritures de reprise existent). Terminez-la ou abandonnez-la avant de choisir de repartir d'une situation d'ouverture.");
      }
    }
    if (mode === "HISTORY" && (await this.existing())) {
      throw new AccountingConflictError("Une situation d'ouverture est enregistrée. Supprimez son brouillon ou annulez son écriture avant de choisir de reprendre l'historique.");
    }
    await this.settings.update("start", { mode }, actorId);
    return { mode };
  }

  async record(body: unknown, actorId: string, canPost: boolean): Promise<OpeningSituationResult> {
    const input = parse(recordInput, body);
    const date = asDate(input.date);
    const post = input.post && canPost;

    if (await this.existing()) {
      throw new AccountingConflictError("Une situation d'ouverture existe déjà. Supprimez son brouillon ou annulez son écriture avant d'en refaire une.");
    }
    if (await this.prisma.recoveryBatchItem.count({ where: { kind: "OPENING" } })) {
      throw new AccountingConflictError("Des soldes d'ouverture ont déjà été repris par la reprise de l'historique : la situation d'ouverture les ferait compter deux fois.");
    }

    const year = await this.prisma.fiscalYear.findFirst({ where: { start: { lte: date }, end: { gte: date } }, select: { id: true } });
    if (!year) throw new AccountingConflictError(`Aucun exercice ne couvre le ${frDate(input.date)}. Définissez d'abord la période de votre comptabilité.`);
    const journal = await this.prisma.journal.findFirst({ where: { type: "OPENING", active: true }, orderBy: { code: "asc" } });
    if (!journal) throw new AccountingConflictError("Aucun journal d'à-nouveaux actif : créez-en un dans les paramètres comptables.");

    const accounts = await this.prisma.financialAccount.findMany({ where: { archivedOn: null }, orderBy: { name: "asc" } });
    const misaligned = accounts.filter((a) => !a.openingBalance.isZero() && day(a.openedOn) !== input.date);
    if (misaligned.length > 0) {
      throw new AccountingConflictError(
        `Le solde de départ de ${misaligned.map((a) => `« ${a.name} » (${frDate(day(a.openedOn))})`).join(", ")} n'est pas daté du ${frDate(input.date)}. Toute la situation doit porter la même date : changez la date d'ouverture de ce compte (tant qu'il n'a aucun mouvement) ou choisissez cette date.`,
      );
    }

    type Line = { accountId: string; debit: string; credit: string; label: string };
    const lines: Line[] = [];
    for (const a of accounts) {
      if (a.openingBalance.isZero()) continue;
      const abs = a.openingBalance.abs().toFixed(2);
      const positive = a.openingBalance.gt(0);
      lines.push({ accountId: a.accountId, debit: positive ? abs : "0", credit: positive ? "0" : abs, label: a.name });
    }

    const resolve = async (entries: z.infer<typeof item>[], side: OpeningKind["side"]): Promise<Line[]> => {
      const out: Line[] = [];
      for (const entry of entries) {
        const kind = OPENING_KINDS.find((k) => k.key === entry.kind && k.side === side);
        if (!kind) throw new AccountingConflictError(`Type de ligne inconnu : « ${entry.kind} ».`);
        const account = await this.prisma.account.findFirst({ where: { number: kind.accountNumber, active: true } });
        if (!account) {
          throw new AccountingConflictError(`« ${kind.label} » n'est pas disponible : le compte ${kind.accountNumber} n'existe pas (ou est désactivé) dans votre plan. Installez le modèle de démarrage ou créez ce compte.`);
        }
        out.push({ accountId: account.id, debit: side === "RECEIVABLE" ? entry.amount : "0", credit: side === "PAYABLE" ? entry.amount : "0", label: `${kind.label} — ${entry.label}`.slice(0, 200) });
      }
      return out;
    };
    lines.push(...(await resolve(input.receivables, "RECEIVABLE")), ...(await resolve(input.payables, "PAYABLE")));
    if (lines.length === 0) {
      throw new AccountingConflictError("Il n'y a rien à reprendre : aucun compte n'a de solde de départ et aucune somme à recevoir ou à payer n'est indiquée.");
    }

    const total = (side: "debit" | "credit") => lines.reduce((sum, l) => sum.add(Money.parse(l[side])), Money.zero());
    const difference = total("debit").subtract(total("credit"));
    if (!Money.parse(input.equityAmount).equals(difference)) {
      throw new AccountingConflictError(`Les montants ont changé depuis l'affichage : le fonds de l'association est maintenant de ${difference.toString()} € (vous aviez ${Money.parse(input.equityAmount).toString()} €). Relisez puis réessayez.`);
    }
    if (!difference.isZero()) {
      if (!input.equityAccountId) throw new AccountingConflictError("Indiquez où ranger le fonds de l'association (fonds associatifs, report à nouveau…).");
      if (!input.explanation || input.explanation.length < 5) throw new AccountingConflictError("Expliquez en quelques mots d'où vient ce fonds (5 caractères au moins) : l'expert-comptable le demandera.");
      const equity = await this.prisma.account.findUnique({ where: { id: input.equityAccountId } });
      if (!equity) throw new AccountingConflictError("Compte du fonds de l'association introuvable.");
      if (!equity.number.startsWith("1")) throw new AccountingConflictError("Le fonds de l'association se range parmi les comptes de capitaux (classe 1) : fonds associatifs, report à nouveau, réserves…");
      if (!equity.active) throw new AccountingConflictError(`Le compte ${equity.number} est désactivé.`);
      const positive = difference.isPositive();
      const abs = positive ? difference.toString() : Money.zero().subtract(difference).toString();
      lines.push({ accountId: equity.id, debit: positive ? "0" : abs, credit: positive ? abs : "0", label: `Fonds de l'association — ${input.explanation}`.slice(0, 200) });
    }

    const entryLabel = `Situation d'ouverture au ${frDate(input.date)}${input.explanation ? ` — ${input.explanation}` : ""}`.slice(0, 200);
    let number: number | null = null;
    const created = await this.prisma
      .$transaction(async (db) => {
        const entry = await db.journalEntry.create({
          data: {
            fiscalYearId: year.id,
            journalId: journal.id,
            date,
            label: entryLabel,
            createdBy: actorId,
            lines: { create: lines.map((l, index) => ({ position: index + 1, accountId: l.accountId, debit: l.debit, credit: l.credit, label: l.label })) },
          },
          select: { id: true },
        });
        await db.openingSituation.create({ data: { entryId: entry.id, date, createdBy: actorId } });
        if (post) {
          const posted = await db.journalEntry.update({ where: { id: entry.id }, data: { status: "POSTED", postedBy: actorId }, select: { number: true } });
          number = posted.number;
        }
        return entry.id;
      })
      .catch((error) => {
        const refusal = triggerMessage(error);
        if (refusal) throw new AccountingConflictError(refusal);
        throw error;
      });

    await this.audit.record({
      action: "opening-situation.recorded",
      objectType: "JournalEntry",
      objectId: created,
      actorId,
      details: { posted: post, lines: lines.length, date: input.date },
    });
    return { entryId: created, posted: post, journalCode: journal.code, number, equity: difference.toString(), lines: lines.length };
  }
}
