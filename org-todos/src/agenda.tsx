/*
 * Agenda: a day-by-day view across all files — Overdue, Today, Tomorrow,
 * the next seven days, Later, and everything unscheduled. Done-today tasks
 * trail the Today section for review.
 */

import { Action, ActionPanel, Color, Icon, List, Toast, showToast } from "@vicinae/api";
import { spawn } from "node:child_process";
import path from "node:path";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { DateForm, EditForm } from "./components/edit-form";
import { RefilePicker } from "./components/refile";
import TaskForm from "./components/task-form";
import { LEVEL_COLOR, detailMarkdown, taskActionSections, type TaskHandlers } from "./components/task-actions";
import { archiveTask, clockIn, clockOut, createFile, deleteTask, removeSubtreeByRaw, restoreTask, setTaskState, setTaskRepeater, toggleTaskCheckbox, updateTask } from "./lib/files";
import { buildEditorCommand, deadlineStatus, daysUntil, parseYmd, replaceState, taskKey, ymd, type Task } from "./lib/org";
import { priorityLevel, taskMatches, tokenize } from "./lib/search";
import { useOrgData } from "./lib/use-org";
import { shortDay } from "./components/task-actions";

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const dayTitle = (d: Date, today: string) => {
  const label = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== parseYmd(today).getFullYear() ? { year: "numeric" as const } : {}),
  });
  return ymd(d) === today ? `Today · ${label}` : label;
};

interface Bucket {
  key: string;
  title: string;
  tasks: Task[];
}

function buildBuckets(
  open: Task[],
  doneToday: Task[],
  today: string,
): Bucket[] {
  const t = parseYmd(today);
  const byEarliest = (a: Task, b: Task) => {
    const da = earliest(a) ?? "9999";
    const db = earliest(b) ?? "9999";
    return da === db ? 0 : da < db ? -1 : 1;
  };

  const buckets: Bucket[] = [];
  const overdue = open.filter((x) => (earliest(x) ?? "9999") < today).sort(byEarliest);
  if (overdue.length) buckets.push({ key: "overdue", title: "Overdue", tasks: overdue });

  const todayTasks = open
    .filter((x) => earliest(x)?.slice(0, 10) === today)
    .sort(byEarliest);
  if (todayTasks.length || doneToday.length) {
    buckets.push({ key: "today", title: dayTitle(t, today), tasks: [...todayTasks, ...doneToday] });
  }

  const tomorrow = addDays(t, 1);
  const tomorrowTasks = open
    .filter((x) => earliest(x)?.slice(0, 10) === ymd(tomorrow))
    .sort(byEarliest);
  if (tomorrowTasks.length) {
    buckets.push({ key: "tomorrow", title: dayTitle(tomorrow, today), tasks: tomorrowTasks });
  }

  for (let i = 2; i <= 7; i++) {
    const day = addDays(t, i);
    const key = ymd(day);
    const dayTasks = open.filter((x) => earliest(x)?.slice(0, 10) === key).sort(byEarliest);
    if (dayTasks.length) buckets.push({ key, title: dayTitle(day, today), tasks: dayTasks });
  }

  const weekEnd = ymd(addDays(t, 7));
  const later = open
    .filter((x) => {
      const d = earliest(x)?.slice(0, 10);
      return d && d > weekEnd;
    })
    .sort(byEarliest);
  if (later.length) buckets.push({ key: "later", title: "Later", tasks: later });

  const unscheduled = open.filter((x) => !earliest(x)).sort((a, b) => priorityLevel(a.priority) - priorityLevel(b.priority) || a.line - b.line);
  if (unscheduled.length) buckets.push({ key: "none", title: "Unscheduled", tasks: unscheduled });

  return buckets;
}

function earliest(t: Task): string | undefined {
  return [t.deadline, t.scheduled].filter((x): x is string => !!x).sort()[0];
}

const plural = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

export default function Agenda() {
  const data = useOrgData();
  const { config, tasks, tags, loading, error, today, multiFile, primaryExists, reload, undoLabel, pushUndo, undoLast, rescheduleOverdue } = data;
  const keywords = config.keywords;
  const [searchText, setSearchText] = useState("");

  async function fail(title: string, e: unknown) {
    await showToast({ style: Toast.Style.Failure, title, message: String(e) });
  }

  async function changeState(task: Task, state: string) {
    if (state === task.state) return;
    try {
      const res = await setTaskState(task, state, keywords);
      if (res.repeated) {
        await showToast2("Rescheduled", `${task.title} → ${res.next ?? ""}`);
      } else {
        const updated = { ...task, state: res.state, raw: replaceState(task.raw, res.state) };
        pushUndo(`Undo ${res.state}`, async () => {
          await setTaskState(updated, task.state, keywords);
        });
        await showToast2(`${res.state} · ctrl+z to undo`, task.title);
      }
    } catch (e) {
      await fail("Could not update task", e);
    } finally {
      reload(true);
    }
  }

  async function changePriority(task: Task, level: 1 | 2 | 3 | 4) {
    const next = level === 1 ? "A" : level === 2 ? "B" : level === 3 ? "C" : undefined;
    if (next === task.priority) return;
    try {
      const raw = await updateTask(task, { priority: next ?? null });
      const updated = { ...task, raw, priority: next };
      pushUndo("Undo priority change", async () => {
        await updateTask(updated, { priority: task.priority ?? null });
      });
      await showToast2(`Priority ${level} · ctrl+z to undo`, task.title);
    } catch (e) {
      await fail("Could not update task", e);
    } finally {
      reload(true);
    }
  }

  async function changeDate(task: Task, kind: "scheduled" | "deadline", date: Date | null) {
    const label = kind === "scheduled" ? "Scheduled" : "Deadline";
    const old = task[kind];
    try {
      const raw = await updateTask(task, { [kind]: date });
      pushUndo(date ? `Undo ${label.toLowerCase()} change` : `Restore ${label.toLowerCase()}`, async () => {
        await updateTask({ ...task, raw }, { [kind]: old ? parseYmd(old) : null });
      });
      await showToast2(date ? `${label} set` : `${label} cleared`, task.title);
    } catch (e) {
      await fail("Could not update task", e);
    } finally {
      reload(true);
    }
  }

  async function toggleTag(task: Task, tag: string) {
    const next = task.tags.includes(tag) ? task.tags.filter((x) => x !== tag) : [...task.tags, tag];
    try {
      const raw = await updateTask(task, { tags: next });
      pushUndo("Undo tag change", async () => {
        await updateTask({ ...task, raw }, { tags: task.tags });
      });
    } catch (e) {
      await fail("Could not update task", e);
    } finally {
      reload(true);
    }
  }

  async function removeTask(task: Task) {
    try {
      const { index, removed } = await deleteTask(task);
      pushUndo("Restore task", () => restoreTask(task.file, index, removed));
      await showToast2("Task deleted · ctrl+z to undo", task.title);
    } catch (e) {
      await fail("Could not delete task", e);
    } finally {
      reload(true);
    }
  }

  async function archive(task: Task) {
    try {
      const { index, removed } = await archiveTask(task, config.archiveFile);
      pushUndo("Unarchive", async () => {
        await restoreTask(task.file, index, removed);
        await removeSubtreeByRaw(config.archiveFile, removed[0]);
      });
      await showToast2("Archived · ctrl+z to undo", task.title);
    } catch (e) {
      await fail("Could not archive task", e);
    } finally {
      reload(true);
    }
  }

  async function clockInTask(task: Task) {
    const open = tasks.find((t) => t.clockIn && taskKey(t) !== taskKey(task));
    if (open) {
      try {
        await clockOut(open);
      } catch {
        /* keep going */
      }
    }
    try {
      await clockIn(task);
      await showToast2("Clock in", task.title);
    } catch (e) {
      await fail("Could not clock in", e);
    } finally {
      reload(true);
    }
  }

  async function clockOutTask(task: Task) {
    try {
      const res = await clockOut(task);
      await showToast2(res ? `Clocked ${Math.floor(res.minutes / 60)}h ${res.minutes % 60}m` : "Nothing to clock out", task.title);
    } catch (e) {
      await fail("Could not clock out", e);
    } finally {
      reload(true);
    }
  }

  async function toggleCheckbox(task: Task, index: number) {
    try {
      await toggleTaskCheckbox(task, index);
    } catch (e) {
      await fail("Could not toggle checkbox", e);
    } finally {
      reload(true);
    }
  }

  // NOTE: self-contained predicate — this runs during render, before the
  // derived section (where isDone lives) is initialized. Don't use isDone here.
  const overdueScheduledCount = tasks.filter(
    (t) => !keywords.done.includes(t.state) && t.scheduled && t.scheduled.slice(0, 10) < today,
  ).length;

  function bulkRescheduleSection(): ReactNode {
    if (overdueScheduledCount === 0) return null;
    const t = new Date();
    const monday = addDays(t, ((8 - t.getDay()) % 7) || 7);
    return (
      <ActionPanel.Submenu
        title={`Reschedule overdue (${overdueScheduledCount})`}
        icon={Icon.ArrowRight}
        shortcut={{ modifiers: ["ctrl", "shift"], key: "t" }}
      >
        <Action
          title={`To Today (${shortDay(t)})`}
          icon={Icon.Calendar}
          onAction={() => rescheduleOverdue(t)}
        />
        <Action
          title={`To Tomorrow (${shortDay(addDays(t, 1))})`}
          icon={Icon.Calendar}
          onAction={() => rescheduleOverdue(addDays(t, 1))}
        />
        <Action
          title={`To Next Monday (${shortDay(monday)})`}
          icon={Icon.Calendar}
          onAction={() => rescheduleOverdue(monday)}
        />
      </ActionPanel.Submenu>
    );
  }

  function openInEditor(task: Task) {
    const cmd = buildEditorCommand(config.editorCommand, task.file, task.line + 1);
    spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" }).unref();
  }

  async function showToast2(title: string, message?: string) {
    await showToast({ style: Toast.Style.Success, title, message });
  }

  /* ---- derived ---- */

  const searchTokens = useMemo(() => tokenize(searchText), [searchText]);
  const isDone = useCallback((t: Task) => keywords.done.includes(t.state), [keywords.done]);
  const matches = useCallback(
    (t: Task) => {
      const d = earliest(t);
      const isOverdue = !isDone(t) && !!d && d.slice(0, 10) < today;
      return taskMatches(t, searchTokens, { isDone: isDone(t), overdue: isOverdue });
    },
    [searchTokens, isDone, today],
  );

  const open = tasks.filter((t) => !isDone(t)).filter(matches);
  const doneToday = tasks
    .filter(isDone)
    .filter(matches)
    .filter((t) => (t.closed ?? "").slice(0, 10) === today);

  const buckets = buildBuckets(open, doneToday, today);
  const total = open.length + doneToday.length;

  const handlers: TaskHandlers = {
    keywords,
    today,
    multiFile,
    tagVocabulary: tags,
    changeState,
    changePriority,
    changeDate,
    editTarget: (t) => <EditForm task={t} onSaved={() => reload(true)} registerUndo={pushUndo} />,
    refileTarget: (t) => <RefilePicker task={t} onDone={() => reload(true)} registerUndo={pushUndo} />,
    dateTarget: (t, kind) => (
      <DateForm task={t} kind={kind} onSaved={() => reload(true)} registerUndo={pushUndo} />
    ),
    openInEditor,
    archive,
    remove: removeTask,
    toggleTag,
    clockIn: clockInTask,
    clockOut: clockOutTask,
    toggleCheckbox,
  };

  function renderItem(task: Task) {
    const finished = isDone(task);
    const level = priorityLevel(task.priority);
    const stamp = finished ? task.closed : earliest(task);
    const isDeadline = !!stamp && stamp === task.deadline && (!task.scheduled || task.deadline <= task.scheduled);

    const accessories: List.Item.Accessory[] = [];
    if (task.state !== keywords.active[0] && !finished) {
      accessories.push({ tag: { value: task.state, color: Color.Purple } });
    }
    for (const tag of task.tags) accessories.push({ tag });
    const dlState = deadlineStatus(task, today);
    if (dlState === "warn") {
      accessories.push({
        tag: { value: `due in ${daysUntil(task.deadline!, today)}d`, color: Color.Orange },
        tooltip: `Deadline ${task.deadline} · warning period ${task.deadlineWarningDays}d`,
      });
    } else if (dlState === "overdue") {
      accessories.push({
        tag: { value: "deadline overdue", color: Color.Red },
        tooltip: `Deadline was ${task.deadline}`,
      });
    }
    if (task.repeat) accessories.push({ icon: Icon.Repeat, tooltip: `Repeats ${task.repeat}` });
    if (task.clockIn) accessories.push({ icon: Icon.Clock, tooltip: `Clocked in at ${task.clockIn}` });
    if (multiFile) {
      accessories.push({
        icon: Icon.BlankDocument,
        tag: { value: path.basename(task.file, ".org"), color: Color.SecondaryText },
        tooltip: task.file,
      });
    }
    if (stamp) {
      const time = stamp.length > 10 ? stamp.slice(11) : "";
      if (time) {
        accessories.push({
          icon: isDeadline ? Icon.Clock : Icon.Calendar,
          tag: { value: time, color: Color.SecondaryText },
          tooltip: isDeadline ? "Deadline time" : "Scheduled time",
        });
      } else if (isDeadline) {
        accessories.push({ icon: Icon.Clock, tooltip: "Deadline" });
      }
    }

    return (
      <List.Item
        key={taskKey(task)}
        title={task.title}
        keywords={[...task.tags, ...task.outline, task.state]}
        icon={
          finished
            ? { source: Icon.CheckCircle, tintColor: Color.Green }
            : { source: Icon.Circle, tintColor: LEVEL_COLOR[level] }
        }
        accessories={accessories}
        detail={<List.Item.Detail markdown={detailMarkdown(task, keywords, today, multiFile, (f) => path.basename(f))} />}
        actions={
          <ActionPanel>
            {taskActionSections(task, handlers)}
            <ActionPanel.Section title="View">
              {bulkRescheduleSection()}
              {undoLabel && (
                <Action title={undoLabel} icon={Icon.Undo} shortcut={{ modifiers: ["ctrl"], key: "z" }} onAction={undoLast} />
              )}
              <Action.Push
                title="New Task"
                icon={Icon.Plus}
                shortcut={{ modifiers: ["ctrl"], key: "n" }}
                target={<TaskForm onCreated={() => reload(true)} registerUndo={pushUndo} />}
              />
              <Action
                title="Reload"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["ctrl"], key: "r" }}
                onAction={() => reload()}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={loading}
      isShowingDetail
      filtering={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Filter the agenda…"
      navigationTitle={`Agenda${total ? ` · ${plural(total)}` : ""}`}
    >
      {error ? (
        <List.EmptyView title="Could not read todos files" description={error} icon={Icon.Exclamationmark} />
      ) : buckets.length === 0 ? (
        <List.EmptyView
          title="Nothing on the agenda"
          icon={Icon.CheckCircle}
          actions={
            <ActionPanel>
              {!primaryExists && (
                <Action
                  title={`Create ${config.file}`}
                  icon={Icon.Plus}
                  onAction={async () => {
                    try {
                      await createFile(config.file);
                      await reload(true);
                    } catch (e) {
                      await fail("Could not create file", e);
                    }
                  }}
                />
              )}
              <Action.Push
                title="New Task"
                icon={Icon.Plus}
                target={<TaskForm onCreated={() => reload(true)} registerUndo={pushUndo} />}
              />
            </ActionPanel>
          }
        />
      ) : (
        buckets.map((b) => (
          <List.Section key={b.key} title={b.title} subtitle={plural(b.tasks.length)}>
            {b.tasks.map(renderItem)}
          </List.Section>
        ))
      )}
    </List>
  );
}

