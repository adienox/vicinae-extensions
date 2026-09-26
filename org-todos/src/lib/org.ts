/*
 * Pure Org-mode task logic: keyword parsing, stamps, headline parsing and
 * line-level edits. No file I/O and no platform imports live here — every
 * function in this module is deterministic and covered by tests/parser.test.ts.
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface Keywords {
  active: string[];
  done: string[];
  all: string[];
}

export interface Task {
  file: string;
  /** 0-based index of the headline in its file */
  line: number;
  /** The headline exactly as it appeared, used to relocate the task after edits */
  raw: string;
  level: number;
  state: string;
  priority?: string;
  title: string;
  tags: string[];
  /** YYYY-MM-DD[ HH:MM] */
  scheduled?: string;
  deadline?: string;
  closed?: string;
  /** First repeater found on SCHEDULED/DEADLINE, e.g. "+1w" */
  repeat?: string;
  /** Which planning line carries the repeater */
  repeatOn?: "scheduled" | "deadline";
  /** Warning period on the DEADLINE stamp, converted to days (org "-3d") */
  deadlineWarningDays?: number;
  body: string;
  /** Parent headlines, outermost first */
  outline: string[];
  /** :ID: property, used for org-id links */
  orgId?: string;
  /** [x/y] or [x%] statistics cookie found in the headline */
  cookie?: { done: number; total: number; percent: boolean };
  /** Checkbox items in the body (line = index within the body region) */
  checkboxItems?: { line: number; checked: boolean; text: string }[];
  /** Start stamp of an open CLOCK entry, if the task is clocked in */
  clockIn?: string;
  /** Total minutes across closed CLOCK entries */
  clockedMinutes?: number;
}

export interface NewTask {
  title: string;
  state: string;
  priority?: string;
  tags: string[];
  scheduled?: Date;
  deadline?: Date;
  notes?: string;
}

/** undefined = leave alone, null = clear, value = set */
export interface TaskPatch {
  title?: string;
  priority?: string | null;
  tags?: string[];
  scheduled?: Date | null;
  deadline?: Date | null;
  body?: string;
}

export interface StateResult {
  /** The state actually applied (a repeating task returns to an active state) */
  state: string;
  repeated: boolean;
  next?: string;
}

export const taskKey = (t: Pick<Task, "file" | "line">) => `${t.file}:${t.line}`;

/* -------------------------------------------------------------------------- */
/*  Keywords                                                                  */
/* -------------------------------------------------------------------------- */

function tokens(s: string): string[] {
  return s
    .replace(/\([^)]*\)/g, "") // strip fast-access keys like TODO(t)
    .split(/\s+/)
    .filter(Boolean);
}

export function parseKeywords(spec: string): Keywords {
  let active: string[];
  let done: string[];
  if (spec.includes("|")) {
    const [a, d] = spec.split("|");
    active = tokens(a);
    done = tokens(d);
  } else {
    const all = tokens(spec);
    done = all.slice(-1);
    active = all.slice(0, -1);
  }
  if (active.length === 0) active = ["TODO"];
  if (done.length === 0) done = ["DONE"];
  return { active, done, all: [...active, ...done] };
}

const FILE_KEYWORD_RE = /^#\+(?:TODO|TYP_TODO|SEQ_TODO):\s*(.+?)\s*$/i;

/**
 * Org keywords are file-local: a `#+TODO:` directive in the file overrides the
 * extension preference for that file. Multiple directives are merged in order.
 */
export function fileKeywords(text: string, pref: Keywords): Keywords {
  const active: string[] = [];
  const done: string[] = [];
  let found = false;
  for (const line of text.split("\n")) {
    const m = FILE_KEYWORD_RE.exec(line);
    if (!m) continue;
    found = true;
    const spec = m[1];
    const add = (arr: string[], list: string[]) => {
      for (const t of list) if (!arr.includes(t)) arr.push(t);
    };
    if (spec.includes("|")) {
      const [a, d] = spec.split("|");
      add(active, tokens(a));
      add(done, tokens(d));
    } else {
      const all = tokens(spec);
      add(active, all.slice(0, -1));
      add(done, all.slice(-1));
    }
  }
  if (!found) return pref;
  const a = active.length ? active : pref.active;
  const d = done.length ? done : pref.done;
  return { active: a, done: d, all: [...a, ...d] };
}

/* -------------------------------------------------------------------------- */
/*  Dates and timestamps                                                      */
/* -------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export interface Stamp {
  open: "<" | "[";
  date: string;
  time?: string;
  repeater?: string;
  warning?: string;
}

export function parseStamp(ts: string): Stamp | undefined {
  const open = ts[0];
  if (open !== "<" && open !== "[") return undefined;
  const parts = ts.slice(1, -1).trim().split(/\s+/);
  const date = parts.shift();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  if (probe.getMonth() !== m - 1 || probe.getDate() !== d) return undefined;
  const s: Stamp = { open, date };
  for (const t of parts) {
    if (/^\d{1,2}:\d{2}/.test(t)) s.time = t;
    else if (/^(\+\+|\.\+|\+)\d+[hdwmy](\/\d+[hdwmy])?$/.test(t)) s.repeater = t;
    else if (/^-{1,2}\d+[hdwmy]$/.test(t)) s.warning = t;
  }
  return s;
}

export function formatStamp(s: Stamp): string {
  const wd = parseYmd(s.date).toLocaleDateString("en-US", { weekday: "short" });
  const close = s.open === "<" ? ">" : "]";
  return (
    `${s.open}${s.date} ${wd}` +
    (s.time ? ` ${s.time}` : "") +
    (s.repeater ? ` ${s.repeater}` : "") +
    (s.warning ? ` ${s.warning}` : "") +
    close
  );
}

export function nowStamp(now = new Date()): string {
  return formatStamp({
    open: "[",
    date: ymd(now),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  });
}

function addInterval(d: Date, n: number, unit: string): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (unit === "d") r.setDate(r.getDate() + n);
  else if (unit === "h") r.setDate(r.getDate() + Math.max(1, Math.ceil(n / 24)));
  else if (unit === "w") r.setDate(r.getDate() + 7 * n);
  else if (unit === "m") r.setMonth(r.getMonth() + n);
  else if (unit === "y") r.setFullYear(r.getFullYear() + n);
  return r;
}

/** "HH:MM" when the date carries an explicit (non-midnight) time. */
export function stampTime(d: Date): string | undefined {
  return d.getHours() || d.getMinutes() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : undefined;
}

/** Org warning period token ("-2d", "--1w", "-12h") to whole days. */
export function warningToDays(token: string): number | undefined {
  const m = /^(-{1,2})(\d+)([hdwmy])$/.exec(token.trim());
  if (!m) return undefined;
  const n = Number(m[2]);
  if (m[3] === "h") return Math.max(1, Math.ceil(n / 24));
  const mult = { d: 1, w: 7, m: 30, y: 365 }[m[3] as "d" | "w" | "m" | "y"];
  return n * mult;
}

/** Whole days from today until a stamp's date (negative when past). */
export function daysUntil(stamp: string, today: string): number {
  return Math.round((parseYmd(stamp).getTime() - parseYmd(today).getTime()) / 86400000);
}

export type DeadlineState = "overdue" | "today" | "warn";

/** Org deadline lifecycle: overdue, due today, or inside its warning period. */
export function deadlineStatus(task: Task, today: string): DeadlineState | undefined {
  if (!task.deadline) return undefined;
  const day = task.deadline.slice(0, 10);
  if (day < today) return "overdue";
  if (day === today) return "today";
  const warn = task.deadlineWarningDays ?? 0;
  if (warn > 0 && daysUntil(task.deadline, today) <= warn) return "warn";
  return undefined;
}

/** Shift a date according to an Org repeater (+1w, ++1w, .+1w). */
export function shiftDate(date: string, repeater: string, today: string): string {
  const m = /^(\+\+|\.\+|\+)(\d+)([hdwmy])/.exec(repeater);
  if (!m) return date;
  const [, kind, nStr, unit] = m;
  const n = Number(nStr);
  const t = parseYmd(today);
  let d = parseYmd(date);
  if (kind === ".+") d = addInterval(t, n, unit);
  else if (kind === "+") d = addInterval(d, n, unit);
  else {
    do d = addInterval(d, n, unit);
    while (ymd(d) <= today);
  }
  return ymd(d);
}

/* -------------------------------------------------------------------------- */
/*  Headlines and planning lines                                              */
/* -------------------------------------------------------------------------- */

export const HEADLINE_RE = /^(\*+)\s+(.*)$/;

type PlanKey = "CLOSED" | "SCHEDULED" | "DEADLINE";
const PLAN_ORDER: PlanKey[] = ["CLOSED", "SCHEDULED", "DEADLINE"];
const PLANNING_RE = /^\s*(?:SCHEDULED|DEADLINE|CLOSED):/;
const PLAN_ENTRY_RE = /(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]*[>\]])/g;

export function readPlanning(line: string | undefined): Partial<Record<PlanKey, string>> {
  const out: Partial<Record<PlanKey, string>> = {};
  if (line && PLANNING_RE.test(line)) {
    for (const m of line.matchAll(PLAN_ENTRY_RE)) out[m[1] as PlanKey] = m[2];
  }
  return out;
}

/**
 * First line of the task's body region: after the headline, skipping the
 * planning line and a PROPERTIES drawer if present.
 */
export function bodyStart(lines: string[], idx: number): number {
  let start = idx + 1;
  if (PLANNING_RE.test(lines[start] ?? "")) start++;
  if ((lines[start] ?? "").trim() === ":PROPERTIES:") {
    let e = start + 1;
    while (e < lines.length && lines[e].trim() !== ":END:") e++;
    start = e + 1;
  }
  return start;
}

export function updatePlanning(
  lines: string[],
  idx: number,
  level: number,
  change: Partial<Record<PlanKey, string | null>>,
) {
  const pi = idx + 1;
  const has = PLANNING_RE.test(lines[pi] ?? "");
  const current = readPlanning(lines[pi]);
  const indent = has ? /^\s*/.exec(lines[pi])![0] : " ".repeat(level + 1);

  for (const k of PLAN_ORDER) {
    if (!(k in change)) continue;
    const v = change[k];
    if (v) current[k] = v;
    else delete current[k];
  }

  const parts = PLAN_ORDER.filter((k) => current[k]).map((k) => `${k}: ${current[k]}`);
  if (parts.length === 0) {
    if (has) lines.splice(pi, 1);
  } else if (has) {
    lines[pi] = indent + parts.join(" ");
  } else {
    lines.splice(pi, 0, indent + parts.join(" "));
  }
}

export function setProperty(lines: string[], idx: number, level: number, key: string, value: string) {
  let start = idx + 1;
  if (PLANNING_RE.test(lines[start] ?? "")) start++;
  const indent = " ".repeat(level + 1);

  if ((lines[start] ?? "").trim() === ":PROPERTIES:") {
    let end = start + 1;
    while (end < lines.length && lines[end].trim() !== ":END:") end++;
    for (let i = start + 1; i < end; i++) {
      if (new RegExp(`^\\s*:${key}:`, "i").test(lines[i])) {
        lines[i] = `${indent}:${key}: ${value}`;
        return;
      }
    }
    lines.splice(end, 0, `${indent}:${key}: ${value}`);
  } else {
    lines.splice(start, 0, `${indent}:PROPERTIES:`, `${indent}:${key}: ${value}`, `${indent}:END:`);
  }
}

const cleanTag = (t: string) =>
  t.trim().replace(/[^\w@#%]+/g, "_").replace(/^_+|_+$/g, "");

export function formatHeadline(
  level: number,
  state: string,
  priority: string | undefined,
  title: string,
  tags: string[],
): string {
  let h = `${"*".repeat(level)} ${state}`;
  if (priority) h += ` [#${priority}]`;
  h += ` ${title.trim()}`;
  const t = tags.map(cleanTag).filter(Boolean);
  if (t.length) h += ` :${t.join(":")}:`;
  return h;
}

export function replaceState(raw: string, state: string): string {
  return raw.replace(/^(\*+\s+)\S+/, `$1${state}`);
}

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                   */
/* -------------------------------------------------------------------------- */

function stampDisplay(ts: string | undefined): string | undefined {
  const s = ts ? parseStamp(ts) : undefined;
  return s ? (s.time ? `${s.date} ${s.time}` : s.date) : undefined;
}

/** Remove any drawer (``:SOMETHING:`` … ``:END:``) from a block of body text. */
function stripDrawers(body: string): string {
  const out: string[] = [];
  let inDrawer = false;
  for (const line of body.split("\n")) {
    if (inDrawer) {
      if (/^\s*:END:\s*$/.test(line)) inDrawer = false;
      continue;
    }
    if (/^\s*:[\w-]+:\s*$/.test(line)) {
      inDrawer = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

export function parseOrg(text: string, pref: Keywords, file: string): Task[] {
  const kw = fileKeywords(text, pref);
  const lines = text.split("\n");
  const tasks: Task[] = [];
  const stack: { level: number; title: string }[] = [];
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headlines inside #+begin_…/#+end_… blocks are content, not tasks.
    if (inBlock) {
      if (/^#\+end_/i.test(line)) inBlock = false;
      continue;
    }
    if (/^#\+begin_/i.test(line)) {
      inBlock = true;
      continue;
    }

    const m = HEADLINE_RE.exec(line);
    if (!m) continue;

    const level = m[1].length;
    let rest = m[2];

    let state = "";
    const first = rest.split(/\s+/)[0];
    if (kw.all.includes(first)) {
      state = first;
      rest = rest.slice(first.length).trim();
    }

    let priority: string | undefined;
    const pm = /^\[#([A-Z0-9])\]\s*/.exec(rest);
    if (pm) {
      priority = pm[1];
      rest = rest.slice(pm[0].length);
    }

    let tags: string[] = [];
    const tm = /(?:^|\s+)(:(?:[\w@#%]+:)+)\s*$/.exec(rest);
    if (tm) {
      tags = tm[1].split(":").filter(Boolean);
      rest = rest.slice(0, tm.index);
    }

    // Tolerate hand-written headlines with the priority cookie after the title.
    if (!priority) {
      const pm2 = /\s*\[#([A-Z0-9])\]\s*$/.exec(rest);
      if (pm2) {
        priority = pm2[1];
        rest = rest.slice(0, pm2.index);
      }
    }

    const title = rest.trim();

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const outline = stack.map((s) => s.title);
    stack.push({ level, title: title || "(untitled)" });

    if (!state) continue;

    let end = i + 1;
    while (end < lines.length && !HEADLINE_RE.test(lines[end])) end++;

    const plan = readPlanning(lines[i + 1]);
    const start = bodyStart(lines, i);
    const rawBody = lines.slice(start, end).join("\n");

    let repeat: string | undefined;
    let repeatOn: "scheduled" | "deadline" | undefined;
    for (const key of ["SCHEDULED", "DEADLINE"] as const) {
      const rep = plan[key] ? parseStamp(plan[key])?.repeater : undefined;
      if (rep && !repeat) {
        repeat = rep;
        repeatOn = key === "SCHEDULED" ? "scheduled" : "deadline";
      }
    }
    const deadlineWarningDays = plan.DEADLINE
      ? warningToDays(parseStamp(plan.DEADLINE)?.warning ?? "")
      : undefined;

    const body = stripDrawers(rawBody);

    // :ID: lives in the PROPERTIES drawer, which is above the body region
    const section = lines.slice(i + 1, end).join("\n");
    const orgId = /^\s*:ID:\s*(.+?)\s*$/m.exec(section)?.[1];

    const cookieMatch = /\[(\d+)\/(\d+)\]|\[(\d+)%\]/.exec(m[2]);
    const cookie = cookieMatch
      ? cookieMatch[3] !== undefined
        ? { done: Number(cookieMatch[3]), total: 100, percent: true }
        : { done: Number(cookieMatch[1]), total: Number(cookieMatch[2]), percent: false }
      : undefined;

    const checkboxItems: { line: number; checked: boolean; text: string }[] = [];
    rawBody.split("\n").forEach((l, n) => {
      const cb = /^\s*[-+] \[([ xX-])\] ?(.*)$/.exec(l);
      if (cb) checkboxItems.push({ line: n, checked: cb[1] !== " ", text: cb[2].trim() });
    });

    let clockIn: string | undefined;
    let clockedMinutes: number | undefined;
    const logbook = /(?:^|\n)\s*:LOGBOOK:\n([\s\S]*?)\n\s*:END:/.exec(rawBody)?.[1];
    if (logbook) {
      let total = 0;
      for (const line of logbook.split("\n")) {
        const closed = /CLOCK:\s*[<[][^>\]]*[>\]]\s*--\s*[<[][^>\]]*[>\]]\s*=>\s*(\d+):(\d+)/.exec(line);
        if (closed) {
          total += Number(closed[1]) * 60 + Number(closed[2]);
          continue;
        }
        const open = /^\s*CLOCK:\s*([<[][^>\]]*[>\]])\s*$/.exec(line);
        if (open) clockIn = stampDisplay(open[1]);
      }
      if (total) clockedMinutes = total;
    }

    tasks.push({
      file,
      line: i,
      raw: lines[i],
      level,
      state,
      priority,
      title,
      tags,
      scheduled: stampDisplay(plan.SCHEDULED),
      deadline: stampDisplay(plan.DEADLINE),
      closed: stampDisplay(plan.CLOSED),
      repeat,
      repeatOn,
      ...(deadlineWarningDays !== undefined ? { deadlineWarningDays } : {}),
      body,
      outline,
      orgId,
      cookie,
      ...(checkboxItems.length ? { checkboxItems } : {}),
      ...(clockIn ? { clockIn } : {}),
      ...(clockedMinutes ? { clockedMinutes } : {}),
    });
  }
  return tasks;
}

/* -------------------------------------------------------------------------- */
/*  Line-level edits (pure)                                                   */
/* -------------------------------------------------------------------------- */

export function locate(lines: string[], task: Task): number {
  if (lines[task.line] === task.raw) return task.line;
  const hits = lines.flatMap((l, i) => (l === task.raw ? [i] : []));
  if (hits.length === 1) return hits[0];
  throw new Error("The file changed on disk. Reload and try again.");
}

/** [start, end) of the subtree rooted at the headline at idx. */
export function findSubtreeRange(lines: string[], idx: number, level: number): [number, number] {
  let end = lines.length;
  for (let e = idx + 1; e < lines.length; e++) {
    const m = HEADLINE_RE.exec(lines[e]);
    if (m && m[1].length <= level) {
      end = e;
      break;
    }
  }
  return [idx, end];
}

/** Apply a TODO state change to the lines in place, org-style. */
export function applyStateChange(
  lines: string[],
  idx: number,
  task: Task,
  newState: string,
  kw: Keywords,
  now = new Date(),
): StateResult {
  const wasDone = kw.done.includes(task.state);
  const isDone = kw.done.includes(newState);

  if (isDone && !wasDone) {
    const plan = readPlanning(lines[idx + 1]);
    const change: Partial<Record<PlanKey, string>> = {};
    let next: string | undefined;
    const today = ymd(now);
    for (const k of ["SCHEDULED", "DEADLINE"] as const) {
      const st = plan[k] ? parseStamp(plan[k]!) : undefined;
      if (st?.repeater) {
        st.date = shiftDate(st.date, st.repeater, today);
        change[k] = formatStamp(st);
        next = next ?? st.date;
      }
    }
    if (next) {
      const active = kw.active[0];
      lines[idx] = replaceState(lines[idx], active);
      updatePlanning(lines, idx, task.level, change);
      setProperty(lines, idx, task.level, "LAST_REPEAT", nowStamp(now));
      return { state: active, repeated: true, next };
    }
  }

  lines[idx] = replaceState(lines[idx], newState);
  if (isDone && !wasDone) updatePlanning(lines, idx, task.level, { CLOSED: nowStamp(now) });
  else if (!isDone && wasDone) updatePlanning(lines, idx, task.level, { CLOSED: null });
  return { state: newState, repeated: false };
}

/** Apply a field patch to the lines in place. Returns the new headline. */
export function applyTaskPatch(lines: string[], idx: number, task: Task, patch: TaskPatch): string {
  const priority =
    patch.priority === undefined ? task.priority : patch.priority ?? undefined;
  const headline = formatHeadline(
    task.level,
    task.state,
    priority,
    patch.title ?? task.title,
    patch.tags ?? task.tags,
  );
  lines[idx] = headline;

  const change: Partial<Record<PlanKey, string | null>> = {};
  const plan = readPlanning(lines[idx + 1]);
  for (const [key, val] of [
    ["SCHEDULED", patch.scheduled],
    ["DEADLINE", patch.deadline],
  ] as const) {
    if (val === undefined) continue;
    if (val === null) {
      change[key] = null;
      continue;
    }
    const old = plan[key] ? parseStamp(plan[key]!) : undefined;
    change[key] = formatStamp({
      open: "<",
      date: ymd(val),
      // an explicitly typed time (non-midnight) wins; otherwise keep the old one
      time: stampTime(val) ?? old?.time,
      repeater: old?.repeater,
      warning: old?.warning,
    });
  }
  if (Object.keys(change).length) updatePlanning(lines, idx, task.level, change);

  if (patch.body !== undefined) {
    const start = bodyStart(lines, idx);
    let end = start;
    while (end < lines.length && !HEADLINE_RE.test(lines[end])) end++;
    const text = patch.body.trim();
    const body = text ? text.split("\n").map((l) => (l.trim() ? `  ${l}` : "")) : [];
    lines.splice(start, end - start, ...body);
  }

  return headline;
}

/* -------------------------------------------------------------------------- */
/*  Appending                                                                 */
/* -------------------------------------------------------------------------- */

export function buildAppendBlock(t: NewTask, level: number): string[] {
  const out = [formatHeadline(level, t.state, t.priority, t.title, t.tags)];
  const planning: string[] = [];
  if (t.scheduled) {
    planning.push(
      `SCHEDULED: ${formatStamp({ open: "<", date: ymd(t.scheduled), time: stampTime(t.scheduled) })}`,
    );
  }
  if (t.deadline) {
    planning.push(
      `DEADLINE: ${formatStamp({ open: "<", date: ymd(t.deadline), time: stampTime(t.deadline) })}`,
    );
  }
  if (planning.length) out.push(" ".repeat(level + 1) + planning.join(" "));
  if (t.notes?.trim()) {
    for (const l of t.notes.trim().split("\n")) out.push(l.trim() ? `  ${l}` : "");
  }
  return out;
}

/**
 * Where a new task should land: inside the last level-1 project whose tags
 * intersect the new task's tags (as a child of that project), or nowhere
 * (undefined = append at the end of the file as a top-level task).
 */
export function findInsertionPoint(
  lines: string[],
  tags: string[],
): { index: number; level: number } | undefined {
  const wanted = new Set(tags.map(cleanTag).filter(Boolean));
  if (wanted.size === 0) return undefined;
  let best: { index: number; level: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADLINE_RE.exec(lines[i]);
    if (!m || m[1].length !== 1) continue;
    const tm = /(?:^|\s+)(:(?:[\w@#%]+:)+)\s*$/.exec(m[2]);
    if (!tm) continue;
    const match = tm[1].split(":").filter(Boolean).some((t) => wanted.has(t));
    if (!match) continue;
    let end = i + 1;
    while (end < lines.length && !/^\*\s/.test(lines[end])) end++;
    let at = end;
    while (at > i + 1 && (lines[at - 1] ?? "").trim() === "") at--;
    best = { index: at, level: m[1].length + 1 };
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/*  Editor command                                                            */
/* -------------------------------------------------------------------------- */

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function buildEditorCommand(template: string, file: string, line: number): string {
  return template
    .replaceAll("{file}", shellQuote(file))
    .replaceAll("{line}", String(line));
}

/* -------------------------------------------------------------------------- */
/*  Repeaters, projects, cookies, tags                                        */
/* -------------------------------------------------------------------------- */

/** Set or clear the repeater on the task's SCHEDULED/DEADLINE stamp. */
export function applyRepeaterChange(
  lines: string[],
  idx: number,
  task: Task,
  target: "scheduled" | "deadline",
  repeater: string | null,
): void {
  const plan = readPlanning(lines[idx + 1]);
  const stampStr = plan[target === "scheduled" ? "SCHEDULED" : "DEADLINE"];
  if (!stampStr) {
    throw new Error(target === "scheduled" ? "No scheduled date — set one first" : "No deadline date — set one first");
  }
  const st = parseStamp(stampStr);
  if (!st) throw new Error("Could not parse the date stamp");
  const next = formatStamp({ ...st, repeater: repeater ?? undefined });
  updatePlanning(lines, idx, task.level, {
    [target === "scheduled" ? "SCHEDULED" : "DEADLINE"]: next,
  });
}

export interface ProjectRef {
  line: number;
  raw: string;
  level: number;
  title: string;
  tags: string[];
}

/** All level-1 headlines of a file, keyword or not — refile targets. */
export function listProjects(text: string, kw: Keywords): ProjectRef[] {
  const out: ProjectRef[] = [];
  let inBlock = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inBlock) {
      if (/^#\+end_/i.test(line)) inBlock = false;
      continue;
    }
    if (/^#\+begin_/i.test(line)) {
      inBlock = true;
      continue;
    }
    const m = HEADLINE_RE.exec(line);
    if (!m || m[1].length !== 1) continue;

    let rest = m[2];
    const first = rest.split(/\s+/)[0];
    if (kw.all.includes(first)) rest = rest.slice(first.length).trim();
    const pm = /^\[#([A-Z0-9])\]\s*/.exec(rest);
    if (pm) rest = rest.slice(pm[0].length);
    let tags: string[] = [];
    const tm = /(?:^|\s+)(:(?:[\w@#%]+:)+)\s*$/.exec(rest);
    if (tm) {
      tags = tm[1].split(":").filter(Boolean);
      rest = rest.slice(0, tm.index);
    }
    out.push({ line: i, raw: line, level: 1, title: rest.trim() || "(untitled)", tags });
  }
  return out;
}

/** Shift the stars of every headline in a subtree by delta (min level 1). */
export function adjustSubtreeLevel(lines: string[], delta: number): string[] {
  if (delta === 0) return [...lines];
  return lines.map((l) => {
    const m = HEADLINE_RE.exec(l);
    if (!m) return l;
    const level = Math.max(1, m[1].length + delta);
    return `${"*".repeat(level)}${l.slice(m[1].length)}`;
  });
}

/** Refresh a [done/total] or [done%] statistics cookie in a headline. */
export function updateCookie(headline: string, done: number, total: number): string {
  const value = /\[(\d+)\/(\d+)\]/.test(headline)
    ? `[${done}/${total}]`
    : /\[(\d+)%\]/.test(headline)
      ? `[${total ? Math.round((done / total) * 100) : 0}%]`
      : null;
  if (!value) return headline;
  return headline.replace(/\[(\d+)\/(\d+)\]|\[(\d+)%\]/, value);
}

/** Every tag used anywhere in a file, including on non-task headlines. */
export function collectTags(text: string, kw: Keywords): string[] {
  const tags = new Set<string>();
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (inBlock) {
      if (/^#\+end_/i.test(line)) inBlock = false;
      continue;
    }
    if (/^#\+begin_/i.test(line)) {
      inBlock = true;
      continue;
    }
    const m = HEADLINE_RE.exec(line);
    if (!m) continue;
    let rest = m[2];
    const first = rest.split(/\s+/)[0];
    if (kw.all.includes(first)) rest = rest.slice(first.length).trim();
    const tm = /(?:^|\s+)(:(?:[\w@#%]+:)+)\s*$/.exec(rest);
    if (tm) for (const t of tm[1].split(":").filter(Boolean)) tags.add(t);
  }
  return [...tags];
}
