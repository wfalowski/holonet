import { ApiRequestError } from "../api/client.js";

/** Best-effort human-readable message for a thrown fetch/API error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.apiError.error.message;
  if (error instanceof Error) return error.message;
  return "UNKNOWN ERROR";
}
