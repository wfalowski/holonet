CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`task_name` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `runs_created_at_idx` ON `runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `runs_task_id_idx` ON `runs` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cron` text NOT NULL,
	`prompt` text NOT NULL,
	`model` text NOT NULL,
	`web_search` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`webhook_url` text NOT NULL,
	`channel` text NOT NULL,
	`dedupe` integer DEFAULT true NOT NULL,
	`format` text DEFAULT 'digest' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
