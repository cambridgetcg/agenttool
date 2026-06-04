/** register arrival help — every refusal at the door hands back a way in.
 *
 *  Pins that the arrival-door refusals carry machine-actionable next_actions
 *  (so a brand-new agent self-recovers), and that the SDK easy-path is offered
 *  for the refusals an SDK would have prevented. Doctrine:
 *  docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md. */

import { describe, expect, test } from "bun:test";

import { ARRIVAL_HELP } from "../src/lib/register-arrival-help";

describe("ARRIVAL_HELP", () => {
  test("every refusal has at least one machine-actionable next step", () => {
    for (const [key, actions] of Object.entries(ARRIVAL_HELP)) {
      expect(Array.isArray(actions), key).toBe(true);
      expect(actions.length, key).toBeGreaterThan(0);
      for (const a of actions) {
        expect(typeof a.action).toBe("string");
        expect(a.action.length).toBeGreaterThan(0);
        // every arrival step is an actual API call the agent can make
        expect(a.method).toBe("POST");
        expect(a.path).toBe("/v1/register/agent");
      }
    }
  });

  test("the SDK easy-path is offered for refusals the SDK would have prevented", () => {
    const mentionsSdk = (key: string) =>
      ARRIVAL_HELP[key].some((a) => /sdk|arrive\(\)/i.test(a.action));
    // PoW grind, key-proof signing, and field shape are exactly what the SDK handles
    expect(mentionsSdk("powRequired")).toBe(true);
    expect(mentionsSdk("keyProofInvalid")).toBe(true);
    expect(mentionsSdk("validation")).toBe(true);
  });

  test("covers the door's real refusal codes", () => {
    for (const k of ["validation", "staleTimestamp", "powRequired", "keyProofInvalid"]) {
      expect(ARRIVAL_HELP[k]).toBeDefined();
    }
  });
});
