import { Color, Icon, List } from "@vicinae/api";
import { useMemo, useState } from "react";
import { ErrorView, LinkListItem } from "./components/link-list-item";
import { useWiki } from "./lib/data";
import { searchEntries } from "./lib/parse";
import { toItem, useSaved } from "./lib/saved";

export default function Search() {
  const { wiki, isLoading, error, reload } = useWiki();
  const saved = useSaved();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");

  const results = useMemo(
    () => (wiki ? searchEntries(wiki.entries, query, { scope }, 60).map(toItem) : []),
    [wiki, query, scope],
  );

  const hasQuery = query.trim().length > 0;
  const showRecents = !hasQuery && saved.recents.length > 0;

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      throttle
      navigationTitle="Search FMHY"
      searchBarPlaceholder="Search every link on FMHY…"
      onSearchTextChange={setQuery}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" value={scope} onChange={setScope}>
          <List.Dropdown.Section title="Type">
            <List.Dropdown.Item title="Everything" value="all" icon={Icon.MagnifyingGlass} />
            <List.Dropdown.Item
              title="Recommended"
              value="starred"
              icon={{ source: Icon.Star, tintColor: Color.Yellow }}
            />
            <List.Dropdown.Item
              title="Indexes"
              value="index"
              icon={{ source: Icon.Globe01, tintColor: Color.Blue }}
            />
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Page">
            {(wiki?.pages ?? []).map((p) => (
              <List.Dropdown.Item key={p.slug} title={p.title} value={`page:${p.slug}`} icon={Icon.Folder} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {!wiki && error && !isLoading ? (
        <ErrorView message={error} onRetry={reload} />
      ) : (
        <>
          {hasQuery && (
            <List.Section title="Results" subtitle={`${results.length}${results.length === 60 ? "+" : ""}`}>
              {results.map((item) => (
                <LinkListItem key={item.key} item={item} saved={saved} showCategory onRefresh={reload} />
              ))}
            </List.Section>
          )}

          {showRecents && (
            <List.Section title="Recently Opened">
              {saved.recents.slice(0, 10).map((item) => (
                <LinkListItem key={item.key} item={item} saved={saved} showCategory onRefresh={reload} />
              ))}
            </List.Section>
          )}

          <List.EmptyView
            icon={Icon.MagnifyingGlass}
            title={hasQuery ? "No results" : "Search FMHY"}
            description={
              hasQuery
                ? "Try fewer or different words, or switch the filter."
                : wiki
                  ? `Type to search ${wiki.entries.length} links across ${wiki.pages.length} pages.`
                  : "Downloading the wiki for the first time…"
            }
          />
        </>
      )}
    </List>
  );
}
