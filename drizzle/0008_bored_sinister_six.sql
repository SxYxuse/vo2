CREATE TABLE "field_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"activity_id" text,
	"result" jsonb,
	"suggested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_tests" ADD CONSTRAINT "field_tests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_tests" ADD CONSTRAINT "field_tests_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_tests_user_assessment_idx" ON "field_tests" USING btree ("user_id","assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_tests_open_suggestion_idx" ON "field_tests" USING btree ("user_id","assessment_id") WHERE "field_tests"."status" = 'suggested';--> statement-breakpoint
CREATE UNIQUE INDEX "field_tests_activity_idx" ON "field_tests" USING btree ("activity_id");