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
  formatEffort,
  formatHeadline,
  formatStamp,
  listProjects,
  parseEffort,
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
import { hasFreeText, priorityLevel, taskMatches, tokenize } from "../src/lib/search";

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

test("parseOrg reads the :Effort: property", () => {
  const text = "* TODO Write report\n:PROPERTIES:\n:Effort: 1:30\n:END:\nbody\n";
  const [t] = parseOrg(text, KW, "t.org");
  assert.equal(t.effort, "1:30");
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

test("parseEffort understands org effort formats", () => {
  assert.equal(parseEffort("20"), 20);
  assert.equal(parseEffort("0:20"), 20);
  assert.equal(parseEffort("1:30"), 90);
  assert.equal(parseEffort("1h 30min"), 90);
  assert.equal(parseEffort("1.5h"), 90);
  assert.equal(parseEffort("2d"), 2880);
  assert.equal(parseEffort("90m"), undefined); // "m" means months in Org
  assert.equal(parseEffort("nonsense"), undefined);
  assert.equal(parseEffort(undefined), undefined);
});

test("formatEffort writes canonical H:MM", () => {
  assert.equal(formatEffort(20), "0:20");
  assert.equal(formatEffort(90), "1:30");
  assert.equal(formatEffort(120), "2:00");
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

test("parseOrg detects clocks written without a LOGBOOK drawer", () => {
  const text = `* TODO Deep work
CLOCK: [2026-09-20 Sun 10:00]--[2026-09-20 Sun 12:30] =>  2:30
CLOCK: [2026-09-21 Mon 22:00]
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

test("applyTaskPatch sets and clears the :Effort: property", () => {
  const lines = ["* TODO Task"];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Task" });
  applyTaskPatch(lines, 0, task, { effort: 90 });
  assert.deepEqual(lines, ["* TODO Task", "  :PROPERTIES:", "  :Effort: 1:30", "  :END:"]);
  applyTaskPatch(lines, 0, task, { effort: null });
  assert.deepEqual(lines, ["* TODO Task"]);
});

test("applyTaskPatch keeps other properties when clearing effort", () => {
  const lines = ["* TODO Task", "  :PROPERTIES:", "  :ID: abc", "  :Effort: 20", "  :END:"];
  const task = mkTask({ raw: lines[0], state: "TODO", title: "Task" });
  applyTaskPatch(lines, 0, task, { effort: null });
  assert.deepEqual(lines, ["* TODO Task", "  :PROPERTIES:", "  :ID: abc", "  :END:"]);
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

test("buildAppendBlock writes the effort property", () => {
  const block = buildAppendBlock(
    { title: "Write report", state: "TODO", tags: [], effort: 90 },
    1,
  );
  assert.deepEqual(block, [
    "* TODO Write report",
    "  :PROPERTIES:",
    "  :Effort: 1:30",
    "  :END:",
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

test("parseQuickAdd: e<duration> sets effort", () => {
  const a = parseQuickAdd("write report e30 #work", REF);
  assert.equal(a.title, "write report");
  assert.equal(a.effort, 30);
  assert.deepEqual(a.tags, ["work"]);

  assert.equal(parseQuickAdd("review e1:30", REF).effort, 90);
  assert.equal(parseQuickAdd("review e1h30min", REF).effort, 90);
  assert.equal(parseQuickAdd("review e2d", REF).effort, 2880);
});

test("parseQuickAdd leaves non-effort e-words in the title", () => {
  const p = parseQuickAdd("email bob about e2e", REF);
  assert.equal(p.title, "email bob about e2e");
  assert.equal(p.effort, undefined);
});

test("describeParsed includes effort", () => {
  const summary = describeParsed(parseQuickAdd("write report e1:30", REF));
  assert.ok(summary.includes("effort 1:30"), summary);
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

const CTX = { isDone: false, overdue: true, today: "2026-09-21" };

test("taskMatches handles the basic token grammar", () => {
  const t = mkTask({ raw: "* TODO Pay rent", state: "TODO", title: "Pay rent", tags: ["money"], priority: "A" });
  assert.ok(taskMatches(t, ["rent"], CTX));
  assert.ok(taskMatches(t, ["#money"], CTX));
  assert.ok(taskMatches(t, ["tag:money"], CTX));
  assert.ok(taskMatches(t, ["p1"], CTX));
  assert.ok(taskMatches(t, ["priority:1"], CTX));
  assert.ok(taskMatches(t, ["is:overdue"], CTX));
  assert.ok(taskMatches(t, ["is:open"], CTX));
  assert.equal(taskMatches(t, ["#home"], CTX), false);
  assert.equal(taskMatches(t, ["p2"], CTX), false);
  assert.equal(taskMatches(t, ["is:done"], CTX), false);
  assert.equal(taskMatches(t, ["nonexistent"], CTX), false);
  assert.ok(taskMatches(t, [], CTX));
});

test("taskMatches matches tags by prefix", () => {
  const t = mkTask({
    raw: "* TODO X",
    state: "TODO",
    title: "X",
    tags: ["work", "workshop", "network"],
  });
  assert.ok(taskMatches(t, ["#work"], CTX));
  assert.ok(taskMatches(t, ["#wo"], CTX));
  assert.ok(taskMatches(t, ["tag:work"], CTX));
  assert.ok(taskMatches(t, ["#net"], CTX));
  assert.equal(taskMatches(t, ["#ork"], CTX), false); // substring is not a prefix
  assert.equal(taskMatches(t, ["!#wo"], CTX), false);
});

test("taskMatches negates any token with !", () => {
  const t = mkTask({ raw: "* TODO Pay rent", state: "TODO", title: "Pay rent", tags: ["money"], priority: "A" });
  assert.ok(taskMatches(t, ["!#devops"], CTX));
  assert.equal(taskMatches(t, ["!#money"], CTX), false);
  assert.ok(taskMatches(t, ["!p2"], CTX));
  assert.equal(taskMatches(t, ["!p1"], CTX), false);
  assert.ok(taskMatches(t, ["!is:done"], CTX));
  assert.equal(taskMatches(t, ["!is:open"], CTX), false);
  assert.equal(taskMatches(t, ["!rent"], CTX), false);
  assert.ok(taskMatches(t, ["!milk"], CTX));
});

test("taskMatches filters by state, project and file", () => {
  const t = mkTask({
    raw: "* WAIT Pay rent",
    state: "WAIT",
    title: "Pay rent",
    outline: ["Home", "Finance"],
    file: "/org/work.org",
  });
  assert.ok(taskMatches(t, ["state:wait"], CTX));
  assert.equal(taskMatches(t, ["state:todo"], CTX), false);
  assert.ok(taskMatches(t, ["project:home"], CTX));
  assert.equal(taskMatches(t, ["project:work"], CTX), false);
  assert.ok(taskMatches(t, ["file:work.org"], CTX));
  assert.equal(taskMatches(t, ["file:personal"], CTX), false);
});

test("taskMatches understands is:/has: feature predicates", () => {
  const t = mkTask({
    raw: "* TODO Pay rent",
    state: "TODO",
    title: "Pay rent",
    tags: ["money"],
    repeat: "+1w",
    clockIn: "2026-09-21 09:00",
    deadline: "2026-09-25",
    scheduled: "2026-09-22",
    body: "notes here",
    checkboxItems: [{ line: 0, checked: false, text: "x" }],
    orgId: "abc",
    effort: "1:30",
  });
  for (const q of [
    "is:repeating",
    "has:repeat",
    "has:clock",
    "is:clocked",
    "has:deadline",
    "has:scheduled",
    "has:date",
    "has:tags",
    "has:notes",
    "has:checkboxes",
    "has:id",
    "has:effort",
  ]) {
    assert.ok(taskMatches(t, [q], CTX), q);
  }
  const plain = mkTask({ raw: "* TODO X", state: "TODO", title: "X" });
  assert.equal(taskMatches(plain, ["has:repeat"], CTX), false);
  assert.ok(taskMatches(plain, ["!has:repeat"], CTX));
});

test("taskMatches buckets due: and scheduled: dates", () => {
  const overdue = mkTask({ raw: "* TODO A", state: "TODO", title: "A", deadline: "2026-09-20" });
  const today = mkTask({ raw: "* TODO B", state: "TODO", title: "B", deadline: "2026-09-21" });
  const tomorrow = mkTask({ raw: "* TODO C", state: "TODO", title: "C", deadline: "2026-09-22" });
  const week = mkTask({ raw: "* TODO D", state: "TODO", title: "D", scheduled: "2026-09-27" });
  const later = mkTask({ raw: "* TODO E", state: "TODO", title: "E", scheduled: "2026-10-10" });
  const none = mkTask({ raw: "* TODO F", state: "TODO", title: "F" });

  assert.ok(taskMatches(overdue, ["due:overdue"], CTX));
  assert.ok(taskMatches(today, ["due:today"], CTX));
  assert.ok(taskMatches(tomorrow, ["due:tomorrow"], CTX));
  assert.ok(taskMatches(week, ["scheduled:week"], CTX));
  assert.ok(taskMatches(later, ["scheduled:future"], CTX));
  assert.ok(taskMatches(none, ["due:none"], CTX));
  assert.equal(taskMatches(later, ["due:any"], CTX), false);
  assert.equal(taskMatches(week, ["due:any"], CTX), false);
  assert.ok(taskMatches(overdue, ["scheduled:none"], CTX));
});

test("tokenize keeps quoted phrases and negation", () => {
  assert.deepEqual(tokenize('is:open "pay rent" !#devops'), ["is:open", "pay rent", "!#devops"]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("  #work   p1 "), ["#work", "p1"]);
});

test("hasFreeText distinguishes filters from quick-add text", () => {
  assert.equal(hasFreeText(tokenize("!#devops is:open")), false);
  assert.equal(hasFreeText(tokenize("p1 #work")), false);
  assert.equal(hasFreeText(tokenize("buy milk")), true);
  assert.equal(hasFreeText(tokenize("buy milk #home")), true);
});

test("priorityLevel maps cookies", () => {
  assert.equal(priorityLevel("A"), 1);
  assert.equal(priorityLevel("C"), 3);
  assert.equal(priorityLevel(undefined), 4);
});
