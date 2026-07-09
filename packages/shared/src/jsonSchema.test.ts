import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsToJsonSchema, validateFields } from "./jsonSchema.js";
import type { SchemaField } from "./prompting.js";

const FIELDS: SchemaField[] = [
  { name: "title", type: "string", required: true, description: "Headline" },
  { name: "score", type: "number", required: false },
  {
    name: "severity",
    type: "enum",
    required: true,
    enumValues: ["low", "high"],
  },
  {
    name: "meta",
    type: "object",
    required: false,
    children: [{ name: "source", type: "string", required: true }],
  },
  {
    name: "tags",
    type: "array",
    required: true,
    items: { name: "item", type: "string", required: true },
  },
];

test("fieldsToJsonSchema builds a closed object schema", () => {
  const schema = fieldsToJsonSchema(FIELDS) as {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, Record<string, unknown>>;
  };
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["title", "severity", "tags"]);
  assert.deepEqual(schema.properties.title, {
    type: "string",
    description: "Headline",
  });
  assert.deepEqual(schema.properties.severity, {
    type: "string",
    enum: ["low", "high"],
  });
  assert.equal(schema.properties.meta?.type, "object");
  assert.deepEqual(schema.properties.tags, {
    type: "array",
    items: { type: "string" },
  });
});

test("validateFields accepts a conforming object", () => {
  const errors = validateFields(FIELDS, {
    title: "hi",
    severity: "low",
    tags: ["a"],
  });
  assert.deepEqual(errors, []);
});

test("validateFields reports missing/wrong/unexpected fields with paths", () => {
  const errors = validateFields(FIELDS, {
    score: "not-a-number",
    severity: "medium",
    tags: [1],
    extra: true,
  });
  assert.ok(errors.some((e) => e.includes("$.title") && e.includes("missing")));
  assert.ok(errors.some((e) => e.includes("$.score")));
  assert.ok(errors.some((e) => e.includes("$.severity")));
  assert.ok(errors.some((e) => e.includes("$.tags[0]")));
  assert.ok(errors.some((e) => e.includes("$.extra")));
});

test("validateFields rejects non-objects", () => {
  assert.deepEqual(validateFields(FIELDS, "nope"), ["$: expected object"]);
});
