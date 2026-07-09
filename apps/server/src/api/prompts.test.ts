import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Prompt, PromptDetail, PromptVersion } from "@holonet/shared";
import { eq } from "drizzle-orm";
import { models, promptVersions } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

async function createPrompt(
  app: Awaited<ReturnType<typeof buildApp>>["app"],
  headers: { Cookie: string },
  body: Record<string, unknown>,
): Promise<Prompt> {
  const res = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as Prompt;
}

afterEach(() => mock.restoreAll());

test("optimize returns improved+rationale and saves nothing", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);
  await db.insert(models).values([
    { modelId: "test/target-model", label: "TGT", family: "TEST" },
    { modelId: "test/optimizer-model", label: "OPT", family: "TEST" },
  ]);
  const prompt = await createPrompt(app, headers, {
    name: "P",
    content: "old",
  });
  const detail = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  const versionId = detail.versions[0]?.id as string;

  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "<improved>\nnew prompt\n</improved>\n<rationale>\nbetter\n</rationale>",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );

  const res = await app.request(`/api/prompts/${prompt.id}/optimize`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      versionId,
      targetModelId: "test/target-model",
      optimizerModelId: "test/optimizer-model",
    }),
  });
  assert.equal(res.status, 200);
  const out = (await res.json()) as { improved: string; rationale: string };
  assert.equal(out.improved, "new prompt");
  assert.equal(out.rationale, "better");

  const after = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  assert.equal(after.versionCount, 1); // nothing saved

  const badModel = await app.request(`/api/prompts/${prompt.id}/optimize`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      versionId,
      targetModelId: "not/in-catalog",
      optimizerModelId: "test/optimizer-model",
    }),
  });
  assert.equal(badModel.status, 400);
});

test("create seeds v1; saves increment; metadata patch adds no version", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);

  const prompt = await createPrompt(app, headers, {
    name: "Daily digest",
    tags: ["news"],
    content: "Summarize AI news.",
  });
  assert.equal(prompt.headVersion, 1);
  assert.equal(prompt.versionCount, 1);

  const v2 = await app.request(`/api/prompts/${prompt.id}/versions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "Summarize AI news briefly.",
      note: "tighter",
    }),
  });
  assert.equal(v2.status, 201);
  assert.equal(((await v2.json()) as PromptVersion).version, 2);

  const patched = await app.request(`/api/prompts/${prompt.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Daily digest v2", tags: ["news", "ai"] }),
  });
  assert.equal(patched.status, 200);

  const detailRes = await app.request(`/api/prompts/${prompt.id}`, { headers });
  const detail = (await detailRes.json()) as PromptDetail;
  assert.equal(detail.name, "Daily digest v2");
  assert.equal(detail.versionCount, 2);
  assert.equal(detail.headVersion, 2);
  assert.deepEqual(
    detail.versions.map((v) => v.version),
    [2, 1],
  );
  assert.equal(detail.versions[0]?.note, "tighter");
});

test("list filters by folderId/none, tag and q", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);
  const folderRes = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "News" }),
  });
  const folder = (await folderRes.json()) as { id: string };

  await createPrompt(app, headers, {
    name: "Alpha",
    folderId: folder.id,
    tags: ["news"],
    content: "a",
  });
  await createPrompt(app, headers, {
    name: "Beta",
    tags: ["fun"],
    content: "b",
  });

  const byFolder = (await (
    await app.request(`/api/prompts?folderId=${folder.id}`, { headers })
  ).json()) as Prompt[];
  assert.deepEqual(
    byFolder.map((p) => p.name),
    ["Alpha"],
  );

  const folderless = (await (
    await app.request("/api/prompts?folderId=none", { headers })
  ).json()) as Prompt[];
  assert.deepEqual(
    folderless.map((p) => p.name),
    ["Beta"],
  );

  const byTag = (await (
    await app.request("/api/prompts?tag=fun", { headers })
  ).json()) as Prompt[];
  assert.deepEqual(
    byTag.map((p) => p.name),
    ["Beta"],
  );

  const byQ = (await (
    await app.request("/api/prompts?q=alph", { headers })
  ).json()) as Prompt[];
  assert.deepEqual(
    byQ.map((p) => p.name),
    ["Alpha"],
  );
});

test("delete cascades versions; unknown folder/schema ids -> 400", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);
  const prompt = await createPrompt(app, headers, { name: "X", content: "c" });

  const bad = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Y",
      content: "c",
      folderId: "00000000-0000-4000-8000-000000000000",
    }),
  });
  assert.equal(bad.status, 400);

  const del = await app.request(`/api/prompts/${prompt.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(del.status, 204);
  const versions = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.promptId, prompt.id));
  assert.equal(versions.length, 0);
});
