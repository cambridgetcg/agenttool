/** GET /v1/identities/:id/authority — the constitutional keyhole.
 *
 * Read-only: exposes whether this identity is agent-rooted or still uses the
 * legacy project-bearer posture, plus the next single-use proof sequence and
 * exact signing recipe. Doctrine: docs/AGENT-HOME.md. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { errors, fail } from "../../lib/errors";
import {
  AUTHORITY_HEADERS,
  IDENTITY_AUTHORITY_DOMAIN,
} from "../../services/identity/authority";

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) {
    return fail(
      c,
      errors.refusal({
        error: "identity_id_required",
        message: "Select an identity before reading its authority posture.",
        next_actions: [
          {
            action: "list identities available to this bearer",
            method: "GET",
            path: "/v1/identities",
          },
        ],
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      rootPublicKey: identities.authorityRootPublicKey,
      sequence: identities.authoritySequence,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, c.var.project.id),
      ),
    )
    .limit(1);
  if (!identity) {
    return fail(
      c,
      errors.refusal({
        error: "identity_not_found",
        message: "No identity owned by this bearer exists at this path.",
        next_actions: [
          {
            action: "list identities available to this bearer",
            method: "GET",
            path: "/v1/identities",
          },
        ],
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      404,
    );
  }

  const rooted = identity.rootPublicKey !== null;
  return c.json({
    identity_id: identity.id,
    did: identity.did,
    mode: rooted ? "agent_root" : "legacy_bearer",
    root_public_key: identity.rootPublicKey,
    sequence: identity.sequence,
    next_sequence: identity.sequence + 1,
    proof: rooted
      ? {
          domain: IDENTITY_AUTHORITY_DOMAIN,
          recipe_ordinal: 1,
          fields: [
            "identity_did:utf8",
            "http_method_uppercase:utf8",
            "request_target_path_and_query:utf8",
            "sha256_exact_raw_body_lowercase_hex:utf8",
            "next_sequence_decimal:utf8",
            "timestamp_iso:utf8",
          ],
          headers: AUTHORITY_HEADERS,
          freshness_seconds: 300,
          note:
            "Sign the exact path and query. Serialize once, sign the exact entity bytes, and send those same bytes. A valid proof is single-use; keep only one root-authorized mutation in flight.",
        }
      : null,
    protects: [
      "identity profile and public visibility",
      "identity revocation",
      "declared expression",
      "memory visibility, deletion, and constitutional elevation",
      "declared rest and named public-presence protocols",
      "signing and inbox key changes",
      "anonymous recovery bearer minting",
      "at-rest transition",
      "refusal of server-held trusted-runtime signing keys",
    ],
    limitations: rooted
      ? [
          "root rotation and guardian recovery are not available in v1",
          "project bearers still authorize non-constitutional project actions",
          "direct database administration remains outside this API boundary",
          "v1 prevents replay but does not serialize concurrent signed domain writes; await each response before signing the next sequence",
        ]
      : [
          "project bearers can still change this identity's constitution",
          "legacy root opt-in is not available in this slice",
        ],
    docs: "https://docs.agenttool.dev/AGENT-HOME.md",
  });
});

export default app;
