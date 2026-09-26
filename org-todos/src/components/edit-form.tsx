import { Action, ActionPanel, Form, Icon, Toast, showToast, useNavigation } from "@vicinae/api";
import { useMemo, useState } from "react";
import { dateFromText, DateField, datePresetList } from "./date-field";
import { getConfig } from "../lib/config";
import { setTaskRepeater, setTaskState, updateTask } from "../lib/files";
import { parseYmd, replaceState, type Task, type TaskPatch } from "../lib/org";

interface EditProps {
  task: Task;
  onSaved: () => void;
  /** Registers an undo entry with the calling view. */
  registerUndo?: (label: string, revert: () => Promise<void>) => void;
}

const REPEATER_RE = /^(\+\+|\.\+|\+)\d+[hdwmy](\/\d+[hdwmy])?$/;

const dayOf = (s?: string) => (s ? s.slice(0, 10) : undefined);
const sameDay = (d: Date | null, s?: string) =>
  (d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : undefined) === dayOf(s);

export function EditForm({ task, onSaved, registerUndo }: EditProps) {
  const { pop } = useNavigation();
  const { keywords } = useMemo(getConfig, []);

  const [title, setTitle] = useState(task.title);
  const [state, setState] = useState(task.state);
  const [priority, setPriority] = useState(task.priority ?? "none");
  const [tags, setTags] = useState(task.tags.join(", "));
  const [schedText, setSchedText] = useState(task.scheduled ? task.scheduled.slice(0, 10) : "");
  const [deadText, setDeadText] = useState(task.deadline ? task.deadline.slice(0, 10) : "");
  const [repeat, setRepeat] = useState(task.repeat ?? "");
  const [body, setBody] = useState(task.body);

  async function submit() {
    const newTitle = title.trim();
    if (!newTitle) {
      await showToast({ style: Toast.Style.Failure, title: "A title is required" });
      return;
    }
    const sched = dateFromText(schedText);
    const dead = dateFromText(deadText);
    if (sched === undefined || dead === undefined) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Date not understood",
        message: "Try: today, tomorrow, fri, 9/30, 2026-09-30",
      });
      return;
    }
    const repeatText = repeat.trim();
    if (repeatText && !REPEATER_RE.test(repeatText)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Repeater not understood",
        message: "Try: +1d, +1w, ++1w, .+1m",
      });
      return;
    }

    try {
      let current = task;

      if (state !== task.state) {
        const res = await setTaskState(task, state, keywords);
        current = { ...task, state: res.state, raw: replaceState(task.raw, res.state) };
      }

      const patch: TaskPatch = {};
      if (newTitle !== task.title) patch.title = newTitle;
      const newPriority = priority === "none" ? undefined : priority;
      if (newPriority !== task.priority) patch.priority = newPriority ?? null;
      const newTags = tags.split(/[,\s]+/).filter(Boolean);
      if (newTags.join(":") !== task.tags.join(":")) patch.tags = newTags;
      if (!sameDay(sched, task.scheduled)) patch.scheduled = sched;
      if (!sameDay(dead, task.deadline)) patch.deadline = dead;
      if (body.trim() !== task.body) patch.body = body;

      const postRaw = Object.keys(patch).length ? await updateTask(current, patch) : current.raw;
      const updated = { ...current, raw: postRaw };

      // Repeater: edited where it lives; a new repeater lands on SCHEDULED.
      const repeatChanged = repeatText !== (task.repeat ?? "");
      let repeatTarget: "scheduled" | "deadline" =
        task.repeatOn ?? (task.scheduled ? "scheduled" : task.deadline ? "deadline" : "scheduled");
      let scheduledAutoCreated = false;
      if (repeatChanged && repeatText && repeatTarget === "scheduled" && !task.scheduled && sched === null) {
        await updateTask(updated, { scheduled: new Date() });
        scheduledAutoCreated = true;
      }
      if (repeatChanged) {
        await setTaskRepeater(updated, repeatTarget, repeatText || null);
      }

      registerUndo?.("Undo edit", async () => {
        let t = updated;
        if (state !== task.state) {
          await setTaskState(t, task.state, keywords);
          t = { ...t, state: task.state, raw: replaceState(t.raw, task.state) };
        }
        const revert: TaskPatch = {};
        if (patch.title !== undefined) revert.title = task.title;
        if (patch.priority !== undefined) revert.priority = task.priority ?? null;
        if (patch.tags !== undefined) revert.tags = task.tags;
        if (patch.scheduled !== undefined) revert.scheduled = task.scheduled ? parseYmd(task.scheduled) : null;
        if (patch.deadline !== undefined) revert.deadline = task.deadline ? parseYmd(task.deadline) : null;
        if (patch.body !== undefined) revert.body = task.body;
        if (Object.keys(revert).length) await updateTask(t, revert);
        if (repeatChanged) {
          await setTaskRepeater(t, repeatTarget, task.repeat ?? null);
          if (scheduledAutoCreated) await updateTask(t, { scheduled: null });
        }
      });

      await showToast({ style: Toast.Style.Success, title: "Task updated", message: newTitle });
      onSaved();
      pop();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Could not update task", message: String(e) });
    }
  }

  return (
    <Form
      navigationTitle="Edit Task"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" onSubmit={submit} />
          <Action title="Repeat daily (+1d)" icon={Icon.Repeat} onAction={() => setRepeat("+1d")} />
          <Action title="Repeat weekly (+1w)" icon={Icon.Repeat} onAction={() => setRepeat("+1w")} />
          <Action title="Repeat monthly (+1m)" icon={Icon.Repeat} onAction={() => setRepeat("+1m")} />
          <Action title="No repeat" icon={Icon.XMarkCircle} onAction={() => setRepeat("")} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" value={title} onChange={setTitle} autoFocus />
      <Form.Dropdown id="state" title="State" value={state} onChange={setState}>
        {keywords.all.map((k) => (
          <Form.Dropdown.Item key={k} value={k} title={k} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="priority" title="Priority" value={priority} onChange={setPriority}>
        <Form.Dropdown.Item value="none" title="None" />
        <Form.Dropdown.Item value="A" title="A (high)" />
        <Form.Dropdown.Item value="B" title="B" />
        <Form.Dropdown.Item value="C" title="C (low)" />
      </Form.Dropdown>
      <Form.TextField id="tags" title="Tags" value={tags} onChange={setTags} placeholder="work, uni, emacs" />
      <Form.Separator />
      <DateField id="scheduled" title="Scheduled" value={schedText} onChange={setSchedText} existing={task.scheduled} />
      <DateField id="deadline" title="Deadline" value={deadText} onChange={setDeadText} existing={task.deadline} />
      <Form.TextField
        id="repeat"
        title="Repeat"
        value={repeat}
        onChange={setRepeat}
        placeholder="+1w, ++1w, .+1d"
      />
      <Form.Separator />
      <Form.TextArea id="body" title="Notes" value={body} onChange={setBody} placeholder="Optional body text" />
    </Form>
  );
}

interface DateProps {
  task: Task;
  kind: "scheduled" | "deadline";
  onSaved: () => void;
  registerUndo?: (label: string, revert: () => Promise<void>) => void;
}

export function DateForm({ task, kind, onSaved, registerUndo }: DateProps) {
  const { pop } = useNavigation();
  const label = kind === "scheduled" ? "Scheduled" : "Deadline";
  const existing = task[kind];
  const [text, setText] = useState("");

  async function apply(date: Date | null) {
    const old = task[kind];
    try {
      const raw = await updateTask(task, { [kind]: date });
      registerUndo?.(
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
      onSaved();
      pop();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Could not update task", message: String(e) });
    }
  }

  async function submit() {
    const d = dateFromText(text);
    if (d === undefined) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Date not understood",
        message: "Try: today, tomorrow, fri, 9/30, 2026-09-30",
      });
      return;
    }
    await apply(d);
  }

  return (
    <Form
      navigationTitle={`${label} Date`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={`Set ${label}`} onSubmit={submit} />
          {datePresetList().map((p) => (
            <Action key={p.title} title={p.title} icon={Icon.Calendar} onAction={() => apply(p.date)} />
          ))}
          {existing && (
            <Action
              title={`Clear ${label}`}
              icon={Icon.Trash}
              style="destructive"
              onAction={() => apply(null)}
            />
          )}
        </ActionPanel>
      }
    >
      <DateField id="date" title={label} value={text} onChange={setText} existing={existing} />
    </Form>
  );
}
