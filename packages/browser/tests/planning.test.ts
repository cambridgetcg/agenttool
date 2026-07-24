import { describe, expect, test } from "bun:test";
import { resolveBrowserCapabilities } from "../src/capabilities.js";
import { planBrowserAction } from "../src/planning.js";

describe("browser consequence planning", () => {
  test("describes navigation conservatively without resolving or executing it", () => {
    const plan = planBrowserAction(
      {
        kind: "navigate",
        url: "https://example.com/path?token=private",
      },
      resolveBrowserCapabilities({ authority: "public" }),
    );

    expect(plan).toMatchObject({
      execution: false,
      authority: {
        profile: "public",
        decision: "checked_at_execution",
      },
      action: {
        kind: "navigate",
        url: "https://example.com/path?token=%5Bredacted%5D",
      },
      repeatSafety: "unsafe_or_unknown",
    });
    expect(plan.possibleEffects).toEqual([
      "external_read_intent",
      "external_mutation_possible",
      "continuous_channel",
      "session_state_change",
      "outcome_unknown",
    ]);
  });

  test("separates data disclosure, session changes, and durable state", () => {
    const persistent = resolveBrowserCapabilities({
      authority: "sovereign",
      profileMode: "persistent",
    });
    const typed = planBrowserAction(
      {
        kind: "type",
        ref: "e1",
        snapshotId: "snapshot-1",
        text: "never echo me",
      },
      persistent,
    );
    const closed = planBrowserAction(
      { kind: "close_tab", tabId: "tab-1" },
      persistent,
    );

    expect(typed.possibleEffects).toEqual([
      "local_read_and_disclosure",
      "external_mutation_possible",
      "outcome_unknown",
      "durable_state",
    ]);
    expect(JSON.stringify(typed)).not.toContain("never echo me");
    expect(closed.possibleEffects).toEqual([
      "session_state_change",
      "durable_state",
    ]);
    expect(closed.repeatSafety).toBe("session_only");
  });
});
