# Org Todos (Vicinae extension)

Browse, complete, edit and create tasks in Org-mode files — with refiling,
clocking, checkboxes and natural-language dates.

## Install

```sh
npm install
npm run build   # installs into ~/.local/share/vicinae/extensions/org-todos
```

## Commands

- **Todos** – the task list.
- **New Todo** – form with title, state, priority, tags, dates, repeater, effort, notes
  and target file. The title understands the quick-add syntax below and shows a
  live preview; explicit fields win over the title. `ctrl+enter` creates and
  keeps the form open.
- **Quick Add Todo** – one-liner, e.g. `call supplier tomorrow p1 #work`.
  Can also be set as a Vicinae **fallback command**: the root search text is
  used as the task when the command is invoked without an argument.
- **Capture from Clipboard** – first clipboard line becomes the title
  (quick-add syntax applies), the rest becomes the body.

## Quick-add syntax

Works in Quick Add Todo and in the Todos search bar (type, and when nothing
matches press Enter; `ctrl+enter` creates even when there are matches).

| Input | Result |
| --- | --- |
| `p1` `p2` `p3` (or `!1`…) | priority `[#A]` `[#B]` `[#C]`; `p4` = none |
| `#tag` | tag |
| `e30` / `e1:30` / `e1h30min` | `:Effort:` property (30 min / 1 h 30 min) |
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

When tasks have overdue scheduled dates, the Todos list offers
"Reschedule overdue (N)": push them all to Today, Tomorrow, or Next Monday in
one undoable batch. Deadlines are deliberately left alone — they are
commitments, not intentions.

## Deadline warnings

Org warning periods on deadlines (`DEADLINE: <… -3d>`) are honoured: while a
deadline is inside its warning window the date turns orange in the Todos list
and the detail view explains the warning period.

## Task actions

- **State** – every configured TODO state is a top-level action in the action
  panel (ctrl+b); Enter marks done / reopens.
- **Refile…** – move the subtree to another file, as a top-level entry or
  under any project (stars are adjusted). Undoable.
- **Clock In / Clock Out** – drives a running Emacs server through
  `emacsclient` so `org-clock` stays authoritative: the task is located by
  position (falling back to its exact headline) and `org-clock-in` /
  `org-clock-out` run there, saving the buffer. Only one clock runs at a time
  (clocking in elsewhere clocks the previous task out). If no Emacs server is
  reachable, the extension falls back to writing org-format `CLOCK:` entries
  into the task's `:LOGBOOK:` directly. Accumulated time shows in the detail
  view.
- **Subtasks** – `- [ ]` items in the body show an `x/y` accessory. Pressing
  Enter on such a task opens it in Emacs (where you tick them off); tasks
  without subtasks keep Enter for mark done / reopen.
- **Tags** – a submenu built from every tag used in your files; one click
  adds or removes.
- **Copy Org Link** – copies `[[id:…][title]]` for tasks with a `:ID:`
  property.
- **Priority, schedule, deadline** – `ctrl+1…4`, submenus with presets and a
  natural-language picker.
- **Effort** – `ctrl+shift+e`, a submenu of presets plus a picker. Stored as
  the Org `:Effort:` property; accepts minutes (`30`), `H:MM` (`1:30`) and Org
  durations (`1h 30min`, `2d`). Clearing removes the property.
- **Edit Task** – title, state, priority, tags, dates, repeater, effort and the
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

Tokens are separated by spaces; wrap multi-word phrases in quotes. Prefix any
token with `!` to **exclude** matches. Free text matches title, state, tags,
outline and priority.

| Token | Matches |
| --- | --- |
| `#work` or `tag:work` | tags starting with `work` |
| `!#devops` | tasks **without** the `devops` tag |
| `p1`…`p4` / `priority:2` | priority level (4 = none) |
| `state:WAIT` | exact TODO state |
| `project:home` | any parent headline containing “home” |
| `file:work` | tasks whose file path contains “work” |
| `is:open` / `is:done` / `is:overdue` | status |
| `is:repeating` / `has:repeat` | has a repeater |
| `has:clock` / `has:deadline` / `has:scheduled` | clock / planning stamps |
| `has:tags` / `has:notes` / `has:checkboxes` / `has:id` / `has:effort` | body / property features |
| `due:overdue` `due:today` `due:tomorrow` `due:week` `due:future` `due:none` | deadline bucket |
| `scheduled:today` … | scheduled bucket |
| `"pay rent"` | free-text phrase |

Examples: `is:open !#someday due:week`, `p1 project:work !is:clocked`.
The **Search Syntax** action (`ctrl+/`) in the Todos command shows this cheat
sheet, and a query that is only filters (no free text) won't offer to create a
task.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Enter | Tasks with `- [ ]` subtasks: open in Emacs; otherwise mark done / reopen |
| ctrl+o | Open in editor |
| ctrl+n | New task |
| ctrl+e | Edit task |
| ctrl+1…4 | Set priority 1–4 (4 clears it) |
| ctrl+s / ctrl+shift+d | Schedule / deadline submenu |
| ctrl+x | Delete task (subtree) |
| ctrl+shift+a | Archive task |
| ctrl+shift+c | Clock in / out (toggle) |
| ctrl+shift+e | Effort submenu |
| ctrl+z | Undo |
| ctrl+g | Cycle grouping: Priority → Date → Project → Flat |
| ctrl+/ | Search syntax help (Todos) |
| ctrl+d | Toggle details (Todos) |
| ctrl+r | Reload |

Filter and grouping live in the dropdown next to the search bar and are
remembered between launches.

## Preferences

- **Todos File** – main file; new tasks are written here.
- **Additional Files** – comma-separated `.org` files or directories.
- **TODO Keywords** – same format as `#+TODO:`. A `#+TODO:` directive inside
  a file overrides this preference for that file, like Org does.
- **Archive File** – target for Archive Task (created on first use).
- **Clocking** – use Emacs (`emacsclient`) for Clock In/Out; uncheck to always
  edit the file directly.
- **Emacs Client** – command used to reach Emacs (extra arguments allowed,
  e.g. `emacsclient -s /run/user/1000/emacs/server`).
- **Editor Command** – `{file}` and `{line}` are substituted.

## Development

```sh
npm test          # pure-logic + file I/O test suites (tests/)
npm run typecheck # tsc --noEmit
```
