-- Authentication sends keep their own Meta message id rather than creating a
-- normal Message row. Store the delivery receipt timestamp on that transaction
-- so Analytics can count only real Meta delivery/read events.
ALTER TABLE "AuthenticationTransaction" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- PostgreSQL permits multiple NULLs in a unique index, while guaranteeing
-- every real Meta message id maps to exactly one Authentication transaction.
CREATE UNIQUE INDEX "AuthenticationTransaction_metaMessageId_key"
  ON "AuthenticationTransaction"("metaMessageId");
