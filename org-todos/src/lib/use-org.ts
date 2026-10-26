/*
 * Shared data layer for the Todos view: loading, live reload,
 * undo stack, and remembered settings.
 */

import { LocalStorage, Toast, showToast } from "@vicinae/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getConfig, type Config } from "./config";
import {
  clockOut as clockOutFile,
  expandSources,
  fileExists,
  loadTasksAndTags,
  rescheduleOverdueTasks,
  sourceExistKey,
  updateTask,
  watchTasks,
} from "./files";
import { emacsClockActive, emacsSaveBuffers } from "./emacs";
import { parseYmd, ymd, type Task } from "./org";

const UNDO_DEPTH = 10;

/** Persisted snapshot of the last successful load, for an instant first paint. */
const CACHE_KEY = "orgTodos:cache:v1";
interface CachedData {
  key: string;
  tasks: Task[];
  tags: string[];
  files: string[];
}
/** Cache is invalidated when the configured sources or keywords change. */
const cacheKeyFor = (config: Config) =>
  JSON.stringify({ sources: config.sources, keywords: config.keywords });

export function useOrgData() {
  const config = useMemo(getConfig, []);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([config.file]);
  const [primaryExists, setPrimaryExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [watchEpoch, setWatchEpoch] = useState(0);
  const [undoLabel, setUndoLabel] = useState<string>();

  const existKeyRef = useRef("");
  const cacheRef = useRef<string | undefined>(undefined);
  const undoStack = useRef<{ label: string; revert: () => Promise<void> }[]>([]);

  const reload = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const expanded = await expandSources(config.sources);
        setFiles((prev) => (prev.join("\n") === expanded.join("\n") ? prev : expanded));
        let data = await loadTasksAndTags(expanded, config.keywords);
        // Emacs is the clock authority: `org-clock-out` edits the buffer but
        // does not save it, so a file-visible open clock can be stale.
        if (config.clockViaEmacs && data.tasks.some((t) => t.clockIn)) {
          const active = await emacsClockActive(config.emacsclientCommand).catch(() => true);
          if (!active) {
            const filesWithClock = [
              ...new Set(data.tasks.filter((t) => t.clockIn).map((t) => t.file)),
            ];
            // Persist Emacs's real clock-out first (avoids a save conflict).
            await emacsSaveBuffers(config.emacsclientCommand, filesWithClock).catch(() => {});
            let reread = await loadTasksAndTags(expanded, config.keywords);
            // No Emacs buffer for the file: close the stale clock ourselves.
            const stale = reread.tasks.filter((t) => t.clockIn);
            for (const t of stale) {
              try {
                await clockOutFile(t);
              } catch {
                /* ignore */
              }
            }
            if (stale.length) reread = await loadTasksAndTags(expanded, config.keywords);
            data = reread;
          }
        }
        const payload = JSON.stringify({
          key: cacheKeyFor(config),
          tasks: data.tasks,
          tags: data.tags,
          files: expanded,
        } satisfies CachedData);
        // Skip the state update (and its list re-render) when the disk data is
        // identical to what we already rendered from cache.
        if (payload !== cacheRef.current) {
          cacheRef.current = payload;
          setTasks(data.tasks);
          setTags(data.tags);
          void LocalStorage.setItem(CACHE_KEY, payload).catch(() => {});
        }
        setError(undefined);
        setPrimaryExists(await fileExists(config.file));

        // Re-arm watchers when the set of existing sources changes (e.g. the
        // todos file was just created by Quick Add).
        const key = await sourceExistKey(expanded);
        if (key !== existKeyRef.current) {
          existKeyRef.current = key;
          setWatchEpoch((e) => e + 1);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [config.sources, config.keywords, config.file],
  );

  // Show the cached list immediately, then revalidate from disk in the
  // background (and keep watching for real-time changes below).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await LocalStorage.getItem<string>(CACHE_KEY).catch(() => undefined);
      let hydrated = false;
      if (raw) {
        try {
          const cached = JSON.parse(raw) as CachedData;
          if (cached?.key === cacheKeyFor(config) && Array.isArray(cached.tasks)) {
            if (cancelled) return;
            setTasks(cached.tasks);
            setTags(cached.tags ?? []);
            if (Array.isArray(cached.files) && cached.files.length) setFiles(cached.files);
            cacheRef.current = raw;
            setLoading(false);
            hydrated = true;
          }
        } catch {
          /* ignore a corrupt cache */
        }
      }
      if (!cancelled) await reload(hydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, config]);

  useEffect(() => watchTasks(files, () => reload(true)), [files, watchEpoch, reload]);

  // While a clock is shown, re-check Emacs periodically: an external clock-out
  // may not touch the file at all (Emacs does not save on `org-clock-out`).
  const hasClock = tasks.some((t) => t.clockIn);
  useEffect(() => {
    if (!hasClock || !config.clockViaEmacs) return;
    const id = setInterval(() => reload(true), 5000);
    return () => clearInterval(id);
  }, [hasClock, config.clockViaEmacs, reload]);

  function pushUndo(label: string, revert: () => Promise<void>) {
    const stack = undoStack.current;
    stack.push({ label, revert });
    if (stack.length > UNDO_DEPTH) stack.shift();
    setUndoLabel(label);
  }

  function clearUndo() {
    undoStack.current = [];
    setUndoLabel(undefined);
  }

  async function undoLast() {
    const u = undoStack.current.pop();
    setUndoLabel(undoStack.current[undoStack.current.length - 1]?.label);
    if (!u) return;
    try {
      await u.revert();
      await showToast({ style: Toast.Style.Success, title: "Undone" });
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not undo",
        message: String(e),
      });
    } finally {
      reload(true);
    }
  }

  /**
   * Morning triage: push all overdue scheduled tasks to `target` as one
   * undoable batch. Returns how many tasks moved.
   */
  async function rescheduleOverdue(target: Date): Promise<number> {
    const todayStr = ymd(new Date());
    const overdue = tasks.filter(
      (t) =>
        !config.keywords.done.includes(t.state) &&
        !!t.scheduled &&
        t.scheduled.slice(0, 10) < todayStr,
    );
    if (!overdue.length) {
      await showToast({ style: Toast.Style.Success, title: "Nothing overdue" });
      return 0;
    }
    try {
      const res = await rescheduleOverdueTasks(overdue, target, todayStr);
      if (res.count) {
        pushUndo(`Undo reschedule (${res.count})`, async () => {
          for (const e of res.entries) {
            await updateTask({ ...e.task, raw: e.raw }, {
              scheduled: e.oldDate ? parseYmd(e.oldDate) : null,
            });
          }
        });
      }
      await showToast({
        style: Toast.Style.Success,
        title: `${res.count} task${res.count === 1 ? "" : "s"} rescheduled · ctrl+z to undo`,
        message: res.failures.length ? `${res.failures.length} failed — see toast history` : undefined,
      });
      for (const f of res.failures) {
        await showToast({ style: Toast.Style.Failure, title: "Could not reschedule", message: f });
      }
      await reload(true);
      return res.count;
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Bulk reschedule failed",
        message: String(e),
      });
      return 0;
    }
  }

  return {
    config,
    tasks,
    tags,
    files,
    loading,
    error,
    today: ymd(new Date()),
    multiFile: files.length > 1,
    primaryExists,
    reload,
    undoLabel,
    pushUndo,
    clearUndo,
    undoLast,
    rescheduleOverdue,
  };
}

/** Remembered per-view setting (filter / grouping / details). */
export function useRemembered<T extends string | boolean>(key: string, valid: (v: unknown) => v is T, initial: T): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await LocalStorage.getItem<T>(key);
        if (valid(stored)) setValue(stored);
      } finally {
        setReady(true);
      }
    })();
  }, [key, valid]);

  useEffect(() => {
    if (ready) LocalStorage.setItem(key, value);
  }, [ready, key, value]);

  return [value, setValue, ready];
}
