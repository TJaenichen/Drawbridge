import { describe, expect, it } from "vitest";
import { buildAuthHeader } from "../src/exec/auth.js";
import { ConfigError } from "../src/model.js";

describe("auth header building", () => {
  it("bearer", () => {
    expect(buildAuthHeader({ type: "bearer", secret_env: "TOK" }, { TOK: "abc" })).toEqual({
      name: "authorization",
      value: "Bearer abc",
    });
  });

  it("header (custom name, raw secret)", () => {
    expect(buildAuthHeader({ type: "header", name: "X-Api-Key", secret_env: "KEY" }, { KEY: "sk-1" })).toEqual({
      name: "X-Api-Key",
      value: "sk-1",
    });
  });

  it("basic (base64 of user:pass)", () => {
    const h = buildAuthHeader({ type: "basic", username_env: "U", password_env: "P" }, { U: "alice", P: "pw" });
    expect(h.name).toBe("authorization");
    expect(h.value).toBe("Basic " + Buffer.from("alice:pw").toString("base64"));
    expect(Buffer.from(h.value.slice(6), "base64").toString()).toBe("alice:pw");
  });

  it("throws when an auth env var is unset", () => {
    expect(() => buildAuthHeader({ type: "bearer", secret_env: "TOK" }, {})).toThrow(ConfigError);
    expect(() => buildAuthHeader({ type: "basic", username_env: "U", password_env: "P" }, { U: "x" })).toThrow(ConfigError);
  });
});
