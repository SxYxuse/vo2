CREATE TABLE "route_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sport_type" text NOT NULL,
	"carb_target" real NOT NULL,
	"bottle_count" integer NOT NULL,
	"bottle_ml" integer NOT NULL,
	"prediction" jsonb NOT NULL,
	"proposals" jsonb NOT NULL,
	"chosen" jsonb,
	"catalog_fetched_at" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_plans_user_created_idx" ON "route_plans" USING btree ("user_id","created_at");