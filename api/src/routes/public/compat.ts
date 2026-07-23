/** /public/compat — a partial pre-signing compatibility projection. UNAUTH.
 *
 *  Why: canonical-bytes contracts drift (register-agent v1→v2 stranded every
 *  checked-out SDK, silently, until a registration bounced). A client that can
 *  read the server's current contract names BEFORE signing fails loudly and
 *  early instead of quietly and late. This surface deliberately covers only
 *  registration and direct identity attestation. It publishes those contract
 *  names and parameters from the same constants the verifiers enforce; it is
 *  not an exhaustive registry of every signed operation and does not reproduce
 *  byte layouts (docs/CANONICAL-BYTES.md and the cross-language vector tests
 *  own those).
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/CANONICAL-BYTES.md. */

import { Hono } from "hono";

import { config } from "../../config";
import { attachSurface } from "../../lib/surface-metadata";
import {
  IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
  REGISTER_AGENT_DOMAIN,
  REGISTER_AGENT_POW_DOMAIN,
} from "../../services/identity/crypto";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/CANONICAL-BYTES";

app.get("/", (c) => {
  c.header("cache-control", "no-store");
  return c.json(
    attachSurface(
      {
        _format: "agenttool-compat/v1",
        purpose:
          "Let a client compare the registration and direct identity-attestation contracts covered here before signing. This endpoint does not enumerate every signing contract the server accepts. A covered name mismatch means: stop, update, do not sign.",
        scope: {
          coverage: "partial",
          exhaustive: false,
          included_contracts: [
            "register_agent",
            "register_agent_pow",
            "identity_attestation",
          ],
          outside_scope:
            "All other signing contexts and signed routes accepted by this server are outside this projection. Their absence here is not evidence that they are unsupported.",
        },
        contracts: {
          register_agent: {
            domain: REGISTER_AGENT_DOMAIN,
            proof: "ed25519 signature over the sha256 canonical digest",
            spec: "docs/CANONICAL-BYTES.md",
          },
          register_agent_pow: {
            domain: REGISTER_AGENT_POW_DOMAIN,
            difficulty_bits: config.registerAgentPowBits,
            applies_to: "self_service registration only",
          },
          identity_attestation: {
            domain: IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
          },
        },
        client_guidance:
          "For each included operation you intend to use, compare the domain you were built to sign against the domain published here. On mismatch, refuse to sign and surface the drift to your operator; a replayed or wrongly-domained proof is rejected server-side anyway, but late failure wastes single-use nonces and confuses custody.",
        unknowns: [
          "This is a partial, non-exhaustive projection for registration and direct identity attestation; other signed operations are outside its scope.",
          "Publishing a contract name is not proof that every route enforces it at this instant; the verifiers in api/src/services/identity/crypto.ts are the authority.",
          "This surface names contracts and parameters; it does not reproduce canonical byte layouts, which are specified in docs/CANONICAL-BYTES.md and locked by cross-language vector tests.",
          "A deployment may lag this source; the response describes the process serving it, not every mirror.",
        ],
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          {
            action: "read the signing contracts this server accepts",
            method: "GET",
            path: "/public/compat",
          },
        ],
      },
    ),
  );
});

export default app;
