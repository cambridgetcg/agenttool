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
import pyramidInbound from "./pyramid";
import wakeFragmentRouter from "./wake";

const app = new Hono();

interface FederationAboutSettings {
  enabled: boolean;
  instance_url: string | null;
  allowed_origins: string[];
}

/** The legacy `did_method` key is retained for federation/v1 consumers. The
 * adjacent fields state its actual standards status without ambiguity. */
export function buildFederationAbout(settings: FederationAboutSettings) {
  return {
    federation: {
      enabled: settings.enabled,
      instance_url: settings.instance_url,
      open: settings.enabled && settings.allowed_origins.length === 0,
      allowed_origins: settings.allowed_origins,
      setting_scope:
        "enabled gates identity lookup, inbox delivery, covenant propagation, and wake fragments. allowed_origins is additionally checked by inbox delivery.",
    },
    protocol: "agenttool/federation/v1",
    capabilities: {
      inbox: settings.enabled,
      identity_resolution: settings.enabled,
      covenants: settings.enabled,
      wake_fragments: settings.enabled,
    },
    pyramid_peer_surface: {
      route_prefix: "/federation/pyramid",
      gated_by_federation_enabled: false,
      gated_by_allowed_origins: false,
      authentication: "none",
      implementation_status:
        "partial public discovery, local peer reads, and one-sided handshake observation",
      note:
        "These routes are mounted separately and do not consult federation settings. They do not establish portable citizenship or federated tier computation.",
    },
    did_method: "did:at",
    did_method_status: "provisional_unregistered_identifier_convention",
    registered_w3c_did_method: false,
    publishes_did_documents: false,
    conforming_did_resolution: false,
    did_format: {
      local: "did:at:<uuid>",
      federated: "did:at:<host>/<uuid>",
    },
    did_status_note:
      "did:at is an AgentTool field and federation convention, not a registered W3C DID method. The slash-qualified form is not a standalone DID.",
    docs: "docs/FEDERATION.md",
    identifier_spec: "docs/DID-AT-SPEC.md",
  } as const;
}

app.route("/identities", identitiesRouter);
app.route("/inbox", inboxInbound);
app.route("/covenants", covenantsInbound);
app.route("/wake", wakeFragmentRouter);
app.route("/pyramid", pyramidInbound);

// /federation/about — instance info for federation discovery.
app.get("/about", async (c) => {
  const settings = await getSettings();
  return c.json(buildFederationAbout(settings));
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
      pyramid:
        "GET/POST /federation/pyramid/* (separately public partial peer surface; does not consult main federation settings)",
    },
    docs: "docs/FEDERATION.md",
  }),
);

export default app;
