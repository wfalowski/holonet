import { countdown, describeCron, relTime, type Task } from "@holonet/shared";
import { useState } from "react";
import { modelLabel } from "../lib/modelLabel.js";
import {
  AMBER,
  CHAKRA,
  chip,
  DIM,
  h1Style,
  OK,
  sectionHeader,
  sectorLabel,
  toggleKnobStyle,
  toggleTrackStyle,
} from "../lib/theme.js";
import type { FilterId } from "../lib/types.js";

const FILTER_DEFS: [FilterId, string][] = [
  ["all", "ALL"],
  ["active", "ACTIVE"],
  ["paused", "PAUSED"],
];

const ROW_GRID = "12px minmax(120px,1.3fr) 134px 92px 108px 104px";

interface TasksViewProps {
  tasks: Task[];
  now: number;
  runningId: string | null;
  conflictId: string | null;
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
  onToggleTask: (id: string) => void;
  onRunTask: (id: string) => void;
}

export function TasksView({
  tasks,
  now,
  runningId,
  conflictId,
  onNewTask,
  onEditTask,
  onToggleTask,
  onRunTask,
}: TasksViewProps) {
  const [filter, setFilter] = useState<FilterId>("all");

  const filtered = tasks.filter((t) =>
    filter === "all" ? true : filter === "active" ? t.enabled : !t.enabled,
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: "18px",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={sectionHeader}>
          <span style={sectorLabel}>{"// SECTOR 02"}</span>
          <h1 style={h1Style}>CRON TASKS</h1>
          <span
            style={{
              fontSize: "11px",
              color: "#7a8496",
              letterSpacing: ".06em",
            }}
          >
            [ {filtered.length} ]
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              display: "flex",
              gap: "2px",
              border: "1px solid rgba(255,179,71,.18)",
              padding: "2px",
            }}
          >
            {FILTER_DEFS.map(([id, label]) => {
              const on = filter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  style={{
                    padding: "6px 12px",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: CHAKRA,
                    fontWeight: 600,
                    fontSize: "9.5px",
                    letterSpacing: ".14em",
                    background: on ? "rgba(255,179,71,.16)" : "transparent",
                    color: on ? AMBER : "#7a8496",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onNewTask}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: AMBER,
              color: "#0a0c10",
              border: "none",
              padding: "9px 16px",
              fontFamily: CHAKRA,
              fontWeight: 700,
              fontSize: "11px",
              letterSpacing: ".16em",
              cursor: "pointer",
              boxShadow: "0 0 18px rgba(255,179,71,.35)",
            }}
          >
            <span style={{ fontSize: "14px", lineHeight: 1 }}>+</span> NEW TASK
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: ROW_GRID,
          gap: 0,
          padding: "0 16px 9px",
          borderBottom: "1px solid rgba(255,179,71,.14)",
        }}
      >
        <span />
        <span style={{ fontSize: "8.5px", letterSpacing: ".24em", color: DIM }}>
          TASK · PROMPT
        </span>
        <span style={{ fontSize: "8.5px", letterSpacing: ".24em", color: DIM }}>
          SCHEDULE
        </span>
        <span style={{ fontSize: "8.5px", letterSpacing: ".24em", color: DIM }}>
          CHANNEL
        </span>
        <span
          style={{
            fontSize: "8.5px",
            letterSpacing: ".24em",
            color: DIM,
            textAlign: "right",
          }}
        >
          NEXT / LAST
        </span>
        <span
          style={{
            fontSize: "8.5px",
            letterSpacing: ".24em",
            color: DIM,
            textAlign: "right",
          }}
        >
          STATE
        </span>
      </div>

      <div>
        {filtered.length === 0 && (
          <div
            style={{ padding: "20px 16px", fontSize: "11px", color: "#7a8496" }}
          >
            No tasks in this filter.
          </div>
        )}
        {filtered.map((j) => {
          const desc = describeCron(j.cron);
          const isRunning = runningId === j.id;
          const isConflict = conflictId === j.id;
          return (
            <div
              key={j.id}
              style={{
                display: "grid",
                gridTemplateColumns: ROW_GRID,
                gap: 0,
                alignItems: "center",
                padding: "15px 16px",
                borderBottom: "1px solid rgba(140,160,190,.08)",
                background: j.enabled ? "transparent" : "rgba(140,160,190,.02)",
                opacity: j.enabled ? 1 : 0.62,
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: j.enabled ? OK : DIM,
                  boxShadow: j.enabled ? `0 0 8px ${OK}` : "none",
                  animation: j.enabled
                    ? "pulse 2.4s ease-in-out infinite"
                    : "none",
                }}
              />
              <div style={{ minWidth: 0, paddingRight: "14px" }}>
                <div
                  style={{
                    fontFamily: CHAKRA,
                    fontWeight: 600,
                    fontSize: "13px",
                    letterSpacing: ".1em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {j.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    marginTop: "6px",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      flex: "none",
                      fontSize: "8px",
                      letterSpacing: ".08em",
                      color: "#8f7bd0",
                      border: "1px solid rgba(143,123,208,.4)",
                      padding: "1px 5px",
                    }}
                  >
                    {modelLabel(j.model)}
                  </span>
                  {j.webSearch && (
                    <span
                      style={{
                        flex: "none",
                        fontSize: "8px",
                        letterSpacing: ".08em",
                        color: OK,
                        border: "1px solid rgba(95,227,161,.35)",
                        padding: "1px 5px",
                      }}
                    >
                      WEB
                    </span>
                  )}
                  <span
                    style={{
                      flex: "0 1 auto",
                      minWidth: 0,
                      fontSize: "10px",
                      color: "#7a8496",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.prompt}
                  </span>
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: CHAKRA,
                    fontWeight: 600,
                    fontSize: "10px",
                    letterSpacing: ".16em",
                    color: AMBER,
                  }}
                >
                  {desc.tag}
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: "#9aa6ba",
                    marginTop: "5px",
                  }}
                >
                  {desc.text}
                </div>
                <div style={{ fontSize: "9px", color: DIM, marginTop: "3px" }}>
                  {j.cron}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#c6cedb",
                    letterSpacing: ".02em",
                  }}
                >
                  #{j.channel}
                </div>
                <div
                  style={{
                    fontSize: "8.5px",
                    letterSpacing: ".16em",
                    color: DIM,
                    marginTop: "5px",
                  }}
                >
                  DISCORD
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: "13px",
                    letterSpacing: ".03em",
                    color: j.enabled ? AMBER : DIM,
                  }}
                >
                  {j.enabled ? countdown(j.nextRunAt, now) : "PAUSED"}
                </div>
                <div style={{ fontSize: "9.5px", marginTop: "5px" }}>
                  {j.lastRun ? (
                    <span style={chip(j.lastRun.status)}>
                      {j.lastRun.status === "fail" ? "FAIL" : "OK"}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "8.5px",
                        letterSpacing: ".1em",
                        color: DIM,
                      }}
                    >
                      —
                    </span>
                  )}{" "}
                  <span style={{ color: "#7a8496" }}>
                    {relTime(j.lastRun?.at, now)}
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "10px",
                  position: "relative",
                }}
              >
                {isConflict && (
                  <span
                    style={{
                      position: "absolute",
                      right: "100%",
                      marginRight: "8px",
                      fontSize: "8px",
                      letterSpacing: ".1em",
                      color: AMBER,
                      whiteSpace: "nowrap",
                    }}
                  >
                    ALREADY RUNNING
                  </span>
                )}
                <button
                  type="button"
                  title="RUN NOW"
                  aria-label="Run now"
                  onClick={() => onRunTask(j.id)}
                  disabled={isRunning}
                  style={{
                    background: "none",
                    border: "1px solid rgba(140,160,190,.22)",
                    color: "#9aa6ba",
                    width: "26px",
                    height: "26px",
                    cursor: isRunning ? "default" : "pointer",
                    fontSize: "13px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    animation: isRunning ? "spin .7s linear infinite" : "none",
                  }}
                >
                  &#8635;
                </button>
                <button
                  type="button"
                  title={j.enabled ? "Disable task" : "Enable task"}
                  aria-label={j.enabled ? "Disable task" : "Enable task"}
                  onClick={() => onToggleTask(j.id)}
                  style={toggleTrackStyle(j.enabled)}
                >
                  <span style={toggleKnobStyle(j.enabled)} />
                </button>
                <button
                  type="button"
                  title="EDIT"
                  aria-label="Edit task"
                  onClick={() => onEditTask(j)}
                  style={{
                    background: "none",
                    border: "none",
                    color: DIM,
                    cursor: "pointer",
                    fontSize: "15px",
                    padding: "0 2px",
                  }}
                >
                  &#9656;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
