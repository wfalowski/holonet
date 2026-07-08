import type { Run } from "@holonet/shared";
import { formatClock } from "../lib/format.js";
import {
  CHAKRA,
  chip,
  DIM,
  h1Style,
  sectionHeader,
  sectorLabel,
} from "../lib/theme.js";

interface ActivityViewProps {
  runs: Run[];
}

export function ActivityView({ runs }: ActivityViewProps) {
  const logSorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      <div style={sectionHeader}>
        <span style={sectorLabel}>{"// SECTOR 04"}</span>
        <h1 style={h1Style}>ACTIVITY LOG</h1>
      </div>
      <div
        style={{
          border: "1px solid rgba(255,179,71,.16)",
          background: "rgba(14,17,24,.6)",
        }}
      >
        {logSorted.length === 0 && (
          <div
            style={{ padding: "20px 16px", fontSize: "11px", color: "#7a8496" }}
          >
            No activity recorded yet.
          </div>
        )}
        {logSorted.map((l) => (
          <div
            key={l.id}
            style={{
              display: "grid",
              gridTemplateColumns: "82px auto 1fr auto",
              gap: "14px",
              alignItems: "center",
              padding: "10px 16px",
              borderBottom: "1px solid rgba(140,160,190,.06)",
            }}
          >
            <span
              style={{ fontSize: "10px", color: DIM, letterSpacing: ".03em" }}
            >
              {formatClock(l.createdAt)}
            </span>
            <span style={chip(l.status)}>
              {l.status === "fail" ? "FAIL" : "OK"}
            </span>
            <div style={{ minWidth: 0, fontSize: "11px" }}>
              <span
                style={{
                  fontFamily: CHAKRA,
                  fontWeight: 600,
                  letterSpacing: ".08em",
                }}
              >
                {l.taskName}
              </span>{" "}
              <span style={{ color: "#7a8496" }}>— {l.message}</span>
            </div>
            <span style={{ fontSize: "10px", color: DIM }}>→ #{l.channel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
