/*
 * A form date field that speaks quick-add: type "tomorrow", "fri", "9/30",
 * "sep 30", "2026-09-30", "in 3 days"… with a live preview of the resolved
 * date. Replaces vicinae's bare ISO date text input.
 */

import { Form } from "@vicinae/api";
import { parseYmd } from "../lib/org";
import { parseDatePhrase } from "../lib/quick-add";

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function fmtDate(d: Date): string {
  const now = new Date();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  });
}

function fmtStamp(s: string): string {
  const time = s.length > 10 ? ` ${s.slice(11)}` : "";
  return `${fmtDate(parseYmd(s))}${time}`;
}

const fmtTime = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Turn field text into a patch value: null = clear, Date = set,
 * undefined = unparseable (callers should reject the submit).
 */
export function dateFromText(text: string): Date | null | undefined {
  const t = text.trim();
  if (!t) return null;
  return parseDatePhrase(t);
}

interface DateFieldProps {
  id: string;
  title: string;
  value: string;
  onChange: (v: string) => void;
  /** The task's current stamp (YYYY-MM-DD[ HH:MM]), shown while empty */
  existing?: string;
}

export function DateField({ id, title, value, onChange, existing }: DateFieldProps) {
  const text = value.trim();
  const parsed = text ? parseDatePhrase(value) : undefined;

  let hint: string;
  if (!text) {
    hint = existing ? `Currently ${fmtStamp(existing)} · clear the field to remove` : "Empty = no date";
  } else if (parsed) {
    hint = `→ ${fmtDate(parsed)}${parsed.getHours() || parsed.getMinutes() ? ` ${fmtTime(parsed)}` : ""}`;
  } else {
    hint = `Can't parse “${text}” — try: today, tomorrow, fri, 9/30, sep 30, tomorrow 9am, in 3 days`;
  }

  return (
    <>
      <Form.TextField
        id={id}
        title={title}
        placeholder="today, tomorrow, fri, 9/30, 2026-09-30…"
        value={value}
        onChange={onChange}
      />
      <Form.Description title="" text={hint} />
    </>
  );
}

/** Shared quick presets for the date-picker forms. */
export function datePresetList(): { title: string; date: Date }[] {
  const t = new Date();
  const tomorrow = addDays(t, 1);
  const monday = addDays(t, ((8 - t.getDay()) % 7) || 7);
  return [
    { title: `Today (${fmtDate(t)})`, date: t },
    { title: `Tomorrow (${fmtDate(tomorrow)})`, date: tomorrow },
    { title: `Next Monday (${fmtDate(monday)})`, date: monday },
  ];
}
