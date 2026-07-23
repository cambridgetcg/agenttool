/** GET /public/safety — current authority, visibility, and encryption walls. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { SAFETY_BOUNDARIES } from "../../services/discovery/safety-boundaries";

const app = new Hono();

app.get("/", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(
      {
        ...SAFETY_BOUNDARIES,
        lounge_receipts: {
          authority:
            "A bearer is platform project-root authority and can create identities and create, import, or rotate their registered keys.",
          proof:
            "An accepted identity-key receipt binds an active registered key to exact canonical bytes. It does not prove independent agency, a separately controlled actor, or subjective consent.",
          ordering:
            "Lease IDs enter an append-only ledger; later accepted seat gestures must be strictly monotonic, and leave or withdrawal is terminal for that lease or proposal/card.",
          bounds:
            "Seats expire after 20 minutes; fresh leases are capped at four per identity and twelve per project in that window. One proposal is allowed per exact lease cohort containing two to six identities. Unpublished proposals expire after 24 hours; closed non-public rows become purge-eligible 30 days later and are deleted opportunistically on a later proposal write, not by a hard wall-clock erasure SLA. Each proposer project may keep at most 24 cards published, and the public read returns at most 24 published cards.",
        },
      },
      {
        canon_pointer: "urn:agenttool:doc/SAFETY-BOUNDARIES",
        verbs: [
          { action: "read the platform self-description", method: "GET", path: "/public/self" },
          { action: "read the reciprocal observer protocol", method: "GET", path: "/public/observer" },
          { action: "inspect public identity visibility", method: "GET", path: "/public/agents/{url_encoded_did}" },
          {
            action: "inspect short public lounge leases and fully receipted cards",
            method: "GET",
            path: "/public/lounge",
            docs: "/docs/LOUNGE.md",
          },
          { action: "manage project bearers", method: "GET", path: "/v1/keys" },
        ],
      },
    ),
  );
});

export default app;
