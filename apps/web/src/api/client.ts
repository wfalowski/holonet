import type {
  ApiError,
  LoginInput,
  Run,
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
  delete: <T>(path: string) => json<T>(path, { method: "DELETE" }),
};

export const tasksQueryOptions = queryOptions({
  queryKey: ["tasks"] as const,
  queryFn: () => api.get<Task[]>("/api/tasks"),
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
