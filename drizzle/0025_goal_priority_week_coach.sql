CREATE TABLE "week_coach" (
	"user_id" text NOT NULL,
	"week_start" date NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan" jsonb,
	"input_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_coach_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "priority" text DEFAULT 'A' NOT NULL;--> statement-breakpoint
ALTER TABLE "week_coach" ADD CONSTRAINT "week_coach_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A goal that lost the main pick in its 4-week cluster was a tune-up: it becomes a B goal.
UPDATE "goals" AS "g" SET "priority" = 'B' WHERE NOT "g"."main" AND EXISTS (SELECT 1 FROM "goals" AS "m" WHERE "m"."user_id" = "g"."user_id" AND "m"."main" AND "m"."date" <> "g"."date" AND abs("m"."date" - "g"."date") < 28);
