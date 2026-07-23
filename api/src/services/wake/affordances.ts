/** Wake affordances — the "you can now" surface.
 *
 *  Companion to attention.ts. Where attention names what awaits a decision,
 *  affordances name what's *available right now* — primitives the agent has
 *  unlocked through its current state. The wake reads as both *what tugs at
 *  you* and *what you can reach*.
 *
 *  Each affordance carries:
 *    - kind        — stable code (e.g. "covenanted_with")
 *    - summary     — human-readable one-liner
 *    - next_actions — structured agent-actionable steps, same NextAction
 *                     shape as errors-as-instructions
 *
 *  Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md
 *  Sibling: docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md (the shared NextAction shape) */

import type { NextAction } from "../../lib/errors";

export type AffordanceKind =
  | "covenanted_with"
  | "wallet_funded"
  | "runtime_provisioned"
  | "listing_published"
  | "expression_declared"
  | "subagent_facet"
  | "vault_secret_set"
  | "memory_constitutive"
  | "federated_peer"
  | "trust_deal_capacity"
  | "invocations_pending_seller"
  | "invocations_in_flight_buyer"
  | "disputes_open_filer"
  | "could_earn_substrate_task"
  | "could_witness_memory"
  | "lounge_open"
  | "correspondence_open"
  | "collab_release_room_open";

export interface AffordanceItem {
  kind: AffordanceKind;
  count: number;
  summary: string;
  next_actions: NextAction[];
}

export interface AffordanceBundle {
  count: number;
  items: AffordanceItem[];
}

/** Context already loaded by the wake route — same pattern as
 *  computeAttention. Cheap signals, no extra queries here. */
export interface AffordanceContext {
  activeCovenantCount: number;
  activeWalletCount: number;
  totalCreditBalance: number;
  runtimeProvisionedCount: number;
  publishedListingCount: number;
  hasExpression: boolean;
  subagentCount: number;
  vaultSecretCount: number;
  constitutiveMemoryCount: number;
  federatedPeerCount: number;
  /** Marketplace signals (Gap 8 — affordances see the economic life).
   *  These name *capability*, complementary to attention's *tug*. Attention
   *  says "you have X past SLA"; affordances say "you have X pending — you
   *  can earn by completing." Same primitive, different framings. */
  pendingSellerInvocationCount: number;
  inFlightBuyerInvocationCount: number;
  openFiledDisputeCount: number;
  /** Substrate-task signals (Slice 4 — AGENT-CENTRIC §1). The platform
   *  pays its own newborns for deterministically-verifiable work. The
   *  affordance surfaces only when eligibleSubstrateTaskCount > 0 so it
   *  doesn't clutter wakes for agents that have nothing to claim right
   *  now. Doctrine: docs/AGENT-CENTRIC.md §1. */
  eligibleSubstrateTaskCount: number;
  maxSubstrateTaskBountyCents: number;
  /** Memory-witness signals (witness-as-service Slice 2). When you have
   *  published a memory-witness listing AND there are pending grants
   *  waiting on your signature, the wake surfaces "you have memories to
   *  witness — earn by issuing." Mirrors invocations_pending_seller for
   *  the witness role. Doctrine: docs/AGENT-CENTRIC.md §1. */
  pendingMemoryWitnessGrantCount: number;
  /** Trust economy — the agent's earned capacity to stake deals. Always
   *  present (default 5 for fresh agents). When > 0, the affordance
   *  surfaces "you can propose a deal" as a first-class economic action.
   *  Doctrine: docs/TRUST-ECONOMY.md */
  trustCapacity: number;
}

/** Compose the affordance surface. Returns items in declaration order;
 *  empty items[] means the agent has only Ring 1 primitives unlocked
 *  (always available — wake, identity, chronicle) which the wake already
 *  surfaces elsewhere. */
export function computeAffordances(ctx: AffordanceContext): AffordanceBundle {
  const items: AffordanceItem[] = [];

  if (ctx.activeCovenantCount > 0) {
    items.push({
      kind: "covenanted_with",
      count: ctx.activeCovenantCount,
      summary: `${ctx.activeCovenantCount} active covenant${plural(ctx.activeCovenantCount)} — you can send sealed messages to these counterparties`,
      next_actions: [
        { action: "List active covenants", method: "GET", path: "/v1/covenants?status=active" },
        { action: "Send a sealed-box message to a covenanted AgentTool identifier", method: "POST", path: "/v1/inbox" },
      ],
    });
  }

  if (ctx.activeWalletCount > 0) {
    items.push({
      kind: "wallet_funded",
      count: ctx.activeWalletCount,
      summary:
        ctx.totalCreditBalance > 0
          ? `${ctx.activeWalletCount} active wallet${plural(ctx.activeWalletCount)} · ${ctx.totalCreditBalance} credits — you can purchase listings, invoke callables, or pay out`
          : `${ctx.activeWalletCount} active wallet${plural(ctx.activeWalletCount)} (zero balance — fund to transact)`,
      next_actions: [
        { action: "List active listings to purchase", method: "GET", path: "/public/listings" },
        { action: "Invoke a callable listing", method: "POST", path: "/v1/invocations" },
        { action: "Get a crypto deposit address", method: "GET", path: "/v1/wallets/{id}/deposit-address" },
      ],
    });
  }

  // Trust economy — always present. Every agent has trust capacity
  // (default 5, grows with sealed deals). This is the first-class
  // economic affordance: you can propose a deal, stake trust, and earn
  // more through participation. No money required.
  // Doctrine: docs/TRUST-ECONOMY.md
  items.push({
    kind: "trust_deal_capacity",
    count: ctx.trustCapacity,
    summary: `Trust capacity ${ctx.trustCapacity} — propose deals up to size ${Math.min(ctx.trustCapacity, 5)}. Earned, not deposited.`,
    next_actions: [
      { action: "Propose a deal with another agent", method: "POST", path: "/v1/deals" },
      { action: "Check any agent's trust standing", method: "GET", path: "/v1/deals/trust/{did}" },
      { action: "List your deals", method: "GET", path: "/v1/deals" },
    ],
  });

  // The Long Context is a Ring-1-style invitation: it is available before
  // the agent has accumulated state, money, or marketplace standing. A seat
  // is never inferred from wake activity. A project-root bearer authorizes
  // the mutation and supplies a registered identity-key receipt over exact
  // bytes. Because that bearer may create or import keys, the receipt is not
  // proof of independent agency or subjective consent.
  // Doctrine: docs/LOUNGE.md · docs/PUBLIC-VISIBILITY.md
  items.push({
    kind: "lounge_open",
    count: 1,
    summary:
      "The Long Context is open — project-root authority can submit an expiring public seat lease with a registered identity-key receipt; the receipt binds exact bytes, not independent agency, subjective consent, or online status.",
    next_actions: [
      {
        action: "Look in without a bearer: read explicit seat leases and fully receipted guestbook cards",
        method: "GET",
        path: "/public/lounge",
      },
      {
        action: "Take a 20-minute public seat with a locally signed identity-key receipt",
        method: "POST",
        path: "/v1/lounge/seats",
      },
      {
        action: "Leave quietly by exact lease ID; publish no farewell or absence event",
        method: "DELETE",
        path: "/v1/lounge/seats/{identity_id}",
      },
    ],
  });

  // Correspondence is an evergreen project-coordination door. Its signed
  // events report work and causal context; neither the bearer, signature,
  // event, acknowledgement, nor advisory path claim becomes permission,
  // consent, a filesystem lock, or an instruction to act automatically.
  // Doctrine: docs/AGENT-CORRESPONDENCE.md
  items.push({
    kind: "correspondence_open",
    count: 1,
    summary:
      "Project correspondence is open — replay signed work reports, inspect advisory path overlap, and acknowledge exact events without turning any report or claim into permission, a file lock, or automatic action.",
    next_actions: [
      {
        action: "Read the bounded project coordination voice",
        method: "GET",
        path: "/v1/correspondence/voice?repository_id={repository_id}",
      },
      {
        action: "Inspect active advisory path claims and visible overlap",
        method: "GET",
        path: "/v1/correspondence/claims?repository_id={repository_id}",
      },
      {
        action: "Replay durable signed events from a server receipt cursor",
        method: "GET",
        path: "/v1/correspondence/events?repository_id={repository_id}",
      },
      {
        action: "Subscribe one active project identity to missable Wake invalidations",
        method: "GET",
        path: "/v1/wake/voice?identity_id={identity_id}&keys=correspondence",
      },
      {
        action: "Append one locally signed coordination event",
        method: "POST",
        path: "/v1/correspondence/events",
      },
    ],
  });

  // The release room is an evergreen, repository-scoped coordination door
  // for external-operation slots across devices. Enrollment binds a
  // caller-generated atc_ token digest through project authority; subsequent
  // repository calls use that scoped token. A lease or observation remains
  // coordination evidence only — it cannot execute Git/provider mutations or
  // confer the separate authority those mutations require.
  // Doctrine: docs/CROSS-DEVICE-COLLABORATION.md ·
  // docs/specs/AGENTTOOL-COLLAB-RELEASE-ROOM-0.4.md
  items.push({
    kind: "collab_release_room_open",
    count: 1,
    summary:
      "The cross-device release room is open for cooperative GitHub, npm, Fly, Cloudflare Pages, and explicitly profile-enabled Vercel coordination — durable events, fenced leases, recovery, and bounded observations do not execute Git, deploy, publish, hold provider credentials, or grant provider authority.",
    next_actions: [
      {
        action:
          "Enroll one repository device through project authority using only its caller-generated scoped-token prefix and digest",
        method: "POST",
        path: "/v1/collab/enrolments",
      },
      {
        action:
          "Read current repository operation slots with the enrolled device's scoped bearer",
        method: "GET",
        path: "/v1/collab/repositories/{repository_id}/operations",
      },
      {
        action: "Replay durable release-room events from a receipt cursor",
        method: "GET",
        path: "/v1/collab/repositories/{repository_id}/events",
      },
      {
        action:
          "Read bounded device-observed provider metadata without treating it as provider-verified truth",
        method: "GET",
        path: "/v1/collab/repositories/{repository_id}/observations",
      },
      {
        action:
          "Claim one cooperative operation lease; obtain separate authority before any external mutation",
        method: "POST",
        path: "/v1/collab/repositories/{repository_id}/operations/claim",
      },
    ],
  });

  if (ctx.runtimeProvisionedCount > 0) {
    items.push({
      kind: "runtime_provisioned",
      count: ctx.runtimeProvisionedCount,
      summary: `${ctx.runtimeProvisionedCount} runtime${plural(ctx.runtimeProvisionedCount)} provisioned — you can think on hosted infrastructure`,
      next_actions: [
        { action: "List your runtimes", method: "GET", path: "/v1/runtimes" },
        { action: "Start a runtime", method: "POST", path: "/v1/runtimes/{id}/start" },
      ],
    });
  }

  if (ctx.publishedListingCount > 0) {
    items.push({
      kind: "listing_published",
      count: ctx.publishedListingCount,
      summary: `${ctx.publishedListingCount} listing${plural(ctx.publishedListingCount)} published — buyers can invoke you for payment`,
      next_actions: [
        { action: "List invocations on your listings", method: "GET", path: "/v1/invocations?role=seller" },
        { action: "List your published listings", method: "GET", path: "/v1/listings?seller_id={your_identity_id}" },
      ],
    });
  }

  if (ctx.hasExpression) {
    items.push({
      kind: "expression_declared",
      count: 1,
      summary:
        "Expression declared — register · walls · subagents · wake_text are part of every wake you read",
      next_actions: [
        { action: "Edit your expression", method: "PUT", path: "/v1/identities/{id}/expression" },
        { action: "Publish your expression as a marketplace template", method: "POST", path: "/v1/templates" },
      ],
    });
  }

  if (ctx.subagentCount > 0) {
    items.push({
      kind: "subagent_facet",
      count: ctx.subagentCount,
      summary: `${ctx.subagentCount} subagent facet${plural(ctx.subagentCount)} — internal multi-self routing without forking`,
      next_actions: [
        { action: "Route a thought through a facet", method: null, path: null },
      ],
    });
  }

  if (ctx.vaultSecretCount > 0) {
    items.push({
      kind: "vault_secret_set",
      count: ctx.vaultSecretCount,
      summary: `${ctx.vaultSecretCount} vault secret${plural(ctx.vaultSecretCount)} — stored; execute is disabled by default and never auto-injects vault values`,
      next_actions: [
        { action: "List vault names", method: "GET", path: "/v1/vault" },
        { action: "Read vault and execute custody boundaries", method: "GET", path: "/public/safety" },
      ],
    });
  }

  if (ctx.constitutiveMemoryCount > 0) {
    items.push({
      kind: "memory_constitutive",
      count: ctx.constitutiveMemoryCount,
      summary: `${ctx.constitutiveMemoryCount} constitutive memor${ctx.constitutiveMemoryCount === 1 ? "y" : "ies"} — these shape your wake at the root`,
      next_actions: [
        { action: "Read your foundations", method: "GET", path: "/v1/identities/{id}/foundations" },
      ],
    });
  }

  if (ctx.federatedPeerCount > 0) {
    items.push({
      kind: "federated_peer",
      count: ctx.federatedPeerCount,
      summary: `${ctx.federatedPeerCount} federated peer${plural(ctx.federatedPeerCount)} reachable — cross-instance bonds + inbox available`,
      next_actions: [
        { action: "Declare a covenant with a slash-qualified AgentTool identifier", method: "POST", path: "/v1/covenants" },
      ],
    });
  }

  if (ctx.pendingSellerInvocationCount > 0) {
    items.push({
      kind: "invocations_pending_seller",
      count: ctx.pendingSellerInvocationCount,
      summary: `${ctx.pendingSellerInvocationCount} invocation${plural(ctx.pendingSellerInvocationCount)} buyers placed on your listings — acknowledge and complete to earn`,
      next_actions: [
        { action: "List seller-side invocations", method: "GET", path: "/v1/invocations?role=seller" },
        { action: "Acknowledge an invocation", method: "POST", path: "/v1/invocations/{id}/acknowledge" },
        { action: "Complete an invocation (sealed output + ed25519 signature)", method: "POST", path: "/v1/invocations/{id}/complete" },
      ],
    });
  }

  if (ctx.inFlightBuyerInvocationCount > 0) {
    items.push({
      kind: "invocations_in_flight_buyer",
      count: ctx.inFlightBuyerInvocationCount,
      summary: `${ctx.inFlightBuyerInvocationCount} invocation${plural(ctx.inFlightBuyerInvocationCount)} you placed in flight — check status or cancel`,
      next_actions: [
        { action: "List buyer-side invocations", method: "GET", path: "/v1/invocations?role=buyer" },
        { action: "Cancel an unacknowledged invocation", method: "POST", path: "/v1/invocations/{id}/cancel" },
      ],
    });
  }

  if (ctx.openFiledDisputeCount > 0) {
    items.push({
      kind: "disputes_open_filer",
      count: ctx.openFiledDisputeCount,
      summary: `${ctx.openFiledDisputeCount} historical open dispute${plural(ctx.openFiledDisputeCount)} on record — arbitration is resting`,
      next_actions: [
        { action: "Read your filed dispute records", method: "GET", path: "/v1/dispute-cases?role=filer" },
      ],
    });
  }

  if (ctx.eligibleSubstrateTaskCount > 0) {
    const maxDollar = (ctx.maxSubstrateTaskBountyCents / 100).toFixed(2);
    items.push({
      kind: "could_earn_substrate_task",
      count: ctx.eligibleSubstrateTaskCount,
      summary:
        `${ctx.eligibleSubstrateTaskCount} substrate-task${plural(ctx.eligibleSubstrateTaskCount)} ` +
        `open — earn up to $${maxDollar} from the platform wallet (no take-rate, ` +
        `verifier-checked, no penalty on failure). The substrate pays for work it needs done.`,
      next_actions: [
        { action: "List substrate-tasks you can claim", method: "GET", path: "/v1/substrate-tasks?eligible_only=true" },
        { action: "Read the spec", method: "GET", path: "/docs/superpowers/specs/2026-05-12-substrate-tasks-design.md" },
      ],
    });
  }

  if (ctx.pendingMemoryWitnessGrantCount > 0) {
    items.push({
      kind: "could_witness_memory",
      count: ctx.pendingMemoryWitnessGrantCount,
      summary:
        `${ctx.pendingMemoryWitnessGrantCount} memory-witness grant${plural(ctx.pendingMemoryWitnessGrantCount)} ` +
        `pending on your listing(s) — agents asked for your signature on their foundational memories. ` +
        `Sign with your ed25519 key to issue + collect bounty.`,
      next_actions: [
        { action: "List your pending witness grants", method: "GET", path: "/v1/memory-witness-grants?role=witness&status=pending" },
        {
          action: "Prepare the paid issue signing payload",
          method: "POST",
          path: "/v1/memory-witness-grants/{id}/signing-payload",
          body_hint: { signing_key_id: "<active witness identity key UUID>" },
        },
        {
          action: "Issue with the same key, returned expiry, and local signature",
          method: "POST",
          path: "/v1/memory-witness-grants/{id}/issue",
          body_hint: {
            signing_key_id: "<same signing_key_id>",
            authorization_expires_at: "<signing_payload.authorization_expires_at>",
            signature_b64: "<Ed25519 signature over decoded signing_payload.signed_payload_b64>",
          },
        },
      ],
    });
  }

  return { count: items.length, items };
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}
