CREATE TABLE "top_effort_celebrations" (
	"activity_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"placements" jsonb NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "top_effort_celebrations" ADD CONSTRAINT "top_effort_celebrations_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_effort_celebrations" ADD CONSTRAINT "top_effort_celebrations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "top_effort_celebrations_user_idx" ON "top_effort_celebrations" USING btree ("user_id","seen_at");