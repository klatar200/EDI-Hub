-- DropForeignKey
ALTER TABLE "alerts" DROP CONSTRAINT "alerts_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "elements" DROP CONSTRAINT "elements_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "functional_groups" DROP CONSTRAINT "functional_groups_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "interchanges" DROP CONSTRAINT "interchanges_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "raw_files" DROP CONSTRAINT "raw_files_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "segments" DROP CONSTRAINT "segments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "trading_partners" DROP CONSTRAINT "trading_partners_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_tenant_id_fkey";

-- AddForeignKey
ALTER TABLE "trading_partners" ADD CONSTRAINT "trading_partners_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_files" ADD CONSTRAINT "raw_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interchanges" ADD CONSTRAINT "interchanges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_groups" ADD CONSTRAINT "functional_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elements" ADD CONSTRAINT "elements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
