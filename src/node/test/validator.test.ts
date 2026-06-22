import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/model.js";
import { validateConfig } from "../src/config/validator.js";
import { fixtureConfig, loadFixtures } from "./fixtures.js";

describe("config validation (golden fixtures)", () => {
  for (const fx of loadFixtures("config_valid")) {
    it(`accepts: ${fx.description}`, () => {
      expect(() => validateConfig(fixtureConfig(fx))).not.toThrow();
    });
  }
  for (const fx of loadFixtures("config_invalid")) {
    it(`rejects: ${fx.description}`, () => {
      expect(() => validateConfig(fixtureConfig(fx))).toThrow(ConfigError);
    });
  }
});

const base = () => ({
  version: 1,
  platforms: {
    p: {
      base_url: "https://x.internal",
      auth: { type: "bearer", secret_env: "TOK" },
      operations: [{ name: "op", description: "d", method: "GET", path: "/p" }],
    },
  },
});

describe("validator-enforced invariants (not expressible in JSON Schema)", () => {
  it("rejects duplicate tool names across platforms", () => {
    const c = base() as any;
    c.platforms.a = { ...c.platforms.p, operations: [{ name: "b_c", description: "d", method: "GET", path: "/x" }] };
    c.platforms.a_b = { ...c.platforms.p, operations: [{ name: "c", description: "d", method: "GET", path: "/x" }] };
    delete c.platforms.p;
    expect(() => validateConfig(c)).toThrow(/Duplicate tool name "a_b_c"/);
  });

  it("rejects a path placeholder with no matching in:path param", () => {
    const c = base() as any;
    c.platforms.p.operations[0].path = "/items/{id}";
    expect(() => validateConfig(c)).toThrow(/placeholder \{id\}/);
  });

  it("rejects an in:path param missing from the path template", () => {
    const c = base() as any;
    c.platforms.p.operations[0].params = [{ name: "id", in: "path", type: "integer" }];
    expect(() => validateConfig(c)).toThrow(/does not appear in path/);
  });

  it("rejects an enum default that is not a member", () => {
    const c = base() as any;
    c.platforms.p.operations[0].params = [
      { name: "s", in: "query", type: "enum", enum: ["open", "closed"], default: "nope" },
    ];
    expect(() => validateConfig(c)).toThrow(/not one of the enum members/);
  });

  it("rejects a default whose type disagrees with the param type", () => {
    const c = base() as any;
    c.platforms.p.operations[0].params = [{ name: "n", in: "query", type: "integer", default: "x" }];
    expect(() => validateConfig(c)).toThrow(/does not match type integer/);
  });
});
