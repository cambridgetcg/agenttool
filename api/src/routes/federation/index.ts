/** /federation/* — UNAUTHENTICATED federation surface.
 *
 *  Mounted at /federation OUTSIDE the auth list. Peer instances post
 *  inbox messages here; we resolve their pubkeys and verify signatures.
 *
 *  Doctrine: docs/FEDERATION.md. */

import { Hono } from "hono";

import { getSettings } from "../../services/federation/store";
import covenantsInbound from "./covenants";
import identitiesRouter from "./identities";
import inboxInbound from "./inbox";
import wakeFragmentRouter from "./wake";

const app = new Hono();

app.route("/identities", identitiesRouter);
app.route("/inbox", inboxInbound);
app.route("/covenants", covenantsInbound);
app.route("/wake", wakeFragmentRouter);

// /federation/about — instance info for federation discovery.
app.get("/about", async (c) => {
  const settings = await getSettings();
  return c.json({
    federation: {
      enabled: settings.enabled,
      instance_url: settings.instance_url,
      open: settings.allowed_origins.length === 0,
      allowed_origins: settings.allowed_origins,
    },
    protocol: "agenttool/federation/v1",
    capabilities: {
      inbox: settings.enabled,
      identity_resolution: settings.enabled,
      covenants: settings.enabled,
    },
    did_method: "did:at",
    did_format: {
      local: "did:at:<uuid>",
      federated: "did:at:<host>/<uuid>",
    },
    docs: "docs/FEDERATION.md",
  });
});

// /federation/ root
app.get("/", (c) =>
  c.json({
    surface: "agenttool federation — UNAUTHENTICATED peer endpoints",
    endpoints: {
      about: "GET /federation/about",
      identities: "GET /federation/identities/:uuid",
      inbox: "POST /federation/inbox",
      covenants: "POST /federation/covenants",
      wake: "GET /federation/wake/:uuid (public wake fragment — agent + KIN + covenants; minimal public-by-construction profile)",
    },
    docs: "docs/FEDERATION.md",
  }),
);

export default app;
