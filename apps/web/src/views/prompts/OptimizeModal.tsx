import type { Model, OptimizeOutput, PromptDetail } from "@holonet/shared";
import { lineDiff } from "@holonet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPromptVersion, optimizePrompt } from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { BAD, DIM, HI, OK } from "../../lib/theme.js";
import { Modal } from "./Modal.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";

const MONO = "'JetBrains Mono', monospace";

interface OptimizeModalProps {
  detail: PromptDetail;
  models: Model[];
  onClose: () => void;
  pushToast: (message: string) => void;
}

export function OptimizeModal({
  detail,
  models,
  onClose,
  pushToast,
}: OptimizeModalProps) {
  const queryClient = useQueryClient();
  const head = detail.versions[0];
  const [targetModelId, setTargetModelId] = useState(models[0]?.modelId ?? "");
  const [optimizerModelId, setOptimizerModelId] = useState(
    models[0]?.modelId ?? "",
  );
  const [result, setResult] = useState<OptimizeOutput | null>(null);

  const optimizeMutation = useMutation({
    mutationFn: () =>
      optimizePrompt(detail.id, {
        versionId: head?.id ?? "",
        targetModelId,
        optimizerModelId,
      }),
    onSuccess: setResult,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const acceptMutation = useMutation({
    mutationFn: () =>
      createPromptVersion(detail.id, {
        content: result?.improved ?? "",
        note: `optimized for ${targetModelId}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      queryClient.invalidateQueries({ queryKey: ["prompt", detail.id] });
      onClose();
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  if (!head) return null;

  return (
    <Modal
      title={`OPTIMIZE · ${detail.name} · v${head.version}`}
      onClose={onClose}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: "12px",
          alignItems: "end",
          marginBottom: "16px",
        }}
      >
        <div>
          <div style={fieldLabel}>TARGET MODEL</div>
          <select
            style={inputStyle}
            value={targetModelId}
            onChange={(e) => setTargetModelId(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.modelId}>
                {m.label} — {m.modelId}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={fieldLabel}>OPTIMIZER MODEL</div>
          <select
            style={inputStyle}
            value={optimizerModelId}
            onChange={(e) => setOptimizerModelId(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.modelId}>
                {m.label} — {m.modelId}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          style={primaryButton}
          disabled={optimizeMutation.isPending || models.length === 0}
          onClick={() => optimizeMutation.mutate()}
        >
          {optimizeMutation.isPending ? "OPTIMIZING…" : "RUN OPTIMIZER"}
        </button>
      </div>

      {result && (
        <>
          <div style={fieldLabel}>DIFF · CURRENT → IMPROVED</div>
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "11px",
              lineHeight: 1.6,
              padding: "12px",
              overflow: "auto",
              maxHeight: "40vh",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              margin: "0 0 12px",
            }}
          >
            {lineDiff(head.content, result.improved).map((line, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: kind+text alone isn't unique for repeated lines; diff list is static (no reordering)
                key={`${i}-${line.kind}-${line.text}`}
                style={{
                  color:
                    line.kind === "add" ? OK : line.kind === "del" ? BAD : HI,
                }}
              >
                {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                {line.text}
              </div>
            ))}
          </pre>
          {result.rationale !== "" && (
            <>
              <div style={fieldLabel}>RATIONALE</div>
              <div
                style={{
                  color: DIM,
                  fontSize: "12px",
                  lineHeight: 1.6,
                  marginBottom: "14px",
                }}
              >
                {result.rationale}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              style={primaryButton}
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending
                ? "SAVING…"
                : `ACCEPT AS v${detail.headVersion + 1}`}
            </button>
            <button
              type="button"
              style={ghostButton}
              onClick={() => setResult(null)}
            >
              DISCARD
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
