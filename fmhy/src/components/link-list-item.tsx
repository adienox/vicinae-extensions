import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Keyboard,
  List,
  Toast,
  closeMainWindow,
  open,
  showToast,
} from "@vicinae/api";
import type { ReactNode } from "react";
import type { EntryKind } from "../lib/parse";
import type { LinkItem, UseSaved } from "../lib/saved";

const MAX_SUBMENU_LINKS = 20;

function iconFor(kind: EntryKind) {
  switch (kind) {
    case "starred":
      return { source: Icon.Star, tintColor: Color.Yellow };
    case "index":
      return { source: Icon.Globe01, tintColor: Color.Blue };
    case "redirect":
      return { source: Icon.ArrowRight, tintColor: Color.SecondaryText };
    case "unsafe":
      return { source: Icon.Warning, tintColor: Color.Red };
    default:
      return { source: Icon.Link, tintColor: Color.SecondaryText };
  }
}

const KIND_TOOLTIP: Record<EntryKind, string> = {
  starred: "Recommended by the FMHY community",
  index: "Third-party index",
  redirect: "Points to another section of the wiki",
  unsafe: "Flagged as unsafe. Avoid.",
  normal: "",
};

interface Props {
  item: LinkItem;
  saved: UseSaved;
  /** Show the "Page › Section" breadcrumb on the right (search, favorites). */
  showCategory?: boolean;
  /** Extra, command-specific actions (rendered in their own section). */
  extraActions?: ReactNode;
  /** Re-download wiki data. Omit where it doesn't apply (e.g. Favorites). */
  onRefresh?: () => void;
}

export function LinkListItem({ item, saved, showCategory, extraActions, onRefresh }: Props) {
  const isFavorite = saved.isFavorite(item);

  const openUrl = async (url: string) => {
    await saved.recordOpen(item);
    await open(url);
    await closeMainWindow();
  };

  const onToggleFavorite = async () => {
    const nowFavorite = await saved.toggleFavorite(item);
    await showToast({
      style: Toast.Style.Success,
      title: nowFavorite ? "Added to favorites" : "Removed from favorites",
      message: item.title,
    });
  };

  const accessories: List.Item.Accessory[] = [];
  if (isFavorite) {
    accessories.push({ icon: { source: Icon.Heart, tintColor: Color.Red }, tooltip: "Favorite" });
  }
  if (showCategory) accessories.push({ text: item.category });

  const otherLinks = item.links.slice(0, MAX_SUBMENU_LINKS);
  const markdown = item.url ? `[${item.title}](${item.url})` : item.title;

  return (
    <List.Item
      id={item.key}
      title={item.title}
      subtitle={item.description}
      icon={{ value: iconFor(item.kind), tooltip: KIND_TOOLTIP[item.kind] }}
      keywords={[item.description, ...item.links.map((l) => l.label)]}
      accessories={accessories}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {item.url ? (
              <Action
                title={item.kind === "redirect" ? "Open on FMHY Website" : "Open in Browser"}
                icon={Icon.Globe01}
                onAction={() => openUrl(item.url!)}
              />
            ) : (
              <Action.CopyToClipboard title="Copy Name" content={item.title} />
            )}
            {item.url && (
              <Action.CopyToClipboard
                title="Copy URL"
                content={item.url}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
            )}
            <Action.CopyToClipboard title="Copy as Markdown" content={markdown} />
          </ActionPanel.Section>

          {otherLinks.length > 0 && (
            <ActionPanel.Section title="Other Links">
              <ActionPanel.Submenu title="Open Other Link…" icon={Icon.Link}>
                {otherLinks.map((l, i) => (
                  <Action
                    key={`${l.url}-${i}`}
                    title={l.label || l.url}
                    icon={Icon.Globe01}
                    onAction={() => openUrl(l.url)}
                  />
                ))}
              </ActionPanel.Submenu>
            </ActionPanel.Section>
          )}

          <ActionPanel.Section>
            {item.url && (
              <Action
                title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                icon={isFavorite ? Icon.HeartDisabled : Icon.Heart}
                shortcut={Keyboard.Shortcut.Common.Pin}
                onAction={onToggleFavorite}
              />
            )}
            <Action
              title="Open Section on FMHY Website"
              icon={Icon.Compass}
              onAction={() => open(item.webUrl).then(() => closeMainWindow())}
            />
          </ActionPanel.Section>

          {extraActions}

          {onRefresh && (
            <ActionPanel.Section>
              <Action
                title="Refresh FMHY Data"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={onRefresh}
              />
            </ActionPanel.Section>
          )}
        </ActionPanel>
      }
    />
  );
}

/** Shown when the very first download fails and there is nothing cached. */
export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <List.EmptyView
      icon={{ source: Icon.Warning, tintColor: Color.Red }}
      title="Couldn't download FMHY"
      description={`${message}. Check your connection and try again.`}
      actions={
        <ActionPanel>
          <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={onRetry} />
        </ActionPanel>
      }
    />
  );
}
