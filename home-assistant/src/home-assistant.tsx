import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  List,
  showToast,
  Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HAEntity } from "./types";
import {
  fetchEntities,
  fetchEntity,
  fetchAreas,
  runScript,
  toggleEntity,
  turnOnEntity,
  turnOffEntity,
  openCover,
  closeCover,
  stopCover,
} from "./api";
import type { EntityCommand } from "./utils";
import {
  formatEntityState,
  hasReachedExpectedState,
  isToggleable,
  getEntityIcon,
  groupEntitiesByDomain,
} from "./utils";

interface Preferences {
  url: string;
  token: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  light: "Lights",
  switch: "Switches",
  fan: "Fans",
  cover: "Covers",
  input_boolean: "Input Booleans",
  automation: "Automations",
  script: "Scripts",
};

const DOMAIN_ORDER = [
  "light",
  "switch",
  "fan",
  "cover",
  "automation",
  "input_boolean",
  "script",
];

// How often the list silently re-syncs with Home Assistant while it is open
const POLL_INTERVAL_MS = 5000;

// After a command, poll the entity until its state confirms the change
const CONFIRM_ATTEMPTS = 8;
const CONFIRM_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sortEntities(ents: HAEntity[]): HAEntity[] {
  return ents.sort((a, b) => {
    const nameA = (a.attributes["friendly_name"] as string) || a.entity_id;
    const nameB = (b.attributes["friendly_name"] as string) || b.entity_id;
    return nameA.localeCompare(nameB);
  });
}

function getDisplayName(entity: HAEntity): string {
  return (entity.attributes["friendly_name"] as string) || entity.entity_id;
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [entities, setEntities] = useState<HAEntity[]>([]);
  const [areas, setAreas] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState("all");

  // Number of commands currently in flight; background sync pauses meanwhile
  // so it can't overwrite a state we are still waiting to confirm.
  const busyRef = useRef(0);
  const syncingRef = useRef(false);

  const loadEntities = useCallback(
    async (silent = false) => {
      if (!preferences.url || !preferences.token) {
        setIsLoading(false);
        return;
      }

      if (!silent) setIsLoading(true);
      try {
        // Areas are best-effort: a failure must never block the list
        const areasPromise = silent
          ? Promise.resolve(null)
          : fetchAreas(preferences, DOMAIN_ORDER).catch((error) => {
              console.error("Error loading areas:", error);
              return null;
            });

        const ents = await fetchEntities(preferences);
        if (busyRef.current === 0) {
          setEntities(sortEntities(ents.filter(isToggleable)));
        }

        const loadedAreas = await areasPromise;
        if (loadedAreas) setAreas(loadedAreas);
      } catch (error) {
        console.error("Error loading entities:", error);
        // Background syncs fail quietly; only surface explicit loads
        if (!silent) {
          showToast({
            style: Toast.Style.Failure,
            title: "Failed to load entities",
            message: "Check your URL and token in preferences",
          });
        }
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [preferences.url, preferences.token],
  );

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  // Keep the list in sync with the real state (e.g. a light switched by a
  // wall switch, the Home Assistant app, or an automation).
  useEffect(() => {
    if (!preferences.url || !preferences.token) return;
    const interval = setInterval(async () => {
      if (busyRef.current > 0 || syncingRef.current) return;
      syncingRef.current = true;
      try {
        await loadEntities(true);
      } finally {
        syncingRef.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadEntities, preferences.url, preferences.token]);

  const filteredEntities = useMemo(() => {
    if (selectedDomain === "all") return entities;
    return entities.filter((e) => e.entity_id.split(".")[0] === selectedDomain);
  }, [entities, selectedDomain]);

  const groupedEntities = useMemo(() => {
    if (selectedDomain !== "all") return { [selectedDomain]: filteredEntities };
    return groupEntitiesByDomain(filteredEntities);
  }, [filteredEntities, selectedDomain]);

  const availableDomains = useMemo(() => {
    const domains = new Set(
      entities.map((e) => e.entity_id.split(".")[0] as string),
    );
    return DOMAIN_ORDER.filter((d) => domains.has(d));
  }, [entities]);

  /**
   * Runs a command, then waits until Home Assistant reports the resulting
   * state before updating the list, so what is shown is the real state.
   */
  const runCommand = async (
    entity: HAEntity,
    command: EntityCommand,
    action: () => Promise<void>,
    labels: { progress: string; done: string },
  ) => {
    busyRef.current++;
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: labels.progress,
      message: getDisplayName(entity),
    });

    try {
      await action();

      let latest = await fetchEntity(entity.entity_id, preferences);
      for (
        let attempt = 1;
        attempt < CONFIRM_ATTEMPTS &&
        !hasReachedExpectedState(command, entity, latest);
        attempt++
      ) {
        await sleep(CONFIRM_DELAY_MS);
        latest = await fetchEntity(entity.entity_id, preferences);
      }

      setEntities((prev) =>
        sortEntities(
          prev.map((e) => (e.entity_id === latest.entity_id ? latest : e)),
        ),
      );

      toast.style = Toast.Style.Success;
      toast.title = labels.done;
      toast.message = formatEntityState(latest);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Action failed";
      toast.message = (error as Error).message;
    } finally {
      busyRef.current--;
    }
  };

  const handleToggle = (entity: HAEntity) =>
    runCommand(
      entity,
      "toggle",
      () => toggleEntity(entity.entity_id, preferences),
      { progress: "Toggling…", done: "Toggled" },
    );

  const handleTurnOn = (entity: HAEntity) =>
    runCommand(
      entity,
      "turn_on",
      () => turnOnEntity(entity.entity_id, preferences),
      { progress: "Turning on…", done: "Turned on" },
    );

  const handleTurnOff = (entity: HAEntity) =>
    runCommand(
      entity,
      "turn_off",
      () => turnOffEntity(entity.entity_id, preferences),
      { progress: "Turning off…", done: "Turned off" },
    );

  const handleOpenCover = (entity: HAEntity) =>
    runCommand(
      entity,
      "open_cover",
      () => openCover(entity.entity_id, preferences),
      { progress: "Opening…", done: "Opened" },
    );

  const handleCloseCover = (entity: HAEntity) =>
    runCommand(
      entity,
      "close_cover",
      () => closeCover(entity.entity_id, preferences),
      { progress: "Closing…", done: "Closed" },
    );

  const handleStopCover = (entity: HAEntity) =>
    runCommand(
      entity,
      "stop_cover",
      () => stopCover(entity.entity_id, preferences),
      { progress: "Stopping…", done: "Stopped" },
    );

  const handleRunScript = (entity: HAEntity) =>
    runCommand(
      entity,
      "run_script",
      () => runScript(entity.entity_id, preferences),
      { progress: "Running script…", done: "Script started" },
    );

  function formatRelativeTime(isoDate: string | null | undefined): string {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  }

  function getEntityAccessories(entity: HAEntity): List.Item.Accessory[] {
    const domain = entity.entity_id.split(".")[0];
    const accessories: List.Item.Accessory[] = [];

    // Light-specific accessories
    if (domain === "light" && entity.state === "on") {
      const brightness = entity.attributes["brightness"] as number | undefined;
      const colorTempKelvin = entity.attributes["color_temp_kelvin"] as
        | number
        | undefined;

      if (brightness != null) {
        accessories.push({
          text: `${Math.round((brightness / 255) * 100)}%`,
          icon: Icon.LightBulb,
        });
      }

      if (colorTempKelvin != null) {
        accessories.push({
          text: `${colorTempKelvin}K`,
          icon: Icon.Sun,
        });
      }
    }

    // Climate accessories
    if (domain === "climate") {
      const currentTemp = entity.attributes["current_temperature"] as
        | number
        | undefined;
      const targetTemp = entity.attributes["temperature"] as number | undefined;
      if (currentTemp != null) {
        accessories.push({ text: `${currentTemp}°`, icon: Icon.Temperature });
      }
      if (targetTemp != null) {
        accessories.push({ text: `→ ${targetTemp}°` });
      }
    }

    // Cover accessories (position)
    if (domain === "cover") {
      const position = entity.attributes["current_position"] as
        | number
        | undefined;
      if (position !== undefined) {
        accessories.push({ text: `${position}%`, icon: Icon.Gauge });
      }
    }

    // Automation accessories (last triggered)
    if (domain === "automation") {
      const lastTriggered = entity.attributes["last_triggered"] as
        | string
        | null
        | undefined;
      if (lastTriggered) {
        accessories.push({
          text: formatRelativeTime(lastTriggered),
          icon: Icon.Clock,
        });
      }
    }

    // Script accessories (last triggered)
    if (domain === "script") {
      const lastTriggered = entity.attributes["last_triggered"] as
        | string
        | null
        | undefined;
      if (lastTriggered) {
        accessories.push({
          text: formatRelativeTime(lastTriggered),
          icon: Icon.Clock,
        });
      }
    }

    // Fan accessories (percentage)
    if (domain === "fan" && entity.state === "on") {
      const percentage = entity.attributes["percentage"] as number | undefined;
      if (percentage !== undefined) {
        accessories.push({ text: `${percentage}%`, icon: Icon.Gauge });
      }
    }

    // State tag (always last)
    if (domain === "script") {
      if (entity.state === "on") {
        accessories.push({ tag: { value: "Running", color: Color.Blue } });
      }
    } else if (domain !== "automation") {
      if (entity.state === "on" || entity.state === "open") {
        accessories.push({ tag: { value: "On", color: Color.Green } });
      } else if (entity.state === "off" || entity.state === "closed") {
        accessories.push({ tag: { value: "Off", color: Color.SecondaryText } });
      } else if (entity.state === "opening" || entity.state === "closing") {
        accessories.push({
          tag: {
            value: entity.state === "opening" ? "Opening" : "Closing",
            color: Color.Orange,
          },
        });
      } else if (entity.state === "unavailable") {
        accessories.push({ tag: { value: "Unavailable", color: Color.Red } });
      }
    }

    return accessories;
  }

  function getEntityActions(entity: HAEntity) {
    const domain = entity.entity_id.split(".")[0] as string;
    const isOn = entity.state === "on" || entity.state === "open";
    const isToggleableDomain = [
      "light",
      "switch",
      "fan",
      "input_boolean",
      "automation",
    ].includes(domain);
    const isControllableDomain = [
      "light",
      "switch",
      "fan",
      "climate",
      "automation",
    ].includes(domain);
    const isCoverDomain = domain === "cover";

    return (
      <ActionPanel>
        <ActionPanel.Section>
          {domain === "script" && (
            <Action
              icon={Icon.Play}
              title="Run Script"
              onAction={() => handleRunScript(entity)}
            />
          )}
          {isToggleableDomain && (
            <Action
              icon={Icon.Power}
              title={isOn ? "Turn Off" : "Turn On"}
              onAction={() => handleToggle(entity)}
            />
          )}
          {isControllableDomain && !isToggleableDomain && (
            <>
              <Action
                icon={Icon.Play}
                title="Turn On"
                onAction={() => handleTurnOn(entity)}
              />
              <Action
                icon={Icon.Stop}
                title="Turn Off"
                onAction={() => handleTurnOff(entity)}
              />
            </>
          )}
          {isCoverDomain && (
            <>
              <Action
                icon={Icon.ChevronUp}
                title="Open"
                onAction={() => handleOpenCover(entity)}
              />
              <Action
                icon={Icon.ChevronDown}
                title="Close"
                onAction={() => handleCloseCover(entity)}
              />
              <Action
                icon={Icon.Stop}
                title="Stop"
                onAction={() => handleStopCover(entity)}
              />
            </>
          )}
        </ActionPanel.Section>
        <ActionPanel.Section>
          <Action.CopyToClipboard
            icon={Icon.CopyClipboard}
            title="Copy Entity ID"
            content={entity.entity_id}
          />
        </ActionPanel.Section>
      </ActionPanel>
    );
  }

  if (!preferences.url || !preferences.token) {
    return (
      <List searchBarPlaceholder="Search entities...">
        <List.EmptyView
          icon={Icon.Exclamationmark}
          title="Home Assistant Not Configured"
          description="Set your Home Assistant URL and access token in extension preferences"
        />
      </List>
    );
  }

  const domainDropdown =
    availableDomains.length > 1 ? (
      <List.Dropdown
        tooltip="Filter by Domain"
        value={selectedDomain}
        onChange={setSelectedDomain}
      >
        <List.Dropdown.Item title="All Domains" value="all" />
        {availableDomains.map((domain) => (
          <List.Dropdown.Item
            key={domain}
            title={DOMAIN_LABELS[domain] || domain}
            value={domain}
          />
        ))}
      </List.Dropdown>
    ) : undefined;

  const globalActions = (
    <ActionPanel>
      <Action
        icon={Icon.RotateClockwise}
        title="Refresh"
        shortcut={{ modifiers: ["ctrl"], key: "r" }}
        onAction={() => loadEntities()}
      />
    </ActionPanel>
  );

  if (filteredEntities.length === 0 && !isLoading) {
    return (
      <List
        isLoading={isLoading}
        searchBarPlaceholder="Search entities..."
        searchBarAccessory={domainDropdown}
        actions={globalActions}
      >
        <List.EmptyView
          icon={Icon.BlankDocument}
          title="No Entities Found"
          description={
            selectedDomain === "all"
              ? "No controllable entities found in Home Assistant"
              : `No ${DOMAIN_LABELS[selectedDomain] || selectedDomain} found`
          }
          actions={globalActions}
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search entities..."
      searchBarAccessory={domainDropdown}
      actions={globalActions}
    >
      {DOMAIN_ORDER.filter((domain) => groupedEntities[domain]?.length).map(
        (domain) => (
          <List.Section
            key={domain}
            title={DOMAIN_LABELS[domain] || domain}
            subtitle={`${groupedEntities[domain]?.length || 0} entities`}
          >
            {groupedEntities[domain]?.map((entity) => (
              <List.Item
                key={entity.entity_id}
                title={getDisplayName(entity)}
                subtitle={areas[entity.entity_id] ?? ""}
                keywords={[entity.entity_id]}
                icon={getEntityIcon(entity)}
                accessories={getEntityAccessories(entity)}
                actions={getEntityActions(entity)}
              />
            ))}
          </List.Section>
        ),
      )}
    </List>
  );
}
