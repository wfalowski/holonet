import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { chatCompleteDetailed, schemaResponseFormat } from "./openrouter.js";

afterEach(() => mock.restoreAll());

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("chatCompleteDetailed sends usage.include and response_format, maps usage", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    okResponse({
      choices: [{ message: { content: '{"a":1}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 7, cost: 0.00042 },
    }),
  );
  const format = schemaResponseFormat("My Schema!", [
    { name: "a", type: "number", required: true },
  ]);
  const result = await chatCompleteDetailed({
    apiKey: "k",
    model: "vendor/model",
    messages: [{ role: "user", content: "go" }],
    responseFormat: format,
  });
  assert.equal(result.content, '{"a":1}');
  assert.equal(result.tokensIn, 12);
  assert.equal(result.tokensOut, 7);
  assert.equal(result.costUsd, "0.00042");

  const init = fetchMock.mock.calls[0]?.arguments[1];
  const body = JSON.parse(String(init?.body));
  assert.deepEqual(body.usage, { include: true });
  assert.equal(body.response_format.json_schema.name, "My_Schema_");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.plugins, undefined);
});

test("chatCompleteDetailed tolerates missing usage", async () => {
  mock.method(globalThis, "fetch", async () =>
    okResponse({ choices: [{ message: { content: "hi" } }] }),
  );
  const result = await chatCompleteDetailed({
    apiKey: "k",
    model: "vendor/model",
    messages: [{ role: "user", content: "go" }],
  });
  assert.equal(result.tokensIn, null);
  assert.equal(result.costUsd, null);
});

test("chatCompleteDetailed throws on non-2xx without leaking the key", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response("nope", { status: 500 }),
  );
  await assert.rejects(
    chatCompleteDetailed({
      apiKey: "secret-key",
      model: "vendor/model",
      messages: [{ role: "user", content: "go" }],
    }),
    (err: Error) => !err.message.includes("secret-key"),
  );
});
