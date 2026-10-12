CREATE TABLE "corporate_numbers" (
	"corporate_number" varchar(13) NOT NULL,
	"process" varchar(2),
	"correct" varchar(1),
	"update_date" varchar(10) NOT NULL,
	"change_date" varchar(10),
	"name" varchar(300) NOT NULL,
	"name_image_id" varchar(8),
	"kind" varchar(3) NOT NULL,
	"prefecture_name" varchar(10),
	"city_name" varchar(20),
	"street_number" varchar(300),
	"address_image_id" varchar(8),
	"prefecture_code" varchar(2),
	"city_code" varchar(3),
	"post_code" varchar(7),
	"address_outside" varchar(300),
	"address_outside_image_id" varchar(8),
	"close_date" varchar(10),
	"close_cause" varchar(2),
	"successor_corporate_number" varchar(13),
	"change_cause" varchar(500),
	"assignment_date" varchar(10),
	"latest" varchar(1) DEFAULT '1' NOT NULL,
	"en_name" varchar(300),
	"en_prefecture_name" varchar(50),
	"en_city_name" varchar(50),
	"en_address_outside" varchar(300),
	"furigana" varchar(500),
	"dataset_version_id" integer NOT NULL,
	CONSTRAINT "corporate_numbers_corporate_number_dataset_version_id_pk" PRIMARY KEY("corporate_number","dataset_version_id")
);
--> statement-breakpoint
CREATE TABLE "corporate_numbers_staging" (
	"corporate_number" varchar(13) NOT NULL,
	"process" varchar(2),
	"correct" varchar(1),
	"update_date" varchar(10) NOT NULL,
	"change_date" varchar(10),
	"name" varchar(300) NOT NULL,
	"name_image_id" varchar(8),
	"kind" varchar(3) NOT NULL,
	"prefecture_name" varchar(10),
	"city_name" varchar(20),
	"street_number" varchar(300),
	"address_image_id" varchar(8),
	"prefecture_code" varchar(2),
	"city_code" varchar(3),
	"post_code" varchar(7),
	"address_outside" varchar(300),
	"address_outside_image_id" varchar(8),
	"close_date" varchar(10),
	"close_cause" varchar(2),
	"successor_corporate_number" varchar(13),
	"change_cause" varchar(500),
	"assignment_date" varchar(10),
	"latest" varchar(1) DEFAULT '1' NOT NULL,
	"en_name" varchar(300),
	"en_prefecture_name" varchar(50),
	"en_city_name" varchar(50),
	"en_address_outside" varchar(300),
	"furigana" varchar(500),
	"dataset_version_id" integer NOT NULL,
	CONSTRAINT "corporate_numbers_staging_corporate_number_dataset_version_id_pk" PRIMARY KEY("corporate_number","dataset_version_id")
);
--> statement-breakpoint
CREATE TABLE "dataset_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"data_as_of" varchar(10) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'staging' NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_issuers" (
	"registration_number" varchar(14) NOT NULL,
	"process" varchar(2),
	"correct" varchar(1),
	"kind" varchar(2) NOT NULL,
	"corporate_number" varchar(13),
	"legal_name" varchar(300),
	"prefecture_name" varchar(10),
	"city_name" varchar(20),
	"street_number" varchar(300),
	"post_code" varchar(7),
	"address_outside" varchar(300),
	"registration_date" varchar(10) NOT NULL,
	"update_date" varchar(10) NOT NULL,
	"cancel_date" varchar(10),
	"expire_date" varchar(10),
	"dataset_version_id" integer NOT NULL,
	CONSTRAINT "invoice_issuers_registration_number_dataset_version_id_pk" PRIMARY KEY("registration_number","dataset_version_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_issuers_staging" (
	"registration_number" varchar(14) NOT NULL,
	"process" varchar(2),
	"correct" varchar(1),
	"kind" varchar(2) NOT NULL,
	"corporate_number" varchar(13),
	"legal_name" varchar(300),
	"prefecture_name" varchar(10),
	"city_name" varchar(20),
	"street_number" varchar(300),
	"post_code" varchar(7),
	"address_outside" varchar(300),
	"registration_date" varchar(10) NOT NULL,
	"update_date" varchar(10) NOT NULL,
	"cancel_date" varchar(10),
	"expire_date" varchar(10),
	"dataset_version_id" integer NOT NULL,
	CONSTRAINT "invoice_issuers_staging_registration_number_dataset_version_id_pk" PRIMARY KEY("registration_number","dataset_version_id")
);
--> statement-breakpoint
ALTER TABLE "corporate_numbers" ADD CONSTRAINT "corporate_numbers_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_numbers_staging" ADD CONSTRAINT "corporate_numbers_staging_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD CONSTRAINT "invoice_issuers_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD CONSTRAINT "invoice_issuers_staging_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_corporate_numbers_number" ON "corporate_numbers" USING btree ("corporate_number");--> statement-breakpoint
CREATE INDEX "idx_corporate_numbers_name" ON "corporate_numbers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_corporate_numbers_prefecture" ON "corporate_numbers" USING btree ("prefecture_code");--> statement-breakpoint
CREATE INDEX "idx_corporate_numbers_version" ON "corporate_numbers" USING btree ("dataset_version_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_versions_source_status" ON "dataset_versions" USING btree ("source_type","status");--> statement-breakpoint
CREATE INDEX "idx_invoice_issuers_reg_number" ON "invoice_issuers" USING btree ("registration_number");--> statement-breakpoint
CREATE INDEX "idx_invoice_issuers_corp_number" ON "invoice_issuers" USING btree ("corporate_number");--> statement-breakpoint
CREATE INDEX "idx_invoice_issuers_version" ON "invoice_issuers" USING btree ("dataset_version_id");