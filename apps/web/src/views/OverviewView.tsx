import { countdown, describeCron, type Run, type Task } from "@holonet/shared";
import { formatClock } from "../lib/format.js";
import { modelLabel } from "../lib/modelLabel.js";
import {
  AMBER,
  BAD,
  CHAKRA,
  chip,
  cornerAccent,
  DIM,
  HI,
  h1Style,
  OK,
  sectionHeader,
  sectorLabel,
} from "../lib/theme.js";

const DAY_MS = 86_400_000;

interface OverviewViewProps {
  tasks: Task[];
  runs: Run[];
  now: number;
}

export function OverviewView({ tasks, runs, now }: OverviewViewProps) {
  const activeJobs = tasks.filter((t) => t.enabled);
  const runsToday = runs.filter((r) => r.createdAt >= now - DAY_MS).length;
  const upcomingRaw = activeJobs
    .filter((j) => j.nextRunAt != null)
    .sort((a, b) => (a.nextRunAt as number) - (b.nextRunAt as number));
  const nextJob = upcomingRaw[0];

  const logSorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  const latestRun = logSorted[0];
  const relayOffline = latestRun?.status === "fail";

  const statCards = [
    {
      label: "ACTIVE TASKS",
      value: String(activeJobs.length),
      sub: `${tasks.length} total configured`,
      color: AMBER,
    },
    {
      label: "DISPATCHES · 24H",
      value: String(runsToday),
      sub: "relayed to discord",
      color: HI,
    },
    {
      label: "NEXT DISPATCH",
      value: nextJob ? describeCron(nextJob.cron).tag : "—",
      sub: nextJob ? nextJob.name : "no active tasks",
      color: AMBER,
    },
    {
      label: "RELAY STATUS",
      value: relayOffline ? "OFFLINE" : "LINKED",
      sub: relayOffline ? "discord · relay failing" : "discord · nominal",
      color: relayOffline ? BAD : OK,
    },
  ];

  const upcoming = upcomingRaw.slice(0, 5).map((j) => ({
    id: j.id,
    name: j.name,
    meta: `${modelLabel(j.model)} · #${j.channel}`,
    cd: countdown(j.nextRunAt, now),
    tag: describeCron(j.cron).tag,
  }));

  const logPreview = logSorted.slice(0, 7).map((l) => ({
    id: l.id,
    time: formatClock(l.createdAt),
    statusText: l.status === "fail" ? "FAIL" : "OK",
    job: l.taskName,
    channel: l.channel,
    msg: l.message,
  }));

  return (
    <div>
      <div style={sectionHeader}>
        <span style={sectorLabel}>{"// SECTOR 01"}</span>
        <h1 style={h1Style}>OVERVIEW</h1>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: "14px",
          marginBottom: "22px",
        }}
      >
        {statCards.map((c) => (
          <div
            key={c.label}
            style={{
              position: "relative",
              border: "1px solid rgba(255,179,71,.16)",
              background: "rgba(14,17,24,.75)",
              padding: "16px 16px 14px",
              overflow: "hidden",
            }}
          >
            <div style={cornerAccent("tl")} />
            <div
              style={{ fontSize: "8.5px", letterSpacing: ".26em", color: DIM }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontFamily: CHAKRA,
                fontWeight: 700,
                fontSize: "30px",
                letterSpacing: ".02em",
                marginTop: "8px",
                color: c.color,
                lineHeight: 1,
              }}
            >
              {c.value}
            </div>
            <div
              style={{
                fontSize: "9.5px",
                letterSpacing: ".08em",
                color: "#7a8496",
                marginTop: "7px",
              }}
            >
              {c.sub}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}
      >
        <section
          style={{
            border: "1px solid rgba(255,179,71,.16)",
            background: "rgba(14,17,24,.6)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 15px",
              borderBottom: "1px solid rgba(255,179,71,.14)",
            }}
          >
            <span
              style={{
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "11px",
                letterSpacing: ".2em",
                color: HI,
              }}
            >
              UPCOMING DISPATCHES
            </span>
            <span
              style={{ fontSize: "8.5px", letterSpacing: ".24em", color: DIM }}
            >
              QUEUE
            </span>
          </div>
          <div style={{ padding: "6px 0" }}>
            {upcoming.length === 0 && (
              <div
                style={{
                  padding: "16px 15px",
                  fontSize: "10.5px",
                  color: "#7a8496",
                }}
              >
                No upcoming dispatches.
              </div>
            )}
            {upcoming.map((u) => (
              <div
                key={u.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "8px 1fr auto",
                  gap: "12px",
                  alignItems: "center",
                  padding: "11px 15px",
                  borderBottom: "1px solid rgba(140,160,190,.07)",
                }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: AMBER,
                    boxShadow: "0 0 7px rgba(255,179,71,.7)",
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: CHAKRA,
                      fontWeight: 600,
                      fontSize: "12px",
                      letterSpacing: ".08em",
                    }}
                  >
                    {u.name}
                  </div>
                  <div
                    style={{
                      fontSize: "9.5px",
                      color: "#7a8496",
                      marginTop: "3px",
                    }}
                  >
                    {u.meta}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "13px",
                      color: AMBER,
                      letterSpacing: ".04em",
                    }}
                  >
                    {u.cd}
                  </div>
                  <div
                    style={{
                      fontSize: "9px",
                      color: DIM,
                      letterSpacing: ".16em",
                      marginTop: "2px",
                    }}
                  >
                    {u.tag}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            border: "1px solid rgba(255,179,71,.16)",
            background: "rgba(14,17,24,.6)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 15px",
              borderBottom: "1px solid rgba(255,179,71,.14)",
            }}
          >
            <span
              style={{
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "11px",
                letterSpacing: ".2em",
                color: HI,
              }}
            >
              ACTIVITY FEED
            </span>
            <span
              style={{ fontSize: "8.5px", letterSpacing: ".24em", color: OK }}
            >
              LIVE
            </span>
          </div>
          <div
            style={{ padding: "4px 0", maxHeight: "262px", overflow: "auto" }}
          >
            {logPreview.length === 0 && (
              <div
                style={{
                  padding: "16px 15px",
                  fontSize: "10.5px",
                  color: "#7a8496",
                }}
              >
                No activity yet.
              </div>
            )}
            {logPreview.map((l) => (
              <div
                key={l.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "11px",
                  padding: "8px 15px",
                  borderBottom: "1px solid rgba(140,160,190,.06)",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    color: DIM,
                    letterSpacing: ".04em",
                    paddingTop: "1px",
                  }}
                >
                  {l.time}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "11px", letterSpacing: ".03em" }}>
                    <span style={chip(l.statusText === "FAIL" ? "fail" : "ok")}>
                      {l.statusText}
                    </span>{" "}
                    <span style={{ color: "#c6cedb" }}>{l.job}</span>{" "}
                    <span style={{ color: DIM }}>→ #{l.channel}</span>
                  </div>
                  <div
                    style={{
                      fontSize: "9.5px",
                      color: "#7a8496",
                      marginTop: "2px",
                    }}
                  >
                    {l.msg}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
