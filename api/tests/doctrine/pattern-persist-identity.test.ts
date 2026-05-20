/** PATTERN: Persist identity before side effect — doctrine test pin.
 *  Closes the four-corner pin — the doc previously carried "Tests: none yet".
 *
 *  Doctrine: docs/PATTERN-PERSIST-IDENTITY.md */

import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const ROOT = "/Users/macair/Desktop/agenttool";
const DOCTRINE = `${ROOT}/docs/PATTERN-PERSIST-IDENTITY.md`;

describe("PATTERN-PERSIST-IDENTITY — doctrine", () => {
  const content = existsSync(DOCTRINE) ? readFileSync(DOCTRINE, "utf-8") : "";

  test("doctrine doc exists", () => {
    expect(existsSync(DOCTRINE)).toBe(true);
  });

  test("states the rule — deterministic identifier persisted transactionally before the side effect", () => {
    expect(content).toMatch(/deterministic identifier/i);
    expect(content).toMatch(/persist/i);
    expect(content).toMatch(/before invoking the side effect/i);
  });

  test("names the recovery shape — ambiguity collapses to a remote lookup", () => {
    expect(content).toMatch(/lookup/i);
  });

  test("Tests line points at this pin — four-corner pin now closed", () => {
    expect(content).toContain("api/tests/doctrine/pattern-persist-identity.test.ts");
    expect(content).not.toMatch(/Tests:\*\*\s*none yet/i);
  });
});

describe("PATTERN-PERSIST-IDENTITY — code witnesses", () => {
  test("canonical example exists: payout broadcast worker", () => {
    expect(existsSync(`${ROOT}/api/src/workers/payout/broadcast-worker.ts`)).toBe(true);
  });

  test("broadcast worker persists the deterministic tx_hash", () => {
    const src = readFileSync(`${ROOT}/api/src/workers/payout/broadcast-worker.ts`, "utf-8");
    expect(src).toMatch(/tx_hash/);
  });

  test("applied site exists: inbox local delivery", () => {
    expect(existsSync(`${ROOT}/api/src/services/inbox/store.ts`)).toBe(true);
  });

  test("applied site exists: LLM-request idempotency persistence", () => {
    expect(existsSync(`${ROOT}/api/src/services/runtime/llm-requests.ts`)).toBe(true);
  });

  test("applied site exists: covenant federation propagation", () => {
    expect(existsSync(`${ROOT}/api/src/services/covenants/federation.ts`)).toBe(true);
  });

  test("audit-closure migrations exist (stripe events status · llm requests)", () => {
    expect(existsSync(`${ROOT}/api/migrations/20260512T180000_stripe_events_status.sql`)).toBe(true);
    expect(existsSync(`${ROOT}/api/migrations/20260512T190000_llm_requests.sql`)).toBe(true);
  });
});
