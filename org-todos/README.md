# Org Todos (Vicinae extension)

Browse, complete, edit and create tasks in Org-mode files — with an agenda,
refiling, clocking, checkboxes and natural-language dates.

## Install

```sh
npm install
npm run build   # installs into ~/.local/share/vicinae/extensions/org-todos
```

## Commands

- **Todos** – the task list.
- **Agenda** – day-by-day view across all files: Overdue, Today, Tomorrow, the
  next seven days, Later, and Unscheduled. Tasks closed today trail the Today
  section.
- **New Todo** – form with title, state, priority, tags, dates, repeater, notes
  and target file. The title understands the quick-add syntax below and shows a
  live preview; explicit fields win over the title. `ctrl+enter` creates and
  keeps the form open.
- **Quick Add Todo** – one-liner, e.g. `call supplier tomorrow p1 #work`.
- **Capture from Clipboard** – first clipboard line becomes the title
  (quick-add syntax applies), the rest becomes the body.

## Quick-add syntax

Works in Quick Add Todo and in the Todos search bar (type, and when nothing
matches press Enter; `ctrl+enter` creates even when there are matches).

| Input | Result |
| --- | --- |
| `p1` `p2` `p3` (or `!1`…) | priority `[#A]` `[#B]` `[#C]`; `p4` = none |
| `#tag` | tag |
| a date phrase (`tomorrow`, `fri`, `sep 30`, `9/30`, `in 3 days`, `2026-09-30`, …) | `SCHEDULED` |
| `by …` / `due …` / `deadline …` before a date | `DEADLINE` |
| `on …` before a date | `SCHEDULED` (anywhere in the sentence) |
| `tomorrow 9am` | `SCHEDULED` with a time |

Dates are parsed with [chrono-node](https://github.com/wanasit/chrono). In
running text, bare month or time mentions are ignored so titles like
"march the boxes" or "meet at 5" stay intact; in the date fields they are
accepted. `next friday` follows chrono's reading (friday of next week).

### Where tasks land

New tasks are appended to the primary file — unless they carry a tag that
matches a top-level project in that file, in which case they are inserted as
the last child of the matching project.

## Dates, in plain language

Every date field (schedule/deadline submenus, Edit Task, New Todo) accepts
natural language with a live preview: `today`, `tomorrow`, `fri`,
`next week`, `in 3 days`, `sep 30`, `9/30`, `2026-09-30`, `tomorrow 9am`…
plus org-native offsets and shortcuts: `+3d`, `+2w`, `+1m`, `eod`, `eow`,
`eom`. Presets (Today / Tomorrow / Next Monday) are available in the
pick-date forms. Rescheduling keeps any time, repeater and warning period
already on the stamp unless you type an explicit time.

## Morning triage

When tasks have overdue scheduled dates, the Todos list and the Agenda offer
"Reschedule overdue (N)": push them all to Today, Tomorrow, or Next Monday in
one undoable batch. Deadlines are deliberately left alone — they are
commitments, not intentions.

## Deadline warnings

Org warning periods on deadlines (`DEADLINE: <… -3d>`) are honoured: while a
deadline is inside its warning window it shows an orange "due in Nd" chip in
the Agenda, the date turns orange in the Todos list, and the detail view
explains the warning period.

## Task actions (list and agenda)

- **State** – every configured TODO state is a top-level action in the action
  panel (ctrl+b); Enter marks done / reopens.
- **Refile…** – move the subtree to another file, as a top-level entry or
  under any project (stars are adjusted). Undoable.
- **Clock In / Clock Out** – writes org-format `CLOCK:` entries into the
  task's `:LOGBOOK:`; only one clock runs at a time (clocking in elsewhere
  clocks the previous task out). Accumulated time shows in the detail view.
- **Checkboxes** – `- [ ]` items in the body get a toggle submenu and a
  `x/y` accessory; `[d/t]` and `[d%]` statistics cookies in the headline are
  updated automatically.
- **Tags** – a submenu built from every tag used in your files; one click
  adds or removes.
- **Copy Org Link** – copies `[[id:…][title]]` for tasks with a `:ID:`
  property.
- **Priority, schedule, deadline** – `ctrl+1…4`, submenus with presets and a
  natural-language picker.
- **Edit Task** – title, state, priority, tags, dates, repeater and the
  notes/body.
- **Archive / Delete** – `ctrl+shift+a` moves the subtree to the archive file
  (with `:ARCHIVE_TIME:`), `ctrl+x` deletes it. Both undoable.
- **Undo** – `ctrl+z`, the last 10 changes (state, priority, dates, tags,
  edits, deletes, archives, refiles, creates).

## Repeating tasks

Completing a task with a repeater (`+1w`, `++1w`, `.+1w`) returns it to the
first active state, shifts the date, and records `:LAST_REPEAT:`, like Org.
Repeaters can be added or changed in Edit Task (`+1w`, `++1w`, `.+1d`; the
`/n` skip form is preserved on existing stamps but shifts use the base
interval).

## Search

Free text matches title, state, tags, outline and priority. Tokens:
`#work` filters by tag, `p1`…`p4` by priority, `is:done`, `is:open`,
`is:overdue` by state.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Enter | Mark done / reopen (repeating tasks reschedule instead) |
| ctrl+n | New task |
| ctrl+e | Edit task |
| ctrl+1…4 | Set priority 1–4 (4 clears it) |
| ctrl+s / ctrl+shift+d | Schedule / deadline submenu |
| ctrl+x | Delete task (subtree) |
| ctrl+shift+a | Archive task |
| ctrl+z | Undo |
| ctrl+g | Cycle grouping: Priority → Date → Project → Flat |
| ctrl+d | Toggle details (Todos) |
| ctrl+o | Open in editor |
| ctrl+r | Reload |

Filter and grouping live in the dropdown next to the search bar and are
remembered between launches.

## Preferences

- **Todos File** – main file; new tasks are written here.
- **Additional Files** – comma-separated `.org` files or directories.
- **TODO Keywords** – same format as `#+TODO:`. A `#+TODO:` directive inside
  a file overrides this preference for that file, like Org does.
- **Archive File** – target for Archive Task (created on first use).
- **Editor Command** – `{file}` and `{line}` are substituted.

## Development

```sh
npm test          # pure-logic + file I/O test suites (tests/)
npm run typecheck # tsc --noEmit
```
