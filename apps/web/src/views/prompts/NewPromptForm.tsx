import type { Folder, PromptInput, SchemaDoc } from "@holonet/shared";
import { useState } from "react";
import { AMBER, BAD, CHAKRA, DIM, HI } from "../../lib/theme.js";

const MONO = "'JetBrains Mono', monospace";

export const fieldLabel = {
  fontSize: "9px",
  letterSpacing: ".24em",
  color: DIM,
  marginBottom: "6px",
} as const;

export const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  fontFamily: MONO,
  fontSize: "12px",
  color: HI,
  background: "rgba(140,160,190,.07)",
  border: "1px solid rgba(140,160,190,.25)",
  outline: "none",
} as const;

export const primaryButton = {
  fontFamily: CHAKRA,
  fontWeight: 700,
  fontSize: "11px",
  letterSpacing: ".18em",
  padding: "9px 16px",
  cursor: "pointer",
  border: "1px solid rgba(255,179,71,.55)",
  background: "rgba(255,179,71,.16)",
  color: AMBER,
} as const;

export const ghostButton = {
  ...primaryButton,
  border: "1px solid rgba(140,160,190,.28)",
  background: "transparent",
  color: DIM,
} as const;

interface NewPromptFormProps {
  folders: Folder[];
  schemas: SchemaDoc[];
  onCancel: () => void;
  onCreate: (input: PromptInput) => void;
  isSaving: boolean;
}

export function NewPromptForm({
  folders,
  schemas,
  onCancel,
  onCreate,
  isSaving,
}: NewPromptFormProps) {
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [schemaId, setSchemaId] = useState<string>("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (name.trim() === "" || content.trim() === "") {
      setError("NAME AND CONTENT ARE REQUIRED");
      return;
    }
    setError(null);
    onCreate({
      name: name.trim(),
      folderId: folderId === "" ? null : folderId,
      schemaId: schemaId === "" ? null : schemaId,
      tags: tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== "")
        .slice(0, 12),
      content,
    });
  }

  return (
    <div
      style={{
        border: "1px solid rgba(255,179,71,.3)",
        background: "rgba(9,11,16,.72)",
        padding: "16px",
        marginBottom: "16px",
        display: "grid",
        gap: "12px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "12px",
        }}
      >
        <div>
          <div style={fieldLabel}>NAME</div>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <div style={fieldLabel}>FOLDER</div>
          <select
            style={inputStyle}
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">— NONE —</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={fieldLabel}>OUTPUT SCHEMA</div>
          <select
            style={inputStyle}
            value={schemaId}
            onChange={(e) => setSchemaId(e.target.value)}
          >
            <option value="">— NONE —</option>
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div style={fieldLabel}>TAGS (COMMA-SEPARATED)</div>
        <input
          style={inputStyle}
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
        />
      </div>
      <div>
        <div style={fieldLabel}>CONTENT · V1</div>
        <textarea
          style={{ ...inputStyle, minHeight: "140px", resize: "vertical" }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      {error && (
        <div style={{ color: BAD, fontSize: "10px", letterSpacing: ".14em" }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          style={primaryButton}
          disabled={isSaving}
          onClick={submit}
        >
          {isSaving ? "SAVING…" : "CREATE PROMPT"}
        </button>
        <button type="button" style={ghostButton} onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
