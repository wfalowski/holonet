export interface PostWebhookOptions {
  url: string;
  title: string;
  content: string;
}

const MAX_CHUNK = 4000;
const EMBED_COLOR = 0xffb347;

// Split content into <=maxChunk pieces on newline boundaries. A single line that
// exceeds maxChunk on its own is hard-split into maxChunk-sized slices.
export function splitDiscordChunks(
  content: string,
  maxChunk = MAX_CHUNK,
): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of content.split("\n")) {
    if (line.length > maxChunk) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += maxChunk) {
        chunks.push(line.slice(i, i + maxChunk));
      }
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChunk) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

interface DiscordEmbed {
  title?: string;
  description: string;
  color: number;
}

function withWait(url: string): string {
  return url.includes("?") ? `${url}&wait=true` : `${url}?wait=true`;
}

interface RateLimitBody {
  retry_after?: number;
}

async function sendEmbed(url: string, embed: DiscordEmbed): Promise<void> {
  const body = JSON.stringify({ embeds: [embed] });
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

  let res = await send();
  if (res.status === 429) {
    const info = (await res.json().catch(() => null)) as RateLimitBody | null;
    const retryAfter =
      typeof info?.retry_after === "number" ? info.retry_after : 1;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
    res = await send();
  }
  if (!res.ok) {
    throw new Error(`Discord webhook failed (${res.status})`);
  }
}

// Relay content to a Discord webhook as one or more amber embeds. The title is
// attached to the first embed only; chunks are sent sequentially with ?wait=true
// so Discord confirms each delivery. Errors never include the webhook token.
export async function postWebhook({
  url,
  title,
  content,
}: PostWebhookOptions): Promise<void> {
  const chunks = splitDiscordChunks(content);
  const target = withWait(url);
  for (let i = 0; i < chunks.length; i++) {
    const embed: DiscordEmbed = {
      description: chunks[i] as string,
      color: EMBED_COLOR,
    };
    if (i === 0) embed.title = title;
    await sendEmbed(target, embed);
  }
}
