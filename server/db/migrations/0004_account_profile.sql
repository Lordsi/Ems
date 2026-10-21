ALTER TABLE "users" ADD COLUMN "phone" varchar(40);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_language" varchar(16) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_announcements" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_language_ck" CHECK ("users"."preferred_language" in ('en','ny','tum'));