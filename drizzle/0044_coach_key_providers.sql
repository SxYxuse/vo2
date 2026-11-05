ALTER TABLE "coach_keys" ADD COLUMN "provider" text DEFAULT 'openrouter' NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_keys" DROP CONSTRAINT "coach_keys_pkey";--> statement-breakpoint
ALTER TABLE "coach_keys" ADD CONSTRAINT "coach_keys_user_id_provider_pk" PRIMARY KEY("user_id","provider");
