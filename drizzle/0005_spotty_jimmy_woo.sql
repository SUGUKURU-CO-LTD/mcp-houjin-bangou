ALTER TABLE "corporate_numbers" ALTER COLUMN "en_city_name" SET DATA TYPE varchar(600);--> statement-breakpoint
ALTER TABLE "corporate_numbers" ALTER COLUMN "en_address_outside" SET DATA TYPE varchar(600);--> statement-breakpoint
ALTER TABLE "corporate_numbers_staging" ALTER COLUMN "en_city_name" SET DATA TYPE varchar(600);--> statement-breakpoint
ALTER TABLE "corporate_numbers_staging" ALTER COLUMN "en_address_outside" SET DATA TYPE varchar(600);