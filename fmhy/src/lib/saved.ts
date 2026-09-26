/**
 * Favorites and recents.
 *
 * These live in LocalStorage (never evicted, unlike Cache) as small snapshots
 * of the link, so they keep working even if the wiki data is missing or the
 * entry later moves or disappears upstream.
 */
import { LocalStorage } from "@vicinae/api";
import { useCallback, useEffect, useState } from "react";
import { type Entry, type EntryKind, type Link, SITE, slugify } from "./parse";

const FAVORITES_KEY = "favorites.v1";
const RECENTS_KEY = "recents.v1";
const MAX_RECENTS = 30;

/** The subset of an entry that the UI (and storage) needs. */
export interface LinkItem {
  /** Identity: the primary URL, or a synthetic key for URL-less entries. */
  key: string;
  title: string;
  description: string;
  kind: EntryKind;
  url?: string;
  links: Link[];
  /** e.g. "Audio › Streaming Apps" */
  category: string;
  /** Where this entry lives on fmhy.net. */
  webUrl: string;
}

export function toItem(e: Entry): LinkItem {
  const where = e.subsection ? `${e.section} › ${e.subsection}` : e.section;
  return {
    key: e.url ?? `${e.pageSlug}/${e.section}/${e.title}`,
    title: e.title,
    description: e.description,
    kind: e.kind,
    url: e.url,
    links: e.links,
    category: `${e.pageTitle} › ${where}`,
    webUrl: `${SITE}/${e.pageSlug}#${slugify(e.subsection ?? e.section)}`,
  };
}

async function readList(key: string): Promise<LinkItem[]> {
  try {
    const raw = await LocalStorage.getItem<string>(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LinkItem[]) : [];
  } catch {
    return [];
  }
}

async function writeList(key: string, items: LinkItem[]): Promise<void> {
  await LocalStorage.setItem(key, JSON.stringify(items));
}

export interface UseSaved {
  favorites: LinkItem[];
  recents: LinkItem[];
  isLoading: boolean;
  isFavorite: (item: LinkItem) => boolean;
  toggleFavorite: (item: LinkItem) => Promise<boolean>;
  recordOpen: (item: LinkItem) => Promise<void>;
  removeRecent: (item: LinkItem) => Promise<void>;
  clearRecents: () => Promise<void>;
}

export function useSaved(): UseSaved {
  const [favorites, setFavorites] = useState<LinkItem[]>([]);
  const [recents, setRecents] = useState<LinkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void Promise.all([readList(FAVORITES_KEY), readList(RECENTS_KEY)]).then(([f, r]) => {
      if (!alive) return;
      setFavorites(f);
      setRecents(r);
      setIsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const isFavorite = useCallback(
    (item: LinkItem) => favorites.some((f) => f.key === item.key),
    [favorites],
  );

  /** @returns whether the item is a favorite after the toggle. */
  const toggleFavorite = useCallback(
    async (item: LinkItem) => {
      const exists = favorites.some((f) => f.key === item.key);
      const next = exists ? favorites.filter((f) => f.key !== item.key) : [item, ...favorites];
      setFavorites(next);
      await writeList(FAVORITES_KEY, next);
      return !exists;
    },
    [favorites],
  );

  const recordOpen = useCallback(
    async (item: LinkItem) => {
      const next = [item, ...recents.filter((r) => r.key !== item.key)].slice(0, MAX_RECENTS);
      setRecents(next);
      await writeList(RECENTS_KEY, next);
    },
    [recents],
  );

  const removeRecent = useCallback(
    async (item: LinkItem) => {
      const next = recents.filter((r) => r.key !== item.key);
      setRecents(next);
      await writeList(RECENTS_KEY, next);
    },
    [recents],
  );

  const clearRecents = useCallback(async () => {
    setRecents([]);
    await LocalStorage.removeItem(RECENTS_KEY);
  }, []);

  return {
    favorites,
    recents,
    isLoading,
    isFavorite,
    toggleFavorite,
    recordOpen,
    removeRecent,
    clearRecents,
  };
}
