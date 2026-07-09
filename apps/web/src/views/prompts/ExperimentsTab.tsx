import type { ExperimentResult } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createExperiment,
  experimentQueryOptions,
  experimentsQueryOptions,
  promptQueryOptions,
  promptsQueryOptions,
  setResultWinner,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, BAD, CHAKRA, DIM, HI, OK } from "../../lib/theme.js";
import { Modal } from "./Modal.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";
import type { PromptsTabProps } from "./PromptsView.js";

const MONO = "'JetBrains Mono', monospace";

function statusColor(status: string): string {
  if (status === "ok" || status === "done") return OK;
  if (status === "fail" || status === "failed") return BAD;
  return AMBER;
}

export function ExperimentsTab({ models, pushToast }: PromptsTabProps) {
  const queryClient = useQueryClient();
  const experimentsQuery = useQuery(experimentsQueryOptions);
  const experiments = experimentsQuery.data ?? [];

  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

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
          onClick={() => setComposing(true)}
        >
          + NEW EXPERIMENT
        </button>
      </div>

      {experiments.length === 0 ? (
        <div
          style={{
            color: DIM,
            fontSize: "12px",
            letterSpacing: ".1em",
            padding: "30px 0",
          }}
        >
          NO EXPERIMENTS YET.
        </div>
      ) : (
        experiments.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setOpenId(e.id)}
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: "14px",
              alignItems: "center",
              textAlign: "left",
              padding: "12px 14px",
              marginBottom: "6px",
              cursor: "pointer",
              border: "1px solid rgba(140,160,190,.16)",
              background: "rgba(9,11,16,.55)",
              color: HI,
            }}
          >
            <span
              style={{
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "13px",
                letterSpacing: ".08em",
              }}
            >
              {e.promptName}
            </span>
            <span
              style={{
                fontSize: "10px",
                letterSpacing: ".14em",
                color: statusColor(e.status),
              }}
            >
              {e.status.toUpperCase()}
            </span>
            <span style={{ fontSize: "10px", color: DIM }}>
              {e.okCount}/{e.totalCount} OK
            </span>
            <span style={{ fontSize: "10px", color: DIM }}>
              {new Date(e.createdAt).toLocaleString()}
            </span>
          </button>
        ))
      )}

      {composing && (
        <NewExperimentModal
          models={models}
          pushToast={pushToast}
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setOpenId(id);
            queryClient.invalidateQueries({ queryKey: ["experiments"] });
          }}
        />
      )}
      {openId && (
        <ExperimentDetailModal
          experimentId={openId}
          pushToast={pushToast}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function NewExperimentModal({
  models,
  pushToast,
  onClose,
  onCreated,
}: {
  models: PromptsTabProps["models"];
  pushToast: (message: string) => void;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const promptsQuery = useQuery(promptsQueryOptions);
  const prompts = promptsQuery.data ?? [];
  const [promptId, setPromptId] = useState<string>("");
  const detailQuery = useQuery({
    ...promptQueryOptions(promptId),
    enabled: promptId !== "",
  });
  const versions = detailQuery.data?.versions ?? [];
  const [versionIds, setVersionIds] = useState<string[]>([]);
  const [modelIds, setModelIds] = useState<string[]>([]);

  const createMutation = useMutation({
    mutationFn: () => createExperiment({ promptId, versionIds, modelIds }),
    onSuccess: (created) => onCreated(created.id),
    onError: (error) => pushToast(errorMessage(error)),
  });

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const checkboxRow = (
    checked: boolean,
    onToggle: () => void,
    label: string,
    hint: string,
  ) => (
    <button
      key={label + hint}
      type="button"
      onClick={onToggle}
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "baseline",
        width: "100%",
        textAlign: "left",
        padding: "7px 10px",
        cursor: "pointer",
        border: `1px solid ${checked ? "rgba(255,179,71,.45)" : "rgba(140,160,190,.18)"}`,
        background: checked ? "rgba(255,179,71,.09)" : "transparent",
        color: checked ? HI : DIM,
        marginBottom: "4px",
      }}
    >
      <span
        style={{
          color: checked ? AMBER : DIM,
          fontFamily: MONO,
          fontSize: "11px",
        }}
      >
        {checked ? "[x]" : "[ ]"}
      </span>
      <span style={{ fontSize: "12px", letterSpacing: ".06em" }}>{label}</span>
      <span
        style={{
          fontSize: "10px",
          color: DIM,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {hint}
      </span>
    </button>
  );

  const canStart =
    promptId !== "" && versionIds.length > 0 && modelIds.length > 0;

  return (
    <Modal title="NEW EXPERIMENT" onClose={onClose}>
      <div style={{ display: "grid", gap: "16px" }}>
        <div>
          <div style={fieldLabel}>PROMPT</div>
          <select
            style={inputStyle}
            value={promptId}
            onChange={(e) => {
              setPromptId(e.target.value);
              setVersionIds([]);
            }}
          >
            <option value="">— SELECT —</option>
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {promptId !== "" && (
          <div>
            <div style={fieldLabel}>VERSIONS (MAX 10)</div>
            {versions.map((v) =>
              checkboxRow(
                versionIds.includes(v.id),
                () => toggle(versionIds, setVersionIds, v.id),
                `v${v.version}${v.note ? ` · ${v.note}` : ""}`,
                v.content.slice(0, 80),
              ),
            )}
          </div>
        )}

        <div>
          <div style={fieldLabel}>MODELS (MAX 10)</div>
          {models.map((m) =>
            checkboxRow(
              modelIds.includes(m.modelId),
              () => toggle(modelIds, setModelIds, m.modelId),
              m.label,
              m.modelId,
            ),
          )}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            style={{ ...primaryButton, opacity: canStart ? 1 : 0.45 }}
            disabled={!canStart || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending
              ? "STARTING…"
              : `START · ${versionIds.length}×${modelIds.length} CELLS`}
          </button>
          <button type="button" style={ghostButton} onClick={onClose}>
            CANCEL
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ExperimentDetailModal({
  experimentId,
  pushToast,
  onClose,
}: {
  experimentId: string;
  pushToast: (message: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(experimentQueryOptions(experimentId));
  const detail = detailQuery.data;
  const [cell, setCell] = useState<ExperimentResult | null>(null);

  const winnerMutation = useMutation({
    mutationFn: ({ id, winner }: { id: string; winner: boolean }) =>
      setResultWinner(experimentId, id, winner),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiment", experimentId] });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  if (!detail) return null;

  const versionNumbers = [
    ...new Set(detail.results.map((r) => r.versionNumber)),
  ].sort((a, b) => a - b);
  const modelIds = [...new Set(detail.results.map((r) => r.modelId))].sort();
  const byKey = new Map(
    detail.results.map((r) => [`${r.versionNumber}|${r.modelId}`, r]),
  );

  return (
    <Modal
      title={`EXPERIMENT · ${detail.promptName} · ${detail.status.toUpperCase()}`}
      onClose={onClose}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...fieldLabel, textAlign: "left", padding: "6px" }}>
                {" "}
              </th>
              {modelIds.map((m) => (
                <th
                  key={m}
                  style={{ ...fieldLabel, textAlign: "left", padding: "6px" }}
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versionNumbers.map((v) => (
              <tr key={v}>
                <td
                  style={{
                    color: AMBER,
                    fontFamily: MONO,
                    fontSize: "11px",
                    padding: "6px",
                    verticalAlign: "top",
                  }}
                >
                  v{v}
                </td>
                {modelIds.map((m) => {
                  const r = byKey.get(`${v}|${m}`);
                  if (!r) return <td key={m} />;
                  return (
                    <td
                      key={m}
                      style={{ padding: "4px", verticalAlign: "top" }}
                    >
                      <div
                        style={{
                          border: `1px solid ${r.winner ? "rgba(255,179,71,.6)" : "rgba(140,160,190,.18)"}`,
                          background: "rgba(9,11,16,.55)",
                          padding: "8px",
                          minWidth: "150px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: "5px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "9px",
                              letterSpacing: ".14em",
                              color: statusColor(r.status),
                              animation:
                                r.status === "pending"
                                  ? "pulse 1.6s ease-in-out infinite"
                                  : undefined,
                            }}
                          >
                            {r.status.toUpperCase()}
                          </span>
                          {r.status === "ok" && (
                            <button
                              type="button"
                              title="Mark winner"
                              onClick={() =>
                                winnerMutation.mutate({
                                  id: r.id,
                                  winner: !r.winner,
                                })
                              }
                              style={{
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                color: r.winner ? AMBER : DIM,
                                fontSize: "12px",
                                padding: 0,
                              }}
                            >
                              ★
                            </button>
                          )}
                        </div>
                        {r.status === "ok" && (
                          <button
                            type="button"
                            onClick={() => setCell(r)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                              color: HI,
                              fontFamily: MONO,
                              fontSize: "10px",
                              lineHeight: 1.5,
                              padding: 0,
                            }}
                          >
                            {r.output.slice(0, 120)}…
                          </button>
                        )}
                        {r.status === "fail" && (
                          <div
                            style={{
                              color: BAD,
                              fontSize: "10px",
                              lineHeight: 1.5,
                            }}
                          >
                            {r.errorMessage}
                          </div>
                        )}
                        <div
                          style={{
                            marginTop: "6px",
                            fontSize: "8.5px",
                            letterSpacing: ".08em",
                            color: DIM,
                          }}
                        >
                          {r.durationMs > 0 && `${r.durationMs}ms`}
                          {r.tokensIn != null &&
                            ` · ${r.tokensIn}/${r.tokensOut ?? 0} tok`}
                          {r.costUsd != null && ` · $${r.costUsd}`}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cell && (
        <div style={{ marginTop: "14px" }}>
          <div style={fieldLabel}>
            OUTPUT · v{cell.versionNumber} · {cell.modelId}
          </div>
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "11.5px",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              padding: "12px",
              maxHeight: "40vh",
              overflow: "auto",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              color: HI,
              margin: 0,
            }}
          >
            {cell.output}
          </pre>
        </div>
      )}
    </Modal>
  );
}
