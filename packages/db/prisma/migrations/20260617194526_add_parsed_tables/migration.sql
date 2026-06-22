-- CreateTable
CREATE TABLE "interchanges" (
    "id" UUID NOT NULL,
    "raw_file_id" UUID NOT NULL,
    "isa_control_number" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "declared_group_count" INTEGER,
    "element_separator" TEXT NOT NULL,
    "sub_element_separator" TEXT NOT NULL,
    "segment_terminator" TEXT NOT NULL,
    "parsed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "functional_groups" (
    "id" UUID NOT NULL,
    "interchange_id" UUID NOT NULL,
    "functional_id_code" TEXT NOT NULL,
    "control_number" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "declared_transaction_count" INTEGER,

    CONSTRAINT "functional_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "functional_group_id" UUID NOT NULL,
    "transaction_set_id" TEXT NOT NULL,
    "control_number" TEXT NOT NULL,
    "declared_segment_count" INTEGER,
    "segment_count" INTEGER NOT NULL,
    "po_number" TEXT,
    "invoice_number" TEXT,
    "purpose" TEXT,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elements" (
    "id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "semantic_label" TEXT,

    CONSTRAINT "elements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interchanges_raw_file_id_key" ON "interchanges"("raw_file_id");

-- CreateIndex
CREATE INDEX "functional_groups_interchange_id_idx" ON "functional_groups"("interchange_id");

-- CreateIndex
CREATE INDEX "transactions_functional_group_id_idx" ON "transactions"("functional_group_id");

-- CreateIndex
CREATE INDEX "transactions_transaction_set_id_idx" ON "transactions"("transaction_set_id");

-- CreateIndex
CREATE INDEX "transactions_po_number_idx" ON "transactions"("po_number");

-- CreateIndex
CREATE INDEX "transactions_invoice_number_idx" ON "transactions"("invoice_number");

-- CreateIndex
CREATE INDEX "segments_transaction_id_idx" ON "segments"("transaction_id");

-- CreateIndex
CREATE INDEX "segments_tag_idx" ON "segments"("tag");

-- CreateIndex
CREATE INDEX "elements_segment_id_idx" ON "elements"("segment_id");

-- AddForeignKey
ALTER TABLE "interchanges" ADD CONSTRAINT "interchanges_raw_file_id_fkey" FOREIGN KEY ("raw_file_id") REFERENCES "raw_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_groups" ADD CONSTRAINT "functional_groups_interchange_id_fkey" FOREIGN KEY ("interchange_id") REFERENCES "interchanges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_functional_group_id_fkey" FOREIGN KEY ("functional_group_id") REFERENCES "functional_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
