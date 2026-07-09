export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Simple LCS line diff — fine for prompt-sized inputs. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i] ?? [];
    const below = dp[i + 1] ?? [];
    for (let j = n - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] ?? 0) + 1
          : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] ?? "" });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ kind: "del", text: a[i] ?? "" });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] ?? "" });
      j++;
    }
  }
  while (i < m) out.push({ kind: "del", text: a[i++] ?? "" });
  while (j < n) out.push({ kind: "add", text: b[j++] ?? "" });
  return out;
}
