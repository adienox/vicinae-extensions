import { describe, it, expect, beforeEach } from "vitest";
import type { HAEntity, HAContext } from "./types";
import {
  formatEntityState,
  isToggleable,
  getEntityIcon,
  getEntityActions,
  hasReachedExpectedState,
  getEntityDisplayInfo,
  filterEntitiesByDomain,
  filterEntitiesByAttribute,
  groupEntitiesByDomain,
  sortEntitiesByName,
} from "./utils";

// Helper to create mock entities with required fields
function createMockEntity(
  partial: Partial<HAEntity> & { entity_id: string; state: string },
): HAEntity {
  const defaultContext: HAContext = {
    id: "test-context-id",
    parent_id: null,
    user_id: null,
  };

  return {
    attributes: {},
    last_changed: "2023-01-01T00:00:00",
    last_reported: "2023-01-01T00:00:00",
    last_updated: "2023-01-01T00:00:00",
    context: defaultContext,
    ...partial,
  };
}

describe("formatEntityState", () => {
  describe("light entities", () => {
    it("should format on light with brightness", () => {
      const entity = createMockEntity({
        entity_id: "light.living_room",
        state: "on",
        attributes: {
          friendly_name: "Living Room",
          brightness: 255,
        },
      });

      const result = formatEntityState(entity);
      expect(result).toContain("Living Room");
      expect(result).toContain("on");
      expect(result).toContain("100%");
    });

    it("should format off light without brightness", () => {
      const entity = createMockEntity({
        entity_id: "light.bedroom",
        state: "off",
        attributes: {
          friendly_name: "Bedroom",
          brightness: 255,
        },
      });

      const result = formatEntityState(entity);
      expect(result).toContain("Bedroom");
      expect(result).toContain("off");
      expect(result).not.toContain("%");
    });
  });

  describe("climate entities", () => {
    it("should format climate with current and target temperature", () => {
      const entity = createMockEntity({
        entity_id: "climate.hvac",
        state: "idle",
        attributes: {
          friendly_name: "HVAC",
          temperature: 22,
          current_temperature: 20,
        },
      });

      const result = formatEntityState(entity);
      expect(result).toContain("HVAC");
      expect(result).toContain("20°");
      expect(result).toContain("22°");
    });

    it("should format climate with only target temperature", () => {
      const entity = createMockEntity({
        entity_id: "climate.hvac",
        state: "idle",
        attributes: {
          friendly_name: "HVAC",
          temperature: 22,
        },
      });

      const result = formatEntityState(entity);
      expect(result).toContain("HVAC");
      expect(result).toContain("22°");
    });
  });

  describe("sensor entities", () => {
    it("should format sensor with unit", () => {
      const entity = createMockEntity({
        entity_id: "sensor.temperature",
        state: "20.5",
        attributes: {
          friendly_name: "Temperature",
          unit_of_measurement: "°C",
        },
      });

      const result = formatEntityState(entity);
      expect(result).toContain("Temperature");
      expect(result).toContain("20.5");
      expect(result).toContain("°C");
    });
  });

  describe("default formatting", () => {
    it("should use entity_id as name when no friendly_name", () => {
      const entity = createMockEntity({
        entity_id: "sensor.unknown",
        state: "value",
      });

      const result = formatEntityState(entity);
      expect(result).toContain("sensor.unknown");
      expect(result).toContain("value");
    });
  });
});

describe("isToggleable", () => {
  it("should return true for toggleable domains", () => {
    expect(
      isToggleable(
        createMockEntity({ entity_id: "light.living_room", state: "on" }),
      ),
    ).toBe(true);

    expect(
      isToggleable(
        createMockEntity({ entity_id: "switch.kitchen", state: "off" }),
      ),
    ).toBe(true);

    expect(
      isToggleable(
        createMockEntity({ entity_id: "fan.bedroom", state: "off" }),
      ),
    ).toBe(true);

    expect(
      isToggleable(
        createMockEntity({ entity_id: "cover.blinds", state: "closed" }),
      ),
    ).toBe(true);

    expect(
      isToggleable(
        createMockEntity({ entity_id: "automation.test", state: "on" }),
      ),
    ).toBe(true);
  });

  it("should return false for non-toggleable domains", () => {
    expect(
      isToggleable(
        createMockEntity({ entity_id: "sensor.temperature", state: "20" }),
      ),
    ).toBe(false);

    expect(
      isToggleable(
        createMockEntity({ entity_id: "binary_sensor.present", state: "on" }),
      ),
    ).toBe(false);
  });
});

describe("getEntityIcon", () => {
  it("should return icon for lights", () => {
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "light.living_room", state: "on" }),
      ),
    ).toBe("💡");
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "light.living_room", state: "off" }),
      ),
    ).toBe("💡");
  });

  it("should return icon for switches", () => {
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "switch.kitchen", state: "on" }),
      ),
    ).toBe("🔌");
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "switch.kitchen", state: "off" }),
      ),
    ).toBe("🔌");
  });

  it("should return icon for fans", () => {
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "fan.bedroom", state: "on" }),
      ),
    ).toBe("💨");
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "fan.bedroom", state: "off" }),
      ),
    ).toBe("💨");
  });

  it("should return icon for covers", () => {
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "cover.blinds", state: "open" }),
      ),
    ).toBe("🪟");
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "cover.blinds", state: "closed" }),
      ),
    ).toBe("🪟");
  });

  it("should return icon for climate", () => {
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "climate.hvac", state: "idle" }),
      ),
    ).toBe("🌡️");
  });

  it("should return default icon for unknown entities", () => {
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "sensor.unknown", state: "value" }),
      ),
    ).toBe("❓");
  });

  it("should return battery icon for battery entities", () => {
    expect(
      getEntityIcon(
        createMockEntity({
          entity_id: "sensor.phone_battery",
          state: "85",
          attributes: { device_class: "battery" },
        }),
      ),
    ).toBe("battery");
  });

  it("should return battery-charging icon for charging battery", () => {
    expect(
      getEntityIcon(
        createMockEntity({
          entity_id: "sensor.phone_battery",
          state: "charging",
          attributes: { device_class: "battery" },
        }),
      ),
    ).toBe("battery-charging");
  });

  it("should return battery-disabled icon for unavailable battery", () => {
    expect(
      getEntityIcon(
        createMockEntity({
          entity_id: "sensor.phone_battery",
          state: "unavailable",
          attributes: { device_class: "battery" },
        }),
      ),
    ).toBe("battery-disabled");
  });

  it("should return input_boolean icons based on state", () => {
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "input_boolean.test", state: "on" }),
      ),
    ).toBe("✅");
    expect(
      getEntityIcon(
        createMockEntity({ entity_id: "input_boolean.test", state: "off" }),
      ),
    ).toBe("❌");
  });
});

describe("getEntityActions", () => {
  it("should return toggle action for toggleable entities", () => {
    const actions = getEntityActions(
      createMockEntity({ entity_id: "light.living_room", state: "on" }),
    );

    expect(actions).toContainEqual({
      title: "Toggle",
      icon: "🔄",
      action: "toggle",
    });
  });

  it("should return turn on/off actions for lights and switches", () => {
    const actions = getEntityActions(
      createMockEntity({ entity_id: "light.living_room", state: "on" }),
    );

    expect(actions).toContainEqual({
      title: "Turn On",
      icon: "🔵",
      action: "turn_on",
    });
    expect(actions).toContainEqual({
      title: "Turn Off",
      icon: "⚫",
      action: "turn_off",
    });
  });

  it("should return cover actions for cover entities", () => {
    const actions = getEntityActions(
      createMockEntity({ entity_id: "cover.blinds", state: "closed" }),
    );

    expect(actions).toContainEqual({
      title: "Open",
      icon: "⬆️",
      action: "open_cover",
    });
    expect(actions).toContainEqual({
      title: "Close",
      icon: "⬇️",
      action: "close_cover",
    });
    expect(actions).toContainEqual({
      title: "Stop",
      icon: "⏹️",
      action: "stop_cover",
    });
  });

  it("should not return cover actions for non-cover entities", () => {
    const actions = getEntityActions(
      createMockEntity({ entity_id: "light.living_room", state: "on" }),
    );

    actions.forEach((action) => {
      expect(action.action).not.toBe("open_cover");
      expect(action.action).not.toBe("close_cover");
      expect(action.action).not.toBe("stop_cover");
    });
  });
});

describe("getEntityDisplayInfo", () => {
  it("should return display info with icon and formatted state", () => {
    const entity = createMockEntity({
      entity_id: "light.living_room",
      state: "on",
      attributes: {
        friendly_name: "Living Room",
        brightness: 255,
      },
    });

    const info = getEntityDisplayInfo(entity);
    expect(info).toHaveProperty("entityId", "light.living_room");
    expect(info).toHaveProperty("icon");
    expect(info).toHaveProperty("state");
    expect(info).toHaveProperty("actions");
    expect(info.state).toContain("Living Room");
    expect(info.state).toContain("100%");
  });

  it("should include attributes in display info", () => {
    const entity = createMockEntity({
      entity_id: "sensor.temperature",
      state: "20",
      attributes: {
        unit_of_measurement: "°C",
        icon: "🌡️",
      },
    });

    const info = getEntityDisplayInfo(entity);
    expect(info.attributes["unit_of_measurement"]).toBe("°C");
    expect(info.attributes["icon"]).toBe("🌡️");
  });
});

describe("filterEntitiesByDomain", () => {
  let entities: HAEntity[];

  beforeEach(() => {
    entities = [
      createMockEntity({ entity_id: "light.living_room", state: "on" }),
      createMockEntity({ entity_id: "switch.kitchen", state: "off" }),
      createMockEntity({ entity_id: "sensor.temperature", state: "20" }),
      createMockEntity({ entity_id: "light.bedroom", state: "off" }),
    ];
  });

  it("should filter lights", () => {
    const result = filterEntitiesByDomain(entities, "light");
    expect(result.length).toBe(2);
    expect(result.every((e) => e.entity_id.startsWith("light."))).toBe(true);
  });

  it("should filter switches", () => {
    const result = filterEntitiesByDomain(entities, "switch");
    expect(result.length).toBe(1);
    expect(result[0]!.entity_id).toBe("switch.kitchen");
  });

  it("should return empty array when no matches", () => {
    const result = filterEntitiesByDomain(entities, "automation");
    expect(result.length).toBe(0);
  });
});

describe("filterEntitiesByAttribute", () => {
  let entities: HAEntity[];

  beforeEach(() => {
    entities = [
      createMockEntity({
        entity_id: "sensor.temperature",
        state: "20",
        attributes: {
          friendly_name: "Temperature",
          unit_of_measurement: "°C",
          icon: "🌡️",
        },
      }),
      createMockEntity({
        entity_id: "sensor.humidity",
        state: "50",
        attributes: {
          friendly_name: "Humidity",
          unit_of_measurement: "%",
          icon: "💧",
        },
      }),
    ];
  });

  it("should filter by friendly name", () => {
    const result = filterEntitiesByAttribute(
      entities,
      "friendly_name",
      "Temperature",
    );
    expect(result.length).toBe(1);
    expect(result[0]!.entity_id).toBe("sensor.temperature");
  });

  it("should filter by unit_of_measurement", () => {
    const result = filterEntitiesByAttribute(
      entities,
      "unit_of_measurement",
      "°C",
    );
    expect(result.length).toBe(1);
    expect(result[0]!.entity_id).toBe("sensor.temperature");
  });

  it("should return empty array when no matches", () => {
    const result = filterEntitiesByAttribute(
      entities,
      "unit_of_measurement",
      "°F",
    );
    expect(result.length).toBe(0);
  });
});

describe("groupEntitiesByDomain", () => {
  let entities: HAEntity[];

  beforeEach(() => {
    entities = [
      createMockEntity({ entity_id: "light.living_room", state: "on" }),
      createMockEntity({ entity_id: "switch.kitchen", state: "off" }),
      createMockEntity({ entity_id: "sensor.temperature", state: "20" }),
      createMockEntity({ entity_id: "light.bedroom", state: "off" }),
    ];
  });

  it("should group entities by domain", () => {
    const result = groupEntitiesByDomain(entities);
    expect(result["light"]).toHaveLength(2);
    expect(result["switch"]).toHaveLength(1);
    expect(result["sensor"]).toHaveLength(1);
  });

  it("should handle empty entity array", () => {
    const result = groupEntitiesByDomain([]);
    expect(result).toEqual({});
  });
});

describe("sortEntitiesByName", () => {
  let entities: HAEntity[];

  beforeEach(() => {
    entities = [
      createMockEntity({
        entity_id: "sensor.temperature",
        state: "20",
        attributes: { friendly_name: "Temperature" },
      }),
      createMockEntity({
        entity_id: "sensor.humidity",
        state: "50",
        attributes: { friendly_name: "Humidity" },
      }),
      createMockEntity({
        entity_id: "light.living_room",
        state: "on",
        attributes: { friendly_name: "Living Room" },
      }),
      createMockEntity({
        entity_id: "light.bedroom",
        state: "off",
        attributes: { friendly_name: "Bedroom" },
      }),
    ];
  });

  it("should sort entities alphabetically by friendly name", () => {
    const result = sortEntitiesByName(entities);
    // Bedroom < Humidity < Living Room < Temperature
    expect(result[0]!.entity_id).toBe("light.bedroom");
    expect(result[1]!.entity_id).toBe("sensor.humidity");
    expect(result[2]!.entity_id).toBe("light.living_room");
    expect(result[3]!.entity_id).toBe("sensor.temperature");
  });

  it("should sort entities without friendly name by entity_id", () => {
    const entitiesWithoutNames: HAEntity[] = [
      createMockEntity({ entity_id: "sensor.temperature", state: "20" }),
      createMockEntity({ entity_id: "sensor.humidity", state: "50" }),
    ];

    const result = sortEntitiesByName(entitiesWithoutNames);
    expect(result[0]!.entity_id).toBe("sensor.humidity");
    expect(result[1]!.entity_id).toBe("sensor.temperature");
  });
});

describe("hasReachedExpectedState", () => {
  const make = (
    id: string,
    state: string,
    attributes: Record<string, unknown> = {},
  ): HAEntity => ({
    entity_id: id,
    state,
    attributes,
    last_changed: "",
    last_reported: "",
    last_updated: "",
    context: { id: "", parent_id: null, user_id: null },
  });

  it("toggle is confirmed only once the state flips", () => {
    const before = make("light.a", "off");
    expect(
      hasReachedExpectedState("toggle", before, make("light.a", "off")),
    ).toBe(false);
    expect(
      hasReachedExpectedState("toggle", before, make("light.a", "on")),
    ).toBe(true);
  });

  it("turn_on / turn_off check the target state", () => {
    const before = make("light.a", "off");
    expect(
      hasReachedExpectedState("turn_on", before, make("light.a", "on")),
    ).toBe(true);
    expect(hasReachedExpectedState("turn_on", before, before)).toBe(false);
    expect(
      hasReachedExpectedState("turn_off", make("light.a", "on"), before),
    ).toBe(true);
  });

  it("cover commands accept the in-motion state", () => {
    const before = make("cover.a", "closed");
    expect(
      hasReachedExpectedState("open_cover", before, make("cover.a", "opening")),
    ).toBe(true);
    expect(hasReachedExpectedState("open_cover", before, before)).toBe(false);
    expect(
      hasReachedExpectedState("stop_cover", before, make("cover.a", "opening")),
    ).toBe(false);
  });

  it("run_script is confirmed by running state or new last_triggered", () => {
    const before = make("script.a", "off", { last_triggered: "t1" });
    expect(hasReachedExpectedState("run_script", before, before)).toBe(false);
    expect(
      hasReachedExpectedState(
        "run_script",
        before,
        make("script.a", "on", { last_triggered: "t1" }),
      ),
    ).toBe(true);
    expect(
      hasReachedExpectedState(
        "run_script",
        before,
        make("script.a", "off", { last_triggered: "t2" }),
      ),
    ).toBe(true);
  });

  it("scripts get a Run action", () => {
    const actions = getEntityActions(make("script.goodnight", "off"));
    expect(actions.map((a) => a.action)).toContain("run_script");
  });
});
