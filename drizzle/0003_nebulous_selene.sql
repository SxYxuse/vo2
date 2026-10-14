CREATE TABLE "athlete_metrics" (
	"user_id" text PRIMARY KEY NOT NULL,
	"ftp" real,
	"lthr" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "average_heartrate" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "max_heartrate" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "average_watts" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "weighted_average_watts" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "device_watts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "training_load" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "load_source" text;--> statement-breakpoint
UPDATE "activities"
SET
	"average_heartrate" = NULLIF("raw"->>'average_heartrate', '')::real,
	"max_heartrate" = NULLIF("raw"->>'max_heartrate', '')::real,
	"average_watts" = NULLIF("raw"->>'average_watts', '')::real,
	"weighted_average_watts" = NULLIF("raw"->>'weighted_average_watts', '')::real,
	"device_watts" = COALESCE("raw"->>'device_watts' IN ('true', 't'), false);--> statement-breakpoint
ALTER TABLE "athlete_metrics" ADD CONSTRAINT "athlete_metrics_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;