import { useQuery } from "@tanstack/react-query";
import { experimentsQueryOptions } from "../../api/client.js";
import { DIM } from "../../lib/theme.js";
import type { PromptsTabProps } from "./PromptsView.js";

export function ExperimentsTab(_props: PromptsTabProps) {
  const experimentsQuery = useQuery(experimentsQueryOptions);
  return (
    <div style={{ color: DIM, fontSize: "12px", letterSpacing: ".08em" }}>
      {experimentsQuery.data?.length ?? 0} EXPERIMENTS
    </div>
  );
}
