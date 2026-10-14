ALTER TABLE "activities" ADD COLUMN "has_heartrate" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "activities" AS a
SET "has_heartrate" = EXISTS (
  SELECT 1
  FROM "activity_streams" AS s,
    LATERAL jsonb_array_elements(s."heartrate") AS hr(value)
  WHERE s."activity_id" = a."id"
    AND s."heartrate" IS NOT NULL
    AND jsonb_typeof(s."heartrate") = 'array'
    AND jsonb_typeof(hr.value) = 'number'
    AND (hr.value #>> '{}')::double precision > 0
);