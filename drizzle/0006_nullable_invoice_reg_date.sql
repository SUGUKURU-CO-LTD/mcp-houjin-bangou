ALTER TABLE "invoice_issuers" ALTER COLUMN "registration_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ALTER COLUMN "registration_date" DROP NOT NULL;
