import { formatClock, formatDate } from "../lib/format.js";
import { AMBER, CHAKRA, DIM, HI, OK } from "../lib/theme.js";

interface StatusBarProps {
  activeCount: number;
  nextName: string;
  nextCountdown: string;
  now: number;
}

export function StatusBar({
  activeCount,
  nextName,
  nextCountdown,
  now,
}: StatusBarProps) {
  return (
    <header
      style={{
        borderBottom: "1px solid rgba(255,179,71,.16)",
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "0 20px",
        background: "rgba(9,11,16,.55)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "9px",
          paddingRight: "20px",
          borderRight: "1px solid rgba(140,160,190,.14)",
          height: "100%",
        }}
      >
        <span style={{ fontSize: "8.5px", letterSpacing: ".28em", color: DIM }}>
          SYS
        </span>
        <span
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: OK,
            boxShadow: `0 0 7px ${OK}`,
            animation: "pulse 2.4s ease-in-out infinite",
          }}
        />
        <span
          style={{
            fontFamily: CHAKRA,
            fontWeight: 600,
            fontSize: "11px",
            letterSpacing: ".14em",
            color: OK,
          }}
        >
          NOMINAL
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 20px",
          borderRight: "1px solid rgba(140,160,190,.14)",
          height: "100%",
        }}
      >
        <span style={{ fontSize: "8.5px", letterSpacing: ".28em", color: DIM }}>
          ACTIVE TASKS
        </span>
        <span
          style={{
            fontFamily: CHAKRA,
            fontWeight: 700,
            fontSize: "14px",
            color: AMBER,
          }}
        >
          {activeCount}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 20px",
          height: "100%",
        }}
      >
        <span style={{ fontSize: "8.5px", letterSpacing: ".28em", color: DIM }}>
          NEXT DISPATCH
        </span>
        <span
          style={{
            fontFamily: CHAKRA,
            fontWeight: 600,
            fontSize: "12px",
            letterSpacing: ".06em",
            color: HI,
          }}
        >
          {nextName}
        </span>
        <span style={{ fontSize: "11px", color: AMBER }}>{nextCountdown}</span>
      </div>
      <div style={{ flex: 1 }} />
      <div
        style={{
          textAlign: "right",
          paddingLeft: "20px",
          borderLeft: "1px solid rgba(140,160,190,.14)",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontFamily: CHAKRA,
            fontWeight: 700,
            fontSize: "16px",
            letterSpacing: ".1em",
            lineHeight: 1,
            color: HI,
          }}
        >
          {formatClock(now)}
        </div>
        <div
          style={{
            fontSize: "8px",
            letterSpacing: ".26em",
            color: DIM,
            marginTop: "3px",
          }}
        >
          {formatDate(now)}
        </div>
      </div>
    </header>
  );
}
