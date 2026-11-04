ALTER TABLE "goals" ADD COLUMN "effort" text;--> statement-breakpoint
-- ADR 0052, as currentGoalWeight in season.types.ts: C goals become supporting races for fun, B goals steady ones.
UPDATE "goals" SET "priority" = 'B', "effort" = 'fun' WHERE "priority" = 'C';--> statement-breakpoint
UPDATE "goals" SET "effort" = 'steady' WHERE "priority" = 'B' AND "effort" IS NULL;
