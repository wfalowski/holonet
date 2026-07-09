import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { PlaygroundRunOutput, SchemaDoc } from "@holonet/shared";
import { models } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

afterEach(() => mock.restoreAll());

function mockCompletion(content: string) {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.001 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
}

async function setup() {
  const built = await buildApp();
  const headers = await loginHeaders(built.app);
  await built.db
    .insert(models)
    .values({ modelId: "test/model", label: "T", family: "TEST" });
  return { ...built, headers };
}

test("run without schema returns output and null validation", async () => {
  const { app, headers } = await setup();
  mockCompletion("plain answer");
  const res = await app.request("/api/playground/run", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hi", modelId: "test/model" }),
  });
  assert.equal(res.status, 200);
  const out = (await res.json()) as PlaygroundRunOutput;
  assert.equal(out.output, "plain answer");
  assert.equal(out.validation, null);
  assert.equal(out.tokensIn, 3);
  assert.equal(out.costUsd, "0.001");
});

test("run with schema validates ok and fail paths", async () => {
  const { app, headers } = await setup();
  const schemaRes = await app.request("/api/schemas", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Out",
      fields: [{ name: "title", type: "string", required: true }],
    }),
  });
  const schema = (await schemaRes.json()) as SchemaDoc;

  mockCompletion('{"title":"ok"}');
  const good = (await (
    await app.request("/api/playground/run", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "hi",
        modelId: "test/model",
        schemaId: schema.id,
      }),
    })
  ).json()) as PlaygroundRunOutput;
  assert.deepEqual(good.validation, { valid: true, errors: [] });

  mockCompletion("not json at all");
  const bad = (await (
    await app.request("/api/playground/run", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "hi",
        modelId: "test/model",
        schemaId: schema.id,
      }),
    })
  ).json()) as PlaygroundRunOutput;
  assert.equal(bad.validation?.valid, false);
  assert.ok(bad.validation?.errors[0]?.includes("not valid JSON"));
});

test("unknown model or schema -> 400; upstream failure -> 502", async () => {
  const { app, headers } = await setup();
  const unknownModel = await app.request("/api/playground/run", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hi", modelId: "no/model" }),
  });
  assert.equal(unknownModel.status, 400);

  mock.method(
    globalThis,
    "fetch",
    async () => new Response("boom", { status: 500 }),
  );
  const upstream = await app.request("/api/playground/run", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hi", modelId: "test/model" }),
  });
  assert.equal(upstream.status, 502);
});
