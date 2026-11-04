
-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REIMBURSEMENT_TO_DECIDE', 'REIMBURSEMENT_TO_PAY', 'REIMBURSEMENT_APPROVED', 'REIMBURSEMENT_RETURNED', 'REIMBURSEMENT_REFUSED', 'REIMBURSEMENT_PAID');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "lastError" TEXT,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

