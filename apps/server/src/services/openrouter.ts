import { fieldsToJsonSchema, type SchemaField } from "@holonet/shared";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompleteOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  webSearch: boolean;
  signal?: AbortSignal;
}

export interface ResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
}

export interface ChatCompleteDetailedOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
}

export interface ChatCompletionDetails {
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// Reasoning models can think for many minutes before emitting the (non-streamed)
// response, so the ceiling must be generous.
const TIMEOUT_MS = 600_000;

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

// POST to OpenRouter chat-completions. Enforces a 10-minute ceiling merged with
// any caller signal and rejects on non-2xx. Never embeds the API key in thrown errors.
async function request(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ChatCompletionResponse> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/holonet",
      "X-Title": "Holonet",
    },
    body: JSON.stringify(body),
    signal: combined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as ChatCompletionResponse;
}

function requireContent(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned empty content");
  }
  return content;
}

export async function chatComplete({
  apiKey,
  model,
  messages,
  webSearch,
  signal,
}: ChatCompleteOptions): Promise<string> {
  const data = await request(
    apiKey,
    { model, messages, plugins: webSearch ? [{ id: "web" }] : undefined },
    signal,
  );
  return requireContent(data);
}

// Playground/experiment/optimizer path: no web plugin ever, usage accounting on,
// optional strict json_schema response format.
export async function chatCompleteDetailed({
  apiKey,
  model,
  messages,
  responseFormat,
  signal,
}: ChatCompleteDetailedOptions): Promise<ChatCompletionDetails> {
  const data = await request(
    apiKey,
    {
      model,
      messages,
      response_format: responseFormat,
      usage: { include: true },
    },
    signal,
  );
  return {
    content: requireContent(data),
    tokensIn: data.usage?.prompt_tokens ?? null,
    tokensOut: data.usage?.completion_tokens ?? null,
    costUsd: data.usage?.cost != null ? String(data.usage.cost) : null,
  };
}

export function schemaResponseFormat(
  name: string,
  fields: SchemaField[],
): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: name.replace(/[^a-zA-Z0-9_-]/g, "_") || "output",
      strict: true,
      schema: fieldsToJsonSchema(fields),
    },
  };
}
