-- The coach plan's sessions have no day (ADR 0048). Stored plans keep their sessions: each loses
-- its date (and the `key` flag ADR 0047 left), gains its week, an id that names no day, and starts
-- open. Links to runs go with automatic matching, and availability keeps only runs a week.
ALTER TABLE "coach_plans" DROP COLUMN "links";--> statement-breakpoint
UPDATE "coach_plans" SET "availability" = jsonb_build_object('runsPerWeek', "availability"->'runsPerWeek');--> statement-breakpoint
UPDATE "coach_plans" SET "plan" = jsonb_set("plan", '{weeks}', COALESCE((
  SELECT jsonb_agg(
    jsonb_set(week, '{sessions}', COALESCE((
      SELECT jsonb_agg(
        (session - 'date' - 'key') || jsonb_build_object(
          'weekStart', week->'weekStart',
          'id', (week->>'weekStart') || '-' || session_index,
          'done', false
        )
        ORDER BY session_index
      )
      FROM jsonb_array_elements(week->'sessions') WITH ORDINALITY AS sessions(session, session_index)
    ), '[]'::jsonb))
    ORDER BY week_index
  )
  FROM jsonb_array_elements("plan"->'weeks') WITH ORDINALITY AS weeks(week, week_index)
), '[]'::jsonb))
WHERE "plan" IS NOT NULL;--> statement-breakpoint
-- Proposals name days; the coach proposes again.
DELETE FROM "coach_plan_proposals";
