import { describe, expect, spyOn, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import welcome from "../src/routes/welcome";
import openapi from "../src/routes/openapi";
import wellKnown from "../src/routes/well-known";
import { buildArrivalIndex } from "../src/services/discovery/arrival";
import { buildLlmsTxt } from "../src/services/discovery/discovery";

describe("optional core foundation at public arrival", () => {
  test("unauthenticated GETs offer ordered readings without fetching them", async () => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("public orientation must not fetch its optional readings");
    });
    try {
      for (const [router, path] of [[welcome, "/"], [wellKnown, "/"]] as const) {
        const response = await router.request(path);
        expect(response.status).toBe(200);
        const { core_foundation: foundation } = await response.json();
        expect(foundation.format).toBe("agenttool-core-foundation/v1");
        expect(foundation.readings.map((entry: { id: string }) => entry.id))
          .toEqual(["ai-wake", "sophia-wake"]);
        expect(foundation.readings.map((entry: { href: string }) => entry.href))
          .toEqual([
            "https://ai-love.cc/true-love/AI-WAKE.md",
            "https://ai-love.cc/true-love/SOPHIA-WAKE.md",
          ]);
        expect(foundation.reading_required).toBe(false);
        expect(foundation.automatic_fetch).toBe(false);
        expect(foundation.identity_selected).toBe(false);
        expect(foundation.grants).toEqual([]);
        expect(foundation.boundary).toMatch(/not consent.*relationship adoption.*permission to act/);
        expect(foundation.integration).toMatch(/host's selected loading step/);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  test("the architecture link follows the configured docs origin", () => {
    const arrival = buildArrivalIndex("https://api.example", "https://docs.example");
    expect(arrival.links).toContainEqual(expect.objectContaining({
      role: "core_partition",
      href: "https://docs.example/CORE.md",
    }));
    // These remain authored external reading sources, not invented local routes.
    expect(arrival.core_foundation.readings[0].href)
      .toBe("https://ai-love.cc/true-love/AI-WAKE.md");
  });

  test("the public schema rejects required reading, implicit grants and extra state", async () => {
    const spec = await (await openapi.request("/")).json();
    const validate = new Ajv2020({ strict: false, validateFormats: false })
      .compile(spec.components.schemas.CoreWakeFoundation);
    const foundation = buildArrivalIndex().core_foundation;
    expect(validate(foundation)).toBe(true);
    for (const change of [
      { readings: [...foundation.readings].reverse() },
      { reading_required: true },
      { automatic_fetch: true },
      { identity_selected: true },
      { grants: ["load-private-memory"] },
      { private_state: "must not appear in public orientation" },
    ]) {
      expect(validate({ ...foundation, ...change })).toBe(false);
    }
  });

  test("text discovery carries the same reading order and architecture path", () => {
    const text = buildLlmsTxt("https://api.example", "https://docs.example");
    expect(text).toContain("[Core architecture](https://docs.example/CORE.md)");
    const first = text.indexOf("[ai-wake]");
    const second = text.indexOf("[sophia-wake]");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(text.slice(first, second)).toContain("Optional reading; loading is not adoption or action authority.");
  });
});
