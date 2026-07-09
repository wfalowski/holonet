import type { Prompt, PromptInput } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  createFolder,
  createPrompt,
  deleteFolder,
  foldersQueryOptions,
  promptsQueryOptions,
  renameFolder,
  schemasQueryOptions,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, CHAKRA, DIM, HI } from "../../lib/theme.js";
import { inputStyle, NewPromptForm, primaryButton } from "./NewPromptForm.js";
import { PromptDrawer } from "./PromptDrawer.js";
import type { PromptsTabProps } from "./PromptsView.js";

type FolderFilter = "all" | "none" | string;

export function LibraryTab({ models: _models, pushToast }: PromptsTabProps) {
  const queryClient = useQueryClient();
  const foldersQuery = useQuery(foldersQueryOptions);
  const promptsQuery = useQuery(promptsQueryOptions);
  const schemasQuery = useQuery(schemasQueryOptions);
  const folders = foldersQuery.data ?? [];
  const prompts = promptsQuery.data ?? [];
  const schemas = schemasQuery.data ?? [];

  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function invalidateLibrary() {
    queryClient.invalidateQueries({ queryKey: ["folders"] });
    queryClient.invalidateQueries({ queryKey: ["prompts"] });
  }

  const createPromptMutation = useMutation({
    mutationFn: (input: PromptInput) => createPrompt(input),
    onSuccess: (created) => {
      invalidateLibrary();
      setCreating(false);
      setOpenId(created.id);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder({ name }),
    onSuccess: () => {
      invalidateLibrary();
      setNewFolderName("");
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameFolder(id, { name }),
    onSuccess: () => {
      invalidateLibrary();
      setRenamingId(null);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => deleteFolder(id),
    onSuccess: () => {
      invalidateLibrary();
      setFolderFilter("all");
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const allTags = useMemo(
    () => [...new Set(prompts.flatMap((p) => p.tags))].sort(),
    [prompts],
  );

  const visible = prompts.filter((p) => {
    if (folderFilter === "none" && p.folderId !== null) return false;
    if (
      folderFilter !== "all" &&
      folderFilter !== "none" &&
      p.folderId !== folderFilter
    )
      return false;
    if (tagFilter && !p.tags.includes(tagFilter)) return false;
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const folderRow = (
    id: FolderFilter,
    label: string,
    count: number,
    deletable?: string,
  ) => {
    const on = folderFilter === id;
    return (
      <div key={String(id)} style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setFolderFilter(on ? "all" : id)}
          onDoubleClick={() => {
            if (deletable) {
              setRenamingId(deletable);
              setRenameValue(label);
            }
          }}
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "space-between",
            padding: "7px 10px",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: CHAKRA,
            fontSize: "11px",
            letterSpacing: ".12em",
            background: on ? "rgba(255,179,71,.1)" : "transparent",
            color: on ? AMBER : "#9aa6ba",
          }}
        >
          <span>{label}</span>
          <span style={{ color: DIM }}>{count}</span>
        </button>
        {deletable && (
          <button
            type="button"
            title="Delete folder"
            onClick={() => deleteFolderMutation.mutate(deletable)}
            style={{
              border: "none",
              background: "transparent",
              color: DIM,
              cursor: "pointer",
              fontSize: "12px",
              padding: "0 6px",
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: "20px" }}
    >
      {/* Folder strip */}
      <aside
        style={{
          border: "1px solid rgba(140,160,190,.18)",
          background: "rgba(9,11,16,.6)",
          padding: "10px 6px",
          alignSelf: "start",
        }}
      >
        <div
          style={{
            fontSize: "8.5px",
            letterSpacing: ".3em",
            color: DIM,
            padding: "4px 10px 10px",
          }}
        >
          FOLDERS
        </div>
        {folderRow("all", "ALL", prompts.length)}
        {folderRow(
          "none",
          "UNFILED",
          prompts.filter((p) => p.folderId === null).length,
        )}
        {folders.map((f) =>
          renamingId === f.id ? (
            <div key={f.id} style={{ padding: "4px 6px" }}>
              <input
                style={inputStyle}
                value={renameValue}
                // biome-ignore lint/a11y/noAutofocus: UX for renaming folder on double-click
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameValue.trim() !== "") {
                    renameFolderMutation.mutate({
                      id: f.id,
                      name: renameValue.trim(),
                    });
                  }
                  if (e.key === "Escape") setRenamingId(null);
                }}
              />
            </div>
          ) : (
            folderRow(f.id, f.name, f.promptCount, f.id)
          ),
        )}
        <div style={{ padding: "10px 6px 2px", display: "flex", gap: "4px" }}>
          <input
            style={{ ...inputStyle, fontSize: "10px" }}
            placeholder="NEW FOLDER"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim() !== "") {
                createFolderMutation.mutate(newFolderName.trim());
              }
            }}
          />
        </div>
      </aside>

      {/* List */}
      <div>
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "14px",
            alignItems: "center",
          }}
        >
          <input
            style={{ ...inputStyle, maxWidth: "260px" }}
            placeholder="SEARCH…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div
            style={{ display: "flex", gap: "4px", flexWrap: "wrap", flex: 1 }}
          >
            {allTags.map((t) => {
              const on = tagFilter === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(on ? null : t)}
                  style={{
                    fontSize: "9px",
                    letterSpacing: ".12em",
                    padding: "3px 8px",
                    cursor: "pointer",
                    border: `1px solid ${on ? "rgba(255,179,71,.5)" : "rgba(140,160,190,.25)"}`,
                    background: on ? "rgba(255,179,71,.12)" : "transparent",
                    color: on ? AMBER : DIM,
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            style={primaryButton}
            onClick={() => setCreating(true)}
          >
            + NEW PROMPT
          </button>
        </div>

        {creating && (
          <NewPromptForm
            folders={folders}
            schemas={schemas}
            isSaving={createPromptMutation.isPending}
            onCancel={() => setCreating(false)}
            onCreate={(input) => createPromptMutation.mutate(input)}
          />
        )}

        {visible.length === 0 ? (
          <div
            style={{
              color: DIM,
              fontSize: "12px",
              letterSpacing: ".1em",
              padding: "30px 0",
            }}
          >
            NO PROMPTS MATCH.
          </div>
        ) : (
          visible.map((p: Prompt) => (
            <button
              key={p.id}
              type="button"
              aria-expanded={openId === p.id}
              onClick={() => setOpenId(p.id)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: "14px",
                alignItems: "center",
                textAlign: "left",
                padding: "12px 14px",
                marginBottom: "6px",
                cursor: "pointer",
                border: "1px solid rgba(140,160,190,.16)",
                background: "rgba(9,11,16,.55)",
                color: HI,
              }}
            >
              <span
                style={{
                  fontFamily: CHAKRA,
                  fontWeight: 600,
                  fontSize: "13px",
                  letterSpacing: ".08em",
                }}
              >
                {p.name}
              </span>
              <span style={{ display: "flex", gap: "4px" }}>
                {p.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: "8.5px",
                      letterSpacing: ".1em",
                      padding: "1px 6px",
                      border: "1px solid rgba(140,160,190,.3)",
                      color: DIM,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </span>
              <span
                style={{ fontSize: "10px", color: DIM, letterSpacing: ".1em" }}
              >
                {folders.find((f) => f.id === p.folderId)?.name ?? "UNFILED"}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  color: AMBER,
                  letterSpacing: ".1em",
                }}
              >
                v{p.headVersion}
              </span>
            </button>
          ))
        )}
      </div>

      {openId && (
        <PromptDrawer
          key={openId}
          promptId={openId}
          folders={folders}
          schemas={schemas}
          onClose={() => setOpenId(null)}
          pushToast={pushToast}
          onOptimize={() => {}}
          onTestRun={() => {}}
        />
      )}
    </div>
  );
}
