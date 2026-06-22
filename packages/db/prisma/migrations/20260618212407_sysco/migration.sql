-- DropIndex
DROP INDEX "trading_partners_isa_receiver_ids_gin";

-- DropIndex
DROP INDEX "trading_partners_isa_sender_ids_gin";

-- AlterTable
ALTER TABLE "trading_partners" ALTER COLUMN "isa_sender_ids" DROP DEFAULT,
ALTER COLUMN "isa_receiver_ids" DROP DEFAULT;
