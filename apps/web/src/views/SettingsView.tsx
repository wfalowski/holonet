import {
  MODEL_ID_RE,
  type Model,
  type ModelInput,
  type ModelUpdate,
} from "@holonet/shared";
import { type CSSProperties, useRef, useState } from "react";
import {
  AMBER,
  BAD,
  CHAKRA,
  cornerAccent,
  DIM,
  HI,
  h1Style,
  sectionHeader,
  sectorLabel,
} from "../lib/theme.js";

const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: "9px",
  letterSpacing: ".26em",
  color: DIM,
  marginBottom: "6px",
};

function fieldInput(error: boolean): CSSProperties {
  return {
    width: "100%",
    background: "rgba(140,160,190,.05)",
    border: `1px solid ${error ? BAD : "rgba(140,160,190,.2)"}`,
    color: HI,
    fontSize: "11px",
    letterSpacing: ".04em",
    padding: "9px 11px",
  };
}

const smallButton: CSSProperties = {
  background: "rgba(255,179,71,.08)",
  border: "1px solid rgba(255,179,71,.24)",
  color: AMBER,
  fontSize: "9px",
  letterSpacing: ".12em",
  padding: "6px 10px",
  cursor: "pointer",
  fontFamily: CHAKRA,
  fontWeight: 600,
};

const dangerButton: CSSProperties = {
  background: "none",
  border: "1px solid rgba(255,93,108,.4)",
  color: BAD,
  fontSize: "9px",
  letterSpacing: ".12em",
  padding: "6px 10px",
  cursor: "pointer",
  fontFamily: CHAKRA,
  fontWeight: 600,
};

interface SettingsViewProps {
  models: Model[];
  onCreate: (input: ModelInput) => void;
  onUpdate: (id: string, input: ModelUpdate) => void;
  onDelete: (id: string) => void;
  isSaving: boolean;
}

export function SettingsView({
  models,
  onCreate,
  onUpdate,
  onDelete,
  isSaving,
}: SettingsViewProps) {
  const [addForm, setAddForm] = useState({
    modelId: "",
    label: "",
    family: "",
  });
  const [showAddErrors, setShowAddErrors] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: "", family: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelIdErr = showAddErrors && !MODEL_ID_RE.test(addForm.modelId.trim());
  const labelErr = showAddErrors && !addForm.label.trim();
  const familyErr = showAddErrors && !addForm.family.trim();

  function handleAdd() {
    const modelId = addForm.modelId.trim();
    const label = addForm.label.trim();
    const family = addForm.family.trim();
    if (!MODEL_ID_RE.test(modelId) || !label || !family) {
      setShowAddErrors(true);
      return;
    }
    onCreate({ modelId, label, family });
    setAddForm({ modelId: "", label: "", family: "" });
    setShowAddErrors(false);
  }

  function startEdit(m: Model) {
    setEditingId(m.id);
    setEditForm({ label: m.label, family: m.family });
  }

  function handleEditSave(id: string) {
    const label = editForm.label.trim();
    const family = editForm.family.trim();
    if (!label || !family) return;
    onUpdate(id, { label, family });
    setEditingId(null);
  }

  function handleDeleteClick(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setConfirmDeleteId(null);
    onDelete(id);
  }

  return (
    <div>
      <div style={sectionHeader}>
        <span style={sectorLabel}>{"// SECTOR 05"}</span>
        <h1 style={h1Style}>SETTINGS</h1>
      </div>

      <div
        style={{
          position: "relative",
          border: "1px solid rgba(255,179,71,.3)",
          background: "rgba(14,17,24,.75)",
          padding: "18px",
          overflow: "hidden",
          maxWidth: "820px",
        }}
      >
        <div style={cornerAccent("tr")} />
        <div
          style={{
            fontFamily: CHAKRA,
            fontWeight: 700,
            fontSize: "14px",
            letterSpacing: ".14em",
            color: AMBER,
          }}
        >
          INFERENCE MODELS
        </div>
        <div
          style={{
            fontSize: "10px",
            color: "#7a8496",
            marginTop: "8px",
            letterSpacing: ".04em",
            lineHeight: 1.6,
          }}
        >
          Catalog offered in the task compose drawer. Ids are OpenRouter model
          ids (vendor/model). A model in use by a task cannot be removed.
        </div>

        <div style={{ marginTop: "16px" }}>
          {models.length === 0 && (
            <div
              style={{
                fontSize: "10px",
                letterSpacing: ".08em",
                color: DIM,
                border: "1px dashed rgba(140,160,190,.25)",
                padding: "12px 13px",
              }}
            >
              NO MODELS CONFIGURED — ADD ONE BELOW
            </div>
          )}
          {models.map((m) => {
            const editing = editingId === m.id;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "11px 2px",
                  borderBottom: "1px solid rgba(140,160,190,.12)",
                }}
              >
                {editing ? (
                  <>
                    <input
                      value={editForm.label}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, label: e.target.value }))
                      }
                      maxLength={40}
                      aria-label="Model label"
                      style={{ ...fieldInput(false), width: "170px" }}
                    />
                    <input
                      value={editForm.family}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, family: e.target.value }))
                      }
                      maxLength={20}
                      aria-label="Model family"
                      style={{ ...fieldInput(false), width: "120px" }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontSize: "10px",
                        color: "#ffd591",
                        letterSpacing: ".04em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.modelId}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleEditSave(m.id)}
                      disabled={isSaving}
                      style={smallButton}
                    >
                      SAVE
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      style={{
                        ...dangerButton,
                        borderColor: "rgba(140,160,190,.3)",
                        color: "#9aa6ba",
                      }}
                    >
                      CANCEL
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ width: "170px", flex: "none" }}>
                      <div
                        style={{
                          fontSize: "8px",
                          letterSpacing: ".2em",
                          color: DIM,
                        }}
                      >
                        {m.family}
                      </div>
                      <div
                        style={{
                          fontFamily: CHAKRA,
                          fontWeight: 600,
                          fontSize: "12px",
                          letterSpacing: ".08em",
                          color: HI,
                          marginTop: "2px",
                        }}
                      >
                        {m.label}
                      </div>
                    </div>
                    <span
                      style={{
                        flex: 1,
                        fontSize: "10px",
                        color: "#ffd591",
                        letterSpacing: ".04em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.modelId}
                    </span>
                    <span
                      style={{
                        fontSize: "8.5px",
                        letterSpacing: ".14em",
                        color: m.inUse > 0 ? AMBER : DIM,
                        width: "84px",
                        flex: "none",
                      }}
                    >
                      {m.inUse > 0 ? `${m.inUse} TASK(S)` : "UNUSED"}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      style={smallButton}
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(m.id)}
                      disabled={isSaving || m.inUse > 0}
                      title={
                        m.inUse > 0
                          ? "In use by tasks — reassign them first"
                          : "Remove from catalog"
                      }
                      style={{
                        ...dangerButton,
                        opacity: m.inUse > 0 ? 0.4 : 1,
                        cursor: m.inUse > 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      {confirmDeleteId === m.id ? "CONFIRM" : "REMOVE"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: "18px",
            fontSize: "9px",
            letterSpacing: ".26em",
            color: DIM,
          }}
        >
          ADD MODEL
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr 0.8fr auto",
            gap: "10px",
            alignItems: "end",
            marginTop: "10px",
          }}
        >
          <div>
            <label htmlFor="settings-model-id" style={fieldLabel}>
              OPENROUTER ID
            </label>
            <input
              id="settings-model-id"
              value={addForm.modelId}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, modelId: e.target.value }))
              }
              placeholder="vendor/model"
              maxLength={100}
              style={fieldInput(modelIdErr)}
            />
          </div>
          <div>
            <label htmlFor="settings-model-label" style={fieldLabel}>
              LABEL
            </label>
            <input
              id="settings-model-label"
              value={addForm.label}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, label: e.target.value }))
              }
              placeholder="e.g. SONNET 4.5"
              maxLength={40}
              style={fieldInput(labelErr)}
            />
          </div>
          <div>
            <label htmlFor="settings-model-family" style={fieldLabel}>
              FAMILY
            </label>
            <input
              id="settings-model-family"
              value={addForm.family}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, family: e.target.value }))
              }
              placeholder="e.g. ANTHROPIC"
              maxLength={20}
              style={fieldInput(familyErr)}
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isSaving}
            style={{
              background: AMBER,
              color: "#0a0c10",
              border: "none",
              padding: "10px 18px",
              fontFamily: CHAKRA,
              fontWeight: 700,
              fontSize: "10px",
              letterSpacing: ".16em",
              cursor: isSaving ? "default" : "pointer",
              opacity: isSaving ? 0.6 : 1,
              boxShadow: "0 0 18px rgba(255,179,71,.35)",
            }}
          >
            ADD
          </button>
        </div>
        <div
          style={{
            fontSize: "9px",
            letterSpacing: ".1em",
            color: BAD,
            marginTop: "6px",
            height: modelIdErr || labelErr || familyErr ? "auto" : 0,
            overflow: "hidden",
          }}
        >
          {modelIdErr
            ? "▸ OPENROUTER ID REQUIRED (vendor/model)"
            : labelErr
              ? "▸ LABEL REQUIRED"
              : familyErr
                ? "▸ FAMILY REQUIRED"
                : ""}
        </div>
      </div>
    </div>
  );
}
