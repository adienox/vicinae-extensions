/*
 * File I/O for org tasks. Every write goes through writeFileAtomic (write to a
 * temp file in the same directory, then rename) so that sync backends such as
 * Syncthing never observe a half-written file.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import {
  applyStateChange,
  applyTaskPatch,
  buildAppendBlock,
  bodyStart,
  collectTags,
  findInsertionPoint,
  findSubtreeRange,
  formatStamp,
  HEADLINE_RE,
  listProjects,
  locate,
  nowStamp,
  parseOrg,
  parseStamp,
  setProperty,
  updateCookie,
  ymd,
  adjustSubtreeLevel,
  applyRepeaterChange,
  type Keywords,
  type NewTask,
  type StateResult,
  type Task,
  type TaskPatch,
} from "./org";

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                */
/* -------------------------------------------------------------------------- */

async function writeFileAtomic(file: string, content: string): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}`);
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

async function readOrEmpty(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

async function editFile<T>(
  task: Task,
  fn: (lines: string[], idx: number) => T,
): Promise<T> {
  const lines = (await readFile(task.file, "utf8")).split("\n");
  const idx = locate(lines, task);
  const result = fn(lines, idx);
  await writeFileAtomic(task.file, lines.join("\n"));
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Mutations                                                                 */
/* -------------------------------------------------------------------------- */

/** Change a task's TODO state, handling CLOSED: timestamps and repeaters like Org. */
export async function setTaskState(
  task: Task,
  newState: string,
  kw: Keywords,
): Promise<StateResult> {
  return editFile(task, (lines, idx) => applyStateChange(lines, idx, task, newState, kw));
}

/** Edit title, priority, tags, planning dates and body. Returns the new headline. */
export async function updateTask(task: Task, patch: TaskPatch): Promise<string> {
  return editFile(task, (lines, idx) => applyTaskPatch(lines, idx, task, patch));
}

export interface CutResult {
  /** 0-based line index the subtree used to start at */
  index: number;
  /** The removed lines, in order */
  removed: string[];
}

/** Delete a task and its whole subtree. Undo with restoreTask(). */
export async function deleteTask(task: Task): Promise<CutResult> {
  const lines = (await readFile(task.file, "utf8")).split("\n");
  const idx = locate(lines, task);
  const [start, end] = cutRange(lines, idx, task.level);
  const removed = lines.splice(start, end - start);
  await writeFileAtomic(task.file, lines.join("\n"));
  return { index: start, removed };
}

/** Subtree range that never swallows the trailing-newline artifact at EOF. */
function cutRange(lines: string[], idx: number, level: number): [number, number] {
  const [start, fullEnd] = findSubtreeRange(lines, idx, level);
  const end = fullEnd === lines.length && lines[fullEnd - 1] === "" ? fullEnd - 1 : fullEnd;
  return [start, end];
}

/** Put a cut subtree back where it was. */
export async function restoreTask(file: string, index: number, removed: string[]): Promise<void> {
  const lines = (await readFile(file, "utf8")).split("\n");
  const at = Math.max(0, Math.min(index, lines.length));
  lines.splice(at, 0, ...removed);
  await writeFileAtomic(file, lines.join("\n"));
}

/** Remove the subtree whose headline is exactly `raw` (hint = remembered index). */
export async function removeSubtreeByRaw(file: string, raw: string, hint?: number): Promise<CutResult> {
  const lines = (await readFile(file, "utf8")).split("\n");
  let idx = hint !== undefined && lines[hint] === raw ? hint : -1;
  if (idx < 0) {
    const hits = lines.flatMap((l, i) => (l === raw ? [i] : []));
    if (hits.length !== 1) {
      throw new Error(`Could not locate the task in ${path.basename(file)}.`);
    }
    idx = hits[0];
  }
  const level = HEADLINE_RE.exec(raw)?.[1]?.length ?? 1;
  const [start, end] = cutRange(lines, idx, level);
  const removed = lines.splice(start, end - start);
  await writeFileAtomic(file, lines.join("\n"));
  return { index: start, removed };
}

/** Move a task and its subtree to the archive file, stamping :ARCHIVE_TIME:. */
export async function archiveTask(task: Task, archiveFile: string): Promise<CutResult> {
  const cut = await deleteTask(task);
  const stamped = [...cut.removed];
  setProperty(stamped, 0, task.level, "ARCHIVE_TIME", nowStamp());
  try {
    const existing = await readOrEmpty(archiveFile);
    const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await mkdir(path.dirname(archiveFile), { recursive: true });
    await writeFileAtomic(archiveFile, `${existing}${prefix}${stamped.join("\n")}\n`);
  } catch (e) {
    // never lose the task: put it back before surfacing the error
    await restoreTask(task.file, cut.index, cut.removed).catch(() => {});
    throw e;
  }
  return cut;
}

/** Reverse of archiveTask: back into the source file, out of the archive. */
export async function unarchiveTask(
  sourceFile: string,
  archiveFile: string,
  index: number,
  removed: string[],
): Promise<void> {
  await restoreTask(sourceFile, index, removed);
  await removeSubtreeByRaw(archiveFile, removed[0]);
}

/**
 * Append a new task. If the task carries tags that match a top-level project
 * in the file, it is inserted as the last child of that project; otherwise it
 * is appended at the end of the file. Returns where the headline landed.
 */
export async function appendTask(file: string, t: NewTask): Promise<{ line: number; raw: string }> {
  const existing = await readOrEmpty(file);
  const lines = existing === "" ? [] : existing.split("\n");
  // drop the artifact of a trailing newline so appends land on real lines
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const ins = findInsertionPoint(lines, t.tags);
  const level = ins?.level ?? 1;
  const block = buildAppendBlock(t, level);
  const at = ins?.index ?? lines.length;
  lines.splice(at, 0, ...block);

  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${lines.join("\n")}\n`);
  return { line: at, raw: block[0] };
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                   */
/* -------------------------------------------------------------------------- */

export async function loadTasks(files: string[], kw: Keywords): Promise<Task[]> {
  const perFile = await Promise.all(
    files.map(async (f) => parseOrg(await readOrEmpty(f), kw, f)),
  );
  return perFile.flat();
}

/** Expand directories into the .org files they contain. */
export async function expandSources(sources: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of sources) {
    try {
      const st = await stat(s);
      if (st.isDirectory()) {
        for (const name of (await readdir(s)).sort()) {
          if (name.endsWith(".org")) out.push(path.join(s, name));
        }
      } else {
        out.push(s);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") out.push(s);
      else throw e;
    }
  }
  return [...new Set(out)];
}

/**
 * A key describing which sources exist on disk. When it changes (e.g. the
 * todos file was just created by Quick Add), the caller should re-arm its
 * watchers — a watcher set up while a directory was missing is dead.
 */
export async function sourceExistKey(files: string[]): Promise<string> {
  const marks = await Promise.all(
    files.map(async (f) => {
      try {
        await stat(f);
        return f;
      } catch {
        return `!${f}`;
      }
    }),
  );
  return marks.join("|");
}

/** Watch the directories containing the files; calls back (debounced) on change. */
export function watchTasks(files: string[], onChange: () => void): () => void {
  const dirs = new Map<string, Set<string>>();
  for (const f of files) {
    const d = path.dirname(f);
    if (!dirs.has(d)) dirs.set(d, new Set());
    dirs.get(d)!.add(path.basename(f));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];
  for (const [dir, names] of dirs) {
    try {
      const w = watch(dir, (_event, name) => {
        if (name && !names.has(name.toString())) return;
        clearTimeout(timer);
        timer = setTimeout(onChange, 250);
      });
      w.on("error", () => {});
      watchers.push(w);
    } catch {
      /* directory may not exist yet */
    }
  }
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

/* -------------------------------------------------------------------------- */
/*  Existence, tags, projects                                                 */
/* -------------------------------------------------------------------------- */

export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Create an empty file (and its directory), for the empty-state button. */
export async function createFile(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, "");
}

export interface LoadedData {
  tasks: Task[];
  /** Every tag used in any source file, including on project headlines */
  tags: string[];
}

export async function loadTasksAndTags(files: string[], kw: Keywords): Promise<LoadedData> {
  const texts = await Promise.all(files.map(readOrEmpty));
  const tasks = texts.flatMap((text, i) => parseOrg(text, kw, files[i]));
  const tags = [...new Set(texts.flatMap((text) => collectTags(text, kw)))].sort((a, b) =>
    a.localeCompare(b),
  );
  return { tasks, tags };
}

export interface FileProjects {
  file: string;
  projects: { line: number; raw: string; title: string; tags: string[] }[];
}

/** Top-level headlines per file, for the refile picker. */
export async function loadProjects(files: string[], kw: Keywords): Promise<FileProjects[]> {
  return Promise.all(
    files.map(async (file) => ({
      file,
      projects: listProjects(await readOrEmpty(file), kw),
    })),
  );
}

/* -------------------------------------------------------------------------- */
/*  Repeaters                                                                 */
/* -------------------------------------------------------------------------- */

/** Set or clear the repeater on the task's scheduled/deadline stamp. */
export async function setTaskRepeater(
  task: Task,
  target: "scheduled" | "deadline",
  repeater: string | null,
): Promise<void> {
  await editFile(task, (lines, idx) => {
    applyRepeaterChange(lines, idx, task, target, repeater);
  });
}

/* -------------------------------------------------------------------------- */
/*  Checkboxes                                                                */
/* -------------------------------------------------------------------------- */

/** Toggle the bodyLine-th checkbox (body-relative index) and refresh the cookie. */
export async function toggleTaskCheckbox(
  task: Task,
  bodyLine: number,
): Promise<{ done: number; total: number }> {
  return editFile(task, (lines, idx) => {
    const start = bodyStart(lines, idx);
    const at = start + bodyLine;
    const line = lines[at] ?? "";
    const m = /^(\s*[-+] \[)([ xX-])(\].*)$/.exec(line);
    if (!m) throw new Error("Checkbox not found (file changed?)");
    lines[at] = `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}`;

    let end = start;
    while (end < lines.length && !HEADLINE_RE.test(lines[end])) end++;
    let done = 0;
    let total = 0;
    for (let i = start; i < end; i++) {
      const cb = /^\s*[-+] \[([ xX-])\]/.exec(lines[i]);
      if (cb) {
        total++;
        if (cb[1] !== " ") done++;
      }
    }
    if (total) lines[idx] = updateCookie(lines[idx], done, total);
    return { done, total };
  });
}

/* -------------------------------------------------------------------------- */
/*  Clocking                                                                  */
/* -------------------------------------------------------------------------- */

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Start a CLOCK entry on the task (inside its LOGBOOK drawer). */
export async function clockIn(task: Task, now = new Date()): Promise<void> {
  await editFile(task, (lines, idx) => {
    const start = bodyStart(lines, idx);
    let end = start;
    while (end < lines.length && !HEADLINE_RE.test(lines[end])) end++;
    const stamp = formatStamp({ open: "[", date: ymd(now), time: hhmm(now) });
    for (let i = start; i < end; i++) {
      if (lines[i].trim() === ":LOGBOOK:") {
        lines.splice(i + 1, 0, `  CLOCK: ${stamp}`);
        return;
      }
    }
    lines.splice(start, 0, "  :LOGBOOK:", `  CLOCK: ${stamp}`, "  :END:");
  });
}

/** Close the open CLOCK entry with an end stamp and duration. */
export async function clockOut(
  task: Task,
  now = new Date(),
): Promise<{ minutes: number } | undefined> {
  return editFile(task, (lines, idx) => {
    const start = bodyStart(lines, idx);
    let end = start;
    while (end < lines.length && !HEADLINE_RE.test(lines[end])) end++;
    for (let i = start; i < end; i++) {
      const m = /^(\s*)CLOCK:\s*([<[][^>\]]*[>\]])\s*$/.exec(lines[i]);
      if (!m) continue;
      const inStamp = parseStamp(m[2]);
      if (!inStamp) continue;
      const [iy, im, id] = inStamp.date.split("-").map(Number);
      const [ih, imin] = (inStamp.time ?? "00:00").split(":").map(Number);
      const inDate = new Date(iy, im - 1, id, ih, imin);
      const minutes = Math.max(1, Math.round((now.getTime() - inDate.getTime()) / 60000));
      const duration = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
      const outStamp = formatStamp({ open: "[", date: ymd(now), time: hhmm(now) });
      lines[i] = `${m[1]}CLOCK: ${m[2]}--${outStamp} =>  ${duration}`;
      return { minutes };
    }
    return undefined;
  });
}

/* -------------------------------------------------------------------------- */
/*  Bulk rescheduling                                                         */
/* -------------------------------------------------------------------------- */

export interface BulkRescheduleResult {
  count: number;
  /** What the undo entry needs to restore each task's old scheduled date */
  entries: { task: Task; raw: string; oldDate: string | undefined }[];
  failures: string[];
}

/**
 * Push every open task whose SCHEDULED date is before `today` forward to
 * `target`. Deadlines are deliberately untouched — they are commitments, not
 * intentions. Per-task failures are collected, not fatal.
 */
export async function rescheduleOverdueTasks(
  tasks: Task[],
  target: Date,
  today: string,
): Promise<BulkRescheduleResult> {
  const entries: BulkRescheduleResult["entries"] = [];
  const failures: string[] = [];
  for (const task of tasks) {
    if (!task.scheduled) continue;
    if (task.scheduled.slice(0, 10) >= today) continue;
    try {
      const raw = await updateTask(task, { scheduled: target });
      entries.push({ task, raw, oldDate: task.scheduled });
    } catch (e) {
      failures.push(`${task.title}: ${String(e)}`);
    }
  }
  return { count: entries.length, entries, failures };
}

/* -------------------------------------------------------------------------- */
/*  Refiling                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Move a task's subtree into another file — appended at the end, or as the
 * last child of a target project (stars adjusted to fit). Returns what the
 * undo entry needs: the adjusted headline and the original cut.
 */
export async function refileTask(
  task: Task,
  targetFile: string,
  project?: { raw: string },
): Promise<{ newRaw: string; index: number; removed: string[] }> {
  const cut = await deleteTask(task);
  let inserted = cut.removed;
  try {
    const existing = await readOrEmpty(targetFile);
    const targetLines = existing === "" ? [] : existing.split("\n");
    if (targetLines.length && targetLines[targetLines.length - 1] === "") targetLines.pop();

    let at = targetLines.length;
    let level = 1;
    if (project) {
      const idx = targetLines.findIndex((l) => l === project.raw);
      if (idx < 0) throw new Error("Could not find the target project.");
      const pLevel = HEADLINE_RE.exec(project.raw)?.[1]?.length ?? 1;
      const [, end] = findSubtreeRange(targetLines, idx, pLevel);
      at = end;
      while (at > idx + 1 && (targetLines[at - 1] ?? "").trim() === "") at--;
      level = pLevel + 1;
    }

    inserted = adjustSubtreeLevel(cut.removed, level - task.level);
    targetLines.splice(at, 0, ...inserted);
    await mkdir(path.dirname(targetFile), { recursive: true });
    await writeFileAtomic(targetFile, `${targetLines.join("\n")}\n`);
  } catch (e) {
    await restoreTask(task.file, cut.index, cut.removed).catch(() => {});
    throw e;
  }
  return { newRaw: inserted[0], index: cut.index, removed: cut.removed };
}
