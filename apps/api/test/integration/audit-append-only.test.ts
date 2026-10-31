import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

describe("AuditEvent en ajout seul (base réelle)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("autorise l'insertion", async () => {
    const event = await prisma.auditEvent.create({
      data: { action: "test.created", objectType: "Test", objectId: "1" },
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuse la modification", async () => {
    const event = await prisma.auditEvent.create({ data: { action: "test.update", objectType: "Test" } });
    await expect(
      prisma.auditEvent.update({ where: { id: event.id }, data: { action: "falsifié" } }),
    ).rejects.toThrow(/ajout seul/);
  });

  it("refuse la suppression", async () => {
    const event = await prisma.auditEvent.create({ data: { action: "test.delete", objectType: "Test" } });
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/ajout seul/);
  });
});
