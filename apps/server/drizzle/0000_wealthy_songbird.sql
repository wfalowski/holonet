CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"task_name" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"web_search" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"webhook_url" text NOT NULL,
	"channel" text NOT NULL,
	"dedupe" boolean DEFAULT true NOT NULL,
	"format" text DEFAULT 'digest' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_task_id_idx" ON "runs" USING btree ("task_id");