/**
 * Pure (Vicinae-independent) types and markdown parsing for the FMHY wiki.
 *
 * The wiki is a set of markdown files with a very regular shape:
 *
 *   # ► Section
 *   ## ▷ Subsection
 *   * ⭐ **[Name](url)**, [2](mirror) / [GitHub](url) - Description / [Note](url)
 *
 * Markers: ⭐ community recommendation, 🌐 third-party index, ↪️ link to another section.
 */

export type EntryKind = "starred" | "index" | "redirect" | "normal" | "unsafe";

export interface Link {
  label: string;
  url: string;
}

export interface Entry {
  /** Stable-ish id within a dataset (page/section/subsection/entry indices). */
  id: string;
  title: string;
  description: string;
  kind: EntryKind;
  /** Primary URL. Undefined for entries with no link (e.g. the "unsafe" list). */
  url?: string;
  /** Every link on the line except the primary one. */
  links: Link[];
  pageSlug: string;
  pageTitle: string;
  section: string;
  subsection?: string;
  /** Lowercased blob used by search. */
  haystack: string;
}

export interface Subsection {
  title: string;
  /** Set when the heading itself is a link (e.g. a pointer to another page). */
  url?: string;
  entries: Entry[];
}

export interface Section {
  title: string;
  url?: string;
  /** Link on fmhy.net for this section. */
  webUrl: string;
  /** Entries that appear before the first subsection heading. */
  entries: Entry[];
  subsections: Subsection[];
  count: number;
}

export interface Page {
  slug: string;
  title: string;
  webUrl: string;
  sections: Section[];
  count: number;
}

export interface Wiki {
  pages: Page[];
  entries: Entry[];
}

export interface PageSource {
  slug: string;
  title: string;
  markdown: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const SITE = "https://fmhy.net";

/** Zero-width / word-joiner characters that litter the wiki source. */
const INVISIBLE = /[\u2060\u200b\u200c\u200d\ufeff]/g;

/** `[label](url)` where the url may contain one level of balanced parentheses. */
const LINK_SOURCE = String.raw`\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()]*\))+)\s*\)`;

/** Same slug algorithm VitePress uses for heading anchors on fmhy.net. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

/**
 * Reddit wiki page name -> fmhy.net page path. The wiki source still links
 * to the (now dead-ish) subreddit wiki, so we point people at the real site.
 */
const REDDIT_PAGE_MAP: Record<string, string> = {
  "adblock-vpn-privacy": "privacy",
  ai: "ai",
  android: "mobile",
  audio: "audio",
  download: "downloading",
  "dev-tools": "developer-tools",
  edu: "educational",
  "file-tools": "file-tools",
  "game-tools": "gaming-tools",
  games: "gaming",
  "image-tools": "image-tools",
  "internet-tools": "internet-tools",
  linux: "linux-macos",
  misc: "misc",
  "non-eng": "non-english",
  reading: "reading",
  "social-media": "social-media-tools",
  storage: "storage",
  "system-tools": "system-tools",
  "text-tools": "text-tools",
  torrent: "torrenting",
  "video-tools": "video-tools",
  video: "video",
};

const REDDIT_RE =
  /^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/FREEMEDIAHECKYEAH\/wiki\/([^/#?]+)\/?(?:#(.*))?$/i;

/** Rewrites FMHY subreddit-wiki links to their fmhy.net equivalent. */
export function normalizeUrl(url: string): string {
  const m = url.match(REDDIT_RE);
  if (!m) return url;
  const page = (m[1] ?? "").toLowerCase();
  if (page === "index" || page === "tools-index") return `${SITE}/`;
  const target = REDDIT_PAGE_MAP[page];
  if (!target) return url;
  const fragment = m[2];
  if (!fragment) return `${SITE}/${target}`;
  // Reddit anchors: `wiki_.25BA_spotify_tools`, `.25B7` = ▷, `.2F` = "/".
  const heading = fragment
    .replace(/^wiki_/, "")
    .replace(/\.25(?:BA|B7)_?/g, "")
    .replace(/\.([0-9A-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/_/g, " ");
  const slug = slugify(heading);
  return slug ? `${SITE}/${target}#${slug}` : `${SITE}/${target}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Strips the simple inline markdown the wiki uses (bold, code, stray escapes). */
function plain(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/(^|\s)\*(?=\S)|(?<=\S)\*(\s|$)/g, "$1$2")
    .replace(/`/g, "")
    .replace(/\\([*_[\]()])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Index of the first " - " that is outside any [] / () nesting, or -1. */
function findDescriptionSplit(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === " " && s.startsWith(" - ", i)) return i;
  }
  return -1;
}

function isMirrorLabel(label: string): boolean {
  return /^\d+$/.test(label.trim());
}

function collectLinks(text: string): Array<{ label: string; url: string; start: number; end: number }> {
  const re = new RegExp(LINK_SOURCE, "g");
  const out: Array<{ label: string; url: string; start: number; end: number }> = [];
  for (const m of text.matchAll(re)) {
    out.push({
      label: plain(m[1] ?? ""),
      url: m[2] ?? "",
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry parsing
// ---------------------------------------------------------------------------

interface ParsedLine {
  title: string;
  description: string;
  kind: EntryKind;
  url?: string;
  links: Link[];
}

const NOTE_RE = /^\*\*(?:Note|Warning|Important|Tip)\*\*/i;

export function parseEntryLine(raw: string, unsafePage = false): ParsedLine | null {
  let s = raw.replace(/^\*\s+/, "").replace(INVISIBLE, "").trim();
  if (!s || NOTE_RE.test(s)) return null;

  let kind: EntryKind = "normal";
  const marker = s.match(/^(⭐|🌐|↪️?)\s*/u);
  if (marker) {
    kind = marker[1] === "⭐" ? "starred" : marker[1] === "🌐" ? "index" : "redirect";
    s = s.slice(marker[0].length);
  }

  // <https://x> autolinks and bare leading URLs -> normal markdown links.
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u: string) => `[${hostOf(u)}](${u})`);
  s = s.replace(/^(https?:\/\/\S+)/, (_, u: string) => `[${hostOf(u)}](${u})`);

  const split = findDescriptionSplit(s);
  const lhs = split === -1 ? s : s.slice(0, split);
  const rhs = split === -1 ? "" : s.slice(split + 3);

  // Left-hand links are either "main" links (alternatives that share this
  // entry, e.g. `A, B or C`), or extras (` / GitHub`, ` / Discord`, mirrors).
  const lhsLinks = collectLinks(lhs);
  const main: Link[] = [];
  const extras: Link[] = [];
  lhsLinks.forEach((l, i) => {
    const link: Link = { label: l.label, url: normalizeUrl(l.url) };
    if (i === 0) {
      (isMirrorLabel(l.label) ? extras : main).push(
        isMirrorLabel(l.label) ? { ...link, label: `Mirror ${l.label}` } : link,
      );
      return;
    }
    const prev = lhsLinks[i - 1];
    const sep = lhs.slice(prev ? prev.end : 0, l.start).replace(/[\s*]+$/, "");
    if (isMirrorLabel(l.label)) {
      extras.push({ ...link, label: `Mirror ${l.label}` });
    } else if (/,$/.test(sep) || /(^|\s)or$/.test(sep)) {
      main.push(link);
    } else {
      extras.push(link);
    }
  });

  for (const l of collectLinks(rhs)) {
    extras.push({
      label: isMirrorLabel(l.label) ? `Mirror ${l.label}` : l.label,
      url: normalizeUrl(l.url),
    });
  }

  // Title
  let title: string;
  const mainNames = [...new Set(main.map((l) => l.label).filter(Boolean))];
  if (mainNames.length > 0) {
    title =
      mainNames.length > 3
        ? `${mainNames.slice(0, 3).join(", ")} +${mainNames.length - 3}`
        : mainNames.join(", ");
  } else {
    title = plain(lhs.replace(new RegExp(LINK_SOURCE, "g"), "$1"));
  }
  if (!title) title = hostOf(main[0]?.url ?? extras[0]?.url ?? "") || "Untitled";

  // Description: rhs minus links, tidied up.
  const description = plain(rhs.replace(new RegExp(LINK_SOURCE, "g"), ""))
    .replace(/(\s*\/\s*){2,}/g, " / ")
    .replace(/^[\s/,]+|[\s/,]+$/g, "")
    .trim();

  const [primary, ...restMain] = main;
  const url = primary?.url ?? extras[0]?.url;
  const links = [...restMain, ...(primary ? extras : extras.slice(1))];

  return {
    title,
    description,
    kind: unsafePage && !url ? "unsafe" : kind,
    url,
    links: dedupe(links, url),
  };
}

function dedupe(links: Link[], primary?: string): Link[] {
  const seen = new Set<string>(primary ? [primary] : []);
  return links.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Heading parsing
// ---------------------------------------------------------------------------

function parseHeading(text: string): { title: string; url?: string } {
  const stripped = text.replace(INVISIBLE, "").replace(/^[►▷]\s*/, "").trim();
  const link = stripped.match(new RegExp(`^${LINK_SOURCE}$`));
  if (link) return { title: plain(link[1] ?? ""), url: normalizeUrl(link[2] ?? "") };
  return { title: plain(stripped.replace(new RegExp(LINK_SOURCE, "g"), "$1")) };
}

// ---------------------------------------------------------------------------
// Whole-wiki parsing
// ---------------------------------------------------------------------------

export function parsePage(src: PageSource): Page {
  const sections: Section[] = [];
  const unsafePage = src.slug === "unsafe";

  let section: Section | undefined;
  let subsection: Subsection | undefined;

  const startSection = (title: string, url?: string) => {
    section = {
      title,
      url,
      webUrl: `${SITE}/${src.slug}#${slugify(title)}`,
      entries: [],
      subsections: [],
      count: 0,
    };
    subsection = undefined;
    sections.push(section);
  };

  for (const line of src.markdown.split("\n")) {
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (heading) {
      const { title, url } = parseHeading(heading[2] ?? "");
      if (!title) continue;
      if (heading[1] === "#") {
        startSection(title, url);
      } else {
        if (!section) startSection(src.title);
        subsection = { title, url, entries: [] };
        section!.subsections.push(subsection);
      }
      continue;
    }

    if (!line.startsWith("* ")) continue;
    const parsed = parseEntryLine(line, unsafePage);
    if (!parsed) continue;
    if (!section) startSection(src.title);

    const sec = section!;
    const target = subsection ? subsection.entries : sec.entries;
    const entry: Entry = {
      ...parsed,
      id: `${src.slug}:${sections.length - 1}:${sec.subsections.length}:${target.length}`,
      pageSlug: src.slug,
      pageTitle: src.title,
      section: sec.title,
      subsection: subsection?.title,
      haystack: "",
    };
    entry.haystack = buildHaystack(entry);
    target.push(entry);
    sec.count++;
  }

  return {
    slug: src.slug,
    title: src.title,
    webUrl: `${SITE}/${src.slug}`,
    sections,
    count: sections.reduce((n, s) => n + s.count, 0),
  };
}

export function buildHaystack(e: Entry): string {
  const hosts = [e.url, ...e.links.map((l) => l.url)]
    .filter((u): u is string => !!u)
    .map(hostOf);
  return [
    e.title,
    e.description,
    ...e.links.map((l) => l.label),
    ...hosts,
    e.section,
    e.subsection ?? "",
    e.pageTitle,
  ]
    .join(" \u0001 ")
    .toLowerCase();
}

export function parseWiki(sources: PageSource[]): Wiki {
  const pages = sources.map(parsePage).filter((p) => p.count > 0 || p.sections.length > 0);
  const entries: Entry[] = [];
  for (const page of pages) {
    for (const s of page.sections) {
      entries.push(...s.entries);
      for (const sub of s.subsections) entries.push(...sub.entries);
    }
  }
  return { pages, entries };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchFilter {
  /** "all" | "starred" | "index" | `page:<slug>` */
  scope: string;
}

/**
 * Tiny ranked search. Every whitespace-separated token must appear somewhere
 * in the entry; matches in the title rank highest.
 */
export function searchEntries(
  entries: Entry[],
  query: string,
  filter: SearchFilter,
  limit = 60,
): Entry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: Array<{ e: Entry; score: number }> = [];
  for (const e of entries) {
    if (filter.scope === "starred" && e.kind !== "starred") continue;
    if (filter.scope === "index" && e.kind !== "index") continue;
    if (filter.scope.startsWith("page:") && e.pageSlug !== filter.scope.slice(5)) continue;

    let score = 0;
    const title = e.title.toLowerCase();
    let ok = true;
    for (const t of tokens) {
      if (!e.haystack.includes(t)) {
        ok = false;
        break;
      }
      if (title === t) score += 100;
      else if (title.startsWith(t)) score += 60;
      else if (title.includes(t)) score += 40;
      else if (e.description.toLowerCase().includes(t)) score += 15;
      else score += 5;
    }
    if (!ok) continue;
    if (e.kind === "starred") score += 8;
    if (e.kind === "redirect") score -= 30;
    scored.push({ e, score });
  }

  scored.sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title));
  return scored.slice(0, limit).map((s) => s.e);
}
