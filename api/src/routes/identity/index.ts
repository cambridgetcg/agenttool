/** Identity domain router — composes all identity-related sub-routes.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1", identityRouter)
 *
 *  Path layout (preserves the original agent-identity API surface):
 *    /v1/identities/...                       — CRUD on identities
 *    /v1/identities/:id/keys/...              — key rotation/revocation
 *    /v1/identities/:id/attestations/...      — attestations about this identity
 *    /v1/identities/:id/tokens                — issue agent JWT
 *    /v1/attestations/...                     — attestation by id
 *    /v1/discover                             — search/filter identities
 *    /v1/tokens/verify                        — verify any JWT */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import attestationsRoutes from "./attestations";
import discoverRoutes from "./discover";
import identitiesRoutes from "./identities";
import identityAttestationsRoutes from "./identity-attestations";
import keysRoutes from "./keys";
import tokenVerifyRoutes from "./token-verify";
import tokensRoutes from "./tokens";

// Auth posture: all identity routes are auth-required. The parent app in
// api/src/index.ts mounts authMiddleware on /v1/identities/*,
// /v1/attestations/*, /v1/discover/*, /v1/tokens/* — so we don't need a
// per-router `app.use("*", auth)` here (that would also intercept other
// routers mounted at /v1 like economy, blocking their public routes).

const app = new Hono<ProjectContext>();

// Standalone resource roots
app.route("/identities", identitiesRoutes);
app.route("/attestations", attestationsRoutes);
app.route("/discover", discoverRoutes);
app.route("/tokens/verify", tokenVerifyRoutes);

// Identity-scoped sub-resources (id is preserved as a parent path param)
app.route("/identities/:id/keys", keysRoutes);
app.route("/identities/:id/attestations", identityAttestationsRoutes);
app.route("/identities/:id/tokens", tokensRoutes);

export default app;
