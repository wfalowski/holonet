import {
  MODEL_ID_RE,
  type Model,
  type ModelInput,
  type ModelUpdate,
} from "@holonet/shared";
import { type CSSProperties, useEffect, useRef, useState } from "react";
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
  onCreate: (input: ModelInput) => Promise<unknown>;
  onUpdate: (id: string, input: ModelUpdate) => void;
  onDelete: (id: string) => void;
  onSyncPricing: () => Promise<{ updated: string[]; notFound: string[] }>;
  isSaving: boolean;
  isSyncing: boolean;
}

// USD per 1M tokens, up to 3 decimals, trailing zeros dropped; null → em dash.
function fmtPrice(v: number | null): string {
  if (v === null) return "—";
  if (v >= 0.001) return String(Math.round(v * 1000) / 1000);
  return String(v);
}

// "" → null; invalid or negative → undefined (caller treats as form error).
function parsePrice(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function SettingsView({
  models,
  onCreate,
  onUpdate,
  onDelete,
  onSyncPricing,
  isSaving,
  isSyncing,
}: SettingsViewProps) {
  const [addForm, setAddForm] = useState({
    modelId: "",
    label: "",
    family: "",
    inputCost: "",
    outputCost: "",
  });
  const [showAddErrors, setShowAddErrors] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    label: "",
    family: "",
    inputCost: "",
    outputCost: "",
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
    },
    [],
  );

  const modelIdErr = showAddErrors && !MODEL_ID_RE.test(addForm.modelId.trim());
  const labelErr = showAddErrors && !addForm.label.trim();
  const familyErr = showAddErrors && !addForm.family.trim();
  const inputCostErr =
    showAddErrors && parsePrice(addForm.inputCost) === undefined;
  const outputCostErr =
    showAddErrors && parsePrice(addForm.outputCost) === undefined;

  function handleAdd() {
    const modelId = addForm.modelId.trim();
    const label = addForm.label.trim();
    const family = addForm.family.trim();
    const inputCostPerMTok = parsePrice(addForm.inputCost);
    const outputCostPerMTok = parsePrice(addForm.outputCost);
    if (
      !MODEL_ID_RE.test(modelId) ||
      !label ||
      !family ||
      inputCostPerMTok === undefined ||
      outputCostPerMTok === undefined
    ) {
      setShowAddErrors(true);
      return;
    }
    onCreate({ modelId, label, family, inputCostPerMTok, outputCostPerMTok })
      .then(() => {
        setAddForm({
          modelId: "",
          label: "",
          family: "",
          inputCost: "",
          outputCost: "",
        });
        setShowAddErrors(false);
      })
      .catch(() => {
        // error toast is handled by the mutation's onError; keep the form values
      });
  }

  function startEdit(m: Model) {
    setEditingId(m.id);
    setEditForm({
      label: m.label,
      family: m.family,
      inputCost: m.inputCostPerMTok === null ? "" : String(m.inputCostPerMTok),
      outputCost:
        m.outputCostPerMTok === null ? "" : String(m.outputCostPerMTok),
    });
  }

  function handleEditSave(id: string) {
    const label = editForm.label.trim();
    const family = editForm.family.trim();
    const inputCostPerMTok = parsePrice(editForm.inputCost);
    const outputCostPerMTok = parsePrice(editForm.outputCost);
    if (
      !label ||
      !family ||
      inputCostPerMTok === undefined ||
      outputCostPerMTok === undefined
    )
      return;
    onUpdate(id, { label, family, inputCostPerMTok, outputCostPerMTok });
    setEditingId(null);
  }

  function handleSync() {
    setSyncStatus(null);
    onSyncPricing()
      .then((r) => {
        const notFound =
          r.notFound.length > 0
            ? ` · NOT ON OPENROUTER: ${r.notFound.join(", ")}`
            : "";
        setSyncStatus(`UPDATED ${r.updated.length} MODEL(S)${notFound}`);
      })
      .catch(() => {
        // error toast is handled by the mutation's onError
        setSyncStatus("SYNC FAILED");
      });
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

        <div
          style={{
            marginTop: "12px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            style={{ ...smallButton, opacity: isSyncing ? 0.5 : 1 }}
          >
            {isSyncing ? "SYNCING…" : "SYNC PRICES FROM OPENROUTER"}
          </button>
          {syncStatus && (
            <span
              style={{ fontSize: "9px", letterSpacing: ".1em", color: DIM }}
            >
              {syncStatus}
            </span>
          )}
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
                    <input
                      value={editForm.inputCost}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          inputCost: e.target.value,
                        }))
                      }
                      inputMode="decimal"
                      aria-label="Input cost per 1M tokens"
                      style={{ ...fieldInput(false), width: "70px" }}
                    />
                    <input
                      value={editForm.outputCost}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          outputCost: e.target.value,
                        }))
                      }
                      inputMode="decimal"
                      aria-label="Output cost per 1M tokens"
                      style={{ ...fieldInput(false), width: "70px" }}
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
                      title="USD per 1M tokens (input / output)"
                      style={{
                        fontSize: "9.5px",
                        letterSpacing: ".06em",
                        color:
                          m.inputCostPerMTok !== null ||
                          m.outputCostPerMTok !== null
                            ? HI
                            : DIM,
                        width: "110px",
                        flex: "none",
                        textAlign: "right",
                      }}
                    >
                      {fmtPrice(m.inputCostPerMTok)} /{" "}
                      {fmtPrice(m.outputCostPerMTok)} $
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
            gridTemplateColumns: "1.5fr 1fr 0.8fr 0.6fr 0.6fr auto",
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
              aria-invalid={modelIdErr}
              aria-describedby={modelIdErr ? "settings-add-error" : undefined}
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
              aria-invalid={labelErr}
              aria-describedby={labelErr ? "settings-add-error" : undefined}
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
              aria-invalid={familyErr}
              aria-describedby={familyErr ? "settings-add-error" : undefined}
              style={fieldInput(familyErr)}
            />
          </div>
          <div>
            <label htmlFor="settings-model-input-cost" style={fieldLabel}>
              IN $/1M
            </label>
            <input
              id="settings-model-input-cost"
              value={addForm.inputCost}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, inputCost: e.target.value }))
              }
              placeholder="e.g. 3"
              inputMode="decimal"
              aria-invalid={inputCostErr}
              aria-describedby={inputCostErr ? "settings-add-error" : undefined}
              style={fieldInput(inputCostErr)}
            />
          </div>
          <div>
            <label htmlFor="settings-model-output-cost" style={fieldLabel}>
              OUT $/1M
            </label>
            <input
              id="settings-model-output-cost"
              value={addForm.outputCost}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, outputCost: e.target.value }))
              }
              placeholder="e.g. 3"
              inputMode="decimal"
              aria-invalid={outputCostErr}
              aria-describedby={
                outputCostErr ? "settings-add-error" : undefined
              }
              style={fieldInput(outputCostErr)}
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
          id="settings-add-error"
          role="alert"
          style={{
            fontSize: "9px",
            letterSpacing: ".1em",
            color: BAD,
            marginTop: "6px",
            height:
              modelIdErr ||
              labelErr ||
              familyErr ||
              inputCostErr ||
              outputCostErr
                ? "auto"
                : 0,
            overflow: "hidden",
          }}
        >
          {modelIdErr
            ? "▸ OPENROUTER ID REQUIRED (vendor/model)"
            : labelErr
              ? "▸ LABEL REQUIRED"
              : familyErr
                ? "▸ FAMILY REQUIRED"
                : inputCostErr || outputCostErr
                  ? "▸ PRICE MUST BE A NON-NEGATIVE NUMBER"
                  : ""}
        </div>
      </div>
    </div>
  );
}
