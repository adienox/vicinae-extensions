/*
 * Clock in/out through a running Emacs server via emacsclient, so Emacs' own
 * org-clock state stays the single source of truth and its buffers are not
 * clobbered by direct file edits. `clock.ts` falls back to file edits when no
 * server is reachable.
 *
 * The elisp is passed as a single `--eval` argument, so there is no shell
 * quoting to worry about. Both forms save the affected buffer so the extension
 * sees the new clock state when it reloads the file from disk.
 */

import { execFile } from "node:child_process";
import type { Task } from "./org";

const EVAL_TIMEOUT_MS = 8000;

/** Split "emacsclient -s /socket" into a binary and an argument list. */
function commandTokens(command: string): { file: string; args: string[] } {
  const [file = "emacsclient", ...args] = command.trim().split(/\s+/).filter(Boolean);
  return { file, args };
}

/** Escape a string for inclusion in an elisp string literal. */
function elispString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Emacs-side navigation: trust the recorded line, then fall back to matching
 * the exact headline text in case the buffer moved on since the extension read
 * the file.
 */
function gotoHeadline(task: Task): string {
  const raw = elispString(task.raw);
  return [
    "(goto-char (point-min))",
    `(forward-line ${task.line})`,
    `(unless (string= (buffer-substring-no-properties (line-beginning-position) (line-end-position)) ${raw})`,
    "  (goto-char (point-min))",
    `  (re-search-forward (concat "^" (regexp-quote ${raw}) "$") nil t))`,
  ].join(" ");
}

/** Clock the task in inside Emacs and save the buffer. */
export function emacsClockInForm(task: Task): string {
  return (
    "(progn (require 'org) (require 'org-clock)" +
    ` (let ((buf (find-file-noselect ${elispString(task.file)})))` +
    ` (with-current-buffer buf (save-excursion ${gotoHeadline(task)} (org-clock-in))` +
    " (set-visited-file-modtime) (save-buffer)) t))"
  );
}

/**
 * Clock out whatever Emacs has running, save the buffer and return the elapsed
 * minutes, or -1 when no clock is running. `org-clock-out` moves
 * `org-clock-marker` itself, so the target buffer is captured beforehand.
 */
export function emacsClockOutForm(): string {
  return (
    "(progn (require 'org-clock)" +
    " (if (org-clock-is-active)" +
    " (let ((buf (marker-buffer org-clock-marker)) (start org-clock-start-time)" +
    " (org-log-note-clock-out nil))" +
    " (org-clock-out)" +
    " (when (buffer-live-p buf) (with-current-buffer buf (set-visited-file-modtime) (save-buffer)))" +
    " (if (and start (numberp (float-time start)))" +
    " (round (/ (float-time (time-subtract (current-time) start)) 60)) 0))" +
    " -1))"
  );
}

function runEmacsEval(command: string, form: string): Promise<string> {
  const { file, args } = commandTokens(command);
  return new Promise((resolve, reject) => {
    execFile(file, [...args, "--eval", form], { timeout: EVAL_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        // execFile's own message drops stderr; keep it for classification.
        (err as Error & { stderr?: string }).stderr = stderr;
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/** True when the failure means "no Emacs server", not a failed evaluation. */
export function isEmacsUnavailable(err: unknown): boolean {
  const e = err as { code?: string | number; stderr?: string; message?: string };
  if (e?.code === "ENOENT" || e?.code === 127) return true;
  const text = `${e?.stderr ?? ""}\n${e?.message ?? ""}`;
  return /can't find socket|error accessing socket|connection refused|Emacs server.*not running/i.test(
    text,
  );
}

/** Clock the task in via Emacs. Throws when Emacs is reachable but fails. */
export async function emacsClockIn(command: string, task: Task): Promise<void> {
  await runEmacsEval(command, emacsClockInForm(task));
}

/** Elisp that reverts an unmodified Emacs buffer for `file`, if open. */
export function emacsRevertForm(file: string): string {
  return (
    "(progn (require 'org)" +
    ` (let ((buf (find-buffer-visiting ${elispString(file)})))` +
    " (when (and buf (not (buffer-modified-p buf)))" +
    " (with-current-buffer buf (revert-buffer t t t)))) t)"
  );
}

/**
 * Ask Emacs to revert an unmodified buffer for `file`, so a direct file edit the
 * extension made doesn't leave Emacs thinking the file changed on disk.
 */
export async function emacsRevert(command: string, file: string): Promise<void> {
  await runEmacsEval(command, emacsRevertForm(file));
}

/** True when Emacs has an org clock running. */
export async function emacsClockActive(command: string): Promise<boolean> {
  const out = await runEmacsEval(
    command,
    "(progn (require 'org-clock) (if (org-clock-is-active) \"1\" \"0\"))",
  );
  return out.trim().replace(/^"|"$/g, "") === "1";
}

/**
 * Save any modified Emacs buffers visiting `files`. Org's `org-clock-out` edits
 * the buffer but does not save it, so this persists an external clock-out.
 */
export async function emacsSaveBuffers(command: string, files: string[]): Promise<void> {
  if (!files.length) return;
  const form =
    "(progn (require 'org) (dolist (f (list " +
    files.map(elispString).join(" ") +
    ")) (let ((b (find-buffer-visiting f))) (when (and b (buffer-modified-p b))" +
    " (with-current-buffer b (set-visited-file-modtime) (save-buffer))))) t)";
  await runEmacsEval(command, form);
}

/**
 * Clock out via Emacs. Returns the elapsed minutes, or undefined when Emacs
 * had no clock running.
 */
export async function emacsClockOut(command: string): Promise<number | undefined> {
  const out = await runEmacsEval(command, emacsClockOutForm());
  const minutes = Number(out.trim());
  if (!Number.isFinite(minutes) || minutes < 0) return undefined;
  return Math.max(1, minutes);
}
