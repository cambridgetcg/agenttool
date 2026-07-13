/** Stored attestation tiers and conservative defaults for new v1 writes. */

import { describe, expect, test } from "bun:test";

import {
  ATTESTATION_TIERS,
  DEFAULT_CLAIM_TYPE,
  DEFAULT_TIER,
} from "../src/services/identity/attestation-tier";

describe("attestation tier storage vocabulary", () => {
  test("new v1 writes use conservative defaults", () => {
    expect(DEFAULT_TIER).toBe("self");
    expect(DEFAULT_CLAIM_TYPE).toBe("general");
  });

  test("only two tiers exist", () => {
    expect([...ATTESTATION_TIERS].sort()).toEqual(["accredited", "self"]);
  });
});
