import { BAD, CHAKRA } from "../lib/theme.js";
import type { Toast as ToastEntry } from "../lib/useToasts.js";

interface ToastStripProps {
  toasts: ToastEntry[];
  onDismiss: (id: number) => void;
}

/** Small amber-bordered error strip anchored under the status bar; auto-dismisses (see useToasts). */
export function ToastStrip({ toasts, onDismiss }: ToastStripProps) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "54px",
        right: "20px",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        marginTop: "10px",
      }}
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onDismiss(t.id)}
          title="Dismiss"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            background: "rgba(14,17,24,.92)",
            border: "1px solid rgba(255,179,71,.4)",
            padding: "9px 13px",
            cursor: "pointer",
            textAlign: "left",
            maxWidth: "360px",
          }}
        >
          <span
            style={{
              fontFamily: CHAKRA,
              fontWeight: 700,
              fontSize: "9px",
              letterSpacing: ".14em",
              color: BAD,
            }}
          >
            ▸ ERROR
          </span>
          <span
            style={{ fontSize: "10.5px", letterSpacing: ".02em", color: BAD }}
          >
            {t.message}
          </span>
        </button>
      ))}
    </div>
  );
}
