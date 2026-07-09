import type { ReactNode } from "react";
import { CHAKRA, DIM } from "../../lib/theme.js";
import { ghostButton } from "./NewPromptForm.js";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          cursor: "pointer",
          background: "rgba(4,5,8,.72)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(860px, 94vw)",
          maxHeight: "88vh",
          overflow: "auto",
          background: "#0a0c11",
          border: "1px solid rgba(255,179,71,.35)",
          padding: "20px 22px 26px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontFamily: CHAKRA,
              fontWeight: 700,
              fontSize: "13px",
              letterSpacing: ".22em",
              color: DIM,
            }}
          >
            {title}
          </span>
          <button type="button" style={ghostButton} onClick={onClose}>
            CLOSE
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
