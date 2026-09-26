import { Action, ActionPanel, Color, Icon, Keyboard, List, closeMainWindow, open } from "@vicinae/api";
import { ErrorView, LinkListItem } from "./components/link-list-item";
import { useWiki } from "./lib/data";
import type { Page, Section } from "./lib/parse";
import { toItem, useSaved, type UseSaved } from "./lib/saved";

/** Level 3: the links inside one section, grouped by subsection. */
function EntriesView({ page, section, saved }: { page: Page; section: Section; saved: UseSaved }) {
  const withEntries = section.subsections.filter((s) => s.entries.length > 0);
  // Subsections that are just a pointer to another part of the wiki.
  const pointers = section.subsections.filter((s) => s.entries.length === 0 && s.url);

  return (
    <List
      navigationTitle={`${page.title} › ${section.title}`}
      searchBarPlaceholder={`Search ${section.title}…`}
    >
      {section.entries.length > 0 && (
        <List.Section title={withEntries.length > 0 ? "General" : section.title}>
          {section.entries.map((e) => (
            <LinkListItem key={e.id} item={toItem(e)} saved={saved} />
          ))}
        </List.Section>
      )}

      {withEntries.map((sub) => (
        <List.Section key={sub.title} title={sub.title} subtitle={`${sub.entries.length}`}>
          {sub.entries.map((e) => (
            <LinkListItem key={e.id} item={toItem(e)} saved={saved} />
          ))}
        </List.Section>
      ))}

      {pointers.length > 0 && (
        <List.Section title="See Also">
          {pointers.map((p) => (
            <List.Item
              key={p.title}
              title={p.title}
              icon={{ source: Icon.ArrowRight, tintColor: Color.SecondaryText }}
              actions={
                <ActionPanel>
                  <Action
                    title="Open on FMHY Website"
                    icon={Icon.Globe01}
                    onAction={() => open(p.url!).then(() => closeMainWindow())}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

/** Level 2: the categories (top-level headings) of one wiki page. */
function SectionsView({ page, saved }: { page: Page; saved: UseSaved }) {
  return (
    <List navigationTitle={page.title} searchBarPlaceholder={`Search ${page.title} categories…`}>
      {page.sections.map((section) => {
        const isPointer = section.count === 0 && !!section.url;
        return (
          <List.Item
            key={section.title}
            title={section.title}
            icon={{
              source: isPointer ? Icon.ArrowRight : Icon.Folder,
              tintColor: Color.SecondaryText,
            }}
            accessories={isPointer ? [] : [{ text: `${section.count} links` }]}
            actions={
              <ActionPanel>
                {isPointer ? (
                  <Action
                    title="Open on FMHY Website"
                    icon={Icon.Globe01}
                    onAction={() => open(section.url!).then(() => closeMainWindow())}
                  />
                ) : (
                  <Action.Push
                    title="Browse Category"
                    icon={Icon.Folder}
                    target={<EntriesView page={page} section={section} saved={saved} />}
                  />
                )}
                <Action
                  title="Open Category on FMHY Website"
                  icon={Icon.Compass}
                  shortcut={Keyboard.Shortcut.Common.Open}
                  onAction={() => open(section.webUrl).then(() => closeMainWindow())}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

/** Level 1: the wiki pages. */
export default function Browse() {
  const { wiki, isLoading, error, reload } = useWiki();
  const saved = useSaved();

  return (
    <List
      isLoading={isLoading}
      navigationTitle="FMHY"
      searchBarPlaceholder="Browse FMHY…"
    >
      {!wiki && error && !isLoading ? (
        <ErrorView message={error} onRetry={reload} />
      ) : (
        <List.Section title="Wiki Pages" subtitle={wiki ? `${wiki.entries.length} links` : undefined}>
          {wiki?.pages.map((page) => (
            <List.Item
              key={page.slug}
              title={page.title}
              subtitle={`${page.sections.length} categories`}
              icon={{ source: Icon.Folder, tintColor: Color.Blue }}
              accessories={[{ text: `${page.count} links` }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Browse Page"
                    icon={Icon.Folder}
                    target={<SectionsView page={page} saved={saved} />}
                  />
                  <Action
                    title="Open Page on FMHY Website"
                    icon={Icon.Compass}
                    shortcut={Keyboard.Shortcut.Common.Open}
                    onAction={() => open(page.webUrl).then(() => closeMainWindow())}
                  />
                  <Action
                    title="Refresh FMHY Data"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={reload}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
