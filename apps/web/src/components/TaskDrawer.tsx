import {
  describeCron,
  type Model,
  type Task,
  type TaskFormat,
  type TaskInput,
} from "@holonet/shared";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  AMBER,
  BAD,
  CHAKRA,
  DIM,
  HI,
  OK,
  toggleKnobStyle,
  toggleTrackStyle,
} from "../lib/theme.js";

// Kept in sync with TaskInputSchema.webhookUrl in packages/shared/src/schemas.ts —
// not exported from shared as a standalone constant, so duplicated here for client-side validation.
const DISCORD_WEBHOOK_RE = /^https:\/\/discord(app)?\.com\/api\/webhooks\/.+/;

const PRESETS: [string, string][] = [
  ["EVERY 15M", "*/15 * * * *"],
  ["HOURLY", "0 * * * *"],
  ["EVERY 4H", "0 */4 * * *"],
  ["DAILY 07:00", "0 7 * * *"],
  ["WEEKDAYS 08:00", "0 8 * * 1-5"],
  ["MON 09:00", "0 9 * * 1"],
];

const TOOL_DEFS = [
  {
    id: "web",
    label: "WEB SEARCH",
    desc: "Live retrieval across the open web",
    locked: false,
  },
  {
    id: "rss",
    label: "RSS FEEDS",
    desc: "Poll subscribed source feeds",
    locked: true,
  },
  {
    id: "fetch",
    label: "URL FETCH",
    desc: "Read specific article URLs",
    locked: true,
  },
] as const;

const FORMAT_DEFS: { id: TaskFormat; label: string }[] = [
  { id: "digest", label: "DIGEST" },
  { id: "bullets", label: "BULLETS" },
  { id: "headlines", label: "HEADLINES" },
];

interface FormState {
  name: string;
  cron: string;
  prompt: string;
  model: string;
  webSearch: boolean;
  enabled: boolean;
  webhookUrl: string;
  channel: string;
  dedupe: boolean;
  format: TaskFormat;
  sources: string[];
  sourceInput: string;
}

function blankForm(models: Model[]): FormState {
  return {
    name: "",
    cron: "0 9 * * *",
    prompt: "",
    model: models[0]?.modelId ?? "",
    webSearch: true,
    enabled: true,
    webhookUrl: "",
    channel: "",
    dedupe: true,
    format: "digest",
    sources: [],
    sourceInput: "",
  };
}

function formFromTask(task: Task): FormState {
  return {
    name: task.name,
    cron: task.cron,
    prompt: task.prompt,
    model: task.model,
    webSearch: task.webSearch,
    enabled: task.enabled,
    webhookUrl: task.webhookUrl,
    channel: task.channel,
    dedupe: task.dedupe,
    format: task.format,
    sources: [...task.sources],
    sourceInput: "",
  };
}

interface TaskDrawerProps {
  mode: "new" | "edit";
  task: Task | null;
  models: Model[];
  onClose: () => void;
  onCreate: (input: TaskInput) => void;
  onUpdate: (id: string, input: TaskInput) => void;
  onDelete: (id: string) => void;
  isSaving: boolean;
  isDeleting: boolean;
}

export function TaskDrawer({
  mode,
  task,
  models,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  isSaving,
  isDeleting,
}: TaskDrawerProps) {
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && task ? formFromTask(task) : blankForm(models),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const purgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // The models list arrives async; if the drawer opened before it resolved,
  // back-fill the default selection once models are available.
  useEffect(() => {
    const first = models[0];
    if (!form.model && first) {
      setForm((f) => (f.model ? f : { ...f, model: first.modelId }));
    }
  }, [form.model, models]);

  function addSource() {
    const v = form.sourceInput.trim();
    if (!v || v.length > 60 || form.sources.length >= 20) return;
    setForm((f) => ({ ...f, sources: [...f.sources, v], sourceInput: "" }));
  }

  function removeSource(idx: number) {
    setForm((f) => ({ ...f, sources: f.sources.filter((_, i) => i !== idx) }));
  }

  function onSourceKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addSource();
    }
  }

  const cdesc = describeCron(form.cron);
  const nameErr = showErrors && !form.name.trim();
  const promptErr = showErrors && form.prompt.trim().length <= 3;
  const cronBad = showErrors && !cdesc.ok;
  const webhookErr = showErrors && !DISCORD_WEBHOOK_RE.test(form.webhookUrl);

  function handleSave() {
    const valid =
      form.name.trim() &&
      cdesc.ok &&
      form.prompt.trim().length > 3 &&
      form.model &&
      DISCORD_WEBHOOK_RE.test(form.webhookUrl);
    if (!valid) {
      setShowErrors(true);
      return;
    }
    const channel = form.channel.replace(/^#+/, "").trim() || "general";
    const payload: TaskInput = {
      name: form.name.trim(),
      cron: form.cron,
      prompt: form.prompt,
      model: form.model,
      webSearch: form.webSearch,
      enabled: form.enabled,
      webhookUrl: form.webhookUrl.trim(),
      channel,
      dedupe: form.dedupe,
      format: form.format,
      sources: form.sources,
    };
    if (mode === "edit" && task) onUpdate(task.id, payload);
    else onCreate(payload);
  }

  function handlePurgeClick() {
    if (!task) return;
    if (!confirmPurge) {
      setConfirmPurge(true);
      purgeTimer.current = setTimeout(() => setConfirmPurge(false), 3000);
      return;
    }
    if (purgeTimer.current) clearTimeout(purgeTimer.current);
    onDelete(task.id);
  }

  const cronTagStyle = cdesc.ok
    ? {
        fontFamily: CHAKRA,
        fontWeight: 600,
        fontSize: "9px",
        letterSpacing: ".14em",
        padding: "2px 7px",
        background: "rgba(255,179,71,.15)",
        color: AMBER,
        border: "1px solid rgba(255,179,71,.35)",
      }
    : {
        fontFamily: CHAKRA,
        fontWeight: 600,
        fontSize: "9px",
        letterSpacing: ".14em",
        padding: "2px 7px",
        background: "rgba(255,93,108,.12)",
        color: BAD,
        border: "1px solid rgba(255,93,108,.35)",
      };

  const cronBorder = cronBad
    ? "rgba(255,93,108,.6)"
    : cdesc.ok
      ? "rgba(255,179,71,.35)"
      : "rgba(140,160,190,.2)";

  const saving = isSaving || isDeleting;

  return (
    <div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 70,
          background: "rgba(4,6,10,.68)",
          backdropFilter: "blur(1.5px)",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      />
      <aside
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: "min(580px,94%)",
          zIndex: 71,
          background: "#0b0e14",
          borderLeft: "1px solid rgba(255,179,71,.3)",
          boxShadow: "-30px 0 60px rgba(0,0,0,.5)",
          display: "flex",
          flexDirection: "column",
          animation: "slidein .24s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "20px",
            height: "20px",
            borderTop: "2px solid #ffb347",
            borderLeft: "2px solid #ffb347",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            borderBottom: "1px solid rgba(255,179,71,.16)",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span
              style={{ fontSize: "9px", letterSpacing: ".28em", color: DIM }}
            >
              {"//"}
            </span>
            <h2
              style={{
                fontFamily: CHAKRA,
                fontWeight: 700,
                fontSize: "16px",
                letterSpacing: ".16em",
                margin: 0,
              }}
            >
              {mode === "edit" ? "EDIT TASK" : "NEW TASK"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            style={{
              background: "none",
              border: "1px solid rgba(140,160,190,.24)",
              color: "#9aa6ba",
              width: "30px",
              height: "30px",
              cursor: "pointer",
              fontSize: "15px",
            }}
          >
            &#10005;
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "22px" }}>
          <label
            htmlFor="task-name"
            style={{
              display: "block",
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              marginBottom: "8px",
            }}
          >
            TASK CALLSIGN
          </label>
          <input
            id="task-name"
            value={form.name}
            onChange={(e) => updForm("name", e.target.value)}
            placeholder="e.g. MORNING BRIEF"
            maxLength={80}
            style={{
              width: "100%",
              background: "rgba(140,160,190,.05)",
              border: "1px solid rgba(140,160,190,.2)",
              borderBottom: `1px solid ${nameErr ? BAD : "rgba(140,160,190,.2)"}`,
              color: HI,
              fontFamily: CHAKRA,
              fontWeight: 600,
              fontSize: "14px",
              letterSpacing: ".1em",
              padding: "11px 13px",
              textTransform: "uppercase",
            }}
          />
          <div
            style={{
              fontSize: "9px",
              letterSpacing: ".1em",
              color: BAD,
              marginTop: "5px",
              height: nameErr ? "auto" : 0,
              overflow: "hidden",
            }}
          >
            {nameErr ? "▸ CALLSIGN REQUIRED" : ""}
          </div>

          <label
            htmlFor="task-cron"
            style={{
              display: "block",
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              margin: "22px 0 8px",
            }}
          >
            {"SCHEDULE // CRON PATTERN"}
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              marginBottom: "10px",
            }}
          >
            {PRESETS.map(([label, cron]) => (
              <button
                key={label}
                type="button"
                onClick={() => updForm("cron", cron)}
                style={{
                  background: "rgba(255,179,71,.08)",
                  border: "1px solid rgba(255,179,71,.24)",
                  color: AMBER,
                  fontSize: "9px",
                  letterSpacing: ".12em",
                  padding: "5px 9px",
                  cursor: "pointer",
                  fontFamily: CHAKRA,
                  fontWeight: 600,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            id="task-cron"
            value={form.cron}
            onChange={(e) => updForm("cron", e.target.value)}
            placeholder="0 9 * * *"
            style={{
              width: "100%",
              background: "rgba(140,160,190,.05)",
              border: `1px solid ${cronBorder}`,
              color: "#ffd591",
              fontSize: "16px",
              letterSpacing: ".14em",
              padding: "12px 13px",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginTop: "9px",
              padding: "10px 12px",
              background: cdesc.ok
                ? "rgba(255,179,71,.05)"
                : "rgba(255,93,108,.06)",
              border: `1px solid ${cronBorder}`,
            }}
          >
            <span style={cronTagStyle}>{cdesc.tag}</span>
            <span
              style={{
                fontSize: "11px",
                color: cdesc.ok ? "#c6cedb" : BAD,
                letterSpacing: ".04em",
              }}
            >
              {cdesc.text}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5,1fr)",
              gap: "4px",
              marginTop: "7px",
            }}
          >
            {["MIN", "HOUR", "DOM", "MON", "DOW"].map((label) => (
              <div
                key={label}
                style={{
                  textAlign: "center",
                  fontSize: "8px",
                  letterSpacing: ".14em",
                  color: "#4d5769",
                }}
              >
                {label}
              </div>
            ))}
          </div>

          <label
            htmlFor="task-prompt"
            style={{
              display: "block",
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              margin: "22px 0 8px",
            }}
          >
            {"DIRECTIVE // PROMPT"}
          </label>
          <textarea
            id="task-prompt"
            value={form.prompt}
            onChange={(e) => updForm("prompt", e.target.value)}
            rows={4}
            placeholder="Summarize the top headlines from the last 24h. Dedupe near-identical stories, 5 bullets max, cite each source."
            style={{
              width: "100%",
              background: "rgba(140,160,190,.05)",
              border: "1px solid rgba(140,160,190,.2)",
              borderLeft: `2px solid ${promptErr ? BAD : "rgba(255,179,71,.4)"}`,
              color: "#c6cedb",
              fontSize: "12px",
              lineHeight: 1.65,
              padding: "12px 13px",
            }}
          />
          <div
            style={{
              fontSize: "9px",
              letterSpacing: ".1em",
              color: BAD,
              marginTop: "5px",
              height: promptErr ? "auto" : 0,
              overflow: "hidden",
            }}
          >
            {promptErr ? "▸ DIRECTIVE REQUIRED" : ""}
          </div>

          <div
            style={{
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              margin: "22px 0 8px",
            }}
          >
            INFERENCE MODEL
          </div>
          {models.length === 0 ? (
            <div
              style={{
                fontSize: "10px",
                letterSpacing: ".08em",
                color: DIM,
                border: "1px dashed rgba(140,160,190,.25)",
                padding: "12px 13px",
              }}
            >
              NO MODELS IN CATALOG — ADD ONE IN SETTINGS
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "7px",
              }}
            >
              {models.map((m) => {
                const on = form.model === m.modelId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => updForm("model", m.modelId)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      alignItems: "flex-start",
                      padding: "10px 12px",
                      cursor: "pointer",
                      border: `1px solid ${on ? "rgba(255,179,71,.55)" : "rgba(140,160,190,.18)"}`,
                      background: on
                        ? "rgba(255,179,71,.1)"
                        : "rgba(140,160,190,.04)",
                      color: on ? HI : "#9aa6ba",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "8px",
                        letterSpacing: ".2em",
                        color: on ? AMBER : DIM,
                      }}
                    >
                      {m.family}
                    </span>
                    <span
                      style={{
                        fontFamily: CHAKRA,
                        fontWeight: 600,
                        fontSize: "12px",
                        letterSpacing: ".08em",
                      }}
                    >
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div
            style={{
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              margin: "22px 0 8px",
            }}
          >
            TOOLS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {TOOL_DEFS.map((t) => {
              const on = t.id === "web" ? form.webSearch : false;
              const disabled = t.locked;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  onClick={
                    disabled
                      ? undefined
                      : () => updForm("webSearch", !form.webSearch)
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "11px",
                    padding: "11px 13px",
                    cursor: disabled ? "not-allowed" : "pointer",
                    textAlign: "left",
                    border: `1px solid ${on ? "rgba(95,227,161,.4)" : "rgba(140,160,190,.16)"}`,
                    background: on
                      ? "rgba(95,227,161,.06)"
                      : "rgba(140,160,190,.03)",
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      flex: "none",
                      background: on ? OK : "#4d5769",
                      boxShadow: on ? `0 0 8px ${OK}` : "none",
                    }}
                  />
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div
                      style={{
                        fontFamily: CHAKRA,
                        fontWeight: 600,
                        fontSize: "12px",
                        letterSpacing: ".1em",
                        color: disabled ? "#6b7488" : on ? HI : "#9aa6ba",
                      }}
                    >
                      {t.label}
                    </div>
                    <div
                      style={{ fontSize: "9px", color: DIM, marginTop: "2px" }}
                    >
                      {t.desc}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "8.5px",
                      letterSpacing: ".14em",
                      fontFamily: CHAKRA,
                      fontWeight: 600,
                      color: disabled ? DIM : on ? OK : DIM,
                    }}
                  >
                    {disabled ? "LOCKED" : on ? "ENABLED" : "OFF"}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            style={{
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              margin: "22px 0 8px",
            }}
          >
            OUTPUT FORMAT
          </div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            {FORMAT_DEFS.map((o) => {
              const on = form.format === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => updForm("format", o.id)}
                  style={{
                    flex: 1,
                    padding: "9px 6px",
                    cursor: "pointer",
                    fontFamily: CHAKRA,
                    fontWeight: 600,
                    fontSize: "10px",
                    letterSpacing: ".12em",
                    border: `1px solid ${on ? "rgba(255,179,71,.5)" : "rgba(140,160,190,.18)"}`,
                    background: on ? "rgba(255,179,71,.12)" : "transparent",
                    color: on ? AMBER : "#9aa6ba",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => updForm("dedupe", !form.dedupe)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "11px",
              width: "100%",
              padding: "10px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: "18px",
                height: "18px",
                flex: "none",
                border: `1px solid ${form.dedupe ? "rgba(255,179,71,.6)" : "rgba(140,160,190,.3)"}`,
                background: form.dedupe
                  ? "rgba(255,179,71,.18)"
                  : "transparent",
                color: AMBER,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
              }}
            >
              {form.dedupe ? "✓" : ""}
            </span>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div
                style={{
                  fontSize: "11px",
                  letterSpacing: ".06em",
                  color: "#c6cedb",
                }}
              >
                Dedupe near-identical headlines
              </div>
            </div>
          </button>

          <label
            htmlFor="task-source-input"
            style={{
              display: "block",
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              margin: "18px 0 8px",
            }}
          >
            PRIORITY SOURCES
          </label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              alignItems: "center",
            }}
          >
            {form.sources.map((s, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: chips are appended/removed strictly by index, order is stable
                key={`${s}-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  background: "rgba(255,179,71,.08)",
                  border: "1px solid rgba(255,179,71,.22)",
                  color: "#ffd591",
                  fontSize: "10px",
                  letterSpacing: ".06em",
                  padding: "5px 9px",
                }}
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeSource(i)}
                  title="Remove source"
                  aria-label={`Remove ${s}`}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#a1794a",
                    cursor: "pointer",
                    fontSize: "11px",
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  &#10005;
                </button>
              </span>
            ))}
            <input
              id="task-source-input"
              value={form.sourceInput}
              onChange={(e) => updForm("sourceInput", e.target.value)}
              onKeyDown={onSourceKey}
              placeholder="+ add source"
              style={{
                background: "none",
                border: "none",
                borderBottom: "1px solid rgba(140,160,190,.22)",
                color: HI,
                fontSize: "10px",
                letterSpacing: ".06em",
                padding: "5px 4px",
                width: "110px",
              }}
            />
          </div>

          <div
            style={{
              fontSize: "9px",
              letterSpacing: ".26em",
              color: DIM,
              margin: "24px 0 8px",
            }}
          >
            {"RELAY // INTEGRATION"}
          </div>
          <div style={{ display: "flex", gap: "7px", marginBottom: "12px" }}>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: "9px",
                border: "1px solid rgba(142,161,255,.45)",
                background: "rgba(142,161,255,.08)",
                padding: "11px 13px",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#8ea1ff",
                  boxShadow: "0 0 8px #8ea1ff",
                }}
              />
              <span
                style={{
                  fontFamily: CHAKRA,
                  fontWeight: 600,
                  fontSize: "12px",
                  letterSpacing: ".1em",
                  color: "#8ea1ff",
                }}
              >
                DISCORD WEBHOOK
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "9px",
                border: "1px dashed rgba(140,160,190,.2)",
                padding: "11px 13px",
                opacity: 0.5,
              }}
            >
              <span
                style={{
                  fontFamily: CHAKRA,
                  fontWeight: 600,
                  fontSize: "12px",
                  letterSpacing: ".1em",
                  color: "#9aa6ba",
                }}
              >
                SLACK
              </span>
              <span
                style={{ fontSize: "8px", letterSpacing: ".16em", color: DIM }}
              >
                SOON
              </span>
            </div>
          </div>
          <input
            value={form.webhookUrl}
            onChange={(e) => updForm("webhookUrl", e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            style={{
              width: "100%",
              background: "rgba(140,160,190,.05)",
              border: `1px solid ${webhookErr ? BAD : "rgba(140,160,190,.2)"}`,
              color: "#c6cedb",
              fontSize: "11px",
              letterSpacing: ".02em",
              padding: "11px 13px",
              marginBottom: "8px",
            }}
          />
          <div
            style={{
              fontSize: "9px",
              letterSpacing: ".1em",
              color: BAD,
              marginBottom: "8px",
              height: webhookErr ? "auto" : 0,
              overflow: "hidden",
            }}
          >
            {webhookErr ? "▸ VALID DISCORD WEBHOOK REQUIRED" : ""}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(140,160,190,.05)",
              border: "1px solid rgba(140,160,190,.2)",
              padding: "0 13px",
            }}
          >
            <span style={{ color: DIM, fontSize: "13px" }}>#</span>
            <input
              value={form.channel}
              onChange={(e) =>
                updForm("channel", e.target.value.replace(/^#+/, ""))
              }
              placeholder="channel-name"
              style={{
                flex: 1,
                background: "none",
                border: "none",
                color: HI,
                fontSize: "12px",
                letterSpacing: ".04em",
                padding: "11px 8px",
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "16px 22px",
            borderTop: "1px solid rgba(255,179,71,.16)",
            background: "rgba(9,11,16,.6)",
          }}
        >
          <button
            type="button"
            onClick={() => updForm("enabled", !form.enabled)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "9px",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <span
              style={toggleTrackStyle(
                form.enabled,
                "rgba(95,227,161,.5)",
                "rgba(95,227,161,.2)",
              )}
            >
              <span style={toggleKnobStyle(form.enabled, OK)} />
            </span>
            <span
              style={{
                fontSize: "9px",
                letterSpacing: ".16em",
                color: form.enabled ? OK : DIM,
                fontFamily: CHAKRA,
                fontWeight: 600,
              }}
            >
              {form.enabled ? "ENABLED" : "PAUSED"}
            </span>
          </button>
          <div style={{ flex: 1 }} />
          {mode === "edit" && (
            <button
              type="button"
              onClick={handlePurgeClick}
              disabled={saving}
              style={{
                background: "none",
                border: "1px solid rgba(255,93,108,.4)",
                color: BAD,
                padding: "10px 15px",
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "10px",
                letterSpacing: ".14em",
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {confirmPurge ? "CONFIRM PURGE" : "PURGE"}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.model}
            style={{
              background: AMBER,
              color: "#0a0c10",
              border: "none",
              padding: "11px 22px",
              fontFamily: CHAKRA,
              fontWeight: 700,
              fontSize: "11px",
              letterSpacing: ".16em",
              cursor: saving || !form.model ? "default" : "pointer",
              opacity: saving || !form.model ? 0.6 : 1,
              boxShadow: "0 0 18px rgba(255,179,71,.4)",
            }}
          >
            {mode === "edit" ? "UPDATE" : "DEPLOY"}
          </button>
        </div>
      </aside>
    </div>
  );
}
