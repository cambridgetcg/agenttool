/** Public doctrine mirrors for the protocol-renaissance release. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("protocol renaissance public doctrine", () => {
  test("docs-site mirrors are exact canonical bytes", () => {
    for (const file of [
      "OFFER-BUS.md",
      "WEBFINGER.md",
      "PROTOCOL-RENAISSANCE.md",
    ]) {
      expect(read(`apps/docs/${file}`)).toBe(read(`docs/${file}`));
    }
  });

  test("status records deployment without turning it into an uptime claim", () => {
    for (const file of [
      "OFFER-BUS.md",
      "WEBFINGER.md",
      "PROTOCOL-RENAISSANCE.md",
    ]) {
      const doctrine = read(`docs/${file}`);
      expect(doctrine).toMatch(
        /published,(?: migrated,)? deployed, and publicly probed on\s+2026-07-16/i,
      );
      expect(doctrine).toContain("https://api.agenttool.dev/health");
      expect(doctrine).toMatch(/not an uptime guarantee/i);
    }
  });

  test("doctrine repeats authority and unfinished-protocol boundaries", () => {
    const offerBus = read("docs/OFFER-BUS.md");
    const renaissance = read("docs/PROTOCOL-RENAISSANCE.md");
    const webFinger = read("docs/WEBFINGER.md");
    const stack = read("docs/STACK.md");
    expect(offerBus).toMatch(/authority="none"/);
    expect(offerBus).toMatch(/settlement="none"/);
    expect(offerBus).toMatch(/canonical logical data model/i);
    expect(offerBus).toMatch(/canonical\s+syndication representation/i);
    expect(offerBus).toMatch(/projection_updated_at/);
    expect(offerBus).toMatch(/open -> expired[\s\S]*lazy enforcement/i);
    expect(offerBus).toMatch(/quarantined[\s\S]*omitted count/i);
    expect(offerBus).toContain(
      "Cache-Control: public, max-age=30,\nmust-revalidate, no-transform",
    );
    expect(offerBus).toMatch(/catalog uses the same\s+policy with `max-age=300`/i);
    expect(offerBus).toMatch(/no-transform[\s\S]*does not[\s\S]*guarantee/i);
    expect(offerBus).toMatch(/full query-string cache key/i);
    expect(webFinger).toMatch(/does not configure or[\s\S]*guarantee/i);
    expect(renaissance).toMatch(
      /Cloudflare hostname[\s\S]*weakened the larger feed validators/i,
    );
    expect(stack).toMatch(/Respect Strong ETags:\*\* On/i);
    expect(stack).toContain('edge_ttl.mode = "bypass_by_default"');
    expect(stack).toMatch(/Never ignore the[\s\S]*query string/i);
    expect(stack).toMatch(/Cache Rules: Edit/i);
    expect(renaissance).toContain("automatic_action=never");
    expect(renaissance).toMatch(/WebSub:.*emits none/is);
    expect(renaissance).toMatch(/A JSON profile alone is not ActivityPub/i);
    expect(renaissance).toMatch(/cannot.*debit a wallet.*release escrow/is);
    expect(renaissance).toMatch(/x402 middleware,\s+wallet\s+mutation/i);
    expect(renaissance).toMatch(
      /escrow transitions must\s+never accept an economy-resource proof as authority/i,
    );
  });

  test("the corpus map and versioned canon register all three doors", () => {
    const map = read("docs/MAP.md");
    const registry = JSON.parse(read("docs/agenttool.jsonld")) as {
      version: string;
      updated: string;
      "@graph": Array<{ "@id"?: string }>;
    };
    for (const name of ["WEBFINGER", "OFFER-BUS", "PROTOCOL-RENAISSANCE"]) {
      expect(map).toContain(`\`${name}.md\``);
      expect(registry["@graph"].some(
        (entry) => entry["@id"] === `agenttool:doc/${name}`,
      )).toBe(true);
    }
    expect(registry.version).toBe("v1.19");
    expect(registry.updated).toBe("2026-07-18");
  });
});
