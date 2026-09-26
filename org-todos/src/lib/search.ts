import type { Task } from "./org";

/** Org [#A] [#B] [#C] map onto Priority 1-3; no cookie is Priority 4. */
export function priorityLevel(p?: string): 1 | 2 | 3 | 4 {
  if (p === "A") return 1;
  if (p === "B") return 2;
  if (p === "C") return 3;
  return 4;
}

function searchHay(t: Task): string {
  return [
    t.title,
    t.state,
    ...t.tags,
    ...t.outline,
    t.priority ? `p${priorityLevel(t.priority)}` : "",
    t.priority ? `[#${t.priority}]` : "",
  ]
    .join(" ")
    .toLowerCase();
}

export interface MatchContext {
  isDone: boolean;
  overdue: boolean;
}

/**
 * Search grammar:
 *   `#work`     tag must be present
 *   `p1`…`p4`   priority level (4 = none)
 *   `is:done` / `is:open` / `is:overdue`
 *   anything else  free-text across title, state, tags, outline, priority
 */
export function taskMatches(t: Task, tokens: string[], ctx: MatchContext): boolean {
  const hay = searchHay(t);
  for (const tok of tokens) {
    if (tok.startsWith("#") && tok.length > 1) {
      if (!t.tags.includes(tok.slice(1))) return false;
    } else if (/^p[1-4]$/.test(tok)) {
      if (String(priorityLevel(t.priority)) !== tok[1]) return false;
    } else if (tok === "is:done") {
      if (!ctx.isDone) return false;
    } else if (tok === "is:open") {
      if (ctx.isDone) return false;
    } else if (tok === "is:overdue") {
      if (!ctx.overdue) return false;
    } else if (!hay.includes(tok)) {
      return false;
    }
  }
  return true;
}

export const tokenize = (search: string): string[] =>
  search.toLowerCase().split(/\s+/).filter(Boolean);
