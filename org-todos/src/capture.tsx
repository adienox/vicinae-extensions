/*
 * Capture: create a task from the clipboard. First line becomes the title
 * (quick-add syntax applies), the rest becomes the body.
 */

import { Clipboard, LaunchProps, Toast, showToast } from "@vicinae/api";
import { getConfig } from "./lib/config";
import { appendTask } from "./lib/files";
import { describeParsed, parseQuickAdd } from "./lib/quick-add";

export default async function Capture(props: LaunchProps) {
  void props;
  const text = await Clipboard.readText();
  if (!text?.trim()) {
    await showToast({ style: Toast.Style.Failure, title: "Clipboard is empty" });
    return;
  }

  const lines = text.trim().split("\n");
  const p = parseQuickAdd(lines[0]);
  const notes = lines.slice(1).join("\n").trim();
  const { file, keywords } = getConfig();

  try {
    await appendTask(file, {
      title: p.title,
      state: keywords.active[0],
      priority: p.priority,
      tags: p.tags,
      scheduled: p.scheduled,
      deadline: p.deadline,
      notes: notes || undefined,
    });
    await showToast({
      style: Toast.Style.Success,
      title: "Captured from clipboard",
      message: [p.title, describeParsed(p)].filter(Boolean).join(" — "),
    });
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not write todos file",
      message: String(e),
    });
  }
}
