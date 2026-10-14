DROP INDEX "idx_invoice_issuers_corp_number";--> statement-breakpoint
ALTER TABLE "invoice_issuers" DROP CONSTRAINT "invoice_issuers_registration_number_dataset_version_id_pk";--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" DROP CONSTRAINT "invoice_issuers_staging_registration_number_dataset_version_id_pk";--> statement-breakpoint
ALTER TABLE "invoice_issuers" ALTER COLUMN "process" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers" ALTER COLUMN "correct" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "invoice_issuers" ALTER COLUMN "correct" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ALTER COLUMN "process" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ALTER COLUMN "correct" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ALTER COLUMN "correct" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "sequence_number" varchar(8) NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "country" varchar(1);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "latest" varchar(1) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "head_office_address" varchar(600);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "head_office_prefecture_code" varchar(2);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "head_office_city_code" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "declared_address" varchar(600);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "declared_prefecture_code" varchar(2);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "declared_city_code" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "kana" varchar(500);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "domestic_office_address" varchar(600);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "domestic_office_prefecture_code" varchar(2);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD COLUMN "domestic_office_city_code" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "sequence_number" varchar(8) NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "country" varchar(1);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "latest" varchar(1) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "head_office_address" varchar(600);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "head_office_prefecture_code" varchar(2);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "head_office_city_code" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "declared_address" varchar(600);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "declared_prefecture_code" varchar(2);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "declared_city_code" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "kana" varchar(500);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "domestic_office_address" varchar(600);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "domestic_office_prefecture_code" varchar(2);--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD COLUMN "domestic_office_city_code" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD CONSTRAINT "invoice_issuers_reg_num_seq_num_version_id_pk" PRIMARY KEY("registration_number","sequence_number","dataset_version_id");--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD CONSTRAINT "invoice_issuers_staging_reg_num_seq_num_version_id_pk" PRIMARY KEY("registration_number","sequence_number","dataset_version_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_issuers_reg_latest" ON "invoice_issuers" USING btree ("registration_number","latest");--> statement-breakpoint
ALTER TABLE "invoice_issuers" DROP COLUMN "corporate_number";--> statement-breakpoint
ALTER TABLE "invoice_issuers" DROP COLUMN "prefecture_name";--> statement-breakpoint
ALTER TABLE "invoice_issuers" DROP COLUMN "city_name";--> statement-breakpoint
ALTER TABLE "invoice_issuers" DROP COLUMN "street_number";--> statement-breakpoint
ALTER TABLE "invoice_issuers" DROP COLUMN "post_code";--> statement-breakpoint
ALTER TABLE "invoice_issuers" DROP COLUMN "address_outside";--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" DROP COLUMN "corporate_number";--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" DROP COLUMN "prefecture_name";--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" DROP COLUMN "city_name";--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" DROP COLUMN "street_number";--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" DROP COLUMN "post_code";--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" DROP COLUMN "address_outside";