-- CreateTable
CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChatMessage_roomId_idx" ON "ChatMessage"("roomId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
