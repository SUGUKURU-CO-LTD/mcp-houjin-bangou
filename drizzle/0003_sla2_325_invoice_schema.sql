DROP TABLE "invoice_issuers";--> statement-breakpoint
DROP TABLE "invoice_issuers_staging";--> statement-breakpoint
CREATE TABLE "invoice_issuers" (
	"sequence_number" varchar(8) NOT NULL,
	"registration_number" varchar(14) NOT NULL,
	"process" varchar(2) NOT NULL,
	"correct" varchar(1) NOT NULL,
	"kind" varchar(2) NOT NULL,
	"country" varchar(1),
	"latest" varchar(1) NOT NULL,
	"registration_date" varchar(10),
	"update_date" varchar(10) NOT NULL,
	"cancel_date" varchar(10),
	"expire_date" varchar(10),
	"head_office_address" varchar(600),
	"head_office_prefecture_code" varchar(2),
	"head_office_city_code" varchar(3),
	"declared_address" varchar(600),
	"declared_prefecture_code" varchar(2),
	"declared_city_code" varchar(3),
	"kana" varchar(500),
	"legal_name" varchar(300),
	"domestic_office_address" varchar(300),
	"domestic_office_prefecture_code" varchar(2),
	"domestic_office_city_code" varchar(3),
	"dataset_version_id" integer NOT NULL,
	CONSTRAINT "invoice_issuers_reg_num_seq_num_version_id_pk" PRIMARY KEY("registration_number","sequence_number","dataset_version_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_issuers_staging" (
	"sequence_number" varchar(8) NOT NULL,
	"registration_number" varchar(14) NOT NULL,
	"process" varchar(2) NOT NULL,
	"correct" varchar(1) NOT NULL,
	"kind" varchar(2) NOT NULL,
	"country" varchar(1),
	"latest" varchar(1) NOT NULL,
	"registration_date" varchar(10),
	"update_date" varchar(10) NOT NULL,
	"cancel_date" varchar(10),
	"expire_date" varchar(10),
	"head_office_address" varchar(600),
	"head_office_prefecture_code" varchar(2),
	"head_office_city_code" varchar(3),
	"declared_address" varchar(600),
	"declared_prefecture_code" varchar(2),
	"declared_city_code" varchar(3),
	"kana" varchar(500),
	"legal_name" varchar(300),
	"domestic_office_address" varchar(300),
	"domestic_office_prefecture_code" varchar(2),
	"domestic_office_city_code" varchar(3),
	"dataset_version_id" integer NOT NULL,
	CONSTRAINT "invoice_issuers_staging_reg_num_seq_num_version_id_pk" PRIMARY KEY("registration_number","sequence_number","dataset_version_id")
);
--> statement-breakpoint
ALTER TABLE "invoice_issuers" ADD CONSTRAINT "invoice_issuers_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_issuers_staging" ADD CONSTRAINT "invoice_issuers_staging_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "public"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoice_issuers_reg_number" ON "invoice_issuers" USING btree ("registration_number");--> statement-breakpoint
CREATE INDEX "idx_invoice_issuers_reg_latest" ON "invoice_issuers" USING btree ("registration_number","latest");--> statement-breakpoint
CREATE INDEX "idx_invoice_issuers_version" ON "invoice_issuers" USING btree ("dataset_version_id");
