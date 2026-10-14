ALTER TABLE "activities" ADD COLUMN "manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "activities"
SET "manual" = COALESCE("raw"->>'manual' IN ('true', 't'), false);--> statement-breakpoint
ALTER TABLE "activity_streams" ADD COLUMN "chart_preview" jsonb;