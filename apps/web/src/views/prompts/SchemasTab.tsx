import { useQuery } from "@tanstack/react-query";
import { schemasQueryOptions } from "../../api/client.js";
import { DIM } from "../../lib/theme.js";
import type { PromptsTabProps } from "./PromptsView.js";

export function SchemasTab(_props: PromptsTabProps) {
  const schemasQuery = useQuery(schemasQueryOptions);
  return (
    <div style={{ color: DIM, fontSize: "12px", letterSpacing: ".08em" }}>
      {schemasQuery.data?.length ?? 0} SCHEMAS
    </div>
  );
}
