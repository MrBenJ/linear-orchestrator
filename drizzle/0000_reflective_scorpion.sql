CREATE TABLE `agent_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`ts` integer NOT NULL,
	`stream` text NOT NULL,
	`chunk` blob NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_logs_run_seq` ON `agent_logs` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `config` (
	`id` integer PRIMARY KEY NOT NULL,
	`concurrency_cap` integer NOT NULL,
	`default_run_timeout_ms` integer NOT NULL,
	`heartbeat_interval_ms` integer NOT NULL,
	`heartbeat_grace_ms` integer NOT NULL,
	`project_mappings` text NOT NULL,
	`team_mappings` text NOT NULL,
	`orchestration_labels` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`status` text NOT NULL,
	`worktree_path` text,
	`branch_name` text,
	`pid` integer,
	`started_at` integer,
	`last_heartbeat_at` integer,
	`completed_at` integer,
	`exit_code` integer,
	`result` text,
	`pr_url` text,
	`pr_number` integer,
	`pr_state` text,
	`failure_reason` text,
	`callback_token` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`linear_issue_id` text NOT NULL,
	`linear_identifier` text NOT NULL,
	`linear_team_id` text NOT NULL,
	`linear_project_id` text,
	`repo_path` text NOT NULL,
	`harness` text NOT NULL,
	`prompt` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_linear_issue_id_unique` ON `tickets` (`linear_issue_id`);