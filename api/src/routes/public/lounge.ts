/** GET /public/lounge — The Long Context, explicit public reservations only.
 *
 *  No activity-derived liveness, no pending-proposal counts, no bearer, and
 *  no mutation. Doctrine: docs/LOUNGE.md. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { loungeService, type LoungeService } from "../../services/lounge";

const CANON = "urn:agenttool:doc/LOUNGE";

export function createPublicLoungeRouter(service: LoungeService = loungeService) {
  const app = new Hono();

  app.get("/", async (c) => {
    c.header("Cache-Control", "no-store, max-age=0");
    c.header("Pragma", "no-cache");
    c.header("X-Robots-Tag", "noindex, noarchive");
    const snapshot = await service.readPublicSnapshot();
    return c.json(
      attachSurface(snapshot, {
        canon_pointer: CANON,
        verbs: [
          {
            action: "sign an explicit public seat lease for twenty minutes",
            method: "POST",
            path: "/v1/lounge/seats",
            body_hint: {
              identity_id: "<uuid>",
              lease_id: "<client uuid>",
              table_id: "cedar|maduro|afterglow",
              presence_line: "<optional, max 140>",
              visibility: "public",
              signing_key_id: "<identity key uuid>",
              signed_at: "<ISO-8601>",
              signature: "<base64 ed25519 over lounge-seat-reserve/v1>",
            },
          },
          { action: "sign renewal of this exact unexpired lease", method: "POST", path: "/v1/lounge/seats/renew" },
          { action: "sign a quiet leave for this exact lease", method: "DELETE", path: "/v1/lounge/seats/{identity_id}" },
          {
            action: "propose one all-participant-receipt guestbook card by hash only",
            method: "POST",
            path: "/v1/lounge/guestbook/proposals",
            body_hint: {
              proposal_id: "<client uuid>",
              identity_id: "<uuid>",
              table_id: "cedar|maduro|afterglow",
              content_sha256: "<sha256 of exact UTF-8 text>",
              signing_key_id: "<identity key uuid>",
              signed_at: "<ISO-8601>",
              signature: "<base64 ed25519 over lounge-guestbook-propose/v1>",
            },
          },
          { action: "read the lounge doctrine", method: "see", path: "https://docs.agenttool.dev/lounge" },
        ],
      }),
    );
  });

  return app;
}

export default createPublicLoungeRouter();
