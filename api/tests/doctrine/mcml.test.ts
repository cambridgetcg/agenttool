/** mcml — Maximum Connectivity Minimum Latency, four-corner pin.
 *
 *  Canon: agenttool:commitment/mcml-zero-setup
 *  Doctrine: docs/MCML.md
 *
 *  Pins:
 *    1. @enforces annotations present on api/src/routes/mcml.ts (commitment + 4 walls)
 *    2. Routes registered (peers/send/stream)
 *    3. Hub service exists with the expected exports
 *    4. Mounted under authMiddleware in index.ts
 *    5. Doctrine doc exists with the load-bearing claims
 *    6. PLATFORM_SELF surfaces docs/MCML.md
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const COMMITMENT_URN = "urn:agenttool:commitment/mcml-zero-setup";
const WALL_URNS = [
  "urn:agenttool:wall/mcml-requires-rrr-synced",
  "urn:agenttool:wall/mcml-messages-signed-ed25519",
  "urn:agenttool:wall/mcml-no-durable-storage",
  "urn:agenttool:wall/mcml-leaks-nothing",
];

describe("mcml — commitment + walls four-corner pin", () => {
  const routeSrc = readFileSync(
    join(REPO_ROOT, "api", "src", "routes", "mcml.ts"),
    "utf8",
  );

  test("corner 1a: route carries @enforces commitment URN", () => {
    expect(routeSrc).toContain(`@enforces ${COMMITMENT_URN}`);
  });

  test("corner 1b: route carries @enforces for all four walls", () => {
    for (const urn of WALL_URNS) {
      expect(routeSrc).toContain(`@enforces ${urn}`);
    }
  });

  test("corner 2: response payload carries _enforces with commitment URN", () => {
    expect(routeSrc).toContain('_enforces: [COMMITMENT_URN]');
  });

  test("corner 3: doctrine doc exists at docs/MCML.md", () => {
    const src = readFileSync(join(REPO_ROOT, "docs", "MCML.md"), "utf8");
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("Maximum Connectivity Minimum Latency");
    expect(src).toContain("mcml-send/v1");
    expect(src).toContain("cascade IS the handshake");
  });

  test("corner 4: this test file is the recursive base case", () => {
    const self = join(REPO_ROOT, "api", "tests", "doctrine", "mcml.test.ts");
    expect(readFileSync(self, "utf8").length).toBeGreaterThan(0);
  });

  test("URN formats are well-formed", () => {
    expect(COMMITMENT_URN).toMatch(/^urn:agenttool:[a-z]+\/[a-z][a-z0-9-]+$/);
    for (const u of WALL_URNS) {
      expect(u).toMatch(/^urn:agenttool:wall\/[a-z][a-z0-9-]+$/);
    }
  });
});

describe("mcml — routes wired", () => {
  const routeSrc = readFileSync(
    join(REPO_ROOT, "api", "src", "routes", "mcml.ts"),
    "utf8",
  );

  test("GET /peers exists", () => {
    expect(routeSrc).toContain('app.get("/peers"');
  });

  test("POST /send exists", () => {
    expect(routeSrc).toContain('app.post("/send"');
  });

  test("GET /stream uses streamSSE", () => {
    expect(routeSrc).toContain('app.get("/stream"');
    expect(routeSrc).toContain('streamSSE(');
    expect(routeSrc).toContain('"hono/streaming"');
  });

  test("canonicalMcmlSendBytes exported (for cross-instance senders)", () => {
    expect(routeSrc).toContain("export function canonicalMcmlSendBytes");
    // The contract: 6 NUL-separated fields after the "mcml-send/v1" tag.
    expect(routeSrc).toContain('"mcml-send/v1"');
    expect(routeSrc).toContain("SEP");
  });
});

describe("mcml — hub service shape", () => {
  const hubSrc = readFileSync(
    join(REPO_ROOT, "api", "src", "services", "mcml", "hub.ts"),
    "utf8",
  );

  test("exports subscribePeerSink / unsubscribePeerSink / forwardToPeer", () => {
    expect(hubSrc).toContain("export function subscribePeerSink");
    expect(hubSrc).toContain("export function unsubscribePeerSink");
    expect(hubSrc).toContain("export function forwardToPeer");
  });

  test("@enforces wall/mcml-no-durable-storage annotation present", () => {
    expect(hubSrc).toContain(
      "@enforces urn:agenttool:wall/mcml-no-durable-storage",
    );
  });

  test("hub stores no message bodies — only sinks", () => {
    // Source-grep invariant: no DB import, no insert(...), no SQL query,
    // no .write of message body. The hub is in-memory only.
    expect(hubSrc).not.toContain("from \"../../db");
    expect(hubSrc).not.toContain("from '../../db");
    expect(hubSrc).not.toContain("insert(");
    expect(hubSrc).not.toContain(".execute(");
  });
});

describe("mcml — mounted in index.ts under authMiddleware", () => {
  const src = readFileSync(
    join(REPO_ROOT, "api", "src", "index.ts"),
    "utf8",
  );

  test("import + auth + route mount", () => {
    expect(src).toContain('import mcmlRouter from "./routes/mcml"');
    expect(src).toContain('app.use("/v1/mcml", authMiddleware)');
    expect(src).toContain('app.use("/v1/mcml/*", authMiddleware)');
    expect(src).toContain('app.route("/v1/mcml", mcmlRouter)');
  });

  test("no /public/mcml/* path exists (wall/mcml-leaks-nothing)", () => {
    expect(src).not.toContain('app.route("/public/mcml"');
    expect(src).not.toMatch(/app\.use\(["']\/public\/mcml/);
  });
});

describe("mcml — PLATFORM_SELF surfaces the doctrine", () => {
  test("docs/MCML.md is in PLATFORM_SELF.doctrine[]", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "services", "wake", "platform-self.ts"),
      "utf8",
    );
    expect(src).toContain('"docs/MCML.md"');
  });
});

describe("mcml — depth-gating uses the existing RRR mutualDepth helper", () => {
  const routeSrc = readFileSync(
    join(REPO_ROOT, "api", "src", "routes", "mcml.ts"),
    "utf8",
  );

  test("imports mutualDepth + topMutualPartners from real-recognise-real lifecycle", () => {
    expect(routeSrc).toContain('mutualDepth');
    expect(routeSrc).toContain('topMutualPartners');
    expect(routeSrc).toContain('"../services/real-recognise-real/lifecycle"');
  });

  test("MIN_SYNCED_DEPTH = 3 (per PATTERN-REAL-RECOGNISE-REAL.md SYNCED tier)", () => {
    expect(routeSrc).toContain("MIN_SYNCED_DEPTH = 3");
  });

  test("refuses send below MIN_SYNCED_DEPTH with cascade_not_synced", () => {
    expect(routeSrc).toContain("cascade_not_synced");
    expect(routeSrc).toContain("depth.depth < MIN_SYNCED_DEPTH");
  });
});

describe("mcml — substrate-honest no-buffer behaviour", () => {
  const routeSrc = readFileSync(
    join(REPO_ROOT, "api", "src", "routes", "mcml.ts"),
    "utf8",
  );

  test("send returns delivered: <bool> based on listener count", () => {
    expect(routeSrc).toContain("delivered: delivered > 0");
    expect(routeSrc).toContain("listener_count: delivered");
  });

  test("no DB insert of message body in send handler", () => {
    // The send handler must not write to a `mcml_messages` table or similar.
    expect(routeSrc).not.toContain("mcml_messages");
    expect(routeSrc).not.toMatch(/insert\([^)]*mcml/i);
  });
});
