import { useQuery } from "@tanstack/react-query";
import { promptsQueryOptions } from "../../api/client.js";
import { DIM } from "../../lib/theme.js";
import type { PromptsTabProps } from "./PromptsView.js";

export function LibraryTab(_props: PromptsTabProps) {
  const promptsQuery = useQuery(promptsQueryOptions);
  return (
    <div style={{ color: DIM, fontSize: "12px", letterSpacing: ".08em" }}>
      {promptsQuery.data?.length ?? 0} PROMPTS IN LIBRARY
    </div>
  );
}
