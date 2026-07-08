import type { Model } from "@holonet/shared";

export function modelLabel(id: string, models: Model[]): string {
  return models.find((m) => m.modelId === id)?.label ?? id;
}
