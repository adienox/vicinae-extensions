import { LaunchProps, Toast, showToast } from "@vicinae/api";
import { getConfig } from "./lib/config";
import { appendTask } from "./lib/files";
import { describeParsed, parseQuickAdd } from "./lib/quick-add";

export default async function QuickAdd(props: LaunchProps<{ arguments: Arguments.QuickAdd }>) {
  const input = props.arguments.text?.trim();
  if (!input) {
    await showToast({ style: Toast.Style.Failure, title: "Type a task first" });
    return;
  }

  const { file, keywords } = getConfig();
  const p = parseQuickAdd(input);
  try {
    await appendTask(file, {
      title: p.title,
      state: keywords.active[0],
      priority: p.priority,
      tags: p.tags,
      scheduled: p.scheduled,
      deadline: p.deadline,
    });
    await showToast({
      style: Toast.Style.Success,
      title: "Task added",
      message: [p.title, describeParsed(p)].filter(Boolean).join(" — "),
    });
  } catch (e) {
    await showToast({ style: Toast.Style.Failure, title: "Could not write todos file", message: String(e) });
  }
}
