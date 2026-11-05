CREATE TABLE "power_files" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"file" "bytea" NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"summary" jsonb NOT NULL,
	"analysis" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "power_files" ADD CONSTRAINT "power_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "power_files_user_hash_idx" ON "power_files" USING btree ("user_id","file_hash");--> statement-breakpoint
CREATE INDEX "power_files_user_start_idx" ON "power_files" USING btree ("user_id","start_date");