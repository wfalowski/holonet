import type { Task } from "@holonet/shared";
import {
  AMBER,
  CHAKRA,
  cornerAccent,
  DIM,
  HI,
  h1Style,
  OK,
  sectionHeader,
  sectorLabel,
} from "../lib/theme.js";

const COMING_SOON = [
  {
    name: "SLACK",
    desc: "Post digests to Slack channels via incoming webhooks.",
  },
  { name: "TELEGRAM", desc: "Relay briefs to a Telegram bot / channel." },
];

interface IntegrationsViewProps {
  tasks: Task[];
}

export function IntegrationsView({ tasks }: IntegrationsViewProps) {
  const discordCount = tasks.length;
  const discordChannels = new Set(tasks.map((t) => t.channel)).size;

  return (
    <div>
      <div style={sectionHeader}>
        <span style={sectorLabel}>{"// SECTOR 03"}</span>
        <h1 style={h1Style}>INTEGRATIONS</h1>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: "14px",
        }}
      >
        <div
          style={{
            position: "relative",
            border: "1px solid rgba(255,179,71,.3)",
            background: "rgba(14,17,24,.75)",
            padding: "18px",
            overflow: "hidden",
          }}
        >
          <div style={cornerAccent("tr")} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: CHAKRA,
                fontWeight: 700,
                fontSize: "14px",
                letterSpacing: ".14em",
                color: "#8ea1ff",
              }}
            >
              DISCORD
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "9px",
                letterSpacing: ".2em",
                color: OK,
              }}
            >
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: OK,
                  boxShadow: `0 0 7px ${OK}`,
                }}
              />
              LINKED
            </span>
          </div>
          <div
            style={{
              fontSize: "10px",
              color: "#7a8496",
              marginTop: "12px",
              letterSpacing: ".04em",
              lineHeight: 1.6,
            }}
          >
            Outbound webhook relay. Digests posted to your server channels on
            dispatch.
          </div>
          <div
            style={{
              marginTop: "16px",
              borderTop: "1px solid rgba(140,160,190,.12)",
              paddingTop: "12px",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "8.5px",
                  letterSpacing: ".22em",
                  color: DIM,
                }}
              >
                BOUND TASKS
              </div>
              <div
                style={{
                  fontFamily: CHAKRA,
                  fontWeight: 700,
                  fontSize: "20px",
                  color: AMBER,
                  marginTop: "4px",
                }}
              >
                {discordCount}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "8.5px",
                  letterSpacing: ".22em",
                  color: DIM,
                }}
              >
                CHANNELS
              </div>
              <div
                style={{
                  fontFamily: CHAKRA,
                  fontWeight: 700,
                  fontSize: "20px",
                  color: HI,
                  marginTop: "4px",
                }}
              >
                {discordChannels}
              </div>
            </div>
          </div>
        </div>
        {COMING_SOON.map((i) => (
          <div
            key={i.name}
            style={{
              border: "1px dashed rgba(140,160,190,.18)",
              background: "rgba(14,17,24,.35)",
              padding: "18px",
              opacity: 0.65,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: CHAKRA,
                  fontWeight: 700,
                  fontSize: "14px",
                  letterSpacing: ".14em",
                  color: "#9aa6ba",
                }}
              >
                {i.name}
              </span>
              <span
                style={{ fontSize: "9px", letterSpacing: ".2em", color: DIM }}
              >
                OFFLINE
              </span>
            </div>
            <div
              style={{
                fontSize: "10px",
                color: DIM,
                marginTop: "12px",
                letterSpacing: ".04em",
                lineHeight: 1.6,
              }}
            >
              {i.desc}
            </div>
            <div
              style={{
                marginTop: "16px",
                fontSize: "9px",
                letterSpacing: ".22em",
                color: DIM,
                borderTop: "1px solid rgba(140,160,190,.1)",
                paddingTop: "12px",
              }}
            >
              {"STANDBY // Q3"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
