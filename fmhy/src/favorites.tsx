import { Action, ActionPanel, Icon, Keyboard, List } from "@vicinae/api";
import { LinkListItem } from "./components/link-list-item";
import { useSaved } from "./lib/saved";

export default function Favorites() {
  const saved = useSaved();

  return (
    <List
      isLoading={saved.isLoading}
      navigationTitle="FMHY Favorites"
      searchBarPlaceholder="Search favorites and recents…"
    >
      <List.Section title="Favorites" subtitle={`${saved.favorites.length}`}>
        {saved.favorites.map((item) => (
          <LinkListItem key={item.key} item={item} saved={saved} showCategory />
        ))}
      </List.Section>

      <List.Section title="Recently Opened" subtitle={`${saved.recents.length}`}>
        {saved.recents.map((item) => (
          <LinkListItem
            key={item.key}
            item={item}
            saved={saved}
            showCategory
            extraActions={
              <ActionPanel.Section title="Recents">
                <Action
                  title="Remove from Recents"
                  icon={Icon.Trash}
                  shortcut={Keyboard.Shortcut.Common.Remove}
                  onAction={() => saved.removeRecent(item)}
                />
                <Action
                  title="Clear All Recents"
                  icon={Icon.Trash}
                  style="destructive"
                  shortcut={Keyboard.Shortcut.Common.RemoveAll}
                  onAction={() => saved.clearRecents()}
                />
              </ActionPanel.Section>
            }
          />
        ))}
      </List.Section>

      <List.EmptyView
        icon={Icon.Heart}
        title="Nothing here yet"
        description="Favorite a link from Browse or Search and it will show up here."
      />
    </List>
  );
}
