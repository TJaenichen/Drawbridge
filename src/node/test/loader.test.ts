import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/model.js";
import { loadConfig } from "../src/config/loader.js";

const cfg = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  platforms: {
    p: {
      base_url: "${BASE}",
      auth: { type: "bearer", secret_env: "TOK" },
      operations: [{ name: "op", description: "d", method: "GET", path: "/p" }],
      ...overrides,
    },
  },
});

describe("config loading + ${ENV} resolution", () => {
  it("interpolates ${VAR} in base_url", () => {
    const c = loadConfig(cfg(), { BASE: "https://svc.internal", TOK: "t" });
    expect(c.platforms.p!.base_url).toBe("https://svc.internal");
  });

  it("fails fast when an interpolated var is unset", () => {
    expect(() => loadConfig(cfg(), { TOK: "t" })).toThrow(/Missing required environment variable.*BASE/);
  });

  it("fails fast when an auth *_env var is unset", () => {
    expect(() => loadConfig(cfg(), { BASE: "https://svc.internal" })).toThrow(/Missing required environment variable.*TOK/);
  });

  it("reports all missing vars at once", () => {
    expect(() => loadConfig(cfg(), {})).toThrow(/BASE, TOK/);
  });
});
