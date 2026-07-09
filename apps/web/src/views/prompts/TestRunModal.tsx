import type { Model, PlaygroundRunOutput } from "@holonet/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { playgroundRun } from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { BAD, DIM, HI, OK } from "../../lib/theme.js";
import { Modal } from "./Modal.js";
import { fieldLabel, inputStyle, primaryButton } from "./NewPromptForm.js";

const MONO = "'JetBrains Mono', monospace";

interface TestRunModalProps {
  content: string;
  schemaId: string | null;
  models: Model[];
  onClose: () => void;
  pushToast: (message: string) => void;
}

export function TestRunModal({
  content,
  schemaId,
  models,
  onClose,
  pushToast,
}: TestRunModalProps) {
  const [modelId, setModelId] = useState(models[0]?.modelId ?? "");
  const [result, setResult] = useState<PlaygroundRunOutput | null>(null);

  const runMutation = useMutation({
    mutationFn: () => playgroundRun({ content, modelId, schemaId }),
    onSuccess: setResult,
    onError: (error) => pushToast(errorMessage(error)),
  });

  return (
    <Modal title="TEST RUN" onClose={onClose}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "12px",
          alignItems: "end",
          marginBottom: "16px",
        }}
      >
        <div>
          <div style={fieldLabel}>MODEL</div>
          <select
            style={inputStyle}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
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
          disabled={runMutation.isPending || models.length === 0}
          onClick={() => runMutation.mutate()}
        >
          {runMutation.isPending ? "RUNNING…" : "RUN"}
        </button>
      </div>

      {result && (
        <>
          <div
            style={{
              display: "flex",
              gap: "16px",
              fontSize: "10px",
              letterSpacing: ".12em",
              color: DIM,
              marginBottom: "10px",
            }}
          >
            <span>{result.durationMs} MS</span>
            {result.tokensIn != null && <span>IN {result.tokensIn}</span>}
            {result.tokensOut != null && <span>OUT {result.tokensOut}</span>}
            {result.costUsd != null && <span>${result.costUsd}</span>}
            {result.validation && (
              <span style={{ color: result.validation.valid ? OK : BAD }}>
                SCHEMA {result.validation.valid ? "VALID" : "INVALID"}
              </span>
            )}
          </div>
          {result.validation && !result.validation.valid && (
            <ul
              style={{
                color: BAD,
                fontSize: "11px",
                lineHeight: 1.7,
                margin: "0 0 10px",
                paddingLeft: "18px",
              }}
            >
              {result.validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "11.5px",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              padding: "12px",
              maxHeight: "50vh",
              overflow: "auto",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              color: HI,
              margin: 0,
            }}
          >
            {result.output}
          </pre>
        </>
      )}
    </Modal>
  );
}
