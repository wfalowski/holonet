import type { SchemaField } from "./prompting.js";

export type JsonSchemaObject = Record<string, unknown>;

function fieldSchema(field: SchemaField): JsonSchemaObject {
  const description = field.description
    ? { description: field.description }
    : {};
  switch (field.type) {
    case "string":
      return { type: "string", ...description };
    case "number":
      return { type: "number", ...description };
    case "boolean":
      return { type: "boolean", ...description };
    case "enum":
      return { type: "string", enum: field.enumValues ?? [], ...description };
    case "object":
      return { ...objectSchema(field.children ?? []), ...description };
    case "array":
      return {
        type: "array",
        items: field.items ? fieldSchema(field.items) : {},
        ...description,
      };
  }
}

function objectSchema(fields: SchemaField[]): JsonSchemaObject {
  const properties: Record<string, JsonSchemaObject> = {};
  for (const field of fields) properties[field.name] = fieldSchema(field);
  return {
    type: "object",
    properties,
    required: fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false,
  };
}

/** Derive a JSON Schema document from the builder field tree. Deterministic. */
export function fieldsToJsonSchema(fields: SchemaField[]): JsonSchemaObject {
  return objectSchema(fields);
}

function validateOne(
  field: SchemaField,
  value: unknown,
  path: string,
): string[] {
  switch (field.type) {
    case "string":
      return typeof value === "string" ? [] : [`${path}: expected string`];
    case "number":
      return typeof value === "number" ? [] : [`${path}: expected number`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
    case "enum": {
      const allowed = field.enumValues ?? [];
      return typeof value === "string" && allowed.includes(value)
        ? []
        : [`${path}: expected one of ${allowed.join(", ")}`];
    }
    case "object":
      return validateFields(field.children ?? [], value, path);
    case "array": {
      if (!Array.isArray(value)) return [`${path}: expected array`];
      const items = field.items;
      if (!items) return [];
      return value.flatMap((entry, i) =>
        validateOne(items, entry, `${path}[${i}]`),
      );
    }
  }
}

/** Validate a parsed JSON value against the field tree. Returns readable errors. */
export function validateFields(
  fields: SchemaField[],
  value: unknown,
  path = "$",
): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`${path}: expected object`];
  }
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const field of fields) {
    const entry = record[field.name];
    if (entry === undefined) {
      if (field.required) {
        errors.push(`${path}.${field.name}: missing required field`);
      }
      continue;
    }
    errors.push(...validateOne(field, entry, `${path}.${field.name}`));
  }
  for (const key of Object.keys(record)) {
    if (!fields.some((f) => f.name === key)) {
      errors.push(`${path}.${key}: unexpected field`);
    }
  }
  return errors;
}
