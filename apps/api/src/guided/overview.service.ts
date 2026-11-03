import { Money } from "@cotiasso/accounting-domain";
import { Inject, Injectable } from "@nestjs/common";
import { AuthorizationService } from "../authz/authorization.service.js";
import type { Permission } from "../authz/permissions.js";
import { MembershipsService } from "../members/memberships.service.js";
import { PaymentsService } from "../members/payments.service.js";
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
  /** Écran qui règle la tâche (chemin web) et, au besoin, de quoi l'ouvrir déjà filtré. */
  link: string;
  query?: Record<string, string>;
  actionLabel: string;
}

/** Une des dernières opérations, pour que la personne voie d'un coup d'œil ce qui vient d'être enregistré. */
export interface RecentOperation {
  id: string;
  /** AAAA-MM-JJ */
  date: string;
  label: string;
  /** Montant signé : positif = argent reçu, négatif = argent dépensé. */
  amount: string;
  accountName: string;
  situation: "TO_CLASSIFY" | "CLASSIFIED" | "DRAFT" | "BOOKED" | "TRANSFER";
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
    /** `SKIPPED` : la personne part de zéro, il n'y a rien à reprendre. */
    openingSituation: "NONE" | "DRAFT" | "POSTED" | "SKIPPED";
  };
  /** Argent disponible sur les comptes de banque et de caisse (somme du solde de chaque compte), absent sans droit de lecture. */
  cash: { total: string; accounts: { id: string; name: string; balance: string }[] } | null;
  /** Argent entré et sorti depuis le début du mois (les virements entre vos comptes ne comptent pas). */
  month: { from: string; to: string; received: string; spent: string } | null;
  /** Les 5 dernières opérations, absentes sans droit de lecture des comptes. */
  recent: RecentOperation[] | null;
  todo: TodoItem[];
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const frenchDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

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
    @Inject(MembershipsService) private readonly memberships: MembershipsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
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
    const [startMode, situation, skipped] = await Promise.all([this.situation.mode(), this.situation.existing(), this.situation.skipped()]);
    const setup = {
      fiscalYear: fiscalYears > 0,
      accounts: planAccounts > 0,
      financialAccount: financialAccounts > 0,
      categories: categories > 0,
      startMode,
      openingSituation: (situation ? situation.status : skipped ? "SKIPPED" : "NONE") as OverviewView["setup"]["openingSituation"],
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

    if (setup.financialAccount && startMode === "OPENING" && setup.openingSituation !== "POSTED" && setup.openingSituation !== "SKIPPED" && can("settings.accounting:admin")) {
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

    // Fin de période : la marche à suivre apparaît un mois avant, et reste tant que la période n'est pas clôturée.
    if (can("fiscal-years:close")) {
      const closing = await this.prisma.fiscalYear.findFirst({
        where: { status: "OPEN", end: { lte: new Date(now.getTime() + 30 * 24 * 3600 * 1000) } },
        orderBy: { end: "asc" },
        select: { label: true, end: true },
      });
      if (closing) {
        const days = Math.ceil((closing.end.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
        const endText = frenchDate(day(closing.end));
        todo.push({
          code: "PERIOD_END",
          level: days < 0 ? "WARNING" : "INFO",
          title: days < 0 ? `Votre période est terminée depuis le ${endText}` : days === 0 ? "Votre période se termine aujourd'hui" : `Votre période se termine le ${endText} (dans ${days} jour${days > 1 ? "s" : ""})`,
          detail:
            "La marche à suivre : 1) classez et enregistrez tous les mouvements ; 2) comparez chaque compte au relevé de la banque ; 3) fermez la saisie, puis clôturez la période (Paramètres › Comptabilité). Les comptes de l'année sont alors arrêtés et reportés sur la suivante.",
          link: "/parametres",
          actionLabel: "Clôturer",
        });
      }
    }

    let cash: OverviewView["cash"] = null;
    let month: OverviewView["month"] = null;
    let recent: OverviewView["recent"] = null;
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

      const lastOnes = await this.prisma.transaction.findMany({
        orderBy: [{ operationDate: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: {
          id: true,
          operationDate: true,
          label: true,
          amount: true,
          counterpartAccountId: true,
          financialAccount: { select: { name: true } },
          matches: { where: { status: "ACTIVE" }, select: { entry: { select: { status: true } } } },
          transferOut: { select: { id: true } },
          transferIn: { select: { id: true } },
        },
      });
      recent = lastOnes.map((t) => {
        const entry = t.matches[0]?.entry;
        const situation: RecentOperation["situation"] = t.transferOut || t.transferIn ? "TRANSFER" : entry ? (entry.status === "POSTED" ? "BOOKED" : "DRAFT") : t.counterpartAccountId ? "CLASSIFIED" : "TO_CLASSIFY";
        return { id: t.id, date: day(t.operationDate), label: t.label, amount: Money.parse(t.amount.toString()).toString(), accountName: t.financialAccount.name, situation };
      });

      // Par compte : le lien de la tâche ouvre directement le compte qui en a le plus, déjà sur « À classer ».
      const perAccount = await this.prisma.transaction.groupBy({
        by: ["financialAccountId"],
        where: { counterpartAccountId: null, transferOut: null, transferIn: null, matches: { none: { status: "ACTIVE" } } },
        _count: { _all: true },
      });
      const unqualified = perAccount.reduce((total, row) => total + row._count._all, 0);
      const busiest = [...perAccount].sort((a, b) => b._count._all - a._count._all)[0];
      if (unqualified > 0)
        todo.push({
          code: "TO_CLASSIFY",
          level: "TODO",
          title: unqualified === 1 ? "1 mouvement à classer" : `${unqualified} mouvements à classer`,
          detail: "Dites d'où vient ou où va l'argent (cotisation, assurance…) pour qu'il apparaisse dans vos comptes.",
          count: unqualified,
          link: "/comptes",
          ...(busiest && { query: { compte: busiest.financialAccountId } }),
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
      // Qui peut enregistrer définitivement a une tâche de validation ; les autres, un simple brouillon à relire.
      const toValidate = can("entries:post");
      if (drafts > 0)
        todo.push({
          code: "DRAFTS",
          level: "WARNING",
          title: toValidate ? (drafts === 1 ? "1 opération à valider" : `${drafts} opérations à valider`) : drafts === 1 ? "1 brouillon à relire" : `${drafts} brouillons à relire`,
          detail: toValidate
            ? "Elles ont été préparées sans pouvoir être enregistrées définitivement (ou laissées en brouillon). Relisez-les puis enregistrez-les : tant qu'elles sont en brouillon, elles ne comptent pas dans vos rapports."
            : "Un brouillon peut encore être modifié mais ne compte pas dans vos états. Relisez-le puis enregistrez-le définitivement.",
          count: drafts,
          link: "/comptabilite",
          actionLabel: toValidate ? "Valider" : "Relire",
        });
    }

    if (can("members:view")) {
      const campaign = await this.memberships.currentCampaign(day(now));
      const due = campaign ? await this.payments.reminders(campaign.id) : null;
      if (due && due.items.length > 0)
        todo.push({
          code: "MEMBERSHIPS_LATE",
          level: "INFO",
          title: `${due.items.length === 1 ? "1 cotisation reste" : `${due.items.length} cotisations restent`} à payer (${Money.parse(due.totalDue).toString().replace(".", ",")} €)`,
          detail: `Pour « ${campaign!.name} ». Vous pouvez préparer un message de rappel pour les personnes concernées.`,
          count: due.items.length,
          link: "/membres",
          query: { cotisation: "late" },
          actionLabel: "Voir",
        });
      const pending = due ? 0 : await this.prisma.membership.count({ where: { status: "PENDING" } });
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

    return { setup, cash, month, recent, todo };
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
