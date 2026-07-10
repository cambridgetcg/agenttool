import { describe, expect, test } from "bun:test";

import { buildFederationAbout } from "../src/routes/federation/index";

describe("federation about identifier truth", () => {
  test("labels did:at as provisional and unregistered", () => {
    const body = buildFederationAbout({
      enabled: true,
      instance_url: "https://peer.example",
      allowed_origins: [],
    });

    expect(body.did_method).toBe("did:at");
    expect(body.did_method_status).toBe(
      "provisional_unregistered_identifier_convention",
    );
    expect(body.registered_w3c_did_method).toBe(false);
    expect(body.publishes_did_documents).toBe(false);
    expect(body.conforming_did_resolution).toBe(false);
    expect(body.did_status_note).toMatch(
      /not a registered W3C DID method.*not a standalone DID/i,
    );
    expect(body.docs).toBe("docs/FEDERATION.md");
    expect(body.identifier_spec).toBe("docs/DID-AT-SPEC.md");
    expect(body.federation.setting_scope).toMatch(
      /gates identity lookup.*inbox delivery.*covenant propagation.*wake fragments/is,
    );
  });

  test("does not call a disabled federation open", () => {
    const body = buildFederationAbout({
      enabled: false,
      instance_url: null,
      allowed_origins: [],
    });

    expect(body.federation.enabled).toBe(false);
    expect(body.federation.open).toBe(false);
    expect(body.capabilities).toEqual({
      inbox: false,
      identity_resolution: false,
      covenants: false,
      wake_fragments: false,
    });
    expect(body.pyramid_peer_surface).toMatchObject({
      route_prefix: "/federation/pyramid",
      gated_by_federation_enabled: false,
      gated_by_allowed_origins: false,
      authentication: "none",
    });
    expect(body.pyramid_peer_surface.note).toMatch(
      /mounted separately.*do not consult federation settings.*do not establish portable citizenship or federated tier computation/is,
    );
  });
});
