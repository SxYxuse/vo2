CREATE TABLE "activity_analyses" (
	"activity_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"mocked" boolean DEFAULT false NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_analyses" ADD CONSTRAINT "activity_analyses_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_analyses" ADD CONSTRAINT "activity_analyses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_analyses_user_idx" ON "activity_analyses" USING btree ("user_id");