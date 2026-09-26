/**
 * Runtime data layer.
 *
 * Nothing is bundled with the extension. Each FMHY page is downloaded from the
 * official source repository on first use, parsed, and stored in Vicinae's
 * `Cache` (an on-disk LRU cache). Afterwards:
 *
 *  - commands render instantly from the cache (stale-while-revalidate),
 *  - pages older than the configured TTL are revalidated in the background
 *    using conditional requests (`If-None-Match`), so an unchanged page costs
 *    a tiny 304 response instead of a full download,
 *  - a failed refresh never destroys data you already have.
 */
import { Cache, Toast, getPreferenceValues, showToast } from "@vicinae/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Page, type Wiki, buildHaystack, parsePage } from "./parse";

/** Same source the official https://api.fmhy.net/single-page endpoint uses. */
const RAW_BASE = "https://raw.githubusercontent.com/fmhy/edit/main/docs";
const FETCH_TIMEOUT_MS = 20_000;

/** Bump when the parser's output shape changes, to invalidate old caches. */
const CACHE_VERSION = 1;

/**
 * Wiki pages, in the order FMHY presents them. `beginners-guide` is prose
 * rather than a link directory, so it is intentionally left out.
 */
export const PAGES: ReadonlyArray<{ slug: string; title: string }> = [
  { slug: "video", title: "Video" },
  { slug: "audio", title: "Audio" },
  { slug: "gaming", title: "Gaming" },
  { slug: "reading", title: "Reading" },
  { slug: "torrenting", title: "Torrenting" },
  { slug: "downloading", title: "Downloading" },
  { slug: "educational", title: "Educational" },
  { slug: "ai", title: "Artificial Intelligence" },
  { slug: "privacy", title: "Adblock / VPN / Privacy" },
  { slug: "mobile", title: "Android / iOS" },
  { slug: "linux-macos", title: "Linux / macOS" },
  { slug: "developer-tools", title: "Developer Tools" },
  { slug: "system-tools", title: "System Tools" },
  { slug: "internet-tools", title: "Internet Tools" },
  { slug: "social-media-tools", title: "Social Media Tools" },
  { slug: "text-tools", title: "Text Tools" },
  { slug: "image-tools", title: "Image Tools" },
  { slug: "video-tools", title: "Video Tools" },
  { slug: "file-tools", title: "File Tools" },
  { slug: "gaming-tools", title: "Gaming Tools" },
  { slug: "storage", title: "Storage" },
  { slug: "non-english", title: "Non-English" },
  { slug: "misc", title: "Miscellaneous" },
  { slug: "unsafe", title: "Unsafe Sites / Software" },
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Cache({ namespace: "fmhy-wiki", capacity: 64 * 1024 * 1024 });

interface StoredPage {
  v: number;
  fetchedAt: number;
  etag?: string;
  page: Page;
}

const keyFor = (slug: string) => `page:${slug}`;

function readStored(slug: string): StoredPage | undefined {
  try {
    const raw = cache.get(keyFor(slug));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredPage;
    return parsed.v === CACHE_VERSION ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(slug: string, stored: StoredPage): void {
  // `haystack` is derived data; rebuilding it on load keeps the cache ~35% smaller.
  cache.set(
    keyFor(slug),
    JSON.stringify(stored, (k, v) => (k === "haystack" ? undefined : v)),
  );
}

function hydrate(page: Page): Page {
  for (const s of page.sections) {
    for (const e of s.entries) e.haystack = buildHaystack(e);
    for (const sub of s.subsections) {
      for (const e of sub.entries) e.haystack = buildHaystack(e);
    }
  }
  return page;
}

function assemble(pages: Page[]): Wiki {
  const entries: Wiki["entries"] = [];
  for (const page of pages) {
    for (const s of page.sections) {
      entries.push(...s.entries);
      for (const sub of s.subsections) entries.push(...sub.entries);
    }
  }
  return { pages, entries };
}

/** Everything currently in the cache, in canonical page order. Synchronous. */
export function loadCachedWiki(): Wiki | undefined {
  const pages: Page[] = [];
  for (const { slug } of PAGES) {
    const stored = readStored(slug);
    if (stored) pages.push(hydrate(stored.page));
  }
  return pages.length > 0 ? assemble(pages) : undefined;
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export function getTtlMs(): number {
  const prefs = getPreferenceValues<{ cacheHours?: string }>();
  const hours = Number(prefs.cacheHours ?? 24);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

function needsRefresh(ttlMs: number): boolean {
  const now = Date.now();
  return PAGES.some(({ slug }) => {
    const s = readStored(slug);
    return !s || now - s.fetchedAt > ttlMs;
  });
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

type PageResult = "updated" | "unchanged";

async function fetchPage(
  slug: string,
  title: string,
  stored: StoredPage | undefined,
): Promise<PageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "User-Agent": "vicinae-fmhy-extension" };
    if (stored?.etag) headers["If-None-Match"] = stored.etag;

    const res = await fetch(`${RAW_BASE}/${slug}.md`, { headers, signal: controller.signal });

    if (res.status === 304 && stored) {
      writeStored(slug, { ...stored, fetchedAt: Date.now() });
      return "unchanged";
    }
    if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);

    const markdown = await res.text();
    const page = parsePage({ slug, title, markdown });
    writeStored(slug, {
      v: CACHE_VERSION,
      fetchedAt: Date.now(),
      etag: res.headers.get("etag") ?? undefined,
      page,
    });
    return "updated";
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error(`${slug}: request timed out`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RefreshResult {
  updated: number;
  unchanged: number;
  skipped: number;
  failed: string[];
}

/**
 * Downloads any page that is missing or older than `ttlMs` (or all of them
 * with `force`). Failures are collected, never thrown, so one bad page can't
 * take the rest down with it.
 */
export async function refreshPages(opts: { ttlMs: number; force?: boolean }): Promise<RefreshResult> {
  const now = Date.now();
  const result: RefreshResult = { updated: 0, unchanged: 0, skipped: 0, failed: [] };

  const settled = await Promise.allSettled(
    PAGES.map(async ({ slug, title }) => {
      const stored = readStored(slug);
      const fresh = stored && now - stored.fetchedAt <= opts.ttlMs;
      if (fresh && !opts.force) return "skipped" as const;
      return fetchPage(slug, title, stored);
    }),
  );

  for (const r of settled) {
    if (r.status === "fulfilled") result[r.value]++;
    else result.failed.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  return result;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseWiki {
  wiki: Wiki | undefined;
  isLoading: boolean;
  /** Set only when there is nothing to show at all. */
  error: string | undefined;
  reload: () => Promise<void>;
}

export function useWiki(): UseWiki {
  const [wiki, setWiki] = useState<Wiki | undefined>(() => loadCachedWiki());
  const [isLoading, setIsLoading] = useState<boolean>(() => needsRefresh(getTtlMs()));
  const [error, setError] = useState<string>();
  const alive = useRef(true);
  const hadData = useRef(wiki !== undefined);

  const run = useCallback(async (force: boolean) => {
    setIsLoading(true);
    const result = await refreshPages({ ttlMs: getTtlMs(), force });
    if (!alive.current) return;

    if (result.updated > 0 || !hadData.current) {
      const next = loadCachedWiki();
      if (next) {
        setWiki(next);
        hadData.current = true;
      }
    }

    if (result.failed.length > 0) {
      if (hadData.current) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Couldn't refresh FMHY data",
          message: "Showing the cached copy instead.",
        });
      } else {
        setError(result.failed[0] ?? "Network error");
      }
    } else {
      setError(undefined);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    if (needsRefresh(getTtlMs())) void run(false);
    else setIsLoading(false);
    return () => {
      alive.current = false;
    };
  }, [run]);

  const reload = useCallback(() => run(true), [run]);
  return { wiki, isLoading, error, reload };
}
