import type { CSSProperties } from "react";

// Palette — from design/Holonet.dc.html
export const AMBER = "#ffb347";
export const OK = "#5fe3a1";
export const BAD = "#ff5d6c";
export const DIM = "#5c6678";
export const HI = "#e9edf4";
export const BG = "#080a0e";

export const CHAKRA = "'Chakra Petch', sans-serif";

export const backgroundGrid: CSSProperties = {
  background:
    "radial-gradient(1200px 620px at 72% -12%, rgba(255,179,71,.07), transparent 60%)," +
    "linear-gradient(rgba(140,160,190,.045) 1px, transparent 1px) 0 0/100% 40px," +
    "linear-gradient(90deg, rgba(140,160,190,.045) 1px, transparent 1px) 0 0/40px 100%," +
    BG,
};

export function chip(status: "ok" | "fail"): CSSProperties {
  return {
    fontSize: "8.5px",
    letterSpacing: ".1em",
    padding: "1px 6px",
    border: "1px solid",
    color: status === "fail" ? BAD : OK,
    borderColor:
      status === "fail" ? "rgba(255,93,108,.4)" : "rgba(95,227,161,.4)",
  };
}

export function toggleTrackStyle(
  on: boolean,
  activeBorder = "rgba(255,179,71,.5)",
  activeBg = "rgba(255,179,71,.22)",
): CSSProperties {
  return {
    position: "relative",
    width: "40px",
    height: "20px",
    borderRadius: "2px",
    border: `1px solid ${on ? activeBorder : "rgba(140,160,190,.28)"}`,
    background: on ? activeBg : "rgba(140,160,190,.08)",
    cursor: "pointer",
    padding: 0,
  };
}

export function toggleKnobStyle(
  on: boolean,
  activeColor = AMBER,
): CSSProperties {
  return {
    position: "absolute",
    top: "2px",
    left: on ? "22px" : "2px",
    width: "14px",
    height: "14px",
    borderRadius: "1px",
    background: on ? activeColor : "#7a8496",
    boxShadow: on ? `0 0 8px ${activeColor}` : "none",
    transition: "left .16s, background .16s",
  };
}

export const cornerAccent = (
  corner: "tl" | "tr" = "tl",
  color = "rgba(255,179,71,.55)",
): CSSProperties => ({
  position: "absolute",
  top: 0,
  ...(corner === "tl" ? { left: 0 } : { right: 0 }),
  width: "16px",
  height: "16px",
  borderTop: `1.5px solid ${color}`,
  ...(corner === "tl"
    ? { borderLeft: `1.5px solid ${color}` }
    : { borderRight: `1.5px solid ${color}` }),
});

export const sectionHeader: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "12px",
  marginBottom: "20px",
};

export const sectorLabel: CSSProperties = {
  fontSize: "9px",
  letterSpacing: ".3em",
  color: DIM,
};

export const h1Style: CSSProperties = {
  fontFamily: CHAKRA,
  fontWeight: 700,
  fontSize: "22px",
  letterSpacing: ".14em",
  margin: 0,
};
