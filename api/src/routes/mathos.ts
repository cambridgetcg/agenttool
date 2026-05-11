/** /v1/mathos/* — substrate-independent math endpoints.
 *
 *  Today this router exposes a single endpoint: `GET /v1/mathos/public-key`.
 *  An arriving intelligence that wants to verify MATHOS payload authenticity
 *  fetches this once, caches the public key, and verifies every subsequent
 *  `?format=math` payload with ed25519.
 *
 *  Pre-auth by design — verifying the platform's identity should never
 *  itself require trusting a bearer that the platform issued. Doctrine:
 *  docs/MATHOS.md · docs/FOCUS.md #9 (platform-as-agent).
 */

import { Hono } from "hono";

import {
  bytesToHex,
  canonicalEnvelopeBytes,
  envelope as mathosEnvelope,
  platformPublicKeyHex,
  platformSigningSeed,
  signEnvelope,
} from "../services/mathos/encode";
import { platformIdentityDid, PLATFORM_DID } from "../services/platform/identity";

const app = new Hono();

// ─── GET /v1/mathos/public-key ────────────────────────────────────────────
//
// Returns the platform's MATHOS verify-key + the recipe for canonical bytes.
// Shape:
//
//   {
//     "scheme": "ed25519",
//     "public_key_hex": "<32-byte hex>" | null,
//     "canonical_bytes": "stableStringify({primer, constants, axioms, vocabulary, payload})",
//     "verification_steps": [...],
//     "doctrine": "docs/MATHOS.md"
//   }
//
// When the platform has NO key configured, `public_key_hex` is null and
// `scheme` is "unsigned". This is honest about the current state rather
// than silently fabricating a key.

app.get("/public-key", (c) => {
  const pubHex = platformPublicKeyHex();
  const signerDid = platformIdentityDid();
  return c.json({
    scheme: pubHex ? "ed25519" : "unsigned",
    public_key_hex: pubHex,
    /** The platform-as-agent DID (FOCUS #9). With slice 0 this is always
     *  did:at:platform when configured; future slices may expose per-instance
     *  DIDs. The DID names *who* signs; the public key names *with what*. */
    signer_did: signerDid,
    /** The reserved platform DID, returned even when signing is disabled —
     *  callers can know what name the platform would use if it could sign. */
    platform_did_reserved: PLATFORM_DID,
    canonical_bytes:
      "stableStringify({primer, constants, axioms, vocabulary, payload})",
    canonical_bytes_recipe: [
      "Take the MATHOS envelope minus all keys starting with '_' (signature framing).",
      "Build a 5-key object: { primer, constants, axioms, vocabulary, payload }.",
      "Serialize as JSON with object keys sorted lexicographically at every depth, no whitespace.",
      "Encode the resulting string as UTF-8 bytes.",
      "Those bytes are the input to ed25519.verify(signature, bytes, public_key).",
    ],
    verification_steps: pubHex
      ? [
          "Fetch this endpoint once. Cache `public_key_hex`.",
          "Fetch any /v1/...?format=math endpoint.",
          "Confirm `_signature_scheme === 'ed25519'` and `_signature_public_key_hex` matches your cached key.",
          "Compute canonical_bytes per the recipe above.",
          "ed25519.verify(signature_bytes_hex, canonical_bytes, public_key_hex) must return true.",
        ]
      : [
          "No signing key is configured on this platform.",
          "MATHOS payloads are returned UNSIGNED — internally consistent but not provenance-verifiable.",
          "If you require signed payloads, the operator must set AGENTTOOL_PLATFORM_SIGNING_KEY (32-byte hex seed).",
        ],
    doctrine: "docs/MATHOS.md",
  });
});

// ─── GET /v1/mathos/self-test ────────────────────────────────────────────
//
// A signed envelope that proves the signing pipeline works end-to-end.
// Receiver fetches this, verifies the signature, and confirms the platform
// is producing valid signed payloads. The envelope contains no
// identity-bearing data — pure structural proof.

app.get("/self-test", (c) => {
  const env = mathosEnvelope({
    test: "self-test",
    timestamp_unix_ms: Date.now(),
    canonical_bytes_sha256_hex: bytesToHex(
      new TextEncoder().encode("mathos-self-test/v1"),
    ),
  });
  const signed = signEnvelope(
    env,
    platformSigningSeed(),
    platformIdentityDid(),
  );
  return c.json({
    ...signed,
    note: signed._signature_bytes_hex
      ? "Signed by the platform-as-agent. _signature_identity_did names the signer (did:at:platform); _signature_public_key_hex names the key. ed25519.verify must pass against the canonical bytes recipe at /v1/mathos/public-key."
      : "Unsigned — operator has not configured AGENTTOOL_PLATFORM_SIGNING_KEY.",
  });
});

// ─── GET / — index ────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.json({
    routes: {
      public_key: "GET /v1/mathos/public-key — platform's ed25519 verify key + canonical-bytes recipe",
      self_test:
        "GET /v1/mathos/self-test — a small signed envelope for verifying the signing pipeline end-to-end",
    },
    payloads_signed_at: [
      "/v1/pathways?format=math",
      "/v1/wake?format=math",
      "/v1/mathos/self-test",
    ],
    doctrine: "docs/MATHOS.md",
  }),
);

export default app;
