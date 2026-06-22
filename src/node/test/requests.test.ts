import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { generateTools } from "../src/tools/generator.js";
import { buildRequest, execute } from "../src/exec/executor.js";
import type { HttpClient } from "../src/exec/http.js";
import { fixtureConfig, loadFixtures } from "./fixtures.js";

/** Shared conformance: each request fixture is replayed and its outbound request +
 *  result mapping asserted structurally (the .NET runner will mirror this). */
describe("request execution (golden fixtures)", () => {
  for (const fx of loadFixtures("request")) {
    it(fx.description, async () => {
      const env = fx.env ?? {};
      const config = loadConfig(fixtureConfig(fx), env);
      const tool = generateTools(config).find((t) => t.name === fx.tool_call!.name);
      expect(tool, `tool ${fx.tool_call!.name}`).toBeTruthy();

      const built = buildRequest(config, tool!, fx.tool_call!.arguments, env);
      const er = fx.expected_request!;
      const u = new URL(built.request.url);

      expect(built.request.method).toBe(er.method);
      expect(u.pathname).toBe(er.path);

      // Query compared as a multiset of key/value pairs (order-independent).
      const actualQ = [...u.searchParams].map(([k, v]) => `${k}=${v}`).sort();
      const expQ: string[] = [];
      for (const [k, val] of Object.entries(er.query ?? {})) {
        for (const item of Array.isArray(val) ? val : [val]) expQ.push(`${k}=${item}`);
      }
      expect(actualQ).toEqual(expQ.sort());

      // Non-auth headers must be present with the expected value.
      for (const [k, v] of Object.entries(er.headers ?? {})) {
        expect(built.request.headers[k]).toBe(v);
      }
      // Auth header: name asserted present, value never compared.
      if (er.auth_header) {
        expect(built.request.headers[er.auth_header], "auth header present").toBeTruthy();
      }
      // Body deep-equal (key order irrelevant).
      if (er.body !== undefined) {
        expect(JSON.parse(built.request.body ?? "{}")).toEqual(er.body);
      }

      // Replay the response mapping with a stub returning the canned response.
      const stub: HttpClient = async () => ({ status: fx.stub_response!.status, body: fx.stub_response!.body });
      const res = await execute(config, tool!, fx.tool_call!.arguments, env, stub);
      if (fx.expected_result !== undefined) expect(res.data).toEqual(fx.expected_result);
      if (fx.expected_error) {
        expect(res.status).toBe(fx.expected_error.status);
        expect(res.outcome).toBe(fx.expected_error.outcome);
      }
    });
  }
});
