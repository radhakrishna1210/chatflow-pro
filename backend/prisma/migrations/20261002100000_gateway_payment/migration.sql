-- CreateTable
CREATE TABLE "GatewayPayment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'razorpay',
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GatewayPayment_paymentId_key" ON "GatewayPayment"("paymentId");

-- CreateIndex
CREATE INDEX "GatewayPayment_workspaceId_createdAt_idx" ON "GatewayPayment"("workspaceId", "createdAt");

