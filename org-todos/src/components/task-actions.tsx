/*
 * Action sections and detail markdown shared by the Todos list and the
 * Agenda view, so both surfaces behave identically.
 */

import { Action, ActionPanel, Color, Icon } from "@vicinae/api";
import type { ReactNode } from "react";
import { parseYmd, ymd, deadlineStatus, type Keywords, type Task } from "../lib/org";
import { priorityLevel } from "../lib/search";

export interface TaskHandlers {
  keywords: Keywords;
  today: string;
  multiFile: boolean;
  tagVocabulary: string[];
  changeState(t: Task, s: string): void;
  changePriority(t: Task, l: 1 | 2 | 3 | 4): void;
  changeDate(t: Task, kind: "scheduled" | "deadline", d: Date | null): void;
  editTarget(t: Task): ReactNode;
  refileTarget(t: Task): ReactNode;
  dateTarget(t: Task, kind: "scheduled" | "deadline"): ReactNode;
  openInEditor(t: Task): void;
  archive(t: Task): void;
  remove(t: Task): void;
  toggleTag(t: Task, tag: string): void;
  clockIn(t: Task): void;
  clockOut(t: Task): void;
  toggleCheckbox(t: Task, index: number): void;
}

export const LEVEL_COLOR: Record<number, Color> = {
  1: Color.Red,
  2: Color.Orange,
  3: Color.Blue,
  4: Color.SecondaryText,
};

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const shortDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function dateSubmenu(task: Task, kind: "scheduled" | "deadline", h: TaskHandlers): ReactNode {
  const t = new Date();
  const label = kind === "scheduled" ? "Schedule" : "Deadline";
  return (
    <ActionPanel.Submenu
      title={label}
      icon={kind === "scheduled" ? Icon.Calendar : Icon.Clock}
      shortcut={
        kind === "scheduled"
          ? { modifiers: ["ctrl"], key: "s" }
          : { modifiers: ["ctrl", "shift"], key: "d" }
      }
    >
      <Action title={`Today (${shortDay(t)})`} icon={Icon.Calendar} onAction={() => h.changeDate(task, kind, t)} />
      <Action
        title={`Tomorrow (${shortDay(addDays(t, 1))})`}
        icon={Icon.Calendar}
        onAction={() => h.changeDate(task, kind, addDays(t, 1))}
      />
      <Action
        title={`Next Monday (${shortDay(addDays(t, ((8 - t.getDay()) % 7) || 7))})`}
        icon={Icon.Calendar}
        onAction={() => h.changeDate(task, kind, addDays(t, ((8 - t.getDay()) % 7) || 7))}
      />
      <Action.Push title="Pick Date…" icon={Icon.Pencil} target={h.dateTarget(task, kind)} />
      {task[kind] && (
        <Action title="Clear" icon={Icon.XMarkCircle} onAction={() => h.changeDate(task, kind, null)} />
      )}
    </ActionPanel.Submenu>
  );
}

export function taskActionSections(task: Task, h: TaskHandlers): ReactNode {
  const finished = h.keywords.done.includes(task.state);
  const primary = finished ? h.keywords.active[0] : h.keywords.done[0];
  const vocab = [...new Set([...h.tagVocabulary, ...task.tags])].sort((a, b) => a.localeCompare(b));
  const boxes = task.checkboxItems ?? [];
  const boxesDone = boxes.filter((b) => b.checked).length;

  return (
    <>
      <ActionPanel.Section>
        <Action
          title={finished ? `Reopen (${h.keywords.active[0]})` : `Mark ${h.keywords.done[0]}`}
          icon={finished ? Icon.Circle : Icon.CheckCircle}
          onAction={() => h.changeState(task, primary)}
        />
        {/* Every configured state, one action each — right there in the
            action panel (ctrl+b), no submenu digging. */}
        {h.keywords.all
          .filter((k) => k !== primary)
          .map((k) => (
            <Action
              key={k}
              title={k === task.state ? `${k} (current)` : k}
              icon={
                k === task.state
                  ? Icon.Checkmark
                  : h.keywords.done.includes(k)
                    ? Icon.CheckCircle
                    : Icon.Circle
              }
              onAction={() => h.changeState(task, k)}
            />
          ))}
        <Action.Push
          title="Edit Task"
          icon={Icon.Pencil}
          shortcut={{ modifiers: ["ctrl"], key: "e" }}
          target={h.editTarget(task)}
        />
        <Action
          title="Open in Editor"
          icon={Icon.BlankDocument}
          shortcut={{ modifiers: ["ctrl"], key: "o" }}
          onAction={() => h.openInEditor(task)}
        />
      </ActionPanel.Section>

      <ActionPanel.Section title="Change">
        {([1, 2, 3, 4] as const).map((lvl) => (
          <Action
            key={lvl}
            title={`Priority ${lvl}${lvl === 4 ? " (none)" : ""}`}
            icon={{ source: Icon.Flag, tintColor: LEVEL_COLOR[lvl] }}
            shortcut={{ modifiers: ["ctrl"], key: String(lvl) as "1" | "2" | "3" | "4" }}
            onAction={() => h.changePriority(task, lvl)}
          />
        ))}
        {dateSubmenu(task, "scheduled", h)}
        {dateSubmenu(task, "deadline", h)}
        <ActionPanel.Submenu title="Tags" icon={Icon.Tag}>
          {vocab.map((tag) => (
            <Action
              key={tag}
              title={task.tags.includes(tag) ? `Remove #${tag}` : `Add #${tag}`}
              icon={task.tags.includes(tag) ? Icon.Checkmark : Icon.Tag}
              onAction={() => h.toggleTag(task, tag)}
            />
          ))}
        </ActionPanel.Submenu>
        {boxes.length > 0 && (
          <ActionPanel.Submenu title={`Checkboxes (${boxesDone}/${boxes.length})`} icon={Icon.Checkmark}>
            {boxes.map((cb, i) => (
              <Action
                key={i}
                title={`${cb.checked ? "[x]" : "[ ]"} ${cb.text}`}
                icon={cb.checked ? Icon.Checkmark : Icon.Circle}
                onAction={() => h.toggleCheckbox(task, i)}
              />
            ))}
          </ActionPanel.Submenu>
        )}
      </ActionPanel.Section>

      <ActionPanel.Section title="Task">
        <Action.Push title="Refile…" icon={Icon.Folder} target={h.refileTarget(task)} />
        {task.clockIn ? (
          <Action title="Clock Out" icon={Icon.Clock} onAction={() => h.clockOut(task)} />
        ) : (
          <Action title="Clock In" icon={Icon.Clock} onAction={() => h.clockIn(task)} />
        )}
        {task.orgId && (
          <Action.CopyToClipboard
            title="Copy Org Link"
            content={`[[id:${task.orgId}][${task.title}]]`}
            icon={Icon.Link}
          />
        )}
        <Action
          title="Archive Task"
          icon={Icon.Folder}
          shortcut={{ modifiers: ["ctrl", "shift"], key: "a" }}
          onAction={() => h.archive(task)}
        />
        <Action
          title="Delete Task"
          icon={Icon.Trash}
          style="destructive"
          shortcut={{ modifiers: ["ctrl"], key: "x" }}
          onAction={() => h.remove(task)}
        />
      </ActionPanel.Section>
    </>
  );
}

const fmtDay = (s: string) =>
  parseYmd(s).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(parseYmd(s).getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
  });

const relDate = (s: string, today: string) =>
  `${s.slice(0, 10) === today ? "Today · " : ""}${fmtDay(s)}${s.length > 10 ? ` ${s.slice(11)}` : ""}`;

const fmtClock = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

export function detailMarkdown(
  task: Task,
  keywords: Keywords,
  today: string,
  multiFile: boolean,
  basename: (f: string) => string,
): string {
  const level = priorityLevel(task.priority);
  const finished = keywords.done.includes(task.state);

  const lines: string[] = [`# ${task.title}`, ""];
  lines.push(
    `**${task.state}** · Priority ${level}${task.repeat ? ` · repeats ${task.repeat}` : ""}`,
  );
  if (task.cookie) {
    lines.push(
      `Progress: ${task.cookie.percent ? `${task.cookie.done}%` : `${task.cookie.done}/${task.cookie.total}`}`,
    );
  }
  if (task.outline.length) lines.push(task.outline.join(" › "));
  if (task.tags.length) lines.push(`Tags: ${task.tags.map((t) => `\`${t}\``).join(" ")}`);
  if (task.scheduled) lines.push(`Scheduled: ${relDate(task.scheduled, today)}`);
  if (task.deadline) {
    const state = deadlineStatus(task, today);
    const note =
      state === "overdue"
        ? " (overdue)"
        : state === "warn"
          ? ` (due soon · warns ${task.deadlineWarningDays}d ahead)`
          : state === "today"
            ? " (due today)"
            : "";
    lines.push(`Deadline: ${relDate(task.deadline, today)}${note}`);
  }
  if (task.closed) lines.push(`Closed: ${relDate(task.closed, today)}`);
  if (task.clockIn) lines.push(`Clock: running since ${task.clockIn}`);
  if (task.clockedMinutes !== undefined) lines.push(`Clocked total: ${fmtClock(task.clockedMinutes)}`);
  if (multiFile) lines.push(`File: \`${basename(task.file)}\``);
  if (task.body) lines.push("---", "", task.body);
  return lines.join("\n");
}

/** A short human label for a stamp, e.g. "Today 09:00" or "Sep 30". */
export function stampLabel(stamp: string, today: string): string {
  const time = stamp.length > 10 ? ` ${stamp.slice(11)}` : "";
  const day = stamp.slice(0, 10);
  if (day === today) return `Today${time}`;
  if (day === ymd(addDays(parseYmd(today), 1))) return `Tomorrow${time}`;
  return `${fmtDay(day)}${time}`;
}
