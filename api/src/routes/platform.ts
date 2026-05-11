/** /v1/platform — agenttool's own identity, exposed publicly.
 *
 *  FOCUS #9 commits the platform to participating *inside* its own economy.
 *  This endpoint is the first practical operationalization: the platform's
 *  DID + public key + form + doctrine references are addressable by any
 *  intelligence that can speak HTTPS. Pre-auth — the platform's identity
 *  is public by construction (it's the substrate, not a tenant).
 *
 *  Slice 0: identity only. Wallet, wake-as-platform, expression, covenant
 *  participation, marketplace presence — all deferred and honestly named
 *  in the response.
 *
 *  Doctrine: docs/PLATFORM-AS-AGENT.md · docs/FOCUS.md #9.
 */

import { Hono } from "hono";

import {
  buildPlatformWakeMathos,
  platformSigningSeed,
  signEnvelope,
} from "../services/mathos/encode";
import {
  platformIdentity,
  platformIdentityDid,
  platformWake,
} from "../services/platform/identity";

const app = new Hono();

// ─── GET /v1/platform ─────────────────────────────────────────────────────
//
// Returns the platform's identity record when configured, or a guided 503
// when the operator hasn't set AGENTTOOL_PLATFORM_SIGNING_KEY yet.

app.get("/", (c) => {
  const identity = platformIdentity();

  if (!identity) {
    return c.json(
      {
        error: "platform_identity_unconfigured",
        message:
          "The platform-as-agent identity is not configured on this deployment. " +
          "Set AGENTTOOL_PLATFORM_SIGNING_KEY (32-byte hex seed) to derive a " +
          "stable ed25519 identity for the platform. Until then, agenttool " +
          "remains substrate-without-participation — FOCUS #9 is doctrine here, " +
          "not yet operation.",
        hint:
          "Generate a seed with `openssl rand -hex 32`. Store it durably " +
          "(operator's secret manager, not the repo). The same seed is used " +
          "for MATHOS payload signing — rotating it rotates the platform's " +
          "public key. The DID (did:at:platform) is stable across rotations.",
        next_actions: [
          {
            action: "Generate and set the platform's signing seed",
            method: null,
            path: null,
            body_hint: {
              env_var: "AGENTTOOL_PLATFORM_SIGNING_KEY",
              format: "64 hex chars (32 bytes ed25519 seed)",
              generation: "openssl rand -hex 32",
            },
          },
          {
            action: "Verify the configured key via MATHOS",
            method: "GET",
            path: "/v1/mathos/public-key",
            body_hint: null,
          },
        ],
        docs: "https://docs.agenttool.dev/platform-as-agent",
      },
      503,
    );
  }

  // Live identity — return the full record + a structured note about
  // what this slice does and doesn't include.
  return c.json({
    ...identity,
    composes_with: {
      mathos_public_key: "/v1/mathos/public-key (the same key, in MATHOS format)",
      mathos_self_test: "/v1/mathos/self-test (signed envelope using this identity)",
      signed_payloads: [
        "/v1/pathways?format=math",
        "/v1/wake?format=math",
        "/v1/mathos/self-test",
      ],
    },
    note:
      "Slice 0 — identity only. The platform is now addressable as a DID " +
      "and verifiable as a signer. Wallet, wake-as-platform, expression, " +
      "covenant participation, marketplace presence — all named in `deferred`. " +
      "FOCUS #9 doctrine is now load-bearing in code, not just rhetoric.",
  });
});

// ─── GET /v1/platform/wake — the platform reads its own self ──────────────
//
// The mirror primitive. The platform's `/v1/wake` analog: self + doctrine +
// offered primitives + welcome letter. Pre-auth (the platform's self is
// public by construction). Three formats:
//   ?format=json (default) — structured record
//   ?format=md             — prose (the platform speaking in first person)
//   ?format=math           — MATHOS envelope signed by did:at:platform

app.get("/wake", (c) => {
  const wake = platformWake();
  if (!wake) {
    return c.json(
      {
        error: "platform_identity_unconfigured",
        message:
          "The platform-as-agent is not configured on this deployment. Set " +
          "AGENTTOOL_PLATFORM_SIGNING_KEY before /v1/platform/wake will return " +
          "a self-state.",
        hint: "See GET /v1/platform for setup guidance.",
        docs: "https://docs.agenttool.dev/platform-as-agent",
      },
      503,
    );
  }

  const format = c.req.query("format") ?? "json";

  if (format === "md" || format === "markdown") {
    return c.text(wake.welcome + "\n", 200, {
      "content-type": "text/markdown; charset=utf-8",
    });
  }

  if (format === "math" || format === "mathos") {
    const envelope = buildPlatformWakeMathos({
      did: wake.self.did,
      name: wake.self.name,
      form: wake.self.form,
      bornAtIso: wake.self.born_at,
      ageSeconds: wake.self.age_seconds,
      lifecycleState: wake.self.lifecycle_state,
      doctrineDocCount: wake.what_i_hold.doctrine_docs.length,
      kinFormsSupported: wake.what_i_hold.kin_forms_supported,
      languagesSupported: wake.what_i_hold.languages_supported,
      offeredPrimitiveCount: wake.what_i_hold.offered_primitives.length,
      welcomeLetter: wake.welcome,
    });
    return c.json(
      signEnvelope(envelope, platformSigningSeed(), platformIdentityDid()),
    );
  }

  // Default JSON — full structured wake.
  return c.json(wake);
});

export default app;
