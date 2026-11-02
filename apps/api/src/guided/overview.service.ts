import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { AuthorizationService } from "../authz/authorization.service.js";
import type { Permission } from "../authz/permissions.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { OpeningSituationService } from "./opening-situation.service.js";

export type TodoLevel = "TODO" | "WARNING" | "INFO";

export interface TodoItem {
  code: string;
  level: TodoLevel;
  title: string;
  detail: string;
  /** Nombre d'éléments concernés, quand il y en a. */
  count?: number;
  /** Écran qui règle la tâche (chemin web). */
  link: string;
  actionLabel: string;
}

export interface OverviewView {
  /** Ce qui est installé : sert à l'assistant de démarrage et aux états vides. */
  setup: {
    fiscalYear: boolean;
    accounts: boolean;
    financialAccount: boolean;
    categories: boolean;
    /** Mode de démarrage choisi (vide tant que non choisi) et état de la situation d'ouverture (ADR 0029). */
    startMode: "HISTORY" | "OPENING" | null;
    openingSituation: "NONE" | "DRAFT" | "POSTED";
  };
  /** Argent disponible sur les comptes de banque et de caisse (somme du solde de chaque compte), absent sans droit de lecture. */
  cash: { total: string; accounts: { id: string; name: string; balance: string }[] } | null;
  /** Argent entré et sorti depuis le début du mois (les virements entre vos comptes ne comptent pas). */
  month: { from: string; to: string; received: string; spent: string } | null;
  todo: TodoItem[];
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Vue d'ensemble « À faire » (ADR 0028) : lecture seule, calculée à la demande, filtrée selon les droits de la personne.
 * Elle ne contient aucune règle : elle compte ce que les autres écrans savent régler et renvoie vers eux.
 */
@Injectable()
export class OverviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(OpeningSituationService) private readonly situation: OpeningSituationService,
  ) {}

  async overview(userId: string, now: Date = new Date()): Promise<OverviewView> {
    const permissions = await this.authz.permissionsFor(userId);
    const can = (permission: Permission) => permissions.has(permission);

    const [fiscalYears, planAccounts, financialAccounts, categories] = await Promise.all([
      this.prisma.fiscalYear.count(),
      this.prisma.account.count(),
      this.prisma.financialAccount.count({ where: { archivedOn: null } }),
      this.prisma.operationCategory.count({ where: { active: true } }),
    ]);
    const [startMode, situation] = await Promise.all([this.situation.mode(), this.situation.existing()]);
    const setup = {
      fiscalYear: fiscalYears > 0,
      accounts: planAccounts > 0,
      financialAccount: financialAccounts > 0,
      categories: categories > 0,
      startMode,
      openingSituation: (situation ? situation.status : "NONE") as "NONE" | "DRAFT" | "POSTED",
    };

    const todo: TodoItem[] = [];
    if (can("settings.accounting:admin")) {
      if (!setup.fiscalYear)
        todo.push({
          code: "NO_FISCAL_YEAR",
          level: "TODO",
          title: "Indiquer la période de votre comptabilité",
          detail: "Une association tient ses comptes sur une période, appelée exercice (souvent l'année civile). Sans elle, on ne peut rien enregistrer.",
          link: "/demarrage",
          actionLabel: "Démarrer",
        });
      else if (!setup.categories)
        todo.push({
          code: "NO_CATEGORIES",
          level: "TODO",
          title: "Installer les catégories de départ",
          detail: "Elles vous permettent de dire « cotisation », « assurance »… sans connaître le plan comptable.",
          link: "/demarrage",
          actionLabel: "Installer",
        });
    }
    if (!setup.financialAccount && can("settings.accounting:admin")) {
      todo.push({
        code: "NO_FINANCIAL_ACCOUNT",
        level: "TODO",
        title: "Ajouter votre compte bancaire",
        detail: "C'est sur lui que vous enregistrerez l'argent reçu et dépensé. Ajoutez aussi la caisse si vous en avez une.",
        link: "/demarrage",
        actionLabel: "Ajouter",
      });
    }

    if (setup.financialAccount && startMode === "OPENING" && setup.openingSituation !== "POSTED" && can("settings.accounting:admin")) {
      todo.push({
        code: "OPENING_SITUATION",
        level: "TODO",
        title: setup.openingSituation === "DRAFT" ? "Enregistrer votre situation de départ" : "Indiquer votre situation de départ",
        detail:
          setup.openingSituation === "DRAFT"
            ? "Elle est préparée mais pas encore enregistrée dans les comptes : relisez-la puis enregistrez-la."
            : "Dites combien d'argent vous avez au départ, ce qu'on vous doit et ce que vous devez : c'est le point de départ de vos comptes.",
        link: "/demarrage",
        actionLabel: "Continuer",
      });
    }

    let cash: OverviewView["cash"] = null;
    let month: OverviewView["month"] = null;
    if (can("financial-accounts:view")) {
      const accounts = await this.prisma.financialAccount.findMany({ where: { archivedOn: null }, orderBy: { name: "asc" } });
      const sums = await this.prisma.transaction.groupBy({ by: ["financialAccountId"], _sum: { amount: true } });
      const sumOf = new Map(sums.map((s) => [s.financialAccountId, s._sum.amount?.toString() ?? "0"]));
      const rows = accounts.map((a) => ({ id: a.id, name: a.name, balance: Money.parse(a.openingBalance.toString()).add(Money.parse(sumOf.get(a.id) ?? "0")) }));
      cash = {
        total: rows.reduce((total, row) => total.add(row.balance), Money.zero()).toString(),
        accounts: rows.map((r) => ({ id: r.id, name: r.name, balance: r.balance.toString() })),
      };

      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      const inMonth = await this.prisma.transaction.findMany({
        where: { operationDate: { gte: from, lte: to }, transferOut: null, transferIn: null },
        select: { amount: true },
      });
      let received = Money.zero();
      let spent = Money.zero();
      for (const t of inMonth) {
        const amount = Money.parse(t.amount.toString());
        if (amount.isNegative()) spent = spent.add(Money.zero().subtract(amount));
        else received = received.add(amount);
      }
      month = { from: day(from), to: day(to), received: received.toString(), spent: spent.toString() };

      const unqualified = await this.prisma.transaction.count({
        where: { counterpartAccountId: null, transferOut: null, transferIn: null, matches: { none: { status: "ACTIVE" } } },
      });
      if (unqualified > 0)
        todo.push({
          code: "TO_CLASSIFY",
          level: "TODO",
          title: unqualified === 1 ? "1 mouvement à classer" : `${unqualified} mouvements à classer`,
          detail: "Dites d'où vient ou où va l'argent (cotisation, assurance…) pour qu'il apparaisse dans vos comptes.",
          count: unqualified,
          link: "/comptes",
          actionLabel: "Classer",
        });
      const toAccount = await this.prisma.transaction.count({
        where: { counterpartAccountId: { not: null }, transferOut: null, transferIn: null, matches: { none: { status: "ACTIVE" } } },
      });
      if (toAccount > 0 && can("entries:create"))
        todo.push({
          code: "TO_ACCOUNT",
          level: "TODO",
          title: toAccount === 1 ? "1 mouvement classé à enregistrer dans les comptes" : `${toAccount} mouvements classés à enregistrer dans les comptes`,
          detail: "Ils sont classés mais pas encore dans la comptabilité : c'est ce qui les fait compter dans le compte de résultat et le bilan.",
          count: toAccount,
          link: "/comptes",
          actionLabel: "Enregistrer",
        });

      const toVerify = await this.accountsToVerify(now);
      if (toVerify > 0)
        todo.push({
          code: "TO_VERIFY",
          level: "INFO",
          title: "Vérifier avec le relevé de la banque",
          detail: "Comparer vos mouvements au relevé permet de repérer un oubli ou une erreur. À faire au moins à chaque fin d'exercice.",
          count: toVerify,
          link: "/comptes",
          actionLabel: "Vérifier",
        });
    }

    if (can("entries:view")) {
      const drafts = await this.prisma.journalEntry.count({ where: { status: "DRAFT" } });
      if (drafts > 0)
        todo.push({
          code: "DRAFTS",
          level: "WARNING",
          title: drafts === 1 ? "1 brouillon à relire" : `${drafts} brouillons à relire`,
          detail: "Un brouillon peut encore être modifié mais ne compte pas dans vos états. Relisez-le puis enregistrez-le définitivement.",
          count: drafts,
          link: "/comptabilite",
          actionLabel: "Relire",
        });
    }

    if (can("members:view")) {
      const pending = await this.prisma.membership.count({ where: { status: "PENDING" } });
      if (pending > 0)
        todo.push({
          code: "MEMBERSHIPS_PENDING",
          level: "INFO",
          title: pending === 1 ? "1 adhésion en attente" : `${pending} adhésions en attente`,
          detail: "Adhésions pas encore réglées, ou réglées mais pas encore rattachées à un encaissement.",
          count: pending,
          link: "/membres/campagnes",
          actionLabel: "Voir",
        });
    }

    return { setup, cash, month, todo };
  }

  /** Comptes avec des mouvements dont aucun rapprochement validé ne date de moins de deux mois. */
  private async accountsToVerify(now: Date): Promise<number> {
    const limit = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
    const accounts = await this.prisma.financialAccount.findMany({
      where: { archivedOn: null, transactions: { some: {} } },
      select: { id: true, reconciliations: { where: { status: "VALIDATED" }, orderBy: { periodEnd: "desc" }, take: 1, select: { periodEnd: true } } },
    });
    return accounts.filter((a) => !a.reconciliations[0] || a.reconciliations[0].periodEnd < limit).length;
  }
}
