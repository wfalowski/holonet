import type { Model } from "@holonet/shared";
import { useState } from "react";
import {
  AMBER,
  CHAKRA,
  DIM,
  HI,
  h1Style,
  sectionHeader,
  sectorLabel,
} from "../../lib/theme.js";
import { ExperimentsTab } from "./ExperimentsTab.js";
import { LibraryTab } from "./LibraryTab.js";
import { SchemasTab } from "./SchemasTab.js";

export interface PromptsTabProps {
  models: Model[];
  pushToast: (message: string) => void;
}

type PromptsTab = "library" | "experiments" | "schemas";

const TABS: { id: PromptsTab; label: string }[] = [
  { id: "library", label: "LIBRARY" },
  { id: "experiments", label: "EXPERIMENTS" },
  { id: "schemas", label: "SCHEMAS" },
];

export function PromptsView({ models, pushToast }: PromptsTabProps) {
  const [tab, setTab] = useState<PromptsTab>("library");

  return (
    <section>
      <header style={sectionHeader}>
        <span style={sectorLabel}>SECTOR · 05</span>
        <h1 style={h1Style}>PROMPT ENGINEERING</h1>
      </header>

      <div style={{ display: "flex", gap: "6px", marginBottom: "18px" }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "11px",
                letterSpacing: ".16em",
                padding: "7px 14px",
                cursor: "pointer",
                border: `1px solid ${on ? "rgba(255,179,71,.5)" : "rgba(140,160,190,.22)"}`,
                background: on ? "rgba(255,179,71,.12)" : "transparent",
                color: on ? AMBER : DIM,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ color: HI }}>
        {tab === "library" && (
          <LibraryTab models={models} pushToast={pushToast} />
        )}
        {tab === "experiments" && (
          <ExperimentsTab models={models} pushToast={pushToast} />
        )}
        {tab === "schemas" && (
          <SchemasTab models={models} pushToast={pushToast} />
        )}
      </div>
    </section>
  );
}
