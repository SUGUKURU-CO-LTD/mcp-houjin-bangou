CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "idx_corporate_numbers_name_trgm" ON "corporate_numbers" USING gin ("name" gin_trgm_ops);