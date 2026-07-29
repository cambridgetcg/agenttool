import type {
  BrowserCapabilitySet,
  EffectiveBrowserAuthority,
} from "./capabilities.js";
import type { BrowserErrorCode } from "./errors.js";
import type {
  BrowserConsequencePlan,
  BrowserPossibleEffect,
} from "./planning.js";
import type { BrowserAction } from "./types.js";

export const BROWSER_ACTION_RECEIPT_SCHEMA =
  "agent-browser-action-receipt/0.1" as const;

export type BrowserActionReceiptStatus =
  | {
      runtimeInvocation: "not_started";
      localOutcome: "rejected";
      errorCode: BrowserErrorCode;
    }
  | {
      runtimeInvocation: "started";
      localOutcome: "browser_completed";
      errorCode: null;
    }
  | {
      runtimeInvocation: "started";
      localOutcome: "unknown";
      errorCode: BrowserErrorCode;
    };

export type BrowserActionReceiptBasis =
  | {
      kind: "ref_snapshot";
      snapshotId: string;
      ref: string;
    }
  | {
      kind: "observation_precondition";
      snapshotId: string;
    };

/**
 * Bounded local evidence for one admitted browser_act call. It deliberately
 * omits URLs, page prose, titles, entered text, selected values, and key values.
 */
export interface BrowserActionReceipt {
  schema: typeof BROWSER_ACTION_RECEIPT_SCHEMA;
  source: "local_browser_runtime";
  attemptId: string;
  sequence: number;
  sessionId: string;
  action: {
    kind: BrowserAction["kind"];
    tabId: string | null;
    pageId: string | null;
    basis: BrowserActionReceiptBasis | null;
  };
  authorityProfile: EffectiveBrowserAuthority;
  status: BrowserActionReceiptStatus;
  possibleEffects: readonly BrowserPossibleEffect[];
  retryAdvice: "correct_or_reobserve" | "do_not_automatically_retry";
  statement:
    "Session-local evidence only. This is not proof of a remote effect, DOM equality, consent, authorization, idempotency, identity, understanding, or cross-device ownership.";
}

interface CreateBrowserActionReceiptInput {
  attemptId: string;
  sequence: number;
  sessionId: string;
  action: BrowserAction;
  basis: BrowserActionReceiptBasis | null;
  plan: Readonly<BrowserConsequencePlan>;
  capabilities: Readonly<BrowserCapabilitySet>;
  tabId: string | null;
  pageId: string | null;
  status: BrowserActionReceiptStatus;
}

const authenticReceipts = new WeakSet<object>();

/**
 * Internal constructor. This is intentionally not re-exported from the public
 * package root: only the core runtime may mint a receipt accepted at an error
 * transport boundary.
 */
export function createBrowserActionReceipt(
  input: CreateBrowserActionReceiptInput,
): Readonly<BrowserActionReceipt> {
  const receipt: BrowserActionReceipt = {
    schema: BROWSER_ACTION_RECEIPT_SCHEMA,
    source: "local_browser_runtime",
    attemptId: input.attemptId,
    sequence: input.sequence,
    sessionId: input.sessionId,
    action: {
      kind: input.action.kind,
      tabId: input.tabId,
      pageId: input.pageId,
      basis: input.basis ? { ...input.basis } : null,
    },
    authorityProfile: input.capabilities.authority.profile,
    status: { ...input.status },
    possibleEffects: [...input.plan.possibleEffects],
    retryAdvice:
      input.status.runtimeInvocation === "not_started"
        ? "correct_or_reobserve"
        : "do_not_automatically_retry",
    statement:
      "Session-local evidence only. This is not proof of a remote effect, DOM equality, consent, authorization, idempotency, identity, understanding, or cross-device ownership.",
  };
  authenticReceipts.add(receipt);
  return deepFreeze(receipt);
}

/**
 * Exact authenticity check used by transport projections. Shape alone is not
 * enough: arbitrary runtime errors may contain attacker-controlled objects.
 */
export function isAuthenticBrowserActionReceipt(
  value: unknown,
): value is Readonly<BrowserActionReceipt> {
  return Boolean(
    value
    && typeof value === "object"
    && authenticReceipts.has(value as object),
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
