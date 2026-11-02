CREATE TABLE "coach_chat_interrupts" (
	"interrupt_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_chat_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_chat_interrupts" ADD CONSTRAINT "coach_chat_interrupts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_chat_runs" ADD CONSTRAINT "coach_chat_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_chats" ADD CONSTRAINT "coach_chats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_chat_interrupts_thread_idx" ON "coach_chat_interrupts" USING btree ("thread_id","requested_at");--> statement-breakpoint
CREATE INDEX "coach_chat_interrupts_run_idx" ON "coach_chat_interrupts" USING btree ("run_id","requested_at");--> statement-breakpoint
CREATE INDEX "coach_chat_runs_thread_idx" ON "coach_chat_runs" USING btree ("thread_id","started_at");--> statement-breakpoint
CREATE INDEX "coach_chats_user_updated_idx" ON "coach_chats" USING btree ("user_id","updated_at");