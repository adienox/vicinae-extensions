/*
 * Integration tests for the I/O layer (src/lib/files.ts): real files in a
 * temp directory, full round-trips. Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  archiveTask,
  appendTask,
  clockIn,
  clockOut,
  createFile,
  deleteTask,
  fileExists,
  loadTasksAndTags,
  refileTask,
  removeSubtreeByRaw,
  rescheduleOverdueTasks,
  restoreTask,
  setTaskRepeater,
  setTaskState,
  toggleTaskCheckbox,
  unarchiveTask,
  updateTask,
} from "../src/lib/files";
import { parseOrg, parseKeywords, parseYmd, type Keywords, type Task } from "../src/lib/org";

const KW: Keywords = parseKeywords("TODO NEXT WAIT | DONE CANCELLED");

async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), "org-todos-test-"));
  return dir;
}

async function writeOrg(dir: string, name: string, text: string) {
  const file = path.join(dir, name);
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(file, text, "utf8");
  return file;
}

const load = async (file: string) => parseOrg(await readFile(file, "utf8"), KW, file);

function findTask(tasks: Task[], title: string): Task {
  const t = tasks.find((x) => x.title === title);
  if (!t) throw new Error(`task ${title} not found`);
  return t;
}

test("state change, reopen and undo round-trip", async () => {
  const dir = await scratch();
  const file = await writeOrg(dir, "todos.org", "* TODO Pay rent\n  body\n");
  const [task] = await load(file);

  await setTaskState(task, "DONE", KW);
  const [done] = await load(file);
  assert.equal(done.state, "DONE");
  assert.match(await readFile(file, "utf8"), /CLOSED: \[/);

  await setTaskState(done, "TODO", KW);
  const text = await readFile(file, "utf8");
  assert.equal(text, "* TODO Pay rent\n  body\n");
  await rm(dir, { recursive: true, force: true });
});

test("repeating task reschedules on completion", async () => {
  const dir = await scratch();
  const file = await writeOrg(dir, "todos.org", "* TODO Water plants\n  SCHEDULED: <2026-09-20 Sun +1w>\n");
  const [task] = await load(file);

  await setTaskState(task, "DONE", KW);
  const [next] = await load(file);
  assert.equal(next.state, "TODO"); // back to active
  assert.equal(next.scheduled, "2026-09-27");
  assert.match(await readFile(file, "utf8"), /:LAST_REPEAT:/);
  await rm(dir, { recursive: true, force: true });
});

test("updateTask preserves time and repeater; explicit time wins", async () => {
  const dir = await scratch();
  const file = await writeOrg(dir, "todos.org", "* TODO X\n  SCHEDULED: <2026-09-20 Sun 09:00 +1w>\n");
  const [task] = await load(file);

  await updateTask(task, { scheduled: parseYmd("2026-09-25") });
  assert.match(await readFile(file, "utf8"), /SCHEDULED: <2026-09-25 Fri 09:00 \+1w>/);

  const [again] = await load(file);
  await updateTask(again, { scheduled: new Date(2026, 8, 26, 14, 45) });
  assert.match(await readFile(file, "utf8"), /SCHEDULED: <2026-09-26 Sat 14:45 \+1w>/);
  await rm(dir, { recursive: true, force: true });
});

test("appendTask lands at EOF or under the matching project", async () => {
  const dir = await scratch();
  const file = await writeOrg(dir, "todos.org", "* Work :work:\n  ** TODO existing\n");

  const placed = await appendTask(file, {
    title: "Solo task",
    state: "TODO",
    tags: [],
  });
  assert.equal(placed.line, 2); // after the project's subtree

  const nested = await appendTask(file, {
    title: "Nested task",
    state: "TODO",
    tags: ["work"],
  });
  assert.equal(nested.line, 2); // end of the Work subtree, before the level-1 task
  const text = await readFile(file, "utf8");
  assert.match(text, /\*\* TODO Nested task/);

  const tasks = await load(file);
  const solo = findTask(tasks, "Solo task");
  assert.equal(solo.level, 1);
  const nestedTask = findTask(tasks, "Nested task");
  assert.equal(nestedTask.level, 2);
  assert.deepEqual(nestedTask.outline, ["Work"]);
  await rm(dir, { recursive: true, force: true });
});

test("delete and restore round-trip preserves the file", async () => {
  const dir = await scratch();
  const original = "* TODO A\n  x\n** TODO B\n  y\n* TODO C\n  z\n";
  const file = await writeOrg(dir, "todos.org", original);
  const tasks = await load(file);
  const b = findTask(tasks, "B");

  const cut = await deleteTask(b);
  const after = await readFile(file, "utf8");
  assert.ok(!after.includes("** TODO B"));

  await restoreTask(file, cut.index, cut.removed);
  assert.equal(await readFile(file, "utf8"), original);
  await rm(dir, { recursive: true, force: true });
});

test("archive moves the subtree and stamps ARCHIVE_TIME; unarchive reverses", async () => {
  const dir = await scratch();
  const source = await writeOrg(dir, "todos.org", "* TODO Task\n  body\n");
  const archive = path.join(dir, "archive.org");
  const [task] = await load(source);

  const cut = await archiveTask(task, archive);
  const srcText = await readFile(source, "utf8");
  assert.ok(!srcText.includes("* TODO Task"));
  const archText = await readFile(archive, "utf8");
  assert.match(archText, /\* TODO Task/);
  assert.match(archText, /:ARCHIVE_TIME:/);

  await unarchiveTask(source, archive, cut.index, cut.removed);
  assert.equal(await readFile(source, "utf8"), "* TODO Task\n  body\n");
  assert.ok(!(await readFile(archive, "utf8")).includes("* TODO Task"));
  await rm(dir, { recursive: true, force: true });
});

test("refile moves the subtree into another file, adjusting stars", async () => {
  const dir = await scratch();
  const src = await writeOrg(dir, "todos.org", "* TODO Migrate\n  details\n");
  const dst = await writeOrg(dir, "work.org", "* Work :work:\n  ** TODO existing\n");
  const [task] = await load(src);

  const res = await refileTask(task, dst, { raw: "* Work :work:" });
  const dstText = await readFile(dst, "utf8");
  assert.match(dstText, /\*\* TODO Migrate/); // demoted to level 2
  assert.ok(dstText.indexOf("** TODO Migrate") > dstText.indexOf("** TODO existing"));
  assert.ok(!(await readFile(src, "utf8")).includes("* TODO Migrate"));

  // undo path: out of target, back into source
  await removeSubtreeByRaw(dst, res.newRaw);
  await restoreTask(src, res.index, res.removed);
  assert.match(await readFile(src, "utf8"), /\* TODO Migrate/);
  await rm(dir, { recursive: true, force: true });
});

test("clock in and out writes org-format CLOCK entries", async () => {
  const dir = await scratch();
  const file = await writeOrg(dir, "todos.org", "* TODO Deep work\n  notes\n");
  const [task] = await load(file);

  await clockIn(task, new Date(2026, 8, 21, 22, 0));
  const [running] = await load(file);
  assert.equal(running.clockIn, "2026-09-21 22:00");
  assert.match(await readFile(file, "utf8"), /:LOGBOOK:\n  CLOCK: \[2026-09-21 Mon 22:00\]\n  :END:/);

  await clockOut(running, new Date(2026, 8, 21, 23, 30));
  const [closed] = await load(file);
  assert.equal(closed.clockIn, undefined);
  assert.equal(closed.clockedMinutes, 90);
  assert.match(await readFile(file, "utf8"), /CLOCK: \[2026-09-21 Mon 22:00\]--\[2026-09-21 Mon 23:30\] =>  1:30/);
  await rm(dir, { recursive: true, force: true });
});

test("checkbox toggle flips the item and refreshes the cookie", async () => {
  const dir = await scratch();
  const file = await writeOrg(
    dir,
    "todos.org",
    "* TODO Pack [1/3]\n- [x] books\n- [ ] shoes\n- [ ] charger\n",
  );
  const [task] = await load(file);

  await toggleTaskCheckbox(task, 1); // "shoes"
  const text = await readFile(file, "utf8");
  assert.match(text, /\* TODO Pack \[2\/3\]/);
  assert.match(text, /- \[x\] shoes/);

  const [again] = await load(file);
  await toggleTaskCheckbox(again, 1);
  const reverted = await readFile(file, "utf8");
  assert.match(reverted, /\* TODO Pack \[1\/3\]/);
  assert.match(reverted, /- \[ \] shoes/);
  await rm(dir, { recursive: true, force: true });
});

test("setTaskRepeater edits the stamp", async () => {
  const dir = await scratch();
  const file = await writeOrg(dir, "todos.org", "* TODO Task\n  SCHEDULED: <2026-09-20 Sun>\n");
  const [task] = await load(file);

  await setTaskRepeater(task, "scheduled", "++1w");
  assert.match(await readFile(file, "utf8"), /SCHEDULED: <2026-09-20 Sun \+\+1w>/);

  const [again] = await load(file);
  await setTaskRepeater(again, "scheduled", null);
  assert.match(await readFile(file, "utf8"), /SCHEDULED: <2026-09-20 Sun>\n/);
  await rm(dir, { recursive: true, force: true });
});

test("createFile, fileExists and loadTasksAndTags", async () => {
  const dir = await scratch();
  const file = path.join(dir, "todos.org");
  assert.equal(await fileExists(file), false);

  await createFile(file);
  assert.equal(await fileExists(file), true);
  assert.equal(await readFile(file, "utf8"), "");

  await appendTask(file, { title: "Tagged", state: "TODO", tags: ["alpha"] });
  const data = await loadTasksAndTags([file], KW);
  assert.equal(data.tasks.length, 1);
  assert.deepEqual(data.tags, ["alpha"]);
  await rm(dir, { recursive: true, force: true });
});

test("atomic writes leave no temp files behind", async () => {
  const dir = await scratch();
  const file = await writeOrg(dir, "todos.org", "* TODO A\n");
  const [task] = await load(file);
  await setTaskState(task, "DONE", KW);
  await updateTask(findTask(await load(file), "A"), { priority: "B" });
  const entries = await readdir(dir);
  assert.deepEqual(entries.filter((e) => !e.startsWith(".")), ["todos.org"]);
  assert.deepEqual(entries.filter((e) => e.includes(".tmp-")), []);
  await rm(dir, { recursive: true, force: true });
});

test("bulk reschedule moves only overdue scheduled tasks, undo restores", async () => {
  const dir = await scratch();
  const file = await writeOrg(
    dir,
    "todos.org",
    `* TODO Overdue one
  SCHEDULED: <2026-09-15 Tue>
* TODO Overdue two
  SCHEDULED: <2026-09-18 Fri 09:00>
* TODO Already fine
  SCHEDULED: <2026-09-25 Fri>
* TODO Deadline only
  DEADLINE: <2026-09-18 Fri>
`,
  );
  const tasks = await load(file);
  const today = "2026-09-21";
  const target = new Date(2026, 8, 21);

  const res = await rescheduleOverdueTasks(tasks, target, today);
  assert.equal(res.count, 2); // deadline-only and future-scheduled tasks untouched

  const after = await load(file);
  const one = findTask(after, "Overdue one");
  const two = findTask(after, "Overdue two");
  assert.equal(one.scheduled, "2026-09-21");
  assert.equal(two.scheduled, "2026-09-21 09:00"); // old time preserved on reschedule
  assert.equal(findTask(after, "Already fine").scheduled, "2026-09-25");
  assert.equal(findTask(after, "Deadline only").deadline, "2026-09-18"); // deadline untouched

  // undo: restore old dates through the returned entries
  for (const e of res.entries) {
    await updateTask({ ...e.task, raw: e.raw }, {
      scheduled: e.oldDate ? parseYmd(e.oldDate) : null,
    });
  }
  const restored = await load(file);
  assert.equal(findTask(restored, "Overdue one").scheduled, "2026-09-15");
  assert.equal(findTask(restored, "Overdue two").scheduled, "2026-09-18 09:00");
  await rm(dir, { recursive: true, force: true });
});
