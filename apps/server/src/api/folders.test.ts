import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { promptFolders, prompts } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

test("folders CRUD with prompt counts and set-null on delete", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);

  // create
  const created = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "News" }),
  });
  assert.equal(created.status, 201);
  const folder = (await created.json()) as { id: string; name: string };
  assert.equal(folder.name, "News");

  // duplicate name -> 409
  const dupe = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "News" }),
  });
  assert.equal(dupe.status, 409);

  // a prompt in the folder shows up in promptCount
  const now = new Date();
  await db.insert(prompts).values({
    name: "p1",
    folderId: folder.id,
    createdAt: now,
    updatedAt: now,
  });
  const list = await app.request("/api/folders", { headers });
  assert.equal(list.status, 200);
  const folders = (await list.json()) as { id: string; promptCount: number }[];
  assert.equal(folders.find((f) => f.id === folder.id)?.promptCount, 1);

  // rename
  const renamed = await app.request(`/api/folders/${folder.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Research" }),
  });
  assert.equal(renamed.status, 200);

  // delete -> prompt keeps living, folderId nulled by FK
  const deleted = await app.request(`/api/folders/${folder.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 204);
  const orphaned = await db
    .select()
    .from(prompts)
    .where(eq(prompts.name, "p1"));
  assert.equal(orphaned[0]?.folderId, null);
  const gone = await db
    .select()
    .from(promptFolders)
    .where(eq(promptFolders.id, folder.id));
  assert.equal(gone.length, 0);
});

test("folders reject invalid payloads and unknown ids", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);
  const bad = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "" }),
  });
  assert.equal(bad.status, 400);
  const missing = await app.request(
    "/api/folders/00000000-0000-4000-8000-000000000000",
    { method: "DELETE", headers },
  );
  assert.equal(missing.status, 404);
});
