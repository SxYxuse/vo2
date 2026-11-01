CREATE TABLE "coach_plans" (
	"user_id" text PRIMARY KEY NOT NULL,
	"availability" jsonb NOT NULL,
	"time_zone" text NOT NULL,
	"plan" jsonb,
	"status" text DEFAULT 'idle' NOT NULL,
	"error" text,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_from" date,
	"attempt_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_plans" ADD CONSTRAINT "coach_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;