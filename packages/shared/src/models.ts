export const MODELS = [
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "SONNET 4.5",
    family: "ANTHROPIC",
  },
  { id: "anthropic/claude-opus-4.1", label: "OPUS 4.1", family: "ANTHROPIC" },
  { id: "x-ai/grok-4", label: "GROK 4", family: "xAI" },
  { id: "x-ai/grok-3", label: "GROK 3", family: "xAI" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export const MODEL_IDS = MODELS.map((m) => m.id) as [ModelId, ...ModelId[]];
