import type { OptimizeOutput } from "@holonet/shared";
import type { ChatMessage } from "./openrouter.js";

const FAMILY_GUIDANCE: Record<string, string> = {
  ANTHROPIC: [
    "- Structure complex instructions with XML tags (e.g. <context>, <task>, <rules>).",
    "- State the role explicitly up front and put critical constraints near the end.",
    "- Prefer positive instructions over prohibitions; ask for step-by-step reasoning only when needed.",
  ].join("\n"),
  XAI: [
    "- Keep instructions direct and compact; Grok responds well to terse imperative style.",
    "- Put the output-format contract in its own final paragraph.",
    "- Avoid heavy markup; use plain numbered rules.",
  ].join("\n"),
  OPENAI: [
    "- Use short markdown sections with clear headers for role, task, and output format.",
    "- Specify output format explicitly and give one compact example when ambiguous.",
    "- Avoid contradictory constraints; state priorities when rules can conflict.",
  ].join("\n"),
};

const GENERIC_GUIDANCE = [
  "- Be explicit about the role, the task, the audience, and the output format.",
  '- Remove ambiguity: quantify vague words ("short", "recent") with concrete limits.',
  "- Separate instructions from data; keep the output contract in one place.",
].join("\n");

export function buildOptimizerMessages(
  content: string,
  targetModelId: string,
  targetFamily: string,
): ChatMessage[] {
  const guidance =
    FAMILY_GUIDANCE[targetFamily.toUpperCase()] ?? GENERIC_GUIDANCE;
  const system = [
    "You are an expert prompt engineer. Rewrite the user's prompt so it performs",
    "as well as possible on the target model, preserving the original intent,",
    "language and output expectations. Do not answer the prompt itself.",
    "",
    "Guidance for the target model family:",
    guidance,
    "",
    "Return your answer in EXACTLY this format, with no other text:",
    "<improved>",
    "(the improved prompt)",
    "</improved>",
    "<rationale>",
    "(2-4 sentences on what you changed and why)",
    "</rationale>",
  ].join("\n");
  const user = [
    `Target model: ${targetModelId}`,
    "",
    "Original prompt:",
    content,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function extractBlock(raw: string, tag: string): string | null {
  const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() ?? null;
}

// Defensive: a model that ignores the format still yields a usable result.
export function parseOptimizerResponse(raw: string): OptimizeOutput {
  const improved = extractBlock(raw, "improved");
  if (improved === null || improved === "") {
    return { improved: raw.trim(), rationale: "" };
  }
  return { improved, rationale: extractBlock(raw, "rationale") ?? "" };
}
