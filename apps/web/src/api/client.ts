import type {
  ApiError,
  Experiment,
  ExperimentDetail,
  ExperimentInput,
  Folder,
  FolderInput,
  LoginInput,
  Model,
  ModelInput,
  ModelUpdate,
  OptimizeInput,
  OptimizeOutput,
  PlaygroundRunInput,
  PlaygroundRunOutput,
  Prompt,
  PromptDetail,
  PromptInput,
  PromptMetaUpdate,
  PromptVersion,
  PromptVersionInput,
  Run,
  SchemaDoc,
  SchemaDocInput,
  Task,
  TaskInput,
} from "@holonet/shared";
import { queryOptions } from "@tanstack/react-query";

export class ApiRequestError extends Error {
  readonly apiError: ApiError;
  readonly status: number;

  constructor(apiError: ApiError, status: number) {
    super(apiError.error.message);
    this.name = "ApiRequestError";
    this.apiError = apiError;
    this.status = status;
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const apiError: ApiError = body ?? {
      error: { code: "INTERNAL", message: res.statusText },
    };
    throw new ApiRequestError(apiError, res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => json<T>(path),
  post: <T>(path: string, data?: unknown) =>
    json<T>(path, {
      method: "POST",
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  put: <T>(path: string, data?: unknown) =>
    json<T>(path, {
      method: "PUT",
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  patch: <T>(path: string, data?: unknown) =>
    json<T>(path, {
      method: "PATCH",
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  delete: <T>(path: string) => json<T>(path, { method: "DELETE" }),
};

export const tasksQueryOptions = queryOptions({
  queryKey: ["tasks"] as const,
  queryFn: () => api.get<Task[]>("/api/tasks"),
});

export const modelsQueryOptions = queryOptions({
  queryKey: ["models"] as const,
  queryFn: () => api.get<Model[]>("/api/models"),
});

export function runsQueryOptions(limit = 80) {
  return queryOptions({
    queryKey: ["runs", limit] as const,
    queryFn: () => api.get<Run[]>(`/api/runs?limit=${limit}`),
  });
}

export interface AuthMe {
  authenticated: boolean;
}

export const authMeQueryOptions = queryOptions({
  queryKey: ["auth", "me"] as const,
  queryFn: () => api.get<AuthMe>("/api/auth/me"),
  retry: false,
});

export function login(key: LoginInput["key"]) {
  return api.post<void>("/api/auth/login", { key } satisfies LoginInput);
}

export function logout() {
  return api.post<void>("/api/auth/logout");
}

export function createTask(input: TaskInput) {
  return api.post<Task>("/api/tasks", input);
}

export function updateTask(id: string, input: TaskInput) {
  return api.put<Task>(`/api/tasks/${id}`, input);
}

export function deleteTask(id: string) {
  return api.delete<void>(`/api/tasks/${id}`);
}

export function toggleTask(id: string) {
  return api.post<Task>(`/api/tasks/${id}/toggle`);
}

export function runTaskNow(id: string) {
  return api.post<Run>(`/api/tasks/${id}/run`);
}

export function createModel(input: ModelInput) {
  return api.post<Model>("/api/models", input);
}

export function updateModel(id: string, input: ModelUpdate) {
  return api.patch<Model>(`/api/models/${id}`, input);
}

export function deleteModel(id: string) {
  return api.delete<void>(`/api/models/${id}`);
}

export const foldersQueryOptions = queryOptions({
  queryKey: ["folders"] as const,
  queryFn: () => api.get<Folder[]>("/api/folders"),
});

export const promptsQueryOptions = queryOptions({
  queryKey: ["prompts"] as const,
  queryFn: () => api.get<Prompt[]>("/api/prompts"),
});

export function promptQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["prompt", id] as const,
    queryFn: () => api.get<PromptDetail>(`/api/prompts/${id}`),
  });
}

export const experimentsQueryOptions = queryOptions({
  queryKey: ["experiments"] as const,
  queryFn: () => api.get<Experiment[]>("/api/experiments"),
});

export function experimentQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["experiment", id] as const,
    queryFn: () => api.get<ExperimentDetail>(`/api/experiments/${id}`),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 5000 : false,
  });
}

export const schemasQueryOptions = queryOptions({
  queryKey: ["schemas"] as const,
  queryFn: () => api.get<SchemaDoc[]>("/api/schemas"),
});

export function createFolder(input: FolderInput) {
  return api.post<Folder>("/api/folders", input);
}

export function renameFolder(id: string, input: FolderInput) {
  return api.patch<Folder>(`/api/folders/${id}`, input);
}

export function deleteFolder(id: string) {
  return api.delete<void>(`/api/folders/${id}`);
}

export function createPrompt(input: PromptInput) {
  return api.post<Prompt>("/api/prompts", input);
}

export function updatePromptMeta(id: string, input: PromptMetaUpdate) {
  return api.patch<Prompt>(`/api/prompts/${id}`, input);
}

export function createPromptVersion(id: string, input: PromptVersionInput) {
  return api.post<PromptVersion>(`/api/prompts/${id}/versions`, input);
}

export function deletePrompt(id: string) {
  return api.delete<void>(`/api/prompts/${id}`);
}

export function optimizePrompt(id: string, input: OptimizeInput) {
  return api.post<OptimizeOutput>(`/api/prompts/${id}/optimize`, input);
}

export function createExperiment(input: ExperimentInput) {
  return api.post<ExperimentDetail>("/api/experiments", input);
}

export function setResultWinner(
  experimentId: string,
  resultId: string,
  winner: boolean,
) {
  return api.patch(`/api/experiments/${experimentId}/results/${resultId}`, {
    winner,
  });
}

export function createSchema(input: SchemaDocInput) {
  return api.post<SchemaDoc>("/api/schemas", input);
}

export function updateSchema(id: string, input: SchemaDocInput) {
  return api.patch<SchemaDoc>(`/api/schemas/${id}`, input);
}

export function deleteSchema(id: string) {
  return api.delete<void>(`/api/schemas/${id}`);
}

export function playgroundRun(input: PlaygroundRunInput) {
  return api.post<PlaygroundRunOutput>("/api/playground/run", input);
}
