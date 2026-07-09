import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ExperimentInputSchema,
  PromptInputSchema,
  SchemaFieldSchema,
} from "./prompting.js";

test("PromptInputSchema defaults folderId/schemaId to null and tags to []", () => {
  const parsed = PromptInputSchema.parse({ name: "News", content: "Say hi" });
  assert.equal(parsed.folderId, null);
  assert.equal(parsed.schemaId, null);
  assert.deepEqual(parsed.tags, []);
});

test("SchemaFieldSchema parses recursive object/array/enum fields", () => {
  const field = SchemaFieldSchema.parse({
    name: "items",
    type: "array",
    required: true,
    items: {
      name: "item",
      type: "object",
      required: true,
      children: [
        { name: "title", type: "string", required: true },
        {
          name: "severity",
          type: "enum",
          required: false,
          enumValues: ["low", "high"],
        },
      ],
    },
  });
  assert.equal(field.items?.children?.length, 2);
});

test("ExperimentInputSchema rejects empty version/model lists", () => {
  assert.equal(
    ExperimentInputSchema.safeParse({
      promptId: "0b8f4a52-1111-4222-8333-444455556666",
      versionIds: [],
      modelIds: ["a/b"],
    }).success,
    false,
  );
});
