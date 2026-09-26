# FMHY for Vicinae

Browse and search the [FMHY](https://fmhy.net) (FreeMediaHeckYeah) wiki from Vicinae.

**Nothing is bundled.** Unlike the earlier attempt
([vicinaehq/extensions#90](https://github.com/vicinaehq/extensions/pull/90)), which
shipped ~660k lines of JSON, this extension downloads the wiki at runtime and
keeps it in Vicinae's `Cache`, as the reviewers asked. The whole extension is ~80 KB.

## Commands

| Command | What it does |
| --- | --- |
| **Browse FMHY** | Page → category → links, with fuzzy filtering at every level. |
| **Search FMHY** | Ranked search across all ~16k links. Filter by ⭐ Recommended, 🌐 Indexes, or a single page. Shows recents when the query is empty. |
| **FMHY Favorites** | Your favorited links plus recently opened ones. |
| **Refresh FMHY Data** | Forces a revalidation of every page. |

Per-link actions: open, copy URL, copy as Markdown, open any *other* link on the
entry (mirrors, GitHub, Discord, alternatives), favorite (`Pin` shortcut),
open the section on fmhy.net, refresh (`Refresh` shortcut).

Icons: ⭐ community recommended · 🌐 third-party index · ➜ points to another section · ⚠ flagged unsafe.

## How the data works

1. On first use, the 24 wiki pages are fetched in parallel from
   `raw.githubusercontent.com/fmhy/edit/main/docs/*.md` (the same files the official
   `api.fmhy.net/single-page` endpoint concatenates, minus its rate limits).
2. Each page is parsed once and stored **already parsed** in `Cache`
   (~5 MB total). Later launches skip the network and parsing entirely
   (~60 ms to load).
3. Stale-while-revalidate: pages older than the *Cache Duration* preference
   (default 24 h) are refreshed in the background while you keep using the
   cached copy. Revalidation uses `If-None-Match`, so unchanged pages cost a tiny
   `304` response.
4. A failed refresh never discards data you already have; one broken page
   doesn't affect the others.
5. Favorites and recents are stored in `LocalStorage` as snapshots, so they
   survive cache eviction.

The wiki still links into the old subreddit wiki for cross-references; those are
rewritten to their fmhy.net equivalents.

## Development

```sh
npm install
npm run dev     # vici develop
npm run build   # type-checks and builds
```

Before submitting to the store: set `author` in `package.json` to your GitHub
username and commit `package-lock.json`.

## Notes / limitations

- The NSFW page isn't part of the public `docs/` source, so there is no NSFW toggle
  (the old PR had one).
- `beginners-guide` is skipped: it's prose, not a link directory.
- Section anchors on fmhy.net (`#adblock-privacy`) follow VitePress' slug rules and are
  best-effort; if one is ever wrong, the browser simply lands on the top of the right page.
- Entries with several sites (`A, B or C`) show as one row; extra sites are under
  *Open Other Link…*.
