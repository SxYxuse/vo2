-- The week planner is gone (ADR 0050). Athletes on it, and those who built its plan before the
-- planning style existed, move to the coach plan, so they keep planning and skip onboarding.
UPDATE "calendar_settings" AS s
SET "value" = jsonb_set(s."value", '{planningStyle}', '"coachPlan"')
WHERE s."value"->>'planningStyle' = 'weekPlanner'
  OR (
    s."value"->>'planningStyle' IS NULL
    AND EXISTS (
      SELECT 1 FROM "athlete_metrics" AS m WHERE m."user_id" = s."user_id" AND m."training" IS NOT NULL
    )
  );--> statement-breakpoint
DROP TABLE "week_coach" CASCADE;--> statement-breakpoint
ALTER TABLE "athlete_metrics" DROP COLUMN "training";
