/*
 * Extension configuration, read from vicinae preferences.
 */

import { getPreferenceValues } from "@vicinae/api";
import { homedir } from "node:os";
import path from "node:path";
import { parseKeywords, type Keywords } from "./org";

export interface Preferences {
  todosFile?: string;
  extraFiles?: string;
  todoKeywords?: string;
  editorCommand?: string;
  archiveFile?: string;
}

export interface Config {
  /** New tasks are written here */
  file: string;
  /** Files or directories to read tasks from (primary first) */
  sources: string[];
  keywords: Keywords;
  editorCommand: string;
  /** Where "Archive Task" moves subtrees */
  archiveFile: string;
}

const DEFAULT_KEYWORDS = "TODO NEXT WAIT | DONE CANCELLED";
const DEFAULT_EDITOR = 'emacsclient -c -n -a "" +{line} {file}';
const DEFAULT_ARCHIVE = "~/org/archive.org";

export function resolvePath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

export function getConfig(): Config {
  const p = getPreferenceValues<Preferences>();
  const primary = resolvePath(p.todosFile?.trim() || "~/org/todos.org");
  const extra = (p.extraFiles ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(resolvePath);
  return {
    file: primary,
    sources: [primary, ...extra],
    keywords: parseKeywords(p.todoKeywords?.trim() || DEFAULT_KEYWORDS),
    editorCommand: p.editorCommand?.trim() || DEFAULT_EDITOR,
    archiveFile: resolvePath(p.archiveFile?.trim() || DEFAULT_ARCHIVE),
  };
}
