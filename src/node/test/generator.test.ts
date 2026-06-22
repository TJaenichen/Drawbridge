import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { generateTools } from "../src/tools/generator.js";
import { fixtureConfig, loadFixtures } from "./fixtures.js";

describe("tool generation (golden fixtures)", () => {
  for (const fx of loadFixtures("tools")) {
    it(fx.description, () => {
      const config = loadConfig(fixtureConfig(fx), fx.env ?? {});
      const tools = generateTools(config).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      expect(tools).toEqual(fx.expected_tools);
    });
  }
});
