import { Action, ActionPanel, Form, Toast, popToRoot, showToast, useNavigation } from "@vicinae/api";
import path from "node:path";
import { useEffect, useMemo, useState } from "react";
import { dateFromText, DateField } from "./date-field";
import { getConfig } from "../lib/config";
import { appendTask, expandSources, removeSubtreeByRaw } from "../lib/files";
import { describeParsed, parseQuickAdd } from "../lib/quick-add";

interface Props {
  /** Called after a task was created (used by the list to reload). */
  onCreated?: () => void;
  /** True when rendered as its own command, so we close instead of popping. */
  standalone?: boolean;
  /** Text to start the title with (quick-add syntax works here too). */
  initialTitle?: string;
  /** Registers an undo entry with the list view. */
  registerUndo?: (label: string, revert: () => Promise<void>) => void;
}

export default function TaskForm({ onCreated, standalone, initialTitle, registerUndo }: Props) {
  const { pop } = useNavigation();
  const config = useMemo(getConfig, []);
  const { keywords } = config;

  const [title, setTitle] = useState(initialTitle ?? "");
  const [state, setState] = useState(keywords.active[0]);
  const [priority, setPriority] = useState("none");
  const [tags, setTags] = useState("");
  const [schedText, setSchedText] = useState("");
  const [deadText, setDeadText] = useState("");
  const [notes, setNotes] = useState("");
  const [targets, setTargets] = useState<string[]>([config.file]);
  const [target, setTarget] = useState(config.file);

  useEffect(() => {
    expandSources(config.sources)
      .then((files) => setTargets(files.includes(config.file) ? files : [config.file, ...files]))
      .catch(() => {});
  }, [config.sources, config.file]);

  const parsed = useMemo(() => parseQuickAdd(title), [title]);
  const hint = describeParsed(parsed);

  function reset() {
    setTitle("");
    setState(keywords.active[0]);
    setPriority("none");
    setTags("");
    setSchedText("");
    setDeadText("");
    setNotes("");
  }

  /** Explicit form fields win; anything left unset is filled from the title's quick-add syntax. */
  async function create(addAnother: boolean) {
    if (!title.trim()) {
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

    const formTags = tags.split(/[,\s]+/).filter(Boolean);
    const finalTags = [...new Set([...formTags, ...parsed.tags])];
    const finalPriority = priority !== "none" ? priority : parsed.priority;
    const finalScheduled = sched ?? parsed.scheduled;
    const finalDeadline = dead ?? parsed.deadline;

    try {
      const placed = await appendTask(target, {
        title: parsed.title,
        state,
        priority: finalPriority,
        tags: finalTags,
        scheduled: finalScheduled ?? undefined,
        deadline: finalDeadline ?? undefined,
        notes,
      });
      registerUndo?.("Remove created task", async () => {
        await removeSubtreeByRaw(target, placed.raw, placed.line);
      });
      await showToast({ style: Toast.Style.Success, title: "Task created", message: parsed.title });
      onCreated?.();
      if (addAnother) {
        reset();
      } else if (standalone) {
        await popToRoot();
      } else {
        pop();
      }
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not write todos file",
        message: String(e),
      });
    }
  }

  return (
    <Form
      navigationTitle="New Todo"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Task" onSubmit={() => create(false)} />
          <Action.SubmitForm
            title="Create & Add Another"
            shortcut={{ modifiers: ["ctrl"], key: "return" }}
            onSubmit={() => create(true)}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        placeholder="buy resistors tomorrow p1 #hardware"
        value={title}
        onChange={setTitle}
        autoFocus
      />
      {title.trim() && (
        <Form.Description
          title=""
          text={`Creates “${parsed.title}”${hint ? ` · ${hint}` : ""}`}
        />
      )}
      <Form.Dropdown id="state" title="State" value={state} onChange={setState}>
        {keywords.active.map((k) => (
          <Form.Dropdown.Item key={k} value={k} title={k} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="priority" title="Priority" value={priority} onChange={setPriority}>
        <Form.Dropdown.Item value="none" title={parsed.priority ? "From title" : "None"} />
        <Form.Dropdown.Item value="A" title="A (high)" />
        <Form.Dropdown.Item value="B" title="B" />
        <Form.Dropdown.Item value="C" title="C (low)" />
      </Form.Dropdown>
      <Form.TextField id="tags" title="Tags" placeholder="work, uni, emacs" value={tags} onChange={setTags} />
      <Form.Separator />
      <DateField id="scheduled" title="Scheduled" value={schedText} onChange={setSchedText} />
      <DateField id="deadline" title="Deadline" value={deadText} onChange={setDeadText} />
      <Form.Separator />
      <Form.TextArea id="notes" title="Notes" placeholder="Optional body text" value={notes} onChange={setNotes} />
      {targets.length > 1 && (
        <Form.Dropdown id="file" title="File" value={target} onChange={setTarget}>
          {targets.map((f) => (
            <Form.Dropdown.Item key={f} value={f} title={path.basename(f)} />
          ))}
        </Form.Dropdown>
      )}
    </Form>
  );
}
