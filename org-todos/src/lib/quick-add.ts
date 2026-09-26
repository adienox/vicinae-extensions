/*
 * Quick-add parsing and natural-language dates, powered by chrono-node.
 *
 * Two modes:
 *  - extractDate (quick-add lines): strict — a mention must be keyworded
 *    (by/due/deadline/on) or trailing, and bare month/time mentions are
 *    ignored so titles like "march the boxes" stay intact.
 *  - parseDatePhrase (date fields): generous — accepts time-only ("9am")
 *    and month-only ("august") input.
 *
 * Convention: a returned Date at midnight means "date only"; a Date with a
 * non-zero time means the user typed an explicit time.
 */

import { en, type ParsedResult } from "chrono-node";
import { ymd } from "./org";

export interface Parsed {
  title: string;
  priority?: "A" | "B" | "C";
  tags: string[];
  scheduled?: Date;
  deadline?: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Reject matches that are too vague to be intentional in running text. */
function acceptable(r: ParsedResult, strict: boolean): boolean {
  const s = r.start;
  // bare month name ("march the boxes"): fine in a date field ("august" → next Aug 1),
  // never in a sentence
  if (s.isCertain("month") && !s.isCertain("day") && !s.isCertain("hour") && !s.isCertain("year")) {
    return !strict;
  }
  // bare year
  if (s.isCertain("year") && !s.isCertain("month") && !s.isCertain("day") && !s.isCertain("hour")) {
    return false;
  }
  // time without any date ("meet at 5") — fine in a date field, not in a title
  if (strict && s.isCertain("hour") && !s.isCertain("day")) return false;
  return true;
}

/** Build a local Date from chrono components; midnight unless a time was typed. */
function resultToDate(r: ParsedResult): Date {
  const y = r.start.get("year") ?? new Date().getFullYear();
  const mo = r.start.get("month") ?? 1;
  const da = r.start.get("day") ?? 1;
  const hasTime = r.start.isCertain("hour");
  const h = hasTime ? (r.start.get("hour") ?? 0) : 0;
  const mi = hasTime ? (r.start.get("minute") ?? 0) : 0;
  return new Date(y, mo - 1, da, h, mi, 0, 0);
}

const KW_BEFORE = /\b(by|due|deadline|on)$/i;

interface Extract {
  date: Date;
  kind: "scheduled" | "deadline";
  start: number;
  end: number;
}

/** Org-style offset "+3d"/"++2w" → date (org users type these reflexively). */
function offsetDate(n: number, unit: string, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (unit === "h") d.setDate(d.getDate() + Math.max(1, Math.ceil(n / 24)));
  else if (unit === "d") d.setDate(d.getDate() + n);
  else if (unit === "w") d.setDate(d.getDate() + 7 * n);
  else if (unit === "m") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d;
}

/** eod / eow / eom — end of day, week (Saturday), month. */
function aliasDate(alias: string, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (alias === "eow") d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  else if (alias === "eom") d.setDate(1), d.setMonth(d.getMonth() + 1), d.setDate(0);
  return d;
}

/**
 * Org-native fallback when chrono finds nothing: "+3w" offsets and
 * eod/eow/eom aliases, keyworded or trailing — same rules as chrono matches.
 */
function orgFallback(text: string, now: Date): Extract | undefined {
  const trimmed = text.trimEnd();
  const attempt = (re: RegExp, toDate: (m: RegExpExecArray) => Date): Extract | undefined => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      const before = text.slice(0, m.index).trimEnd();
      const kw = KW_BEFORE.exec(before);
      const trailing = end >= trimmed.length;
      if (!kw && !trailing) continue;
      const word = kw?.[0].trim().toLowerCase();
      return {
        date: toDate(m),
        kind: word && word !== "on" ? "deadline" : "scheduled",
        start: kw ? before.length - kw[0].length : m.index + (m[0].startsWith(" ") ? 1 : 0),
        end,
      };
    }
    return undefined;
  };

  return attempt(/(?:^|\s)\+{1,2}(\d+)([hdwmy])(?=\s|$)/gi, (m) =>
    offsetDate(Number(m[2]), m[3].toLowerCase(), now),
  ) ?? attempt(/(?:^|\s)(eod|eow|eom)(?=\s|$)/gi, (m) => aliasDate(m[1].toLowerCase(), now));
}

function extractDate(text: string, now: Date): Extract | undefined {
  const results = en.parse(text, now, { forwardDate: true }).filter((r) => acceptable(r, true));

  for (const r of results) {
    // chrono consumes "on" before weekdays ("on monday"); treat it as scheduled
    if (/^on\s/i.test(r.text)) {
      return { date: resultToDate(r), kind: "scheduled", start: r.index, end: r.index + r.text.length };
    }
    const before = text.slice(0, r.index).trimEnd();
    const kw = KW_BEFORE.exec(before);
    if (kw) {
      const word = kw[0].trim().toLowerCase();
      return {
        date: resultToDate(r),
        kind: word === "on" ? "scheduled" : "deadline",
        start: before.length - kw[0].length,
        end: r.index + r.text.length,
      };
    }
  }

  // a bare date only counts when it trails the line
  const last = results[results.length - 1];
  if (last && last.index + last.text.length >= text.trimEnd().length) {
    return {
      date: resultToDate(last),
      kind: "scheduled",
      start: last.index,
      end: last.index + last.text.length,
    };
  }

  return orgFallback(text, now);
}

/**
 * Parse "buy resistors tomorrow p1 #hardware" into structured fields.
 *
 *  - p1/p2/p3 (or !1/!2/!3) set priority A/B/C, p4 means none
 *  - #tag adds a tag
 *  - a trailing date phrase sets SCHEDULED; "by/due/deadline <date>" sets DEADLINE;
 *    "on <date>" sets SCHEDULED anywhere in the sentence
 */
export function parseQuickAdd(input: string, now = new Date()): Parsed {
  let text = ` ${input.trim()} `;
  const result: Parsed = { title: "", tags: [] };

  text = text.replace(/(?<=\s)#([\w@%-]+)(?=\s)/g, (_m, tag: string) => {
    result.tags.push(tag);
    return " ";
  });

  const pm = /(?<=\s)(?:p|!)([1-4])(?=\s)/i.exec(text);
  if (pm) {
    result.priority = ({ 1: "A", 2: "B", 3: "C" } as const)[Number(pm[1]) as 1 | 2 | 3];
    text = text.slice(0, pm.index) + " " + text.slice(pm.index + pm[0].length);
  }

  text = text.trim();

  const ex = extractDate(text, now);
  if (ex) {
    if (ex.kind === "scheduled") result.scheduled = ex.date;
    else result.deadline = ex.date;
    text = (text.slice(0, ex.start) + " " + text.slice(ex.end)).trim();
  }

  result.title = text.replace(/\s+/g, " ").trim() || input.trim();
  return result;
}

/**
 * Resolve a free-form date phrase ("tomorrow", "fri", "9/30", "tomorrow 9am")
 * to a Date, or undefined when it can't be understood. Generous mode.
 */
export function parseDatePhrase(input: string, now = new Date()): Date | undefined {
  const t = input.trim();
  if (!t) return undefined;

  // org-native syntax first: "+3d", "eow"
  const off = /^(\+{1,2})(\d+)([hdwmy])$/i.exec(t);
  if (off) return offsetDate(Number(off[2]), off[3].toLowerCase(), now);
  const alias = /^(eod|eow|eom)$/i.exec(t);
  if (alias) return aliasDate(alias[1].toLowerCase(), now);

  const r = en.parse(t, now, { forwardDate: true }).filter((x) => acceptable(x, false))[0];
  return r ? resultToDate(r) : undefined;
}

export function shortDate(d: Date): string {
  const today = ymd(new Date());
  const t = new Date();
  const tomorrow = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
  let base: string;
  if (ymd(d) === today) base = "today";
  else if (ymd(d) === tomorrow) base = "tomorrow";
  else base = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.getHours() || d.getMinutes() ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
  return base + time;
}

/** Human summary of what parseQuickAdd extracted, e.g. "P1 · #work · scheduled tomorrow". */
export function describeParsed(p: Parsed): string {
  const bits: string[] = [];
  if (p.priority) bits.push(`P${{ A: 1, B: 2, C: 3 }[p.priority]}`);
  for (const t of p.tags) bits.push(`#${t}`);
  if (p.scheduled) bits.push(`scheduled ${shortDate(p.scheduled)}`);
  if (p.deadline) bits.push(`due ${shortDate(p.deadline)}`);
  return bits.join(" · ");
}
