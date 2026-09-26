import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Icon,
  List,
  Toast,
  showToast,
} from "@vicinae/api";
import { spawn } from "node:child_process";
import path from "node:path";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { DateForm, EditForm } from "./components/edit-form";
import { RefilePicker } from "./components/refile";
import TaskForm from "./components/task-form";
import { LEVEL_COLOR, detailMarkdown, shortDay, stampLabel, taskActionSections, type TaskHandlers } from "./components/task-actions";
import {
  appendTask,
  archiveTask,
  clockIn,
  clockOut,
  createFile,
  deleteTask,
  removeSubtreeByRaw,
  restoreTask,
  setTaskRepeater,
  setTaskState,
  toggleTaskCheckbox,
  updateTask,
} from "./lib/files";
import { buildEditorCommand, deadlineStatus, parseYmd, replaceState, taskKey, ymd, type Task } from "./lib/org";
import { describeParsed, parseQuickAdd } from "./lib/quick-add";
import { priorityLevel, taskMatches, tokenize } from "./lib/search";
import { useOrgData, useRemembered } from "./lib/use-org";

type Filter = "open" | "due" | "done" | "all";
type Grouping = "priority" | "date" | "project" | "flat";

const FILTERS: Filter[] = ["open", "due", "done", "all"];
const FILTER_TITLES: Record<Filter, string> = {
  open: "Open",
  due: "Due / Overdue",
  done: "Done",
  all: "All",
};
const GROUPINGS: Grouping[] = ["priority", "date", "project", "flat"];
const GROUPING_TITLES: Record<Grouping, string> = {
  priority: "Priority",
  date: "Date",
  project: "Project",
  flat: "Flat",
};

const isFilter = (v: unknown): v is Filter =>
  typeof v === "string" && (FILTERS as string[]).includes(v);
const isGrouping = (v: unknown): v is Grouping =>
  typeof v === "string" && (GROUPINGS as string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/* ------------------------------ helpers ---------------------------------- */

function earliestDate(t: Task): string | undefined {
  return [t.deadline, t.scheduled].filter((x): x is string => !!x).sort()[0];
}

const cmpDate = (a: Task, b: Task) => {
  const da = earliestDate(a) ?? "9999";
  const db = earliestDate(b) ?? "9999";
  return da === db ? 0 : da < db ? -1 : 1;
};
const cmpLevel = (a: Task, b: Task) => priorityLevel(a.priority) - priorityLevel(b.priority);
const byDate = (a: Task, b: Task) => cmpDate(a, b) || cmpLevel(a, b) || a.line - b.line;
const byLevel = (a: Task, b: Task) => cmpLevel(a, b) || cmpDate(a, b) || a.line - b.line;

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function dateLabel(stamp: string, today: string): { text: string; color: Color } {
  const day = stamp.slice(0, 10);
  const time = stamp.length > 10 ? ` ${stamp.slice(11)}` : "";
  const t = parseYmd(today);
  if (day === today) return { text: `Today${time}`, color: Color.Green };
  if (day === ymd(addDays(t, 1))) return { text: `Tomorrow${time}`, color: Color.Orange };
  const label = parseYmd(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { text: `${label}${time}`, color: day < today ? Color.Red : Color.SecondaryText };
}

const plural = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

interface Group {
  key: string;
  title: string;
  tasks: Task[];
}

function buildGroups(tasks: Task[], mode: Grouping, today: string): Group[] {
  if (mode === "flat") {
    return [{ key: "all", title: "All", tasks: [...tasks].sort(byDate) }];
  }

  if (mode === "priority") {
    return ([1, 2, 3, 4] as const).map((lvl) => ({
      key: `p${lvl}`,
      title: `Priority ${lvl}`,
      tasks: tasks.filter((t) => priorityLevel(t.priority) === lvl).sort(byDate),
    }));
  }

  if (mode === "date") {
    const t = parseYmd(today);
    const tomorrow = ymd(addDays(t, 1));
    const weekAhead = ymd(addDays(t, 7));
    const bucket = (task: Task) => {
      const d = earliestDate(task)?.slice(0, 10);
      if (!d) return "none";
      if (d < today) return "overdue";
      if (d === today) return "today";
      if (d === tomorrow) return "tomorrow";
      if (d <= weekAhead) return "week";
      return "later";
    };
    const order: [string, string][] = [
      ["overdue", "Overdue"],
      ["today", "Today"],
      ["tomorrow", "Tomorrow"],
      ["week", "Next 7 days"],
      ["later", "Later"],
      ["none", "No date"],
    ];
    return order.map(([key, title]) => ({
      key,
      title,
      tasks: tasks.filter((x) => bucket(x) === key).sort(byDate),
    }));
  }

  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.outline[0] ?? "No project";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(task);
  }
  return [...map.entries()].map(([key, list]) => ({ key, title: key, tasks: list.sort(byLevel) }));
}

/* ------------------------------ component -------------------------------- */

export default function ListTasks() {
  const data = useOrgData();
  const { config, tasks, tags, loading, error, today, multiFile, primaryExists, reload } = data;
  const { undoLabel, pushUndo, clearUndo, undoLast, rescheduleOverdue } = data;
  const keywords = config.keywords;

  const [filter, setFilter, ready] = useRemembered<Filter>("filter", isFilter, "open");
  const [grouping, setGrouping] = useRemembered<Grouping>("grouping", isGrouping, "priority");
  const [showDetail, setShowDetail] = useRemembered<boolean>("showDetail", isBool, false);
  const [searchText, setSearchText] = useState("");

  const fail = (title: string, e: unknown) =>
    showToast({ style: Toast.Style.Failure, title, message: String(e) });

  /* ---- mutations ---- */

  async function changeState(task: Task, state: string) {
    if (state === task.state) return;
    const wasDone = keywords.done.includes(task.state);
    const finishing = keywords.done.includes(state) && !wasDone;
    const repeating = finishing && !!task.repeat;

    try {
      const res = await setTaskState(task, state, keywords);
      if (res.repeated) {
        clearUndo();
        await showToast({
          style: Toast.Style.Success,
          title: "Rescheduled",
          message: `${task.title} → ${stampLabel(res.next ?? "", today)}`,
        });
      } else {
        const updated = { ...task, state: res.state, raw: replaceState(task.raw, res.state) };
        pushUndo(`Undo ${res.state}`, async () => {
          await setTaskState(updated, task.state, keywords);
        });
        await showToast({
          style: Toast.Style.Success,
          title: `${res.state} · ctrl+z to undo`,
          message: task.title,
        });
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
      await showToast({
        style: Toast.Style.Success,
        title: `Priority ${level} · ctrl+z to undo`,
        message: task.title,
      });
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
      pushUndo(
        date ? `Undo ${label.toLowerCase()} change` : `Restore ${label.toLowerCase()}`,
        async () => {
          await updateTask({ ...task, raw }, { [kind]: old ? parseYmd(old) : null });
        },
      );
      await showToast({
        style: Toast.Style.Success,
        title: date ? `${label} set` : `${label} cleared`,
        message: task.title,
      });
    } catch (e) {
      await fail("Could not update task", e);
    } finally {
      reload(true);
    }
  }

  async function toggleTag(task: Task, tag: string) {
    const next = task.tags.includes(tag) ? task.tags.filter((t) => t !== tag) : [...task.tags, tag];
    try {
      const raw = await updateTask(task, { tags: next });
      pushUndo(`Undo tag ${task.tags.includes(tag) ? "removal" : "addition"}`, async () => {
        await updateTask({ ...task, raw }, { tags: task.tags });
      });
      await showToast({ style: Toast.Style.Success, title: `#${tag} ${task.tags.includes(tag) ? "removed" : "added"}`, message: task.title });
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
      await showToast({ style: Toast.Style.Success, title: "Task deleted · ctrl+z to undo", message: task.title });
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
      await showToast({
        style: Toast.Style.Success,
        title: "Archived · ctrl+z to undo",
        message: `${task.title} → ${path.basename(config.archiveFile)}`,
      });
    } catch (e) {
      await fail("Could not archive task", e);
    } finally {
      reload(true);
    }
  }

  async function clockInTask(task: Task) {
    // one open clock at a time, like org
    const open = tasks.find((t) => t.clockIn && taskKey(t) !== taskKey(task));
    if (open) {
      try {
        await clockOut(open);
      } catch {
        /* keep going; the new clock still starts */
      }
    }
    try {
      await clockIn(task);
      await showToast({ style: Toast.Style.Success, title: "Clock in", message: task.title });
    } catch (e) {
      await fail("Could not clock in", e);
    } finally {
      reload(true);
    }
  }

  async function clockOutTask(task: Task) {
    try {
      const res = await clockOut(task);
      await showToast({
        style: Toast.Style.Success,
        title: res ? `Clocked ${Math.floor(res.minutes / 60)}h ${res.minutes % 60}m` : "Nothing to clock out",
        message: task.title,
      });
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

  async function createFromSearch() {
    const text = searchText.trim();
    if (!text) return;
    const p = parseQuickAdd(text);
    try {
      const placed = await appendTask(config.file, {
        title: p.title,
        state: keywords.active[0],
        priority: p.priority,
        tags: p.tags,
        scheduled: p.scheduled,
        deadline: p.deadline,
      });
      pushUndo("Remove created task", async () => {
        await removeSubtreeByRaw(config.file, placed.raw, placed.line);
      });
      setSearchText("");
      await reload(true);
      await showToast({
        style: Toast.Style.Success,
        title: "Task created",
        message: [p.title, describeParsed(p)].filter(Boolean).join(" — "),
      });
    } catch (e) {
      await fail("Could not write todos file", e);
    }
  }

  async function captureClipboard() {
    try {
      const text = await Clipboard.readText();
      if (!text?.trim()) {
        await showToast({ style: Toast.Style.Failure, title: "Clipboard is empty" });
        return;
      }
      const lines = text.trim().split("\n");
      const p = parseQuickAdd(lines[0]);
      await appendTask(config.file, {
        title: p.title,
        state: keywords.active[0],
        priority: p.priority,
        tags: p.tags,
        scheduled: p.scheduled,
        deadline: p.deadline,
        notes: lines.slice(1).join("\n").trim() || undefined,
      });
      await reload(true);
      await showToast({ style: Toast.Style.Success, title: "Captured from clipboard", message: p.title });
    } catch (e) {
      await fail("Could not capture", e);
    }
  }

  function openInEditor(task: Task) {
    const cmd = buildEditorCommand(config.editorCommand, task.file, task.line + 1);
    spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" }).unref();
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

  /* ---- derived data ---- */

  const searchTokens = useMemo(() => tokenize(searchText), [searchText]);
  const isDone = useCallback((t: Task) => keywords.done.includes(t.state), [keywords.done]);
  const overdue = useCallback(
    (t: Task) => {
      const d = earliestDate(t);
      return !isDone(t) && !!d && d.slice(0, 10) < today;
    },
    [isDone, today],
  );
  const matches = useCallback(
    (t: Task) => taskMatches(t, searchTokens, { isDone: isDone(t), overdue: overdue(t) }),
    [searchTokens, isDone, overdue],
  );

  const open = tasks
    .filter((t) => !isDone(t))
    .filter(matches)
    .filter((t) => {
      if (filter !== "due") return true;
      const d = earliestDate(t);
      return !!d && d.slice(0, 10) <= today;
    });
  const done = tasks
    .filter(isDone)
    .filter(matches)
    .sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));

  const showOpen = filter !== "done";
  const showDone = filter === "done" || filter === "all";
  const groups = showOpen ? buildGroups(open, grouping, today).filter((g) => g.tasks.length > 0) : [];

  const parsed = searchText.trim() ? parseQuickAdd(searchText) : undefined;

  function onViewChange(value: string) {
    const [kind, val] = value.split(":") as [string, string];
    if (kind === "f" && isFilter(val)) setFilter(val);
    if (kind === "g" && isGrouping(val)) setGrouping(val);
  }

  /* ---- rendering ---- */

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
    const stamp = finished ? task.closed : earliestDate(task);
    const overdueNow = !finished && !!stamp && stamp.slice(0, 10) < today;
    const boxes = task.checkboxItems;

    const accessories: List.Item.Accessory[] = [];
    if (!showDetail) {
      if (task.state !== keywords.active[0] && !finished) {
        accessories.push({ tag: { value: task.state, color: Color.Purple } });
      }
      for (const tag of task.tags) accessories.push({ tag });
      if (boxes && boxes.length) {
        const d = boxes.filter((b) => b.checked).length;
        accessories.push({ tag: { value: `${d}/${boxes.length}`, color: Color.SecondaryText }, tooltip: "Checkboxes" });
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
        const { text, color } = dateLabel(stamp, today);
        const isDeadline = !!task.deadline && stamp === task.deadline;
        const dlState = isDeadline ? deadlineStatus(task, today) : undefined;
        const tagColor = finished
          ? Color.SecondaryText
          : overdueNow
            ? Color.Red
            : dlState === "warn"
              ? Color.Orange
              : color;
        accessories.push({
          icon: Icon.Calendar,
          tag: { value: text, color: tagColor },
          tooltip: finished
            ? "Closed"
            : isDeadline
              ? `Deadline${task.deadlineWarningDays ? ` · warns ${task.deadlineWarningDays}d ahead` : ""}`
              : "Scheduled",
        });
      }
    }

    return (
      <List.Item
        key={taskKey(task)}
        title={task.title}
        keywords={[...task.tags, ...task.outline, task.state, `p${level}`, `priority ${level}`]}
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
                <Action
                  title={undoLabel}
                  icon={Icon.Undo}
                  shortcut={{ modifiers: ["ctrl"], key: "z" }}
                  onAction={undoLast}
                />
              )}
              <Action
                title={showDetail ? "Hide Details" : "Show Details"}
                icon={Icon.Eye}
                shortcut={{ modifiers: ["ctrl"], key: "d" }}
                onAction={() => setShowDetail(!showDetail)}
              />
              {parsed && (
                <Action
                  title={`Create “${parsed.title}”`}
                  icon={Icon.Plus}
                  shortcut={{ modifiers: ["ctrl"], key: "return" }}
                  onAction={createFromSearch}
                />
              )}
              <Action.Push
                title="New Task"
                icon={Icon.Plus}
                shortcut={{ modifiers: ["ctrl"], key: "n" }}
                target={<TaskForm onCreated={() => reload(true)} initialTitle={searchText} registerUndo={pushUndo} />}
              />
              <Action title="Capture from Clipboard" icon={Icon.Paperclip} onAction={captureClipboard} />
              <ActionPanel.Submenu title="Group By" icon={Icon.Layers}>
                {GROUPINGS.map((g) => (
                  <Action
                    key={g}
                    title={GROUPING_TITLES[g]}
                    icon={g === grouping ? Icon.Checkmark : undefined}
                    onAction={() => setGrouping(g)}
                  />
                ))}
              </ActionPanel.Submenu>
              <Action
                title={`Cycle Grouping (now ${GROUPING_TITLES[grouping]})`}
                icon={Icon.Layers}
                shortcut={{ modifiers: ["ctrl"], key: "g" }}
                onAction={() => setGrouping(GROUPINGS[(GROUPINGS.indexOf(grouping) + 1) % GROUPINGS.length])}
              />
              <Action.CopyToClipboard title="Copy Title" content={task.title} />
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
      isLoading={loading || !ready}
      isShowingDetail={showDetail}
      filtering={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search or quick-add: buy milk tomorrow p1 #home…"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter & group" value={`f:${filter}`} onChange={onViewChange}>
          <List.Dropdown.Section title="Filter">
            {FILTERS.map((f) => (
              <List.Dropdown.Item key={f} title={FILTER_TITLES[f]} value={`f:${f}`} />
            ))}
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Group By">
            {GROUPINGS.map((g) => (
              <List.Dropdown.Item key={g} title={GROUPING_TITLES[g]} value={`g:${g}`} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {error ? (
        <List.EmptyView title="Could not read todos file" description={error} icon={Icon.Exclamationmark} />
      ) : (
        <>
          <List.EmptyView
            title="Nothing found in todos"
            description={
              parsed
                ? `Press Enter to create “${parsed.title}”${describeParsed(parsed) ? ` · ${describeParsed(parsed)}` : ""}`
                : undefined
            }
            icon={parsed ? Icon.Plus : Icon.CheckCircle}
            actions={
              <ActionPanel>
                {parsed ? (
                  <Action title={`Create “${parsed.title}”`} icon={Icon.Plus} onAction={createFromSearch} />
                ) : (
                  <>
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
                  </>
                )}
              </ActionPanel>
            }
          />
          {groups.map((g) => (
            <List.Section key={g.key} title={g.title} subtitle={plural(g.tasks.length)}>
              {g.tasks.map(renderItem)}
            </List.Section>
          ))}
          {showDone && done.length > 0 && (
            <List.Section title="Done" subtitle={plural(done.length)}>
              {done.map(renderItem)}
            </List.Section>
          )}
        </>
      )}
    </List>
  );
}
