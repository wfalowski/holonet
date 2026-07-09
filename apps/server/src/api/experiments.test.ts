import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Experiment,
  ExperimentDetail,
  Prompt,
  PromptDetail,
} from "@holonet/shared";
import { models } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

async function waitForDone(
  app: Awaited<ReturnType<typeof buildApp>>["app"],
  headers: { Cookie: string },
  id: string,
): Promise<ExperimentDetail> {
  for (let i = 0; i < 40; i++) {
    const res = await app.request(`/api/experiments/${id}`, { headers });
    const detail = (await res.json()) as ExperimentDetail;
    if (detail.status !== "running") return detail;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("experiment never finished");
}

test("experiment matrix runs to done with per-cell results and winner marking", async () => {
  const { app, db } = await buildApp({
    complete: async ({ model }) => {
      if (model === "bad/model") throw new Error("nope");
      return {
        content: `out:${model}`,
        tokensIn: 1,
        tokensOut: 2,
        costUsd: "0.01",
      };
    },
  });
  const headers = await loginHeaders(app);
  await db.insert(models).values([
    { modelId: "good/model", label: "G", family: "TEST" },
    { modelId: "bad/model", label: "B", family: "TEST" },
  ]);

  const promptRes = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "P", content: "v1 content" }),
  });
  const prompt = (await promptRes.json()) as Prompt;
  await app.request(`/api/prompts/${prompt.id}/versions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "v2 content" }),
  });
  const detail = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  const versionIds = detail.versions.map((v) => v.id);

  const created = await app.request("/api/experiments", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      promptId: prompt.id,
      versionIds,
      modelIds: ["good/model", "bad/model", "good/model"],
    }),
  });
  assert.equal(created.status, 201);
  const experiment = (await created.json()) as ExperimentDetail;
  assert.equal(experiment.totalCount, 4);

  const done = await waitForDone(app, headers, experiment.id);
  assert.equal(done.status, "done");
  assert.equal(done.okCount, 2);
  assert.equal(done.failCount, 2);
  const okCell = done.results.find(
    (r) => r.modelId === "good/model" && r.versionNumber === 2,
  );
  assert.equal(okCell?.output, "out:good/model");

  // winner marking
  const marked = await app.request(
    `/api/experiments/${experiment.id}/results/${okCell?.id}`,
    {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ winner: true }),
    },
  );
  assert.equal(marked.status, 200);
  const after = await waitForDone(app, headers, experiment.id);
  assert.equal(after.results.find((r) => r.id === okCell?.id)?.winner, true);

  // list endpoint carries counts
  const list = (await (
    await app.request("/api/experiments", { headers })
  ).json()) as Experiment[];
  assert.equal(list[0]?.okCount, 2);
});

test("experiment validation: foreign versions and unknown models -> 400", async () => {
  const { app, db } = await buildApp({
    complete: async () => ({
      content: "x",
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
    }),
  });
  const headers = await loginHeaders(app);
  await db
    .insert(models)
    .values({ modelId: "good/model", label: "G", family: "TEST" });
  const promptRes = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "P", content: "c" }),
  });
  const prompt = (await promptRes.json()) as Prompt;

  const badVersion = await app.request("/api/experiments", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      promptId: prompt.id,
      versionIds: ["00000000-0000-4000-8000-000000000000"],
      modelIds: ["good/model"],
    }),
  });
  assert.equal(badVersion.status, 400);

  const detail = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  const badModel = await app.request("/api/experiments", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      promptId: prompt.id,
      versionIds: [detail.versions[0]?.id],
      modelIds: ["not/in-catalog"],
    }),
  });
  assert.equal(badModel.status, 400);
});
