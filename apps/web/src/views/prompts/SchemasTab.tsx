import type { SchemaDoc, SchemaField } from "@holonet/shared";
import { fieldsToJsonSchema } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createSchema,
  deleteSchema,
  schemasQueryOptions,
  updateSchema,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, BAD, CHAKRA, DIM, HI } from "../../lib/theme.js";
import { FieldEditor, newField } from "./FieldEditor.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";
import type { PromptsTabProps } from "./PromptsView.js";
import { TestRunModal } from "./TestRunModal.js";

const MONO = "'JetBrains Mono', monospace";

type EditorState =
  | { mode: "new"; name: string; fields: SchemaField[] }
  | {
      mode: "edit";
      id: string;
      name: string;
      fields: SchemaField[];
      saved: SchemaDoc;
    };

export function SchemasTab({ models, pushToast }: PromptsTabProps) {
  const queryClient = useQueryClient();
  const schemasQuery = useQuery(schemasQueryOptions);
  const schemas = schemasQuery.data ?? [];

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [testPrompt, setTestPrompt] = useState("");
  const [testing, setTesting] = useState<{
    content: string;
    schemaId: string;
  } | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["schemas"] });
    queryClient.invalidateQueries({ queryKey: ["prompts"] });
  }

  const saveMutation = useMutation({
    mutationFn: (state: EditorState) =>
      state.mode === "new"
        ? createSchema({ name: state.name, fields: state.fields })
        : updateSchema(state.id, { name: state.name, fields: state.fields }),
    onSuccess: (doc) => {
      invalidate();
      setEditor({
        mode: "edit",
        id: doc.id,
        name: doc.name,
        fields: doc.fields,
        saved: doc,
      });
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSchema(id),
    onSuccess: () => {
      invalidate();
      setEditor(null);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const dirty =
    editor?.mode === "edit" &&
    (editor.name !== editor.saved.name ||
      JSON.stringify(editor.fields) !== JSON.stringify(editor.saved.fields));

  if (editor) {
    const canSave = editor.name.trim() !== "" && editor.fields.length > 0;
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 380px",
          gap: "20px",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginBottom: "14px",
              alignItems: "end",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={fieldLabel}>SCHEMA NAME</div>
              <input
                style={{ ...inputStyle, fontFamily: CHAKRA, fontSize: "14px" }}
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
            </div>
            <button
              type="button"
              style={{ ...primaryButton, opacity: canSave ? 1 : 0.45 }}
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate(editor)}
            >
              {saveMutation.isPending ? "SAVING…" : "SAVE"}
            </button>
            <button
              type="button"
              style={ghostButton}
              onClick={() => setEditor(null)}
            >
              BACK
            </button>
          </div>

          <div style={fieldLabel}>FIELDS</div>
          {editor.fields.map((field, i) => (
            <FieldEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: field name alone isn't unique/stable while editing; index scoping is acceptable here
              key={`${i}-${field.name}`}
              field={field}
              depth={0}
              onChange={(next) => {
                const fields = [...editor.fields];
                fields[i] = next;
                setEditor({ ...editor, fields });
              }}
              onRemove={() =>
                setEditor({
                  ...editor,
                  fields: editor.fields.filter((_, j) => j !== i),
                })
              }
            />
          ))}
          <button
            type="button"
            style={{ ...ghostButton, marginTop: "4px" }}
            onClick={() =>
              setEditor({ ...editor, fields: [...editor.fields, newField()] })
            }
          >
            + ADD FIELD
          </button>

          {editor.mode === "edit" && (
            <div style={{ marginTop: "26px" }}>
              <div style={fieldLabel}>
                TEST AGAINST A MODEL {dirty ? "· SAVE FIRST" : ""}
              </div>
              <textarea
                style={{
                  ...inputStyle,
                  fontFamily: MONO,
                  minHeight: "90px",
                  resize: "vertical",
                }}
                placeholder="Prompt to run with this schema enforced…"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
              />
              <button
                type="button"
                style={{
                  ...primaryButton,
                  marginTop: "8px",
                  opacity: !dirty && testPrompt.trim() !== "" ? 1 : 0.45,
                }}
                disabled={Boolean(dirty) || testPrompt.trim() === ""}
                onClick={() =>
                  setTesting({ content: testPrompt, schemaId: editor.id })
                }
              >
                TEST RUN
              </button>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div>
          <div style={fieldLabel}>JSON SCHEMA · LIVE</div>
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "10.5px",
              lineHeight: 1.55,
              padding: "12px",
              overflow: "auto",
              maxHeight: "70vh",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              color: HI,
              margin: 0,
            }}
          >
            {JSON.stringify(fieldsToJsonSchema(editor.fields), null, 2)}
          </pre>
          <button
            type="button"
            style={{ ...ghostButton, marginTop: "8px" }}
            onClick={() => {
              navigator.clipboard
                .writeText(
                  JSON.stringify(fieldsToJsonSchema(editor.fields), null, 2),
                )
                .then(() => pushToast("SCHEMA COPIED"))
                .catch(() => pushToast("COPY FAILED"));
            }}
          >
            COPY
          </button>
        </div>

        {testing && (
          <TestRunModal
            content={testing.content}
            schemaId={testing.schemaId}
            models={models}
            onClose={() => setTesting(null)}
            pushToast={pushToast}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "14px",
        }}
      >
        <button
          type="button"
          style={primaryButton}
          onClick={() =>
            setEditor({ mode: "new", name: "", fields: [newField()] })
          }
        >
          + NEW SCHEMA
        </button>
      </div>
      {schemas.length === 0 ? (
        <div
          style={{
            color: DIM,
            fontSize: "12px",
            letterSpacing: ".1em",
            padding: "30px 0",
          }}
        >
          NO SCHEMAS YET.
        </div>
      ) : (
        schemas.map((s) => (
          <div
            key={s.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: "14px",
              alignItems: "center",
              padding: "12px 14px",
              marginBottom: "6px",
              border: "1px solid rgba(140,160,190,.16)",
              background: "rgba(9,11,16,.55)",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setEditor({
                  mode: "edit",
                  id: s.id,
                  name: s.name,
                  fields: s.fields,
                  saved: s,
                })
              }
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                color: HI,
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "13px",
                letterSpacing: ".08em",
                padding: 0,
              }}
            >
              {s.name}
            </button>
            <span style={{ fontSize: "10px", color: DIM }}>
              {s.fields.length} FIELDS
            </span>
            <span
              style={{
                fontSize: "10px",
                color: s.attachedTo > 0 ? AMBER : DIM,
              }}
            >
              {s.attachedTo} ATTACHED
            </span>
            <button
              type="button"
              style={{
                ...ghostButton,
                padding: "4px 10px",
                color: BAD,
                borderColor: "rgba(255,93,108,.35)",
              }}
              onClick={() => deleteMutation.mutate(s.id)}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}
