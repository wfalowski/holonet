const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** HH:MM:SS from an epoch ms timestamp. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** "DOW YYYY.MM.DD" from an epoch ms timestamp. */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAY[d.getDay()]} ${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}
