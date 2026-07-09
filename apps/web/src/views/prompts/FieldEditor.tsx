import type { SchemaField, SchemaFieldType } from "@holonet/shared";
import { BAD, DIM } from "../../lib/theme.js";
import { ghostButton, inputStyle } from "./NewPromptForm.js";

const TYPES: SchemaFieldType[] = [
  "string",
  "number",
  "boolean",
  "enum",
  "object",
  "array",
];

export function newField(name = ""): SchemaField {
  return { name, type: "string", required: true };
}

interface FieldEditorProps {
  field: SchemaField;
  onChange: (field: SchemaField) => void;
  onRemove: () => void;
  depth: number;
  isArrayItem?: boolean;
}

export function FieldEditor({
  field,
  onChange,
  onRemove,
  depth,
  isArrayItem,
}: FieldEditorProps) {
  const isItem = Boolean(isArrayItem);
  return (
    <div
      style={{
        borderLeft: depth > 0 ? "1px solid rgba(140,160,190,.2)" : "none",
        paddingLeft: depth > 0 ? "14px" : 0,
        marginBottom: "8px",
      }}
    >
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {!isItem && (
          <input
            style={{ ...inputStyle, width: "150px" }}
            placeholder="field_name"
            value={field.name}
            onChange={(e) => onChange({ ...field, name: e.target.value })}
          />
        )}
        <select
          style={{ ...inputStyle, width: "100px" }}
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as SchemaFieldType;
            const next: SchemaField = { ...field, type };
            if (type === "object" && !next.children) next.children = [];
            if (type === "array" && !next.items)
              next.items = { ...newField("item") };
            onChange(next);
          }}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {!isItem && (
          <button
            type="button"
            title="Toggle required"
            style={{
              ...ghostButton,
              padding: "6px 10px",
              fontSize: "9px",
              color: field.required ? undefined : DIM,
              opacity: field.required ? 1 : 0.6,
            }}
            onClick={() => onChange({ ...field, required: !field.required })}
          >
            {field.required ? "REQ" : "OPT"}
          </button>
        )}
        <input
          style={{ ...inputStyle, flex: 1 }}
          placeholder="description (optional)"
          value={field.description ?? ""}
          onChange={(e) =>
            onChange({
              ...field,
              description: e.target.value === "" ? undefined : e.target.value,
            })
          }
        />
        {!isItem && (
          <button
            type="button"
            title="Remove field"
            style={{
              ...ghostButton,
              padding: "6px 10px",
              color: BAD,
              borderColor: "rgba(255,93,108,.35)",
            }}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>

      {field.type === "enum" && (
        <input
          style={{ ...inputStyle, marginTop: "6px" }}
          placeholder="enum values, comma-separated"
          value={(field.enumValues ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              ...field,
              enumValues: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter((v) => v !== ""),
            })
          }
        />
      )}

      {field.type === "object" && (
        <div style={{ marginTop: "8px" }}>
          {(field.children ?? []).map((child, i) => (
            <FieldEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: field name alone isn't unique/stable while editing; index scoping is acceptable here
              key={`${i}-${child.name}`}
              field={child}
              depth={depth + 1}
              onChange={(next) => {
                const children = [...(field.children ?? [])];
                children[i] = next;
                onChange({ ...field, children });
              }}
              onRemove={() =>
                onChange({
                  ...field,
                  children: (field.children ?? []).filter((_, j) => j !== i),
                })
              }
            />
          ))}
          <button
            type="button"
            style={{ ...ghostButton, padding: "4px 10px", fontSize: "9px" }}
            onClick={() =>
              onChange({
                ...field,
                children: [...(field.children ?? []), newField()],
              })
            }
          >
            + FIELD
          </button>
        </div>
      )}

      {field.type === "array" && field.items && (
        <div style={{ marginTop: "8px" }}>
          <div
            style={{
              fontSize: "8.5px",
              letterSpacing: ".2em",
              color: DIM,
              marginBottom: "4px",
            }}
          >
            ITEM TYPE
          </div>
          <FieldEditor
            field={field.items}
            depth={depth + 1}
            isArrayItem={true}
            onChange={(items) => onChange({ ...field, items })}
            onRemove={() => {}}
          />
        </div>
      )}
    </div>
  );
}
