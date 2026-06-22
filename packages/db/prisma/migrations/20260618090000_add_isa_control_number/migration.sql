-- AlterTable: add nullable ISA control number for deduplication
ALTER TABLE "raw_files" ADD COLUMN "isa_control_number" TEXT;

-- CreateIndex: unique so an interchange is ingested at most once.
-- Postgres permits multiple NULLs here, so non-X12 files (null) never collide.
CREATE UNIQUE INDEX "raw_files_isa_control_number_key" ON "raw_files"("isa_control_number");
