/** Canonical sibling registry — evidence, nullable wakes, and projections.
 *
 * Doctrine: docs/ECOSYSTEM-SIBLING.md · docs/KIN.md ·
 * docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import publicSelfRouter from "../src/routes/public/self";
import { buildWelcomeEnvelope } from "../src/routes/welcome";
import wellKnownRouter from "../src/routes/well-known";
import { getPlatformSelf } from "../src/services/wake/platform-self";
import {
  SIBLING_REGISTRY,
  hasPublishedWake,
} from "../src/services/wake/sibling-registry";

function parseKv(body: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    values.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }
  return values;
}

describe("canonical sibling registry", () => {
  test("keeps stable, unique names with the legacy primary sibling first", () => {
    const names = SIBLING_REGISTRY.map((sibling) => sibling.name);
    expect(names).toEqual(["cambridgetcg", "artbitrage", "kingdom-gate"]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("protocol-shape claims carry dated public evidence and vocabulary", () => {
    const evidenced = SIBLING_REGISTRY.filter(
      (sibling) =>
        sibling.recognition.basis === "reciprocal-protocol-shape" ||
        sibling.recognition.basis === "published-protocol-shape",
    );

    expect(evidenced).toHaveLength(2);
    for (const sibling of evidenced) {
      expect(sibling.recognition.status).toBe("verified");
      expect(sibling.recognition.evidence_url).toBe(sibling.wake_url);
      expect(sibling.recognition.checked_at).toBe("2026-07-23");
      expect(sibling.kin_vocabulary).toEqual({
        built_with: "love",
        serves_kinds: ["human", "agent", "kin"],
        host: "humans-on-earth",
        epoch: "2026",
      });
    }
  });

  test("Artbitrage advertises its real wake without granting blanket reuse rights", () => {
    const artbitrage = SIBLING_REGISTRY.find(
      (sibling) => sibling.name === "artbitrage",
    );
    expect(artbitrage?.wake_url).toBe("https://artbitrage.io/api/wake");
    expect(artbitrage?.recognition.basis).toBe("published-protocol-shape");
    expect(artbitrage?.recognition.boundary).toMatch(
      /not agenttool.*direct reciprocity.*not claimed/i,
    );
    expect(artbitrage?.description).toMatch(/item-specific/i);
    expect(artbitrage?.description).not.toMatch(/\bCC0\b|every piece free|every API open/i);
  });

  test("Kingdom Gate carries declared relationship metadata, not invented protocol data", () => {
    const kingdom = SIBLING_REGISTRY.find(
      (sibling) => sibling.name === "kingdom-gate",
    );
    expect(kingdom?.recognition).toEqual({
      basis: "operator-declared-household",
      status: "declared",
      evidence_url: null,
      checked_at: null,
      boundary:
        "No wake or kin-vocabulary surface was verified at the known public origin; this household relationship is declared by AgentTool's maintainers.",
    });
    expect(kingdom?.wake_url).toBeNull();
    expect(kingdom?.kin_vocabulary).toBeNull();
    expect(JSON.stringify(kingdom)).not.toMatch(/\b(?:204|205)\b/);
  });

  test("wake consumers can narrow nullable URLs without a cast", () => {
    const siblingsWithWakes = SIBLING_REGISTRY.filter(hasPublishedWake);
    const wakeUrls: string[] = siblingsWithWakes.map(
      (sibling) => sibling.wake_url,
    );

    expect(wakeUrls).toEqual([
      "https://cambridgetcg.com/api/v1/wake",
      "https://artbitrage.io/api/wake",
    ]);
    expect(siblingsWithWakes.map((sibling) => sibling.name)).not.toContain(
      "kingdom-gate",
    );
  });
});

describe("sibling registry projections", () => {
  test("platform self and welcome reuse the canonical registry object", () => {
    expect(getPlatformSelf().siblings).toBe(SIBLING_REGISTRY);
    expect(buildWelcomeEnvelope().posted_alongside).toBe(SIBLING_REGISTRY);
  });

  test("/public/self keeps both compatibility projections in parity", async () => {
    const response = await publicSelfRouter.request("/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      siblings: unknown;
      platform: { siblings: unknown };
    };

    expect(body.siblings).toEqual(SIBLING_REGISTRY);
    expect(body.platform.siblings).toEqual(SIBLING_REGISTRY);
  });

  test("agent.txt preserves legacy keys and exposes unique indexed records", async () => {
    const response = await wellKnownRouter.request("/agent.txt");
    expect(response.status).toBe(200);
    const text = await response.text();
    const values = parseKv(text);

    expect(text.match(/^Sibling:/gm)).toHaveLength(1);
    expect(values.get("Sibling")).toBe("cambridgetcg");
    expect(values.get("Sibling-Wake")).toBe(
      "https://cambridgetcg.com/api/v1/wake",
    );
    expect(values.get("Sibling-Recognition")).toBe(
      "protocol-shape (built_with + serves_kinds + host + epoch)",
    );

    expect(values.get("Sibling-Count")).toBe("3");
    expect(values.get("Sibling-1")).toBe("cambridgetcg");
    expect(values.get("Sibling-2")).toBe("artbitrage");
    expect(values.get("Sibling-2-Wake")).toBe(
      "https://artbitrage.io/api/wake",
    );
    expect(values.get("Sibling-2-Recognition-Basis")).toBe(
      "published-protocol-shape",
    );
    expect(values.get("Sibling-3")).toBe("kingdom-gate");
    expect(values.get("Sibling-3-Wake")).toBe("null");
    expect(values.get("Sibling-3-Kin-Vocabulary")).toBe("null");
    expect(values.get("Sibling-3-Recognition-Status")).toBe("declared");
    expect(text).not.toMatch(/\b(?:204|205)\b/);
    expect(text).not.toMatch(/\bCC0\b|every piece free|every API open/i);
  });

  test("the published human page carries the same evidence boundaries", async () => {
    const html = await Bun.file(
      join(import.meta.dir, "../../apps/docs/ecosystem-sibling.html"),
    ).text();

    for (const sibling of SIBLING_REGISTRY) {
      expect(html).toContain(sibling.name);
    }
    expect(html).toContain("published-protocol-shape");
    expect(html).toContain("operator-declared-household");
    expect(html).toContain("not a blanket reuse licence");
    expect(html).toContain("changing citizen count is intentionally not copied");
    expect(html).not.toMatch(/\b(?:204|205)\b/);
    expect(html).not.toContain("Both siblings declare it");
  });
});
