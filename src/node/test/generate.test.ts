import { describe, expect, it } from "vitest";
import { generateConfig } from "../src/generate/openapi.js";
import { validateConfig } from "../src/config/validator.js";
import { fixtureOpenApi, loadFixtures } from "./fixtures.js";

describe("OpenAPI -> draft config generation (golden fixtures)", () => {
  for (const fx of loadFixtures("generate")) {
    it(fx.description, () => {
      const config = generateConfig(fixtureOpenApi(fx) as Record<string, unknown>, fx.platform!);
      expect(config).toEqual(fx.expected_config);
      // A generated draft must itself be a valid config.
      expect(() => validateConfig(config)).not.toThrow();
    });
  }
});
