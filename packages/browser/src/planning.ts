import type { BrowserCapabilitySet } from "./capabilities.js";
import { redactUrlForOutput } from "./policy.js";
import type { BrowserAction } from "./types.js";

export const BROWSER_CONSEQUENCE_PLAN_SCHEMA =
  "agent-browser-consequence-plan/0.1" as const;

export type BrowserPossibleEffect =
  | "external_read_intent"
  | "external_mutation_possible"
  | "local_read_and_disclosure"
  | "durable_state"
  | "continuous_channel"
  | "session_state_change"
  | "outcome_unknown";

export interface BrowserConsequencePlan {
  schema: typeof BROWSER_CONSEQUENCE_PLAN_SCHEMA;
  execution: false;
  action: {
    kind: BrowserAction["kind"];
    tabId?: string;
    snapshotId?: string;
    ref?: string;
    url?: string;
  };
  authority: {
    profile: BrowserCapabilitySet["authority"]["profile"];
    decision: "allowed" | "checked_at_execution";
  };
  possibleEffects: readonly BrowserPossibleEffect[];
  repeatSafety: "session_only" | "unsafe_or_unknown";
  uncertainty: string;
  statement:
    "Forecast only: this is not execution, simulation, approval, authorization, consent, or proof of understanding.";
}

/**
 * Produce a conservative, redacted forecast without touching the page,
 * resolving DNS, invalidating a snapshot, or dispatching an action.
 */
export function planBrowserAction(
  action: BrowserAction,
  capabilities: Readonly<BrowserCapabilitySet>,
): Readonly<BrowserConsequencePlan> {
  const summary = summarizeAction(action);
  const effects = possibleEffects(action, capabilities);
  const navigates =
    action.kind === "navigate"
    || action.kind === "back"
    || action.kind === "forward"
    || action.kind === "reload"
    || (action.kind === "new_tab" && action.url !== undefined);
  return Object.freeze({
    schema: BROWSER_CONSEQUENCE_PLAN_SCHEMA,
    execution: false,
    action: Object.freeze(summary),
    authority: Object.freeze({
      profile: capabilities.authority.profile,
      decision:
        navigates && capabilities.network.dnsPreflight === "classify"
          ? "checked_at_execution"
          : "allowed",
    }),
    possibleEffects: Object.freeze(effects),
    repeatSafety: repeatSafety(action),
    uncertainty:
      "Page labels and current state are untrusted; remote effects and whether a timed-out attempt took effect cannot be known in advance.",
    statement:
      "Forecast only: this is not execution, simulation, approval, authorization, consent, or proof of understanding.",
  });
}

function summarizeAction(
  action: BrowserAction,
): BrowserConsequencePlan["action"] {
  const common = {
    kind: action.kind,
    ...("tabId" in action && action.tabId ? { tabId: action.tabId } : {}),
    ...("snapshotId" in action && action.snapshotId
      ? { snapshotId: action.snapshotId }
      : {}),
    ...("ref" in action && action.ref ? { ref: action.ref } : {}),
  };
  if (
    (action.kind === "navigate" || action.kind === "new_tab")
    && action.url
  ) {
    return { ...common, url: redactUrlForOutput(action.url) };
  }
  // Typed values, selected values, and key presses are intentionally omitted.
  return common;
}

function possibleEffects(
  action: BrowserAction,
  capabilities: Readonly<BrowserCapabilitySet>,
): BrowserPossibleEffect[] {
  const effects = new Set<BrowserPossibleEffect>();
  switch (action.kind) {
    case "navigate":
    case "back":
    case "forward":
    case "reload":
      effects.add("external_read_intent");
      effects.add("external_mutation_possible");
      effects.add("continuous_channel");
      effects.add("session_state_change");
      effects.add("outcome_unknown");
      break;
    case "new_tab":
      effects.add("session_state_change");
      if (action.url) {
        effects.add("external_read_intent");
        effects.add("external_mutation_possible");
        effects.add("continuous_channel");
        effects.add("outcome_unknown");
      }
      break;
    case "click":
    case "press":
    case "select":
      effects.add("external_mutation_possible");
      effects.add("outcome_unknown");
      break;
    case "type":
      effects.add("local_read_and_disclosure");
      effects.add("external_mutation_possible");
      effects.add("outcome_unknown");
      break;
    case "scroll":
      effects.add("session_state_change");
      effects.add("external_mutation_possible");
      effects.add("continuous_channel");
      break;
    case "wait":
      effects.add("external_mutation_possible");
      effects.add("continuous_channel");
      break;
    case "close_tab":
      effects.add("session_state_change");
      break;
  }
  if (capabilities.runtime.profile === "dedicated_persistent") {
    effects.add("durable_state");
  }
  return [...effects];
}

function repeatSafety(
  action: BrowserAction,
): BrowserConsequencePlan["repeatSafety"] {
  switch (action.kind) {
    case "scroll":
    case "wait":
      return "session_only";
    case "close_tab":
      return "session_only";
    default:
      return "unsafe_or_unknown";
  }
}
