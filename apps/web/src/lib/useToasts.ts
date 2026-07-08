import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: number;
  message: string;
}

/** Small toast queue — entries auto-dismiss after `ttlMs` (default 5s). */
export function useToasts(ttlMs = 5000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback(
    (message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, ttlMs);
    },
    [ttlMs],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}
