/** runtime/bridge — Slice 3 deterministic primitives.
 *
 *  Covers control_token mint/verify and the bridge-hub registry helpers.
 *  Crypto correctness against the bridge sidecar is the e2e harness's
 *  job (api/scripts/_e2e-runtime-loop.mjs); here we lock down the
 *  primitives that don't need infra. */

import { describe, expect, test } from "bun:test";

import {
  hashControlToken,
  mintControlToken,
  verifyControlToken,
} from "../src/services/runtime/control-token";
import { _registrySize, bridgeSummary, isBridgeConnected } from "../src/services/runtime/bridge-hub";

describe("control-token", () => {
  test("mint returns the expected shape", () => {
    const t = mintControlToken();
    expect(t.plaintext.startsWith("at_rt_")).toBe(true);
    expect(t.plaintext.length).toBeGreaterThan(20);
    expect(t.hash.length).toBe(64); // sha256 hex
    expect(/^[0-9a-f]+$/.test(t.hash)).toBe(true);
  });

  test("hashControlToken is stable", () => {
    const t = mintControlToken();
    expect(hashControlToken(t.plaintext)).toBe(t.hash);
    expect(hashControlToken(t.plaintext)).toBe(hashControlToken(t.plaintext));
  });

  test("verifyControlToken accepts the right token", () => {
    const t = mintControlToken();
    expect(verifyControlToken(t.plaintext, t.hash)).toBe(true);
  });

  test("verifyControlToken rejects a tampered token", () => {
    const t = mintControlToken();
    const bad = t.plaintext.slice(0, -1) + (t.plaintext.endsWith("A") ? "B" : "A");
    expect(verifyControlToken(bad, t.hash)).toBe(false);
  });

  test("verifyControlToken rejects wrong-prefix tokens", () => {
    const t = mintControlToken();
    const wrongPrefix = t.plaintext.replace("at_rt_", "at_xx_");
    expect(verifyControlToken(wrongPrefix, t.hash)).toBe(false);
  });

  test("verifyControlToken rejects mismatched-hash tokens", () => {
    const a = mintControlToken();
    const b = mintControlToken();
    expect(verifyControlToken(a.plaintext, b.hash)).toBe(false);
  });

  test("two mints are independent", () => {
    const a = mintControlToken();
    const b = mintControlToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("bridge-hub registry", () => {
  test("starts empty", () => {
    expect(_registrySize()).toBe(0);
  });

  test("isBridgeConnected returns false for unknown ids", () => {
    expect(isBridgeConnected("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  test("bridgeSummary returns the disconnected shape for unknown ids", () => {
    const s = bridgeSummary("00000000-0000-0000-0000-000000000000");
    expect(s.connected).toBe(false);
    expect(s.session_id).toBe(null);
    expect(s.pending).toBe(0);
    expect(s.last_seen_at).toBe(null);
  });
});
