ALTER TABLE "athlete_metrics" ADD COLUMN "cycling_lthr" real;--> statement-breakpoint
ALTER TABLE "athlete_metrics" ADD COLUMN "run_lthr" real;--> statement-breakpoint
ALTER TABLE "athlete_metrics" ADD COLUMN "swim_lthr" real;--> statement-breakpoint
ALTER TABLE "athlete_metrics" ADD COLUMN "rest_hr" real;--> statement-breakpoint
UPDATE "athlete_metrics" SET "cycling_lthr" = "lthr" WHERE "cycling_lthr" IS NULL AND "lthr" IS NOT NULL;