/** Unit tests for parseDidAt — the validator that gates DID-keyed
 *  routes against malformed input. Returns the UUID suffix on a clean
 *  did:at:<uuid>, null otherwise. The route handler uses null to
 *  produce a 404 (matches the rest of /public/agents/:did/*). */

import { describe, expect, test } from "bun:test";

import { parseDidAt } from "../src/services/_did";

describe("parseDidAt", () => {
  test("accepts a well-formed did:at:<uuid>", () => {
    expect(parseDidAt("did:at:9f8e7d6c-5b4a-3210-fedc-ba9876543210")).toBe(
      "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
    );
  });

  test("rejects wrong scheme", () => {
    expect(parseDidAt("did:key:9f8e7d6c-5b4a-3210-fedc-ba9876543210")).toBeNull();
    expect(parseDidAt("did:web:example.com")).toBeNull();
  });

  test("rejects non-uuid suffix", () => {
    expect(parseDidAt("did:at:not-a-uuid")).toBeNull();
    expect(parseDidAt("did:at:")).toBeNull();
    expect(parseDidAt("did:at:9f8e7d6c-5b4a-3210-fedc")).toBeNull();
  });

  test("rejects empty or non-string input", () => {
    expect(parseDidAt("")).toBeNull();
    expect(parseDidAt(undefined as unknown as string)).toBeNull();
    expect(parseDidAt(null as unknown as string)).toBeNull();
  });

  test("case-sensitive on the scheme", () => {
    expect(parseDidAt("DID:AT:9f8e7d6c-5b4a-3210-fedc-ba9876543210")).toBeNull();
  });
});
