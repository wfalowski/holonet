// Port of the cron logic embedded in design/Holonet.dc.html (<script> block).
// Behavior is kept identical to the original design-file implementation.

const DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const DAYFULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface ParsedCron {
  mi: Set<number>;
  ho: Set<number>;
  dom: Set<number>;
  mon: Set<number>;
  dow: Set<number>;
  domR: boolean;
  dowR: boolean;
}

function expandField(
  expr: string,
  min: number,
  max: number,
): Set<number> | null {
  if (expr === "*") {
    const s = new Set<number>();
    for (let i = min; i <= max; i++) s.add(i);
    return s;
  }
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const [rangePart, stepStr] = part.split("/");
    let step = 1;
    if (stepStr !== undefined) {
      step = Number.parseInt(stepStr, 10);
      if (Number.isNaN(step) || step < 1) return null;
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart === undefined) {
      return null;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number.parseInt(a ?? "", 10);
      hi = Number.parseInt(b ?? "", 10);
    } else {
      lo = Number.parseInt(rangePart, 10);
      hi = stepStr !== undefined ? max : lo;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo < min || hi > max || lo > hi)
      return null;
    for (let i = lo; i <= hi; i += step) out.add(i);
  }
  return out;
}

export function parseCron(str: string): ParsedCron | null {
  const p = (str || "").trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [miExpr, hoExpr, domExpr, monExpr, dowExpr] = p as [
    string,
    string,
    string,
    string,
    string,
  ];
  const mi = expandField(miExpr, 0, 59);
  const ho = expandField(hoExpr, 0, 23);
  const dom = expandField(domExpr, 1, 31);
  const mon = expandField(monExpr, 1, 12);
  const dowRaw = expandField(dowExpr, 0, 7);
  if (!mi || !ho || !dom || !mon || !dowRaw) return null;
  const dow = new Set<number>();
  for (const d of dowRaw) dow.add(d === 7 ? 0 : d);
  return {
    mi,
    ho,
    dom,
    mon,
    dow,
    domR: domExpr !== "*",
    dowR: dowExpr !== "*",
  };
}

function matches(d: Date, c: ParsedCron): boolean {
  if (!c.mi.has(d.getMinutes())) return false;
  if (!c.ho.has(d.getHours())) return false;
  if (!c.mon.has(d.getMonth() + 1)) return false;
  const dm = c.dom.has(d.getDate());
  const dw = c.dow.has(d.getDay());
  let dayOk: boolean;
  if (c.domR && c.dowR) dayOk = dm || dw;
  else if (c.domR) dayOk = dm;
  else if (c.dowR) dayOk = dw;
  else dayOk = true;
  return dayOk;
}

export function nextRun(str: string, fromMs?: number): number | null {
  const c = parseCron(str);
  if (!c) return null;
  const d = new Date(fromMs || Date.now());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 527040; i++) {
    if (matches(d, c)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

export interface CronDescription {
  ok: boolean;
  tag: string;
  text: string;
}

export function describeCron(str: string): CronDescription {
  const raw = (str || "").trim();
  const p = raw.split(/\s+/);
  if (p.length !== 5)
    return {
      ok: false,
      tag: "INVALID",
      text: "Needs 5 fields: min hour dom mon dow",
    };
  const c = parseCron(str);
  if (!c)
    return { ok: false, tag: "INVALID", text: "Unrecognized field value" };
  const [mi, ho, dom, mon, dow] = p as [string, string, string, string, string];
  const at = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`;
  if (mi === "*" && ho === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ok: true, tag: "REALTIME", text: "Every minute" };
  }
  const m1 = /^\*\/(\d+)$/.exec(mi);
  if (m1 && ho === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ok: true, tag: `EVERY ${m1[1]}M`, text: `Every ${m1[1]} minutes` };
  }
  if (
    /^\d+$/.test(mi) &&
    ho === "*" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    return { ok: true, tag: "HOURLY", text: `Every hour at :${pad2(+mi)}` };
  }
  const h2 = /^\*\/(\d+)$/.exec(ho);
  if (/^\d+$/.test(mi) && h2 && dom === "*" && mon === "*" && dow === "*") {
    return {
      ok: true,
      tag: `EVERY ${h2[1]}H`,
      text: `Every ${h2[1]} hours at :${pad2(+mi)}`,
    };
  }
  if (/^\d+$/.test(mi) && /^\d+$/.test(ho) && dom === "*" && mon === "*") {
    const t = at(+ho, +mi);
    if (dow === "*")
      return { ok: true, tag: "DAILY", text: `Every day at ${t}` };
    if (dow === "1-5")
      return { ok: true, tag: "WEEKDAYS", text: `Weekdays at ${t}` };
    if (dow === "0,6" || dow === "6,0" || dow === "6-7" || dow === "6,7") {
      return { ok: true, tag: "WEEKENDS", text: `Weekends at ${t}` };
    }
    const arr = [...c.dow].sort((a, b) => a - b);
    if (arr.length === 1) {
      const idx = arr[0] as number;
      return {
        ok: true,
        tag: DAY[idx] as string,
        text: `Every ${DAYFULL[idx]} at ${t}`,
      };
    }
    return {
      ok: true,
      tag: "WEEKLY",
      text: `${arr.map((d) => DAY[d]).join(", ")} at ${t}`,
    };
  }
  if (
    /^\d+$/.test(mi) &&
    /^\d+$/.test(ho) &&
    /^\d+$/.test(dom) &&
    mon === "*" &&
    dow === "*"
  ) {
    return {
      ok: true,
      tag: "MONTHLY",
      text: `Day ${dom} of each month at ${at(+ho, +mi)}`,
    };
  }
  return { ok: true, tag: "CUSTOM", text: "Custom schedule" };
}

export function countdown(ts: number | null | undefined, now: number): string {
  if (!ts) return "—";
  const diff = ts - now;
  if (diff <= 0) return "DISPATCHING";
  let s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const t = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return d > 0 ? `T-${d}d ${t}` : `T-${t}`;
}

export function relTime(ts: number | null | undefined, now: number): string {
  if (!ts) return "never";
  const diff = now - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Structural validity check used by the shared TaskInput schema (5-field cron parse). */
export function isValidCron(str: string): boolean {
  return parseCron(str) !== null;
}
