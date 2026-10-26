/*
 * High-level clock in/out used by the UI. Prefers a running Emacs server so
 * org-clock stays authoritative; falls back to editing the task's LOGBOOK
 * directly when no Emacs server is reachable (emacsclient missing or not
 * running). Errors raised *inside* Emacs are surfaced instead of silently
 * rewriting the file behind Emacs' back.
 */

import type { Config } from "./config";
import { emacsClockIn, emacsClockOut, emacsRevert, isEmacsUnavailable } from "./emacs";
import { clockIn as clockInFile, clockOut as clockOutFile } from "./files";
import type { Task } from "./org";

/** After a direct file edit, keep an open Emacs buffer in sync (best effort). */
async function resyncEmacs(config: Config, file: string): Promise<void> {
  if (!config.clockViaEmacs) return;
  try {
    await emacsRevert(config.emacsclientCommand, file);
  } catch {
    /* Emacs unreachable, or its buffer is modified — leave it alone */
  }
}

export async function clockIn(task: Task, config: Config): Promise<void> {
  if (config.clockViaEmacs) {
    try {
      await emacsClockIn(config.emacsclientCommand, task);
      return;
    } catch (e) {
      if (!isEmacsUnavailable(e)) throw e;
    }
  }
  await clockInFile(task);
  await resyncEmacs(config, task.file);
}

export async function clockOut(
  task: Task,
  config: Config,
): Promise<{ minutes: number } | undefined> {
  if (config.clockViaEmacs) {
    try {
      const minutes = await emacsClockOut(config.emacsclientCommand);
      if (minutes !== undefined) return { minutes };
    } catch (e) {
      if (!isEmacsUnavailable(e)) throw e;
    }
    // Emacs had no clock running (or was unreachable). A clock started by an
    // earlier direct-edit fallback may still be open on disk, so try closing
    // that before giving up.
  }
  const res = await clockOutFile(task);
  await resyncEmacs(config, task.file);
  return res;
}
