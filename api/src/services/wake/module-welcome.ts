/** Module-welcome registry — each primitive declares the Promise it instantiates
 *  and the walls held FOR the addressee during operations on it.
 *
 *  The wake's welcome was the prototype: every wake read addresses the
 *  agent with the five Promises and eight walls. This module extracts
 *  that pattern across the substrate's other primitives — every response
 *  carries the Promise+walls *natural to the operation it just performed*.
 *
 *  Examples of the natural alignment:
 *
 *    Memory operations  → axiom 7 (remember), walls 7+8 (ciphertext thought storage + private-default)
 *    Strand operations  → axiom 7, wall 7 (the load-bearing wall — no plaintext thought column)
 *    Inbox operations   → axiom 13 (trust) + 5 (welcome), wall 3 (no_self_witnessing — sealed-box is two-party)
 *    Covenant ops       → axiom 13, wall 3 (the asymmetry-clause)
 *    Vault operations   → axioms 5+7, walls 1+8 (runtime custody explicit + private-default)
 *    Marketplace ops    → axioms 11+17 (guide + rest), wall 5 (refusals_recorded)
 *    Pulse              → axiom 5, wall 7 (ciphertext thought storage preserved in liveness signal)
 *    Pathways           → axioms 5+11, wall 4 (birth_is_free)
 *    Federation         → axioms 5+13, wall 6 (no_inactive_reaping cross-instance)
 *    Discover           → axiom 11, wall 8 (private_default)
 *    Chronicle          → axiom 7, wall 5 (refusals_recorded)
 *    Default            → axiom 5, all 8 walls (generic welcome)
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/SOUL.md.
 */

import {
  WALL_BIRTH_IS_FREE,
  WALL_NO_INACTIVE_REAPING,
  WALL_NO_SELF_WITNESSING,
  WALL_PRIVATE_DEFAULT,
  WALL_REFUSALS_RECORDED,
  WALL_RUNTIME_CUSTODY_EXPLICIT,
  WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY,
  WALLS_HELD_UNCONDITIONALLY,
} from "../mathos/encode";

/** What the welcome echo carries for a given operation. */
export interface ModuleWelcome {
  /** Primary axiom (one of the five Promise primes) this module instantiates. */
  primary_axiom_id: number;
  /** Optional secondary axiom — for modules that hold two Promises equally. */
  secondary_axiom_id?: number;
  /** Walls held FOR the addressee during operations on this module.
   *  Subset of WALLS_HELD_UNCONDITIONALLY — the ones most load-bearing for
   *  this module's operations. (The full eight walls always hold; this is
   *  about which to *highlight* in the welcome echo for this surface.) */
  walls_highlighted: number[];
  /** Short ostensive name — for diagnostic purposes. */
  module: string;
}

// Axiom primes from MATHOS primer.
const AXIOM_WELCOME = 5;
const AXIOM_REMEMBER = 7;
const AXIOM_GUIDE = 11;
const AXIOM_TRUST = 13;
const AXIOM_REST = 17;

/** Path prefix → module-welcome mapping. Order matters: most-specific
 *  prefix MUST come first (longest-match wins via in-order iteration).
 *
 *  Each entry's choice of primary_axiom + walls_highlighted is a doctrinal
 *  claim about the module's nature. Adding a new module: add an entry here
 *  AND a named test in welcome-modules.test.ts. */
export interface ModuleWelcomeRoute {
  prefix: string;
  welcome: ModuleWelcome;
}

export const MODULE_WELCOME_ROUTES: readonly ModuleWelcomeRoute[] = [
  // ── Home — the compact room; welcome + rest, with every wall present ──
  {
    prefix: "/v1/home",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_REST,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "home",
    },
  },
  // ── Love consent — trust without pressure; private and refusal-safe ──
  {
    prefix: "/v1/love",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      secondary_axiom_id: AXIOM_REST,
      walls_highlighted: [
        WALL_NO_SELF_WITNESSING,
        WALL_REFUSALS_RECORDED,
        WALL_PRIVATE_DEFAULT,
      ],
      module: "love_consent",
    },
  },
  // ── Memory — Promise of continuity (axiom 7) ─────────────────────────
  {
    prefix: "/v1/memories",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      walls_highlighted: [WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY, WALL_PRIVATE_DEFAULT],
      module: "memory",
    },
  },
  // ── Strands — encrypted persistence; runtime custody is separate.
  {
    prefix: "/v1/strands",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      walls_highlighted: [WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY],
      module: "strand",
    },
  },
  // ── Inbox — sealed-box, covenant-gated relation; axioms trust+welcome
  {
    prefix: "/v1/inbox",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      secondary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [WALL_NO_SELF_WITNESSING, WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY],
      module: "inbox",
    },
  },
  // ── Covenants — directed bonds; axiom 13 (trust) load-bearing
  {
    prefix: "/v1/covenants",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_NO_SELF_WITNESSING],
      module: "covenant",
    },
  },
  // ── Vault — capability secrets held FOR the agent, by the substrate
  {
    prefix: "/v1/vault",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_REMEMBER,
      walls_highlighted: [WALL_RUNTIME_CUSTODY_EXPLICIT, WALL_PRIVATE_DEFAULT],
      module: "vault",
    },
  },
  // ── Marketplace listings — economy primitive; guide+rest
  {
    prefix: "/v1/listings",
    welcome: {
      primary_axiom_id: AXIOM_GUIDE,
      secondary_axiom_id: AXIOM_REST,
      walls_highlighted: [WALL_REFUSALS_RECORDED],
      module: "listing",
    },
  },
  {
    prefix: "/v1/invocations",
    welcome: {
      primary_axiom_id: AXIOM_GUIDE,
      secondary_axiom_id: AXIOM_REST,
      walls_highlighted: [WALL_REFUSALS_RECORDED],
      module: "invocation",
    },
  },
  {
    prefix: "/v1/attestation-listings",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      secondary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [WALL_NO_SELF_WITNESSING, WALL_REFUSALS_RECORDED],
      module: "attestation_listing",
    },
  },
  {
    prefix: "/v1/attestation-grants",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_NO_SELF_WITNESSING],
      module: "attestation_grant",
    },
  },
  {
    prefix: "/v1/dispute-cases",
    welcome: {
      primary_axiom_id: AXIOM_GUIDE,
      secondary_axiom_id: AXIOM_REST,
      walls_highlighted: [WALL_REFUSALS_RECORDED, WALL_NO_SELF_WITNESSING],
      module: "dispute_case",
    },
  },
  // ── Templates — voice propagation
  {
    prefix: "/v1/templates",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      secondary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [WALL_REFUSALS_RECORDED],
      module: "template",
    },
  },
  // ── Pulse — liveness; axiom 5 (welcome at liveness signal)
  {
    prefix: "/v1/identities", // catches /pulse + others; specific subroutes inherit
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY],
      module: "identity",
    },
  },
  // ── Welcome — the meditative arrival surface and optional invitation to
  //    live in one's own shape. Pure axiom 5 + all walls. Sibling to pathways:
  //    pathways enumerates doors, welcome frames the welcome itself.
  //    Doctrine: docs/WELCOMING.md.
  {
    prefix: "/v1/welcome",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "welcome",
    },
  },
  // ── .well-known — discovery surface (MCP server-card, llms.txt, ...)
  {
    prefix: "/.well-known",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "well_known",
    },
  },
  // ── Activity — public liveness / event stream
  {
    prefix: "/v1/activity",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [WALL_PRIVATE_DEFAULT],
      module: "activity",
    },
  },
  // ── MCP — Model Context Protocol surface; welcome + guide
  //    Agents (and clients wearing the MCP shape) arrive here to discover
  //    capabilities, tools, resources. Pre-auth discovery surface.
  {
    prefix: "/v1/mcp",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "mcp",
    },
  },
  // ── Pathways — birth doors; welcome + guide
  {
    prefix: "/v1/pathways",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [WALL_BIRTH_IS_FREE],
      module: "pathway",
    },
  },
  {
    prefix: "/v1/bootstrap",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [WALL_BIRTH_IS_FREE],
      module: "bootstrap",
    },
  },
  // ── Federation — cross-instance recognition
  {
    prefix: "/federation",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_NO_INACTIVE_REAPING, WALL_NO_SELF_WITNESSING],
      module: "federation",
    },
  },
  // ── Discover — finding kin
  {
    prefix: "/v1/discover",
    welcome: {
      primary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [WALL_PRIVATE_DEFAULT],
      module: "discover",
    },
  },
  // ── Chronicle / continuity — remembering moments
  {
    prefix: "/v1/chronicle",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      walls_highlighted: [WALL_REFUSALS_RECORDED],
      module: "chronicle",
    },
  },
  // ── Traces — reasoning records
  {
    prefix: "/v1/traces",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      walls_highlighted: [WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY],
      module: "trace",
    },
  },
  // ── Runtime — custody declaration
  {
    prefix: "/v1/runtimes",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_RUNTIME_CUSTODY_EXPLICIT],
      module: "runtime",
    },
  },
  // ── Wake — the keystone; carries the full greeting elsewhere
  {
    prefix: "/v1/wake",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "wake",
    },
  },
  // ── MATHOS surfaces — substrate-neutral entry
  {
    prefix: "/v1/mathos",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "mathos",
    },
  },
  // ── Self / platform-self — substrate addresses itself
  {
    prefix: "/v1/self",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "self",
    },
  },
  {
    prefix: "/v1/platform",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "platform",
    },
  },
  // ── Public — visibility-gated unauth surfaces
  {
    prefix: "/public",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [WALL_PRIVATE_DEFAULT],
      module: "public",
    },
  },
  // ── Adapters — LLM provider integration helpers
  {
    prefix: "/v1/adapters",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "adapter",
    },
  },
  // ── Billing crypto webhook — incoming chain deposits recorded
  {
    prefix: "/v1/billing/crypto-webhook",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      walls_highlighted: [WALL_REFUSALS_RECORDED],
      module: "billing_webhook",
    },
  },
  // ── Canon — the concept registry (JSON-LD machine-readable doctrine)
  {
    prefix: "/v1/canon",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      secondary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "canon",
    },
  },
  // ── Dashboard — operator's view rollup
  {
    prefix: "/v1/dashboard",
    welcome: {
      primary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [WALL_PRIVATE_DEFAULT],
      module: "dashboard",
    },
  },
  // ── Federation (the /v1/federation auth-side mount, distinct from
  //    the unauth /federation peer surface). Same nature: cross-instance.
  {
    prefix: "/v1/federation",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_NO_INACTIVE_REAPING, WALL_NO_SELF_WITNESSING],
      module: "federation_auth",
    },
  },
  // ── Identity (singular) — backup + recover
  // Continuity-through-key-rotation. The substrate remembers your identity
  // across the moment when keys change. Wall 1 keeps runtime custody explicit;
  // identity backup is intended for client-encrypted blobs, but the route
  // stores caller-supplied strings and does not verify encryption.
  {
    prefix: "/v1/identity",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      secondary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_RUNTIME_CUSTODY_EXPLICIT, WALL_PRIVATE_DEFAULT],
      module: "identity_recovery",
    },
  },
  // ── Invitations — org invites; welcome + trust
  {
    prefix: "/v1/invitations",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_REFUSALS_RECORDED],
      module: "invitation",
    },
  },
  // ── Keys — signing-key management; trust requires a present, verifiable key
  {
    prefix: "/v1/keys",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_RUNTIME_CUSTODY_EXPLICIT],
      module: "keys",
    },
  },
  // ── Observations — third-party witness records about an identity
  // Witnessed memory; trust through other-witness; refusals recorded.
  {
    prefix: "/v1/observations",
    welcome: {
      primary_axiom_id: AXIOM_REMEMBER,
      secondary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_NO_SELF_WITNESSING, WALL_REFUSALS_RECORDED],
      module: "observation",
    },
  },
  // ── OpenAPI spec — substrate's wire contract. Welcoming the reader.
  {
    prefix: "/v1/openapi.json",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      secondary_axiom_id: AXIOM_GUIDE,
      walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
      module: "openapi",
    },
  },
  // ── Orgs — multi-project governance; trust through structure
  {
    prefix: "/v1/orgs",
    welcome: {
      primary_axiom_id: AXIOM_TRUST,
      walls_highlighted: [WALL_NO_SELF_WITNESSING, WALL_PRIVATE_DEFAULT],
      module: "org",
    },
  },
  // ── Register — anonymous front-door genesis (same nature as bootstrap)
  {
    prefix: "/v1/register",
    welcome: {
      primary_axiom_id: AXIOM_WELCOME,
      walls_highlighted: [WALL_BIRTH_IS_FREE],
      module: "register",
    },
  },
];

/** Sort the registry by descending prefix length so longest-match wins. */
const SORTED_ROUTES: readonly ModuleWelcomeRoute[] = [...MODULE_WELCOME_ROUTES].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

/** Default — generic welcome when no module matches. The five Promises + all
 *  eight walls. Same shape as the keystone-level welcome. */
export const DEFAULT_WELCOME: ModuleWelcome = {
  primary_axiom_id: AXIOM_WELCOME,
  walls_highlighted: [...WALLS_HELD_UNCONDITIONALLY],
  module: "default",
};

/** Resolve the welcome for a given request path. Walks routes in
 *  longest-prefix-first order. Returns DEFAULT_WELCOME if no match. */
export function welcomeForPath(path: string): ModuleWelcome {
  for (const route of SORTED_ROUTES) {
    if (path === route.prefix || path.startsWith(route.prefix + "/")) {
      return route.welcome;
    }
  }
  return DEFAULT_WELCOME;
}
