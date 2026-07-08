import {
  countdown,
  type ModelInput,
  type ModelUpdate,
  type Task,
  type TaskInput,
} from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ApiRequestError,
  createModel,
  createTask,
  deleteModel,
  deleteTask,
  modelsQueryOptions,
  runsQueryOptions,
  runTaskNow,
  tasksQueryOptions,
  toggleTask,
  updateModel,
  updateTask,
} from "../api/client.js";
import { errorMessage } from "../lib/errors.js";
import { backgroundGrid } from "../lib/theme.js";
import type { ViewId } from "../lib/types.js";
import { useNow } from "../lib/useNow.js";
import { useToasts } from "../lib/useToasts.js";
import { ActivityView } from "../views/ActivityView.js";
import { IntegrationsView } from "../views/IntegrationsView.js";
import { OverviewView } from "../views/OverviewView.js";
import { SettingsView } from "../views/SettingsView.js";
import { TasksView } from "../views/TasksView.js";
import { Rail } from "./Rail.js";
import { StatusBar } from "./StatusBar.js";
import { TaskDrawer } from "./TaskDrawer.js";
import { ToastStrip } from "./Toast.js";

type DrawerState = { mode: "new" } | { mode: "edit"; task: Task } | null;

export function Console() {
  const now = useNow();
  const queryClient = useQueryClient();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [view, setView] = useState<ViewId>("overview");
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

  const tasksQuery = useQuery(tasksQueryOptions);
  const runsQuery = useQuery(runsQueryOptions());
  const modelsQuery = useQuery(modelsQueryOptions);
  const tasks = tasksQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const models = modelsQuery.data ?? [];

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  }

  const createMutation = useMutation({
    mutationFn: (input: TaskInput) => createTask(input),
    onSuccess: () => {
      invalidateAll();
      setDrawer(null);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskInput }) =>
      updateTask(id, input),
    onSuccess: () => {
      invalidateAll();
      setDrawer(null);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      invalidateAll();
      setDrawer(null);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleTask(id),
    onSuccess: invalidateAll,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => runTaskNow(id),
    onMutate: (id: string) => setRunningId(id),
    onSuccess: invalidateAll,
    onError: (error, id) => {
      if (error instanceof ApiRequestError && error.status === 409) {
        setConflictId(id);
        setTimeout(() => setConflictId(null), 2500);
        return;
      }
      pushToast(errorMessage(error));
    },
    onSettled: () => setRunningId(null),
  });

  function invalidateModels() {
    queryClient.invalidateQueries({ queryKey: ["models"] });
  }

  const createModelMutation = useMutation({
    mutationFn: (input: ModelInput) => createModel(input),
    onSuccess: invalidateModels,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const updateModelMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ModelUpdate }) =>
      updateModel(id, input),
    onSuccess: invalidateModels,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteModelMutation = useMutation({
    mutationFn: (id: string) => deleteModel(id),
    onSuccess: invalidateModels,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const activeCount = tasks.filter((t) => t.enabled).length;
  const upcomingRaw = tasks
    .filter((t) => t.enabled && t.nextRunAt != null)
    .sort((a, b) => (a.nextRunAt as number) - (b.nextRunAt as number));
  const nextJob = upcomingRaw[0];

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "236px 1fr",
        color: "#e9edf4",
        ...backgroundGrid,
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 60,
          background:
            "repeating-linear-gradient(rgba(0,0,0,0) 0 2px, rgba(0,0,0,.15) 2px 3px)",
          animation: "scan 6s linear infinite",
          opacity: 0.55,
        }}
      />

      <Rail
        view={view}
        onNavigate={setView}
        tasksCount={tasks.length}
        runsCount={runs.length}
      />

      <div
        style={{
          display: "grid",
          gridTemplateRows: "54px 1fr",
          minWidth: 0,
          position: "relative",
          zIndex: 1,
        }}
      >
        <StatusBar
          activeCount={activeCount}
          nextName={nextJob ? nextJob.name : "—"}
          nextCountdown={nextJob ? countdown(nextJob.nextRunAt, now) : ""}
          now={now}
        />
        <ToastStrip toasts={toasts} onDismiss={dismissToast} />

        <main style={{ overflow: "auto", padding: "26px 28px 40px" }}>
          {view === "overview" && (
            <OverviewView tasks={tasks} runs={runs} models={models} now={now} />
          )}
          {view === "tasks" && (
            <TasksView
              tasks={tasks}
              models={models}
              now={now}
              runningId={runningId}
              conflictId={conflictId}
              onNewTask={() => setDrawer({ mode: "new" })}
              onEditTask={(task) => setDrawer({ mode: "edit", task })}
              onToggleTask={(id) => toggleMutation.mutate(id)}
              onRunTask={(id) => runMutation.mutate(id)}
            />
          )}
          {view === "integrations" && <IntegrationsView tasks={tasks} />}
          {view === "activity" && <ActivityView runs={runs} />}
          {view === "settings" && (
            <SettingsView
              models={models}
              onCreate={(input) => createModelMutation.mutateAsync(input)}
              onUpdate={(id, input) =>
                updateModelMutation.mutate({ id, input })
              }
              onDelete={(id) => deleteModelMutation.mutate(id)}
              isSaving={
                createModelMutation.isPending ||
                updateModelMutation.isPending ||
                deleteModelMutation.isPending
              }
            />
          )}
        </main>
      </div>

      {drawer && (
        <TaskDrawer
          key={drawer.mode === "edit" ? drawer.task.id : "new"}
          mode={drawer.mode}
          task={drawer.mode === "edit" ? drawer.task : null}
          models={models}
          onClose={() => setDrawer(null)}
          onCreate={(input) => createMutation.mutate(input)}
          onUpdate={(id, input) => updateMutation.mutate({ id, input })}
          onDelete={(id) => deleteMutation.mutate(id)}
          isSaving={createMutation.isPending || updateMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
