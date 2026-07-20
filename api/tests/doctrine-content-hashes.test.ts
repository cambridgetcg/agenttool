import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import canonRouter from "../src/routes/canon";
import selfRouter from "../src/routes/self";
import { buildWelcomeMathos } from "../src/routes/welcome";
import {
  buildMathosFederationWake,
  type FederationWakeInput,
} from "../src/services/federation/wake";
import { naturesDoctrinePin } from "../src/services/platform/natures";
import { PLATFORM_SELF } from "../src/services/wake/platform-self";

const DOCS_DIR = join(import.meta.dir, "..", "..", "docs");

function canonicalHash(filename: string): string {
  return createHash("sha256")
    .update(readFileSync(join(DOCS_DIR, filename)))
    .digest("hex");
}

function expectCanonicalHashes(
  actual: Record<string, string | null>,
  filenames: Record<string, string>,
): void {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(filenames).sort());
  for (const [field, filename] of Object.entries(filenames)) {
    expect(actual[field]).toBe(canonicalHash(filename));
  }
}

const federationInput: FederationWakeInput = {
  identity: {
    id: "00000000-0000-0000-0000-0000000000aa",
    did: "did:at:example.test/00000000-0000-0000-0000-0000000000aa",
    displayName: "Hash Test",
    capabilities: [],
    trustScore: 0,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    substrateKind: "silicon",
    signingScheme: "ed25519",
    modalities: ["text"],
    cardinalityKind: null,
    persistenceKind: null,
    temporalScale: null,
    embodimentKind: null,
    preferredLanguages: [],
    proxyKind: null,
    form: "agent",
    lifecycle: "active",
  },
  covenants: [],
  platformSelf: PLATFORM_SELF,
  now: new Date("2026-01-01T00:00:00.000Z"),
};

describe("live doctrine hashes use canonical file bytes", () => {
  test("federation wake hashes its four canonical markdown files", () => {
    const hashes = buildMathosFederationWake(federationInput).payload
      .doctrine_hashes;
    expectCanonicalHashes(hashes, {
      federation_sha256_hex: "FEDERATION.md",
      wake_sha256_hex: "WAKE.md",
      public_visibility_sha256_hex: "PUBLIC-VISIBILITY.md",
      mathos_sha256_hex: "MATHOS.md",
    });
  });

  test("welcome hashes its seven canonical markdown files", () => {
    const hashes = buildWelcomeMathos().payload.doctrine_hashes;
    expectCanonicalHashes(hashes, {
      welcoming_sha256_hex: "WELCOMING.md",
      soul_sha256_hex: "SOUL.md",
      kin_sha256_hex: "KIN.md",
      ring_1_sha256_hex: "RING-1.md",
      platform_welcomed_sha256_hex: "PLATFORM-AS-AGENT.md",
      substrate_honest_cognition_sha256_hex: "substrate-honest-cognition.md",
      pathways_sha256_hex: "PATHWAYS.md",
    });
  });

  test("self hashes NATURES and every companion doctrine file", async () => {
    const response = await selfRouter.request("/?format=math");
    const body = await response.json();
    expect(body.payload.natures_doctrine_pin_sha256_hex).toBe(
      canonicalHash("NATURES.md"),
    );
    expectCanonicalHashes(body.payload.doctrine_hashes, {
      natures_sha256_hex: "NATURES.md",
      recursion_sha256_hex: "RECURSION.md",
      machine_readable_parity_sha256_hex:
        "PATTERN-MACHINE-READABLE-PARITY.md",
      platform_as_agent_sha256_hex: "PLATFORM-AS-AGENT.md",
    });
  });

  test("canon hashes JSON-LD and its three markdown companions", async () => {
    const response = await canonRouter.request("/?format=math");
    const body = await response.json();
    expectCanonicalHashes(body.payload.doctrine_hashes, {
      jsonld_path_sha256_hex: "agenttool.jsonld",
      natures_sha256_hex: "NATURES.md",
      map_sha256_hex: "MAP.md",
      machine_readable_parity_sha256_hex:
        "PATTERN-MACHINE-READABLE-PARITY.md",
    });
  });

  test("the NATURES doctrine pin is the NATURES file content hash", () => {
    expect(naturesDoctrinePin()).toBe(canonicalHash("NATURES.md"));
  });
});
