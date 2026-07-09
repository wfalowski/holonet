import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchemaDoc } from "@holonet/shared";
import { eq } from "drizzle-orm";
import { prompts } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

const FIELDS = [
  { name: "title", type: "string", required: true },
  {
    name: "severity",
    type: "enum",
    required: true,
    enumValues: ["low", "high"],
  },
];

test("schemas CRUD with attachedTo count and detach-on-delete", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);

  const created = await app.request("/api/schemas", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Digest", fields: FIELDS }),
  });
  assert.equal(created.status, 201);
  const doc = (await created.json()) as SchemaDoc;
  assert.equal(doc.fields.length, 2);

  const now = new Date();
  await db.insert(prompts).values({
    name: "p1",
    schemaId: doc.id,
    createdAt: now,
    updatedAt: now,
  });

  const list = await app.request("/api/schemas", { headers });
  const docs = (await list.json()) as SchemaDoc[];
  assert.equal(docs.find((d) => d.id === doc.id)?.attachedTo, 1);

  const patched = await app.request(`/api/schemas/${doc.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Digest v2", fields: FIELDS.slice(0, 1) }),
  });
  assert.equal(patched.status, 200);
  const updated = (await patched.json()) as SchemaDoc;
  assert.equal(updated.name, "Digest v2");
  assert.equal(updated.fields.length, 1);
  assert.ok(updated.updatedAt >= updated.createdAt);

  const deleted = await app.request(`/api/schemas/${doc.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 204);
  const orphan = await db.select().from(prompts).where(eq(prompts.name, "p1"));
  assert.equal(orphan[0]?.schemaId, null);
});

test("schemas reject invalid field trees", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);
  const bad = await app.request("/api/schemas", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "X", fields: [{ name: "", type: "string" }] }),
  });
  assert.equal(bad.status, 400);
});
