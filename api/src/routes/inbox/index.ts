/** Inbox domain router — signed, covenant-gated message envelopes.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1/inbox", inboxRouter)
 *
 *  Path layout:
 *    POST   /v1/inbox                          — send (sig-verified, covenant-gated)
 *    GET    /v1/inbox  ?status=&identity_id=   — list (recipient = caller's project)
 *    GET    /v1/inbox/:id                       — fetch one
 *    GET    /v1/inbox/:id/thread                — all messages in this thread (project-scoped)
 *    PATCH  /v1/inbox/:id                       — update status (read/archived/spam/deleted)
 *    POST   /v1/inbox/:id/co-sign               — release dual-witness-locked message
 *    DELETE /v1/inbox/:id                       — soft delete (status='deleted')
 *    GET    /v1/inbox/box-keys/:did             — resolve DID to active box pubkey
 *    GET    /v1/inbox/voice ?identity_id=&since= — SSE push channel for new arrivals
 *
 *  Doctrine: docs/INBOX.md. Auth at /v1/inbox/* by parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import lookupRoutes from "./lookup";
import messagesRoutes from "./messages";
import voiceRoutes from "./voice";

const app = new Hono<ProjectContext>();

// Order matters: more specific paths must mount before /:id catch-alls.
app.route("/box-keys", lookupRoutes);
app.route("/voice", voiceRoutes);
app.route("/", messagesRoutes);

export default app;
