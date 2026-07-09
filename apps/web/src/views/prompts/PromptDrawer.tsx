import type { Folder, PromptDetail, SchemaDoc } from "@holonet/shared";
import { lineDiff } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createPromptVersion,
  deletePrompt,
  promptQueryOptions,
  updatePromptMeta,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, BAD, CHAKRA, DIM, HI, OK } from "../../lib/theme.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";

const MONO = "'JetBrains Mono', monospace";

interface PromptDrawerProps {
  promptId: string;
  folders: Folder[];
  schemas: SchemaDoc[];
  onClose: () => void;
  pushToast: (message: string) => void;
  onOptimize: (detail: PromptDetail) => void;
  onTestRun: (content: string, schemaId: string | null) => void;
}

export function PromptDrawer({
  promptId,
  folders,
  schemas,
  onClose,
  pushToast,
  onOptimize,
  onTestRun,
}: PromptDrawerProps) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(promptQueryOptions(promptId));
  const detail = detailQuery.data;
  const head = detail?.versions[0];

  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Seed the editor once per loaded head version; user edits are not clobbered
  // by background refetches because the key includes the version id.
  const headId = head?.id;
  useEffect(() => {
    if (headId && head) setContent(head.content);
  }, [headId, head]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["prompts"] });
    queryClient.invalidateQueries({ queryKey: ["prompt", promptId] });
    queryClient.invalidateQueries({ queryKey: ["folders"] });
  }

  const saveVersionMutation = useMutation({
    mutationFn: (input: { content: string; note?: string }) =>
      createPromptVersion(promptId, input),
    onSuccess: () => {
      invalidate();
      setNote("");
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const metaMutation = useMutation({
    mutationFn: (input: Parameters<typeof updatePromptMeta>[1]) =>
      updatePromptMeta(promptId, input),
    onSuccess: invalidate,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePrompt(promptId),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  if (!detail || !head) return null;

  const dirty = content !== head.content;
  const diffVersion = detail.versions.find((v) => v.id === diffVersionId);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40 }}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          cursor: "pointer",
          background: "rgba(4,5,8,.66)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(680px, 92vw)",
          overflow: "auto",
          background: "#0a0c11",
          borderLeft: "1px solid rgba(255,179,71,.3)",
          padding: "22px 24px 40px",
          animation: "slidein .18s ease-out",
        }}
      >
        {/* Header / metadata */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <span style={{ fontSize: "9px", letterSpacing: ".3em", color: DIM }}>
            PROMPT · v{detail.headVersion} · {detail.versionCount} VERSIONS
          </span>
          <button type="button" style={ghostButton} onClick={onClose}>
            CLOSE
          </button>
        </div>

        <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
          <div>
            <div style={fieldLabel}>NAME</div>
            <input
              style={{ ...inputStyle, fontFamily: CHAKRA, fontSize: "15px" }}
              defaultValue={detail.name}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== "" && value !== detail.name) {
                  metaMutation.mutate({ name: value });
                }
              }}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "12px",
            }}
          >
            <div>
              <div style={fieldLabel}>FOLDER</div>
              <select
                style={inputStyle}
                value={detail.folderId ?? ""}
                onChange={(e) =>
                  metaMutation.mutate({
                    folderId: e.target.value === "" ? null : e.target.value,
                  })
                }
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
                value={detail.schemaId ?? ""}
                onChange={(e) =>
                  metaMutation.mutate({
                    schemaId: e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">— NONE —</option>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabel}>TAGS</div>
              <input
                style={inputStyle}
                defaultValue={detail.tags.join(", ")}
                onBlur={(e) =>
                  metaMutation.mutate({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter((t) => t !== "")
                      .slice(0, 12),
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* Editor */}
        <div style={fieldLabel}>CONTENT {dirty ? "· UNSAVED" : ""}</div>
        <textarea
          style={{
            ...inputStyle,
            fontFamily: MONO,
            minHeight: "220px",
            resize: "vertical",
            lineHeight: 1.55,
          }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div
          style={{
            display: "flex",
            gap: "8px",
            margin: "10px 0 22px",
            alignItems: "center",
          }}
        >
          <input
            style={{ ...inputStyle, maxWidth: "260px" }}
            placeholder="VERSION NOTE (OPTIONAL)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            style={{ ...primaryButton, opacity: dirty ? 1 : 0.45 }}
            disabled={!dirty || saveVersionMutation.isPending}
            onClick={() =>
              saveVersionMutation.mutate({
                content,
                note: note.trim() === "" ? undefined : note.trim(),
              })
            }
          >
            {saveVersionMutation.isPending
              ? "SAVING…"
              : `SAVE AS v${detail.headVersion + 1}`}
          </button>
          <button
            type="button"
            style={ghostButton}
            onClick={() => onOptimize(detail)}
          >
            OPTIMIZE
          </button>
          <button
            type="button"
            style={ghostButton}
            onClick={() => onTestRun(content, detail.schemaId)}
          >
            TEST RUN
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            style={{
              ...ghostButton,
              color: BAD,
              borderColor: "rgba(255,93,108,.4)",
            }}
            onClick={() => {
              if (confirmDelete) deleteMutation.mutate();
              else {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 2500);
              }
            }}
          >
            {confirmDelete ? "SURE?" : "DELETE"}
          </button>
        </div>

        {/* Version history */}
        <div style={fieldLabel}>VERSION HISTORY</div>
        {detail.versions.map((v) => (
          <div
            key={v.id}
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              padding: "8px 10px",
              borderBottom: "1px solid rgba(140,160,190,.12)",
              fontSize: "11px",
            }}
          >
            <span style={{ color: AMBER, fontFamily: MONO, width: "34px" }}>
              v{v.version}
            </span>
            <span style={{ color: DIM, flex: 1 }}>{v.note ?? ""}</span>
            <span style={{ color: DIM }}>
              {new Date(v.createdAt).toLocaleString()}
            </span>
            {v.id !== head.id && (
              <>
                <button
                  type="button"
                  style={{
                    ...ghostButton,
                    padding: "3px 8px",
                    fontSize: "9px",
                  }}
                  onClick={() =>
                    setDiffVersionId(diffVersionId === v.id ? null : v.id)
                  }
                >
                  {diffVersionId === v.id ? "HIDE DIFF" : "DIFF"}
                </button>
                <button
                  type="button"
                  style={{
                    ...ghostButton,
                    padding: "3px 8px",
                    fontSize: "9px",
                  }}
                  onClick={() =>
                    saveVersionMutation.mutate({
                      content: v.content,
                      note: `restored from v${v.version}`,
                    })
                  }
                >
                  RESTORE
                </button>
              </>
            )}
          </div>
        ))}

        {/* Diff vs head */}
        {diffVersion && (
          <div style={{ marginTop: "14px" }}>
            <div style={fieldLabel}>
              DIFF · v{diffVersion.version} → v{head.version}
            </div>
            <pre
              style={{
                fontFamily: MONO,
                fontSize: "11px",
                lineHeight: 1.6,
                padding: "12px",
                overflow: "auto",
                border: "1px solid rgba(140,160,190,.18)",
                background: "rgba(9,11,16,.6)",
                margin: 0,
              }}
            >
              {lineDiff(diffVersion.content, head.content).map((line) => (
                <div
                  key={`${line.kind}-${line.text}`}
                  style={{
                    color:
                      line.kind === "add" ? OK : line.kind === "del" ? BAD : HI,
                  }}
                >
                  {line.kind === "add"
                    ? "+ "
                    : line.kind === "del"
                      ? "- "
                      : "  "}
                  {line.text}
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
