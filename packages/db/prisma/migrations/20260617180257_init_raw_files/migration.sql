-- CreateEnum
CREATE TYPE "RawFileStatus" AS ENUM ('RECEIVED', 'DUPLICATE', 'PARSED', 'PARSE_ERROR', 'UNRECOGNIZED_FORMAT', 'FAILED');

-- CreateEnum
CREATE TYPE "SourceChannel" AS ENUM ('upload', 'sftp');

-- CreateTable
CREATE TABLE "raw_files" (
    "id" UUID NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "source" "SourceChannel" NOT NULL,
    "status" "RawFileStatus" NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_files_s3_key_key" ON "raw_files"("s3_key");

-- CreateIndex
CREATE INDEX "raw_files_file_hash_idx" ON "raw_files"("file_hash");

-- CreateIndex
CREATE INDEX "raw_files_ingested_at_idx" ON "raw_files"("ingested_at");
