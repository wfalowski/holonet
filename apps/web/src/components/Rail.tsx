import { AMBER, CHAKRA, DIM, HI } from "../lib/theme.js";
import type { ViewId } from "../lib/types.js";

interface NavDef {
  id: ViewId;
  code: string;
  label: string;
  count: string;
}

interface RailProps {
  view: ViewId;
  onNavigate: (view: ViewId) => void;
  tasksCount: number;
  runsCount: number;
}

export function Rail({ view, onNavigate, tasksCount, runsCount }: RailProps) {
  const navDefs: NavDef[] = [
    { id: "overview", code: "01", label: "OVERVIEW", count: "" },
    { id: "tasks", code: "02", label: "CRON TASKS", count: String(tasksCount) },
    { id: "integrations", code: "03", label: "INTEGRATIONS", count: "1" },
    { id: "activity", code: "04", label: "ACTIVITY", count: String(runsCount) },
  ];

  return (
    <aside
      style={{
        borderRight: "1px solid rgba(255,179,71,.16)",
        display: "flex",
        flexDirection: "column",
        background: "rgba(9,11,16,.72)",
        backdropFilter: "blur(2px)",
        position: "relative",
        zIndex: 2,
      }}
    >
      <div
        style={{
          padding: "20px 18px 18px",
          borderBottom: "1px solid rgba(255,179,71,.14)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              position: "relative",
              width: "30px",
              height: "30px",
              flex: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: "1.5px solid #ffb347",
                transform: "rotate(45deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: "8px",
                background: "#ffb347",
                transform: "rotate(45deg)",
                boxShadow: "0 0 12px rgba(255,179,71,.7)",
                animation: "flick 3s ease-in-out infinite",
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: CHAKRA,
                fontWeight: 700,
                fontSize: "16px",
                letterSpacing: ".24em",
                lineHeight: 1,
              }}
            >
              HOLONET
            </div>
            <div
              style={{
                fontSize: "8.5px",
                letterSpacing: ".34em",
                color: DIM,
                marginTop: "3px",
              }}
            >
              OPS CONSOLE · v2.6
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "14px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          flex: 1,
        }}
      >
        <div
          style={{
            fontSize: "8.5px",
            letterSpacing: ".32em",
            color: "#4d5769",
            padding: "6px 8px 10px",
          }}
        >
          NAVIGATION
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          {navDefs.map((n) => {
            const on = view === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onNavigate(n.id)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 10px",
                  border: "none",
                  cursor: "pointer",
                  background: on ? "rgba(255,179,71,.1)" : "transparent",
                  color: on ? HI : "#9aa6ba",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "20%",
                    bottom: "20%",
                    width: "2px",
                    background: on ? AMBER : "transparent",
                    boxShadow: on ? `0 0 8px ${AMBER}` : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: ".14em",
                    color: DIM,
                    width: "16px",
                  }}
                >
                  {n.code}
                </span>
                <span
                  style={{
                    fontFamily: CHAKRA,
                    fontWeight: 600,
                    fontSize: "12px",
                    letterSpacing: ".13em",
                    flex: 1,
                    textAlign: "left",
                  }}
                >
                  {n.label}
                </span>
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: ".1em",
                    color: on ? AMBER : DIM,
                    opacity: n.count ? 1 : 0,
                  }}
                >
                  {n.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          padding: "14px 16px",
          borderTop: "1px solid rgba(255,179,71,.14)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#5fe3a1",
              boxShadow: "0 0 8px #5fe3a1",
              animation: "pulse 2.4s ease-in-out infinite",
              flex: "none",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "11px",
                letterSpacing: ".08em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              OPERATOR · LOCAL
            </div>
            <div
              style={{
                fontSize: "8.5px",
                letterSpacing: ".24em",
                color: DIM,
                marginTop: "2px",
              }}
            >
              CLEARANCE · OMEGA
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
