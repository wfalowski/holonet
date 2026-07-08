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

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 120_000;

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

// POST to OpenRouter chat-completions. Enables the web plugin when requested,
// enforces a 120s ceiling merged with any caller signal, and rejects on non-2xx
// or empty content. Never embeds the API key in thrown errors.
export async function chatComplete({
  apiKey,
  model,
  messages,
  webSearch,
  signal,
}: ChatCompleteOptions): Promise<string> {
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
    body: JSON.stringify({
      model,
      messages,
      plugins: webSearch ? [{ id: "web" }] : undefined,
    }),
    signal: combined,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${res.status}): ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned empty content");
  }
  return content;
}
