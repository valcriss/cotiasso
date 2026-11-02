import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { ProjectAccess } from "../auth/auth.guard.js";
import type { Member, ProjectParticipant, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingConflictError, AccountingNotFoundError } from "./errors.js";
import { assertProjectAccess } from "./project-access.js";
import { parse } from "./schemas.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), "Date inexistante.");
const role = z.string().trim().min(1, "Rôle obligatoire.").max(80, "Rôle trop long (80 caractères).");

const createInput = z
  .object({
    memberId: z.uuid().nullish(),
    userId: z.uuid().nullish(),
    role,
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
    note: z.string().trim().max(500).default(""),
  })
  .strict()
  .refine((value) => Boolean(value.memberId) !== Boolean(value.userId), {
    path: ["memberId"],
    message: "Indiquez un membre ou un utilisateur (un seul).",
  });

const patchInput = z
  .object({
    role: role.optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export interface ParticipantView {
  id: string;
  projectId: string;
  memberId: string | null;
  userId: string | null;
  /** Nom à afficher : celui du membre ou de l'utilisateur. */
  name: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  note: string;
}

type Row = ProjectParticipant & { member: Pick<Member, "firstName" | "lastName"> | null; user: Pick<User, "displayName"> | null };

const include = { member: { select: { firstName: true, lastName: true } }, user: { select: { displayName: true } } } as const;
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const asDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);

const view = (row: Row): ParticipantView => ({
  id: row.id,
  projectId: row.projectId,
  memberId: row.memberId,
  userId: row.userId,
  name: row.member ? `${row.member.firstName} ${row.member.lastName}` : (row.user?.displayName ?? ""),
  role: row.role,
  startDate: day(row.startDate),
  endDate: day(row.endDate),
  note: row.note,
});

/**
 * Participants d'un projet (ADR 0024, tranche 4.1) : information seulement. Être participant ne donne aucun droit
 * d'accès : les droits restent dans les rôles et leur portée projet (ADR 0022).
 */
@Injectable()
export class ParticipantsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(projectId: string, access?: ProjectAccess): Promise<ParticipantView[]> {
    assertProjectAccess(projectId, access);
    if (!(await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Projet");
    }
    const rows = await this.prisma.projectParticipant.findMany({
      where: { projectId },
      include,
      orderBy: [{ endDate: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    });
    return rows.map(view);
  }

  async add(projectId: string, body: unknown, actorId: string, access?: ProjectAccess): Promise<ParticipantView> {
    assertProjectAccess(projectId, access);
    const input = parse(createInput, body);
    this.assertDates(input.startDate ?? null, input.endDate ?? null);
    if (!(await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
      throw new AccountingNotFoundError("Projet");
    }
    const row = await this.guard(() =>
      this.prisma.projectParticipant.create({
        data: {
          projectId,
          memberId: input.memberId ?? null,
          userId: input.userId ?? null,
          role: input.role,
          startDate: asDate(input.startDate),
          endDate: asDate(input.endDate),
          note: input.note,
          createdBy: actorId,
        },
        include,
      }),
    );
    await this.audit.record({
      action: "project.participant.added",
      objectType: "Project",
      objectId: projectId,
      actorId,
      details: { participantId: row.id, role: row.role },
    });
    return view(row);
  }

  async update(id: string, body: unknown, actorId: string, access?: ProjectAccess): Promise<ParticipantView> {
    const patch = parse(patchInput, body);
    const current = await this.prisma.projectParticipant.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Participant");
    assertProjectAccess(current.projectId, access);
    this.assertDates(
      patch.startDate === undefined ? day(current.startDate) : patch.startDate,
      patch.endDate === undefined ? day(current.endDate) : patch.endDate,
    );
    const { startDate, endDate, ...rest } = patch;
    const row = await this.guard(() =>
      this.prisma.projectParticipant.update({
        where: { id },
        data: {
          ...(rest.role !== undefined && { role: rest.role }),
          ...(rest.note !== undefined && { note: rest.note }),
          ...(startDate !== undefined && { startDate: asDate(startDate) }),
          ...(endDate !== undefined && { endDate: asDate(endDate) }),
        },
        include,
      }),
    );
    await this.audit.record({
      action: "project.participant.updated",
      objectType: "Project",
      objectId: current.projectId,
      actorId,
      details: { participantId: id, fields: Object.keys(patch) },
    });
    return view(row);
  }

  /** Retire un participant de la liste. Information seulement : aucune donnée comptable n'en dépend. */
  async remove(id: string, actorId: string, access?: ProjectAccess): Promise<void> {
    const current = await this.prisma.projectParticipant.findUnique({ where: { id } });
    if (!current) throw new AccountingNotFoundError("Participant");
    assertProjectAccess(current.projectId, access);
    await this.prisma.projectParticipant.delete({ where: { id } });
    await this.audit.record({
      action: "project.participant.removed",
      objectType: "Project",
      objectId: current.projectId,
      actorId,
      details: { participantId: id },
    });
  }

  private assertDates(start: string | null, end: string | null): void {
    if (start && end && start > end) throw new AccountingConflictError("La fin de la participation précède son début.");
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const text = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
      if (/P2003|Foreign key/i.test(text)) throw new AccountingConflictError("Le membre ou l'utilisateur indiqué n'existe pas.");
      throw error;
    }
  }
}
