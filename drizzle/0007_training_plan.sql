CREATE TABLE "planned_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"week_start" date NOT NULL,
	"sport_family" text NOT NULL,
	"title" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"target_load" real NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athlete_metrics" ADD COLUMN "training" jsonb;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_sessions_user_week_idx" ON "planned_sessions" USING btree ("user_id","week_start");