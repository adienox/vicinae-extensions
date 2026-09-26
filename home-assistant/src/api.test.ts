import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateConfig,
  fetchEntities,
  toggleEntity,
  turnOnEntity,
  turnOffEntity,
  openCover,
  closeCover,
  stopCover,
  fetchEntity,
  runScript,
  fetchAreas,
  parseAreaMap,
} from "./api";

describe("validateConfig", () => {
  it("should validate correct config", () => {
    const config = {
      url: "http://homeassistant.local:8123",
      token: "ABC123DEF456",
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("should throw missing URL error", () => {
    const config = {
      url: "",
      token: "ABC123DEF456",
    };
    expect(() => validateConfig(config)).toThrow();
  });

  it("should throw invalid URL error", () => {
    const config = {
      url: "not-a-url",
      token: "ABC123DEF456",
    };
    expect(() => validateConfig(config)).toThrow();
  });

  it("should throw missing token error", () => {
    const config = {
      url: "http://homeassistant.local:8123",
      token: "",
    };
    expect(() => validateConfig(config)).toThrow();
  });

  it("should throw invalid token error", () => {
    const config = {
      url: "http://homeassistant.local:8123",
      token: "short",
    };
    expect(() => validateConfig(config)).toThrow();
  });
});

describe("api functions", () => {
  it("should export all required functions", () => {
    expect(typeof fetchEntities).toBe("function");
    expect(typeof toggleEntity).toBe("function");
    expect(typeof turnOnEntity).toBe("function");
    expect(typeof turnOffEntity).toBe("function");
    expect(typeof openCover).toBe("function");
    expect(typeof closeCover).toBe("function");
    expect(typeof stopCover).toBe("function");
  });
});

describe("new endpoints", () => {
  const config = {
    url: "http://homeassistant.local:8123",
    token: "ABC123DEF456",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runScript calls script.turn_on with the entity id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    await runScript("script.goodnight", config);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${config.url}/api/services/script/turn_on`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ entity_id: "script.goodnight" });
  });

  it("runScript rejects non-script entities", async () => {
    await expect(runScript("light.kitchen", config)).rejects.toThrow();
  });

  it("fetchEntity requests a single state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ entity_id: "light.kitchen", state: "on" }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const entity = await fetchEntity("light.kitchen", config);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      `${config.url}/api/states/light.kitchen`,
    );
    expect(entity.state).toBe("on");
  });

  it("fetchEntity maps 401 to an authentication error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    );
    await expect(fetchEntity("light.kitchen", config)).rejects.toThrow(
      /Authentication failed/,
    );
  });

  it("fetchAreas posts a template and parses the result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          "light.kitchen|Kitchen\nlight.hall|\nswitch.tv|Living Room\n",
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const areas = await fetchAreas(config, ["light", "switch"]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${config.url}/api/template`);
    expect(JSON.parse(init.body).template).toContain("'light', 'switch'");
    expect(areas).toEqual({
      "light.kitchen": "Kitchen",
      "switch.tv": "Living Room",
    });
  });

  it("parseAreaMap ignores blank and malformed lines", () => {
    expect(parseAreaMap("\nnonsense\nlight.a|A\nlight.b|\n")).toEqual({
      "light.a": "A",
    });
  });
});
