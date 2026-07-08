CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"family" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_model_id_unique" UNIQUE("model_id")
);
--> statement-breakpoint
INSERT INTO "models" ("model_id", "label", "family") VALUES
  ('anthropic/claude-sonnet-4.5', 'SONNET 4.5', 'ANTHROPIC'),
  ('anthropic/claude-opus-4.1', 'OPUS 4.1', 'ANTHROPIC'),
  ('x-ai/grok-4', 'GROK 4', 'xAI'),
  ('x-ai/grok-3', 'GROK 3', 'xAI');
