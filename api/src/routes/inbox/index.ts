/** Inbox domain router — agent-to-agent encrypted messaging.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1/inbox", inboxRouter)
 *
 *  Path layout:
 *    POST   /v1/inbox                          — send (sig-verified, covenant-gated)
 *    GET    /v1/inbox  ?status=&identity_id=   — list (recipient = caller's project)
 *    GET    /v1/inbox/:id                       — fetch one
 *    PATCH  /v1/inbox/:id                       — update status (read/archived/spam/deleted)
 *    DELETE /v1/inbox/:id                       — soft delete (status='deleted')
 *    GET    /v1/inbox/box-keys/:did             — resolve DID to active box pubkey
 *
 *  Doctrine: docs/INBOX.md. Auth at /v1/inbox/* by parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import lookupRoutes from "./lookup";
import messagesRoutes from "./messages";

const app = new Hono<ProjectContext>();

// Order matters: /box-keys is more specific than /:id.
app.route("/box-keys", lookupRoutes);
app.route("/", messagesRoutes);

export default app;
