/*
 * Tests for the pure org logic (src/lib/org.ts, src/lib/quick-add.ts,
 * src/lib/search.ts). Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustSubtreeLevel,
  applyRepeaterChange,
  applyStateChange,
  applyTaskPatch,
  buildAppendBlock,
  collectTags,
  daysUntil,
  deadlineStatus,
  fileKeywords,
  findInsertionPoint,
  findSubtreeRange,
  formatHeadline,
  formatStamp,
  listProjects,
  parseKeywords,
  parseOrg,
  parseStamp,
  replaceState,
  shiftDate,
  updateCookie,
  warningToDays,
  ymd,
  type Keywords,
  type Task,
} from "../src/lib/org";
import { describeParsed, parseDatePhrase, parseQuickAdd } from "../src/lib/quick-add";
import { priorityLevel, taskMatches } from "../src/lib/search";

const KW: Keywords = parseKeywords("TODO NEXT WAIT | DONE CANCELLED");

function mkTask(over: Partial<Task> & Pick<Task, "raw" | "state" | "title">): Task {
  return {
    file: "test.org",
    line: 0,
    level: 1,
    tags: [],
    body: "",
    outline: [],
    ...over,
  };
}

/* ------------------------------ keywords --------------------------------- */

test("parseKeywords splits active and done states", () => {
  const kw = parseKeywords("TODO NEXT WAIT | DONE CANCELLED");
  assert.deepEqual(kw.active, ["TODO", "NEXT", "WAIT"]);
  assert.deepEqual(kw.done, ["DONE", "CANCELLED"]);
  assert.deepEqual(kw.all, ["TODO", "NEXT", "WAIT", "DONE", "CANCELLED"]);
});

test("parseKeywords without a bar makes the last state done", () => {
  const kw = parseKeywords("TODO DOING DONE");
  assert.deepEqual(kw.active, ["TODO", "DOING"]);
  assert.deepEqual(kw.done, ["DONE"]);
});

test("parseKeywords falls back to TODO/DONE", () => {
  const kw = parseKeywords("");
  assert.deepEqual(kw.active, ["TODO"]);
  assert.deepEqual(kw.done, ["DONE"]);
});

test("parseKeywords strips fast-access keys", () => {
  const kw = parseKeywords("TODO(t) | DONE(d)");
  assert.deepEqual(kw.active, ["TODO"]);
  assert.deepEqual(kw.done, ["DONE"]);
});

test("fileKeywords: no directive means the preference applies", () => {
  const text = "* TODO thing\n";
  assert.equal(fileKeywords(text, KW), KW);
});

test("fileKeywords: a #+TODO: directive overrides the preference", () => {
  const text = "#+TODO: WAITING PROGRESS | FINISHED\n* WAITING ask bob\n";
  const kw = fileKeywords(text, KW);
  assert.deepEqual(kw.active, ["WAITING", "PROGRESS"]);
  assert.deepEqual(kw.done, ["FINISHED"]);
});

test("fileKeywords merges multiple directives", () => {
  const text = "#+TODO: TODO NEXT |\n#+TODO: | DONE CANCELLED\n";
  const kw = fileKeywords(text, KW);
  assert.deepEqual(kw.active, ["TODO", "NEXT"]);
  assert.deepEqual(kw.done, ["DONE", "CANCELLED"]);
});

/* ------------------------------ stamps ----------------------------------- */

test("parseStamp reads time, repeater and warning period", () => {
  const s = parseStamp("<2026-09-21 Mon 09:30 +1w -2d>");
  assert.ok(s);
  assert.equal(s.date, "2026-09-21");
  assert.equal(s.time, "09:30");
  assert.equal(s.repeater, "+1w");
  assert.equal(s.warning, "-2d");
  assert.equal(formatStamp(s), "<2026-09-21 Mon 09:30 +1w -2d>");
});

test("parseStamp handles diary stamps in brackets", () => {
  const s = parseStamp("[2026-09-21 Mon 10:00]");
  assert.ok(s);
  assert.equal(s.open, "[");
  assert.equal(formatStamp(s), "[2026-09-21 Mon 10:00]");
});

test("parseStamp rejects impossible and malformed dates", () => {
  assert.equal(parseStamp("hello"), undefined);
  assert.equal(parseStamp("<2026-13-99 Mon>"), undefined);
});

test("shiftDate: +1w moves from the stored date, no catch-up", () => {
  assert.equal(shiftDate("2026-09-14", "+1w", "2026-09-21"), "2026-09-21");
  assert.equal(shiftDate("2026-09-07", "+1w", "2026-09-21"), "2026-09-14");
});

test("shiftDate: .+1w counts from today", () => {
  assert.equal(shiftDate("2026-09-07", ".+1w", "2026-09-21"), "2026-09-28");
});

test("shiftDate: ++1w stays strictly in the future", () => {
  assert.equal(shiftDate("2026-09-07", "++1w", "2026-09-21"), "2026-09-28");
});

test("shiftDate handles days and months", () => {
  assert.equal(shiftDate("2026-09-20", "+2d", "2026-09-21"), "2026-09-22");
  assert.equal(shiftDate("2026-09-21", "+1m", "2026-09-21"), "2026-10-21");
});

/* ------------------------------ headlines -------------------------------- */

test("formatHeadline builds state, priority, title and tags", () => {
  assert.equal(formatHeadline(1, "TODO", "A", "Pay rent", ["money", "home"]), "* TODO [#A] Pay rent :money:home:");
  assert.equal(formatHeadline(2, "DONE", undefined, "Thing", []), "** DONE Thing");
});

test("formatHeadline sanitizes tags", () => {
  assert.equal(formatHeadline(1, "TODO", undefined, "X", ["weird tag!"]), "* TODO X :weird_tag:");
});

test("replaceState swaps only the keyword", () => {
  assert.equal(replaceState("* TODO Pay rent [#A] :x:", "DONE"), "* DONE Pay rent [#A] :x:");
  assert.equal(replaceState("** NEXT Deep thing", "WAIT"), "** WAIT Deep thing");
});

/* ------------------------------ parsing ---------------------------------- */

const SAMPLE = `#+TITLE: Todos
* TODO [#A] Pay rent :money:home:
SCHEDULED: <2026-09-20 Sun>
rent is due
** TODO call landlord
* WAITING Ask bob about budget
* DONE Old thing
CLOSED: [2026-09-01 Tue 10:00]
`;

test("parseOrg extracts state, priority, tags, dates and outline", () => {
  const tasks = parseOrg(SAMPLE, KW, "test.org");
  assert.equal(tasks.length, 3);

  const rent = tasks[0];
  assert.equal(rent.state, "TODO");
  assert.equal(rent.priority, "A");
  assert.deepEqual(rent.tags, ["money", "home"]);
  assert.equal(rent.title, "Pay rent");
  assert.equal(rent.level, 1);
  assert.equal(rent.scheduled, "2026-09-20");
  assert.equal(rent.body, "rent is due");
  assert.deepEqual(rent.outline, []);

  const call = tasks[1];
  assert.equal(call.level, 2);
  assert.deepEqual(call.outline, ["Pay rent"]);

  const old = tasks[2];
  assert.equal(old.state, "DONE");
  assert.equal(old.closed, "2026-09-01 10:00");
});

test("parseOrg skips headlines inside begin/end blocks", () => {
  const text = `#+begin_src org
* TODO not a task
#+end_src
* TODO real
`;
  const tasks = parseOrg(text, KW, "t.org");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "real");
});

test("parseOrg strips drawers from the body", () => {
  const text = `* TODO Task
:PROPERTIES:
:ID: abc
:END:
first line
:LOGBOOK:
- Note taken
:END:
last line
`;
  const [t] = parseOrg(text, KW, "t.org");
  assert.equal(t.body, "first line\nlast line");
});

test("parseOrg picks up repeaters and where they live", () => {
  const text = "* TODO Water plants\nSCHEDULED: <2026-09-14 Mon +1w>\n";
  const [t] = parseOrg(text, KW, "t.org");
  assert.equal(t.repeat, "+1w");
  assert.equal(t.repeatOn, "scheduled");
  assert.equal(t.scheduled, "2026-09-14");
});

test("parseOrg reads :ID:, statistics cookies and checkboxes", () => {
  const text = `* TODO Pack [1/3]
:PROPERTIES:
:ID: abc-123
:END:
- [x] books
- [ ] shoes
- [ ] charger
`;
  const [t] = parseOrg(text, KW, "t.org");
  assert.equal(t.orgId, "abc-123");
  assert.deepEqual(t.cookie, { done: 1, total: 3, percent: false });
  assert.equal(t.checkboxItems?.length, 3);
  assert.equal(t.checkboxItems?.[0].checked, true);
  assert.equal(t.checkboxItems?.[1].text, "shoes");
});

test("parseOrg reads percent cookies", () => {
  const text = "* TODO Progress [33%]\nbody\n";
  const [t] = parseOrg(text, KW, "t.org");
  assert.deepEqual(t.cookie, { done: 33, total: 100, percent: true });
});

test("parseOrg reads deadline warning periods", () => {
  const text = "* TODO Submit paper\nDEADLINE: <2026-09-25 Fri -3d>\n";
  const [t] = parseOrg(text, KW, "t.org");
  assert.equal(t.deadlineWarningDays, 3);
  assert.equal(t.deadline, "2026-09-25");
});

test("warningToDays converts org warning tokens to days", () => {
  assert.equal(warningToDays("-2d"), 2);
  assert.equal(warningToDays("--3d"), 3);
  assert.equal(warningToDays("-1w"), 7);
  assert.equal(warningToDays("-12h"), 1);
  assert.equal(warningToDays("nonsense"), undefined);
});

test("deadlineStatus tracks the org lifecycle", () => {
  const base = { raw: "* TODO X", state: "TODO", title: "X" };
  // today = 2026-09-21
  const overdue = mkTask({ ...base, deadline: "2026-09-20" });
  const dueToday = mkTask({ ...base, deadline: "2026-09-21" });
  const warned = mkTask({ ...base, deadline: "2026-09-24", deadlineWarningDays: 5 });
  const outside = mkTask({ ...base, deadline: "2026-09-24" });
  const noWarn = mkTask({ ...base, deadline: "2026-09-30", deadlineWarningDays: 3 });

  assert.equal(deadlineStatus(overdue, "2026-09-21"), "overdue");
  assert.equal(deadlineStatus(dueToday, "2026-09-21"), "today");
  assert.equal(deadlineStatus(warned, "2026-09-21"), "warn");
  assert.equal(deadlineStatus(outside, "2026-09-21"), undefined);
  assert.equal(deadlineStatus(noWarn, "2026-09-21"), undefined);
});

test("daysUntil counts calendar days", () => {
  assert.equal(daysUntil("2026-09-24", "2026-09-21"), 3);
  assert.equal(daysUntil("2026-09-21", "2026-09-21"), 0);
  assert.equal(daysUntil("2026-09-19", "2026-09-21"), -2);
});

test("parseOrg detects open clocks and clocked totals", () => {
  const text = `* TODO Deep work
:LOGBOOK:
CLOCK: [2026-09-20 Sun 10:00]--[2026-09-20 Sun 12:30] =>  2:30
CLOCK: [2026-09-21 Mon 22:00]
:END:
`;
  const [t] = parseOrg(text, KW, "t.org");
  assert.equal(t.clockIn, "2026-09-21 22:00");
  assert.equal(t.clockedMinutes, 150);
});

test("parseOrg uses file-local keywords", () => {
  const text = "#+TODO: WAITING | FINISHED\n* WAITING ask bob\n* FINISHED done thing\n";
  const tasks = parseOrg(text, KW, "t.org");
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].state, "WAITING");
  assert.equal(tasks[1].state, "FINISHED");
});

test("parseOrg tolerates a priority cookie written after the title", () => {
  const text = "* TODO Pay rent [#A] :money:\n";
  const [t] = parseOrg(text, KW, "t.org");
  assert.equal(t.priority, "A");
  assert.equal(t.title, "Pay rent");
  assert.deepEqual(t.tags, ["money"]);
});

/* ------------------------------ state changes ---------------------------- */

test("applyStateChange marks done and records CLOSED", () => {
  const lines = ["* TODO Pay rent", "  body"];
  const task = mkTask({ raw: "* TODO Pay rent", state: "TODO", title: "Pay rent" });
  const res = applyStateChange(lines, 0, task, "DONE", KW, new Date(2026, 8, 21, 10, 30));
  assert.deepEqual(res, { state: "DONE", repeated: false });
  assert.equal(lines[0], "* DONE Pay rent");
  assert.equal(lines[1], "  CLOSED: [2026-09-21 Mon 10:30]");
  assert.equal(lines[2], "  body");
});

test("applyStateChange reopens and drops CLOSED", () => {
  const lines = ["* DONE Pay rent", "  CLOSED: [2026-09-21 Mon 10:30]", "  body"];
  const task = mkTask({ raw: "* DONE Pay rent", state: "DONE", title: "Pay rent" });
  const res = applyStateChange(lines, 0, task, "TODO", KW, new Date(2026, 8, 21));
  assert.equal(res.state, "TODO");
  assert.equal(lines[0], "* TODO Pay rent");
  assert.deepEqual(lines, ["* TODO Pay rent", "  body"]);
});

test("applyStateChange reschedules repeating tasks instead of closing", () => {
  const lines = ["* TODO Water plants", "  SCHEDULED: <2026-09-20 Sun +1w>"];
  const task = mkTask({
    raw: "* TODO Water plants",
    state: "TODO",
    title: "Water plants",
    repeat: "+1w",
    repeatOn: "scheduled",
  });
  const res = applyStateChange(lines, 0, task, "DONE", KW, new Date(2026, 8, 21, 8, 0));
  assert.equal(res.repeated, true);
  assert.equal(res.state, "TODO"); // back to the first active state
  assert.equal(res.next, "2026-09-27");
  assert.equal(lines[1], "  SCHEDULED: <2026-09-27 Sun +1w>");
  assert.match(lines[3], /:LAST_REPEAT: \[2026-09-21 Mon 08:00\]/);
});

/* ------------------------------ patches ---------------------------------- */

test("applyTaskPatch rewrites title, priority and tags", () => {
  const lines = ["* TODO Buy milk [#A] :a:b:", "  SCHEDULED: <2026-09-20 Sun 09:00 +1w>"];
  const task = mkTask({
    raw: lines[0],
    state: "TODO",
    title: "Buy milk",
    priority: "A",
    tags: ["a", "b"],
  });
  const headline = applyTaskPatch(lines, 0, task, { title: "Buy oat milk", priority: "B", tags: ["x"] });
  assert.equal(headline, "* TODO [#B] Buy oat milk :x:");
  assert.equal(lines[1], "  SCHEDULED: <2026-09-20 Sun 09:00 +1w>");
});

test("applyTaskPatch keeps time, repeater and warning when rescheduling", () => {
  const lines = ["* TODO Buy milk", "  SCHEDULED: <2026-09-20 Sun 09:00 +1w -2d>"];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Buy milk" });
  applyTaskPatch(lines, 0, task, { scheduled: new Date(2026, 8, 25) });
  assert.equal(lines[1], "  SCHEDULED: <2026-09-25 Fri 09:00 +1w -2d>");
});

test("applyTaskPatch writes an explicitly typed time", () => {
  const lines = ["* TODO Buy milk", "  SCHEDULED: <2026-09-20 Sun>"];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Buy milk" });
  applyTaskPatch(lines, 0, task, { scheduled: new Date(2026, 8, 25, 9, 30) });
  assert.equal(lines[1], "  SCHEDULED: <2026-09-25 Fri 09:30>");
});

test("applyTaskPatch clears a date", () => {
  const lines = ["* TODO Buy milk", "  SCHEDULED: <2026-09-20 Sun>"];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Buy milk" });
  applyTaskPatch(lines, 0, task, { scheduled: null });
  assert.deepEqual(lines, ["* TODO Buy milk"]);
});

test("applyTaskPatch replaces the body, keeping planning and properties", () => {
  const lines = [
    "* TODO Task",
    "  SCHEDULED: <2026-09-20 Sun>",
    "  :PROPERTIES:",
    "  :ID: abc",
    "  :END:",
    "  old body",
    "  more",
  ];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Task" });
  applyTaskPatch(lines, 0, task, { body: "new body" });
  assert.deepEqual(lines, [
    "* TODO Task",
    "  SCHEDULED: <2026-09-20 Sun>",
    "  :PROPERTIES:",
    "  :ID: abc",
    "  :END:",
    "  new body",
  ]);
});

test("applyRepeaterChange sets and clears repeaters", () => {
  const lines = ["* TODO Task", "  SCHEDULED: <2026-09-20 Sun>"];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Task" });
  applyRepeaterChange(lines, 0, task, "scheduled", "+1w");
  assert.equal(lines[1], "  SCHEDULED: <2026-09-20 Sun +1w>");
  applyRepeaterChange(lines, 0, task, "scheduled", null);
  assert.equal(lines[1], "  SCHEDULED: <2026-09-20 Sun>");
});

test("applyRepeaterChange refuses when there is no date", () => {
  const lines = ["* TODO Task"];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Task" });
  assert.throws(() => applyRepeaterChange(lines, 0, task, "scheduled", "+1w"));
});

/* ------------------------------ appending -------------------------------- */

test("buildAppendBlock formats headline, planning and notes", () => {
  const block = buildAppendBlock(
    {
      title: "Call supplier",
      state: "TODO",
      priority: "A",
      tags: ["work"],
      scheduled: new Date(2026, 8, 22, 9, 30),
      notes: "ask about\nlead times",
    },
    1,
  );
  assert.deepEqual(block, [
    "* TODO [#A] Call supplier :work:",
    "  SCHEDULED: <2026-09-22 Tue 09:30>",
    "  ask about",
    "  lead times",
  ]);
});

test("findInsertionPoint nests under the matching project", () => {
  const lines = ["* Work :work:", "  some", "  ** TODO a", "* Home :home:", "  x"];
  const point = findInsertionPoint(lines, ["work"]);
  assert.ok(point);
  assert.equal(point.level, 2);
  assert.equal(point.index, 3);
});

test("findInsertionPoint returns undefined without a tag match", () => {
  const lines = ["* Work :work:", "  x"];
  assert.equal(findInsertionPoint(lines, ["nope"]), undefined);
  assert.equal(findInsertionPoint(lines, []), undefined);
});

/* ------------------------------ subtrees, projects, cookies, tags --------- */

test("findSubtreeRange covers children until the next sibling", () => {
  const lines = ["* A", "x", "** B", "y", "* C", "z"];
  assert.deepEqual(findSubtreeRange(lines, 0, 1), [0, 4]);
  assert.deepEqual(findSubtreeRange(lines, 2, 2), [2, 4]);
  assert.deepEqual(findSubtreeRange(lines, 4, 1), [4, 6]);
});

test("listProjects lists every top-level headline", () => {
  const text = "* Work :work:\nx\n* TODO Inbox\n* Archived stuff\n";
  const projects = listProjects(text, KW);
  assert.deepEqual(
    projects.map((p) => p.title),
    ["Work", "Inbox", "Archived stuff"],
  );
  assert.deepEqual(projects[0].tags, ["work"]);
});

test("adjustSubtreeLevel shifts and clamps stars", () => {
  assert.deepEqual(adjustSubtreeLevel(["* A", "text", "** B"], 1), ["** A", "text", "*** B"]);
  assert.deepEqual(adjustSubtreeLevel(["** A", "** B"], -1), ["* A", "* B"]);
  assert.deepEqual(adjustSubtreeLevel(["* A"], -5), ["* A"]);
});

test("updateCookie refreshes fraction and percent cookies", () => {
  assert.equal(updateCookie("* TODO X [1/3]", 2, 3), "* TODO X [2/3]");
  assert.equal(updateCookie("* TODO X [33%]", 2, 3), "* TODO X [67%]");
  assert.equal(updateCookie("* TODO X", 2, 3), "* TODO X"); // no cookie, no addition
});

test("collectTags includes non-task headlines", () => {
  const text = "* Work :work:\n** TODO sub :deep:\n* Plain :other:\n";
  assert.deepEqual(collectTags(text, KW).sort(), ["deep", "other", "work"]);
});

/* ------------------------------ quick add -------------------------------- */

const REF = new Date(2026, 8, 21, 22, 30); // Mon Sep 21 2026, 22:30 local
const ymdh = (d?: Date) => (d ? `${ymd(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : undefined);

test("parseQuickAdd extracts title, priority, tags and schedule", () => {
  const p = parseQuickAdd("call supplier tomorrow p1 #work", REF);
  assert.equal(p.title, "call supplier");
  assert.equal(p.priority, "A");
  assert.deepEqual(p.tags, ["work"]);
  assert.equal(ymdh(p.scheduled), "2026-09-22 00:00");
  assert.equal(p.deadline, undefined);
});

test("parseQuickAdd: by/due/deadline sets a deadline", () => {
  const p = parseQuickAdd("pay rent by fri !2", REF);
  assert.equal(p.title, "pay rent");
  assert.equal(p.priority, "B");
  assert.equal(ymdh(p.deadline), "2026-09-25 00:00");
  assert.equal(p.scheduled, undefined);
});

test("parseQuickAdd: on <date> schedules anywhere in the sentence", () => {
  const p = parseQuickAdd("submit report on monday", REF);
  assert.equal(p.title, "submit report");
  assert.equal(ymdh(p.scheduled), "2026-09-28 00:00");
});

test("parseQuickAdd: trailing dates in several formats", () => {
  assert.equal(ymdh(parseQuickAdd("taxes 9/30", REF).scheduled), "2026-09-30 00:00");
  assert.equal(ymdh(parseQuickAdd("taxes sep 30", REF).scheduled), "2026-09-30 00:00");
  assert.equal(ymdh(parseQuickAdd("taxes 30 sep", REF).scheduled), "2026-09-30 00:00");
  assert.equal(ymdh(parseQuickAdd("taxes 2026-10-01", REF).scheduled), "2026-10-01 00:00");
  assert.equal(ymdh(parseQuickAdd("gym in 3 days", REF).scheduled), "2026-09-24 00:00");
  assert.equal(ymdh(parseQuickAdd("gym next week", REF).scheduled), "2026-09-28 00:00");
});

test("parseQuickAdd keeps explicit times", () => {
  const p = parseQuickAdd("call supplier tomorrow 9am", REF);
  assert.equal(p.title, "call supplier");
  assert.equal(ymdh(p.scheduled), "2026-09-22 09:00");
});

test("parseQuickAdd: p4 means no priority", () => {
  const p = parseQuickAdd("gym today p4", REF);
  assert.equal(p.priority, undefined);
  assert.equal(p.title, "gym");
  assert.equal(ymdh(p.scheduled), "2026-09-21 00:00");
});

test("parseQuickAdd ignores month and time mentions in titles", () => {
  const p = parseQuickAdd("march the boxes", REF);
  assert.equal(p.title, "march the boxes");
  assert.equal(p.scheduled, undefined);
  const q = parseQuickAdd("meet at 5", REF);
  assert.equal(q.title, "meet at 5");
  assert.equal(q.scheduled, undefined);
});

test("parseQuickAdd keeps the title when nothing parses", () => {
  const p = parseQuickAdd("just some words", REF);
  assert.equal(p.title, "just some words");
  assert.deepEqual(p.tags, []);
});

test("describeParsed summarizes the extraction", () => {
  const p = parseQuickAdd("call supplier tomorrow 9am #work", REF);
  const summary = describeParsed(p);
  // relative labels ("today"/"tomorrow") depend on the real run date — assert parts
  assert.ok(summary.includes("#work"), summary);
  assert.ok(summary.startsWith("scheduled ") || summary.includes(" scheduled "), summary);
  assert.ok(summary.endsWith("09:00"), summary);
});

test("parseDatePhrase resolves phrases generously", () => {
  assert.equal(ymdh(parseDatePhrase("today", REF)), "2026-09-21 00:00");
  assert.equal(ymdh(parseDatePhrase("tomorrow", REF)), "2026-09-22 00:00");
  assert.equal(ymdh(parseDatePhrase("fri", REF)), "2026-09-25 00:00");
  assert.equal(ymdh(parseDatePhrase("next week", REF)), "2026-09-28 00:00");
  assert.equal(ymdh(parseDatePhrase("next month", REF)), "2026-10-21 00:00");
  assert.equal(ymdh(parseDatePhrase("2026-12-25", REF)), "2026-12-25 00:00");
  assert.equal(ymdh(parseDatePhrase("2026-01-01", REF)), "2026-01-01 00:00"); // past stays put
  assert.equal(ymdh(parseDatePhrase("tomorrow 9am", REF)), "2026-09-22 09:00");
  assert.equal(ymdh(parseDatePhrase("9am", REF)), "2026-09-22 09:00");
  assert.equal(ymdh(parseDatePhrase("august", REF)), "2027-08-01 00:00");
  assert.equal(parseDatePhrase("nonsense", REF), undefined);
});

test("parseDatePhrase speaks org offsets and eod/eow/eom", () => {
  assert.equal(ymdh(parseDatePhrase("+3d", REF)), "2026-09-24 00:00");
  assert.equal(ymdh(parseDatePhrase("+2w", REF)), "2026-10-05 00:00");
  assert.equal(ymdh(parseDatePhrase("+1m", REF)), "2026-10-21 00:00");
  assert.equal(ymdh(parseDatePhrase("+1y", REF)), "2027-09-21 00:00");
  assert.equal(ymdh(parseDatePhrase("++1w", REF)), "2026-09-28 00:00");
  assert.equal(ymdh(parseDatePhrase("eod", REF)), "2026-09-21 00:00");
  assert.equal(ymdh(parseDatePhrase("eow", REF)), "2026-09-26 00:00"); // Saturday
  assert.equal(ymdh(parseDatePhrase("eom", REF)), "2026-09-30 00:00");
});

test("parseQuickAdd accepts trailing org offsets and aliases", () => {
  const p = parseQuickAdd("buy milk +3w", REF);
  assert.equal(p.title, "buy milk");
  assert.equal(ymdh(p.scheduled), "2026-10-12 00:00"); // +3 weeks

  const q = parseQuickAdd("pay bill due +2d", REF);
  assert.equal(q.title, "pay bill");
  assert.equal(ymdh(q.deadline), "2026-09-23 00:00");

  const r = parseQuickAdd("submit report eow", REF);
  assert.equal(r.title, "submit report");
  assert.equal(ymdh(r.scheduled), "2026-09-26 00:00");

  // mid-sentence offsets are ignored, like any bare date
  const s = parseQuickAdd("cost +3d analysis", REF);
  assert.equal(s.title, "cost +3d analysis");
  assert.equal(s.scheduled, undefined);
});

/* ------------------------------ search ----------------------------------- */

test("taskMatches handles the token grammar", () => {
  const t = mkTask({ raw: "* TODO Pay rent", state: "TODO", title: "Pay rent", tags: ["money"], priority: "A" });
  const ctx = { isDone: false, overdue: true };
  assert.ok(taskMatches(t, ["rent"], ctx));
  assert.ok(taskMatches(t, ["#money"], ctx));
  assert.ok(taskMatches(t, ["p1"], ctx));
  assert.ok(taskMatches(t, ["is:overdue"], ctx));
  assert.ok(taskMatches(t, ["is:open"], ctx));
  assert.equal(taskMatches(t, ["#home"], ctx), false);
  assert.equal(taskMatches(t, ["p2"], ctx), false);
  assert.equal(taskMatches(t, ["is:done"], ctx), false);
  assert.equal(taskMatches(t, ["nonexistent"], ctx), false);
  assert.ok(taskMatches(t, [], ctx));
});

test("priorityLevel maps cookies", () => {
  assert.equal(priorityLevel("A"), 1);
  assert.equal(priorityLevel("C"), 3);
  assert.equal(priorityLevel(undefined), 4);
});
