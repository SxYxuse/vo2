ALTER TABLE "activities" ADD COLUMN "estimated_heartrate" real;--> statement-breakpoint
-- Loads without heart rate can now borrow it from similar activities; clear them so the next fitness load rescores.
UPDATE "activities" SET "training_load" = NULL WHERE "load_source" IN ('duration', 'similarHeartRate');
