import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { buildApp, loginHeaders } from "./test-helpers.js";

afterEach(() => mock.restoreAll());

const validTask = {
  name: "Test Task",
  cron: "30 9 * * *",
  prompt: "Summarize today's headlines",
  model: "anthropic/claude-sonnet-4.5",
  webSearch: true,
  enabled: true,
  dedupe: true,
  webhookUrl: "https://discord.com/api/webhooks/123/abc",
  channel: "general",
  format: "digest",
  sources: [],
};

test("models API: CRUD, seed, conflicts, task membership check", async () => {
  const { app, scheduler } = await buildApp();

  // Auth guard.
  const noAuth = await app.request("/api/models");
  assert.equal(noAuth.status, 401);

  const auth = await loginHeaders(app);

  // Seeded list.
  const listRes = await app.request("/api/models", { headers: auth });
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as {
    id: string;
    modelId: string;
    label: string;
    family: string;
    createdAt: number;
    inUse: number;
  }[];
  assert.equal(list.length, 4);
  assert.ok(list.every((m) => m.inUse === 0));
  assert.ok(list.every((m) => typeof m.createdAt === "number"));
  const sonnet = list.find((m) => m.modelId === "anthropic/claude-sonnet-4.5");
  assert.ok(sonnet);

  // Create.
  const createRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-5.2",
      label: "GPT 5.2",
      family: "OPENAI",
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { id: string; inUse: number };
  assert.ok(created.id);
  assert.equal(created.inUse, 0);

  // Invalid body.
  const badRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: "no-slash", label: "X", family: "Y" }),
  });
  assert.equal(badRes.status, 400);

  // Duplicate.
  const dupRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-5.2",
      label: "DUPE",
      family: "OPENAI",
    }),
  });
  assert.equal(dupRes.status, 409);

  // Patch label/family.
  const patchRes = await app.request(`/api/models/${created.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ label: "GPT 5.2 TURBO", family: "OPENAI" }),
  });
  assert.equal(patchRes.status, 200);
  const patched = (await patchRes.json()) as { label: string };
  assert.equal(patched.label, "GPT 5.2 TURBO");

  // Patch unknown id.
  const patch404 = await app.request(
    "/api/models/00000000-0000-0000-0000-000000000000",
    {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "X", family: "Y" }),
    },
  );
  assert.equal(patch404.status, 404);

  // Task using an uncataloged model is rejected.
  const badTask = await app.request("/api/tasks", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ...validTask, model: "vendor/not-in-catalog" }),
  });
  assert.equal(badTask.status, 400);
  const badTaskBody = (await badTask.json()) as {
    error: { code: string };
  };
  assert.equal(badTaskBody.error.code, "VALIDATION");

  // Create a task using gpt-5.2, then deleting that model is blocked.
  const taskRes = await app.request("/api/tasks", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ...validTask, model: "openai/gpt-5.2" }),
  });
  assert.equal(taskRes.status, 201);
  const task = (await taskRes.json()) as { id: string };

  const delBlocked = await app.request(`/api/models/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(delBlocked.status, 409);

  // inUse is reported.
  const listRes2 = await app.request("/api/models", { headers: auth });
  const list2 = (await listRes2.json()) as { modelId: string; inUse: number }[];
  assert.equal(list2.find((m) => m.modelId === "openai/gpt-5.2")?.inUse, 1);

  // Delete the task, then the model deletes cleanly.
  const delTask = await app.request(`/api/tasks/${task.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(delTask.status, 204);

  const delOk = await app.request(`/api/models/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(delOk.status, 204);

  const del404 = await app.request(`/api/models/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(del404.status, 404);

  scheduler.stop();
});

test("models API: pricing fields", async () => {
  const { app, scheduler } = await buildApp();
  const auth = await loginHeaders(app);

  // Seeded models have no prices.
  const seeded = await app.request("/api/models", { headers: auth });
  const seededList = (await seeded.json()) as {
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  }[];
  assert.ok(seededList.every((m) => m.inputCostPerMTok === null));
  assert.ok(seededList.every((m) => m.outputCostPerMTok === null));

  // Create with prices.
  const createRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-5.2",
      label: "GPT 5.2",
      family: "OPENAI",
      inputCostPerMTok: 1.25,
      outputCostPerMTok: 10,
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as {
    id: string;
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  };
  assert.equal(created.inputCostPerMTok, 1.25);
  assert.equal(created.outputCostPerMTok, 10);

  // Create without prices defaults to null.
  const bare = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/o5",
      label: "O5",
      family: "OPENAI",
    }),
  });
  assert.equal(bare.status, 201);
  const bareBody = (await bare.json()) as { inputCostPerMTok: number | null };
  assert.equal(bareBody.inputCostPerMTok, null);

  // Negative price rejected.
  const neg = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-neg",
      label: "NEG",
      family: "OPENAI",
      inputCostPerMTok: -1,
    }),
  });
  assert.equal(neg.status, 400);

  // PATCH updates prices; omitting a field leaves it unchanged.
  const patch = await app.request(`/api/models/${created.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "GPT 5.2",
      family: "OPENAI",
      inputCostPerMTok: 2.5,
    }),
  });
  assert.equal(patch.status, 200);
  const patched = (await patch.json()) as {
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  };
  assert.equal(patched.inputCostPerMTok, 2.5);
  assert.equal(patched.outputCostPerMTok, 10);

  // PATCH with null clears a price.
  const clear = await app.request(`/api/models/${created.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "GPT 5.2",
      family: "OPENAI",
      outputCostPerMTok: null,
    }),
  });
  assert.equal(clear.status, 200);
  const cleared = (await clear.json()) as {
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  };
  assert.equal(cleared.inputCostPerMTok, 2.5);
  assert.equal(cleared.outputCostPerMTok, null);

  scheduler.stop();
});

function pricingResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("models API: sync-pricing updates matched models from OpenRouter", async () => {
  const { app, scheduler } = await buildApp();
  const auth = await loginHeaders(app);

  mock.method(globalThis, "fetch", async () =>
    pricingResponse({
      data: [
        {
          id: "anthropic/claude-sonnet-4.5",
          pricing: { prompt: "0.000003", completion: "0.000015" },
        },
        {
          id: "anthropic/claude-opus-4.1",
          pricing: { prompt: "not-a-number", completion: "0.000075" },
        },
        {
          id: "some/other-model",
          pricing: { prompt: "0.000001", completion: "0.000002" },
        },
      ],
    }),
  );

  const res = await app.request("/api/models/sync-pricing", {
    method: "POST",
    headers: auth,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { updated: string[]; notFound: string[] };
  assert.deepEqual(body.updated, ["anthropic/claude-sonnet-4.5"]);
  // Unmatched on OpenRouter, or matched with unparsable pricing.
  assert.deepEqual(body.notFound, [
    "anthropic/claude-opus-4.1",
    "x-ai/grok-3",
    "x-ai/grok-4",
  ]);

  const list = await app.request("/api/models", { headers: auth });
  const listBody = (await list.json()) as {
    modelId: string;
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  }[];
  const sonnet = listBody.find(
    (m) => m.modelId === "anthropic/claude-sonnet-4.5",
  );
  assert.equal(sonnet?.inputCostPerMTok, 3);
  assert.equal(sonnet?.outputCostPerMTok, 15);
  const opus = listBody.find((m) => m.modelId === "anthropic/claude-opus-4.1");
  assert.equal(opus?.inputCostPerMTok, null);

  scheduler.stop();
});

test("models API: sync-pricing returns 502 when OpenRouter is down", async () => {
  const { app, scheduler } = await buildApp();
  const auth = await loginHeaders(app);

  mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });

  const res = await app.request("/api/models/sync-pricing", {
    method: "POST",
    headers: auth,
  });
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "UPSTREAM");

  scheduler.stop();
});
