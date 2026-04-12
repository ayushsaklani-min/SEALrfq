-- CreateTable
CREATE TABLE "DeliveryMilestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetAmount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "evidenceHash" TEXT,
    "evidenceUrl" TEXT,
    "evidenceNote" TEXT,
    "evidenceSubmittedBy" TEXT,
    "evidenceSubmittedAt" DATETIME,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "releaseTxId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryMilestone_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryMilestone_rfqId_sequence_key" ON "DeliveryMilestone"("rfqId", "sequence");

-- CreateIndex
CREATE INDEX "DeliveryMilestone_rfqId_idx" ON "DeliveryMilestone"("rfqId");

-- CreateIndex
CREATE INDEX "DeliveryMilestone_status_idx" ON "DeliveryMilestone"("status");
