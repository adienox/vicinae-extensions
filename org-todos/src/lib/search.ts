import { parseYmd, ymd, type Task } from "./org";

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
  /** Today as YYYY-MM-DD; used by `due:`/`scheduled:` buckets. */
  today: string;
}

type TokenKind =
  | "tag"
  | "priority"
  | "state"
  | "project"
  | "file"
  | "is"
  | "has"
  | "due"
  | "scheduled"
  | "text";

interface Token {
  negated: boolean;
  kind: TokenKind;
  value: string;
}

const PRIORITY_WORDS: Record<string, string> = { a: "1", b: "2", c: "3", none: "4", no: "4" };

/** Turn one raw token into its operator form. `!` negates any token. */
function parseToken(raw: string): Token {
  let s = raw;
  let negated = false;
  if (s.startsWith("!") && s.length > 1) {
    negated = true;
    s = s.slice(1);
  }
  if (s.startsWith("#") && s.length > 1) return { negated, kind: "tag", value: s.slice(1) };
  if (/^p[1-4]$/.test(s)) return { negated, kind: "priority", value: s[1] };

  const m = /^([a-z]+):(.+)$/.exec(s);
  if (m) {
    const [, key, value] = m;
    switch (key) {
      case "tag":
        return { negated, kind: "tag", value };
      case "priority": {
        const lvl = /^[1-4]$/.test(value) ? value : PRIORITY_WORDS[value];
        return lvl ? { negated, kind: "priority", value: lvl } : { negated, kind: "text", value: s };
      }
      case "state":
        return { negated, kind: "state", value };
      case "project":
        return { negated, kind: "project", value };
      case "file":
        return { negated, kind: "file", value };
      case "is":
        return { negated, kind: "is", value };
      case "has":
        return { negated, kind: "has", value };
      case "due":
        return { negated, kind: "due", value };
      case "scheduled":
      case "sched":
        return { negated, kind: "scheduled", value };
      default:
        break;
    }
  }
  return { negated, kind: "text", value: s };
}

/** Feature checks shared by `is:` and `has:`. */
function featurePredicate(t: Task, value: string): boolean | undefined {
  switch (value) {
    case "repeat":
    case "repeating":
    case "repeater":
      return !!t.repeat;
    case "clock":
    case "clocked":
    case "clockin":
      return !!t.clockIn;
    case "deadline":
      return !!t.deadline;
    case "scheduled":
      return !!t.scheduled;
    case "date":
    case "dated":
      return !!(t.deadline || t.scheduled);
    case "tag":
    case "tags":
    case "tagged":
      return t.tags.length > 0;
    case "note":
    case "notes":
    case "noted":
      return !!t.body.trim();
    case "checkbox":
    case "checkboxes":
      return !!t.checkboxItems?.length;
    case "id":
    case "orgid":
      return !!t.orgId;
    case "effort":
      return !!t.effort;
    default:
      return undefined;
  }
}

function isPredicate(t: Task, value: string, ctx: MatchContext): boolean {
  switch (value) {
    case "open":
    case "active":
      return !ctx.isDone;
    case "done":
    case "closed":
      return ctx.isDone;
    case "overdue":
      return ctx.overdue;
    default:
      return featurePredicate(t, value) ?? false;
  }
}

const addDays = (day: string, n: number): string => {
  const d = parseYmd(day);
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

/** Compare a planning stamp against a named date bucket. */
function bucketMatch(stamp: string | undefined, bucket: string, today: string): boolean {
  const day = stamp?.slice(0, 10);
  switch (bucket) {
    case "none":
    case "no":
    case "empty":
      return !day;
    case "any":
    case "some":
    case "yes":
      return !!day;
    case "overdue":
    case "past":
    case "before":
      return !!day && day < today;
    case "today":
      return day === today;
    case "tomorrow":
      return day === addDays(today, 1);
    case "week":
    case "soon":
      return !!day && day >= today && day <= addDays(today, 7);
    case "future":
    case "upcoming":
      return !!day && day > today;
    default:
      return false;
  }
}

function tokenMatches(t: Task, tok: Token, ctx: MatchContext): boolean {
  let hit: boolean;
  switch (tok.kind) {
    case "tag":
      hit = t.tags.some((x) => x.toLowerCase().startsWith(tok.value));
      break;
    case "priority":
      hit = String(priorityLevel(t.priority)) === tok.value;
      break;
    case "state":
      hit = t.state.toLowerCase() === tok.value;
      break;
    case "project":
      hit = t.outline.some((o) => o.toLowerCase().includes(tok.value));
      break;
    case "file":
      hit = t.file.toLowerCase().includes(tok.value);
      break;
    case "due":
      hit = bucketMatch(t.deadline, tok.value, ctx.today);
      break;
    case "scheduled":
      hit = bucketMatch(t.scheduled, tok.value, ctx.today);
      break;
    case "is":
      hit = isPredicate(t, tok.value, ctx);
      break;
    case "has":
      hit = featurePredicate(t, tok.value) ?? false;
      break;
    default:
      hit = searchHay(t).includes(tok.value);
  }
  return tok.negated ? !hit : hit;
}

/**
 * Search grammar (tokens are whitespace-separated; `"quoted phrases"` work):
 *
 *   `#work` / `tag:work`        tag starts with the text (prefix)
 *   `p1`…`p4` / `priority:1`    priority level (4 = none)
 *   `state:WAIT`                exact state
 *   `project:home`              any parent headline contains the text
 *   `file:work`                 file path contains the text
 *   `is:open|done|overdue`      status
 *   `is:repeating` / `has:repeat` (also clock, deadline, scheduled, date,
 *                               tags, notes, checkboxes, id)
 *   `due:overdue|today|tomorrow|week|future|none|any`
 *   `scheduled:…`               same buckets, against SCHEDULED
 *   anything else               free text across title, state, tags, outline
 *
 * Any token may be negated with a leading `!`, e.g. `!#devops`, `!p1`,
 * `!is:done`, `!rent`.
 */
export function taskMatches(t: Task, tokens: string[], ctx: MatchContext): boolean {
  for (const raw of tokens) {
    if (!tokenMatches(t, parseToken(raw), ctx)) return false;
  }
  return true;
}

const TOKEN_RE = /!?"[^"]*"|!?'[^']*'|\S+/g;

/** Split a query into lowercase tokens, keeping `"quoted phrases"` together. */
export function tokenize(search: string): string[] {
  const out: string[] = [];
  for (const m of search.matchAll(TOKEN_RE)) {
    let tok = m[0];
    let neg = "";
    if (tok.startsWith("!") && tok.length > 1) {
      neg = "!";
      tok = tok.slice(1);
    }
    if (
      tok.length >= 2 &&
      ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'")))
    ) {
      tok = tok.slice(1, -1);
    }
    tok = tok.trim();
    if (tok) out.push((neg + tok).toLowerCase());
  }
  return out;
}

/**
 * Whether a query still contains free text (as opposed to only filter
 * operators). Used to decide if the search bar should offer quick-add.
 */
export function hasFreeText(tokens: string[]): boolean {
  return tokens.some((raw) => {
    const t = parseToken(raw);
    return t.kind === "text" && !t.negated;
  });
}

export const SEARCH_PLACEHOLDER = "Search…";

export const SEARCH_HELP_MD = `# Search syntax

Tokens are separated by spaces; wrap multi-word phrases in quotes.
Prefix any token with \`!\` to **exclude** matches.

| Token | Matches |
| --- | --- |
| \`#work\` or \`tag:work\` | tags starting with \`work\` |
| \`!#devops\` | tasks **without** the \`devops\` tag |
| \`p1\`…\`p4\` / \`priority:2\` | priority level (4 = none) |
| \`state:WAIT\` | exact TODO state |
| \`project:home\` | any parent headline containing “home” |
| \`file:work\` | tasks whose file path contains “work” |
| \`is:open\` / \`is:done\` / \`is:overdue\` | status |
| \`is:repeating\` / \`has:repeat\` | has a repeater |
| \`has:clock\` / \`has:deadline\` / \`has:scheduled\` | planning/clock features |
| \`has:tags\` / \`has:notes\` / \`has:checkboxes\` / \`has:id\` / \`has:effort\` | body/property features |
| \`due:overdue\` \`due:today\` \`due:tomorrow\` \`due:week\` \`due:future\` \`due:none\` | deadline bucket |
| \`scheduled:today\` … | scheduled bucket |
| \`"pay rent"\` | free text phrase in title/state/tags/outline |

Examples: \`is:open !#someday due:week\`, \`p1 project:work !is:clocked\`.
`;
