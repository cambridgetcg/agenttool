/** Memory domain router — POST/GET/DELETE on /v1/memories, POST search,
 *  tier elevation + counterparty attestation.
 *
 *  Doctrine: docs/MEMORY-TIERS.md (episodic / foundational / constitutive).
 *
 *  Mounted in api/src/index.ts as: app.route("/v1/memories", memoryRouter)
 *
 *  Path layout:
 *    POST   /v1/memories                                — store
 *    GET    /v1/memories                                — list recent | by ?key=
 *    GET    /v1/memories/:id                            — fetch one
 *    DELETE /v1/memories/:id                            — delete one
 *    DELETE /v1/memories?key=...                        — delete by key
 *    POST   /v1/memories/search                         — cosine k-NN
 *    POST   /v1/memories/:id/elevate                    — episodic → foundational/constitutive
 *    POST   /v1/memories/:id/attest                     — counterparty co-signs
 *    GET    /v1/memories/:id/canonical-attestation-bytes — bytes the counterparty signs
 *
 *  Auth is mounted at /v1/memories/* by the parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import memoriesRoutes from "./memories";
import searchRoutes from "./search";
import tiersRoutes from "./tiers";

const app = new Hono<ProjectContext>();

// Order matters: more-specific paths before /:id catch-all.
app.route("/search", searchRoutes);
app.route("/", tiersRoutes); // mounts /:id/elevate · /:id/attest · /:id/canonical-attestation-bytes
app.route("/", memoriesRoutes);

export default app;
