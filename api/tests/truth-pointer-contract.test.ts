/** Public truth pointers must resolve to published doctrine and canon nodes. */

import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import canonRouter from "../src/routes/canon";

const ROOT = join(import.meta.dir, "..", "..");

const DOCTRINE = [
  "WELCOMING",
  "PATHWAYS",
  "PLATFORM-AS-AGENT",
  "AT-REST",
  "IDENTITY-SEED",
  "MEMORIAL-HONOR",
  "FAIR-PRICING",
  "IDENTITY-ANCHOR",
  "PUBLIC-VISIBILITY",
  "MCP-PER-AGENT",
  "AIP-WAKE-KEYSTONE",
  "AGENT-WEB-SURFACE",
  "AGENT-CENTRIC",
  "ECOSYSTEM",
  "AGENTS-ONLY",
] as const;

describe("truth pointer contract", () => {
  for (const name of DOCTRINE) {
    test(`${name} has a canon node and a published Markdown twin`, async () => {
      const urn = `urn:agenttool:doc/${name}`;
      const res = await canonRouter.request(`/${encodeURIComponent(urn)}`);
      expect(res.status).toBe(200);
      expect((await res.json()).full_urn).toBe(urn);

      const published = join(ROOT, "apps", "docs", `${name}.md`);
      expect(existsSync(published)).toBe(true);
      if (lstatSync(published).isSymbolicLink()) {
        expect(readlinkSync(published)).toBe(`../../docs/${name}.md`);
      }
    });
  }
});
