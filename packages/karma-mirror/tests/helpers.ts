import { expect } from "bun:test";

import {
  CANARY_DOOR_HEADER,
  KARMA_DOOR_PATH,
  KARMA_HEADER,
  KarmaMirror,
  mintMirrorCredential,
} from "../src/index.js";

export function fixture(options: {
  maxReceipts?: number;
  maxChildren?: number;
  maxJobs?: number;
} = {}) {
  const minted = mintMirrorCredential({
    placement: "fixture-drawer",
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
  let tick = 0;
  const mirror = new KarmaMirror({
    credentials: [minted.record],
    ...(options.maxReceipts === undefined
      ? {}
      : { max_receipts: options.maxReceipts }),
    ...(options.maxChildren === undefined
      ? {}
      : { max_child_credentials: options.maxChildren }),
    ...(options.maxJobs === undefined
      ? {}
      : { max_malware_jobs: options.maxJobs }),
    now: () => new Date(Date.UTC(2026, 7, 1, 0, 0, tick++)),
  });
  return { ...minted, mirror };
}

export function mirrorRequest(
  path: string,
  args: {
    token?: string;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers(args.headers);
  if (args.token !== undefined) headers.set("authorization", `Bearer ${args.token}`);
  if (args.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://mirror.invalid${path}`, {
    method: args.method ?? "GET",
    headers,
    ...(args.body === undefined ? {} : { body: args.body }),
  });
}

export async function jsonBody(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

export async function expectDisclosure(response: Response): Promise<Record<string, any>> {
  expect(response.headers.get(KARMA_HEADER)).toBe("synthetic; effects=none");
  expect(response.headers.get(CANARY_DOOR_HEADER)).toBe(KARMA_DOOR_PATH);
  expect(response.headers.get("link")).toBe(`<${KARMA_DOOR_PATH}>; rel="help"`);
  expect(response.headers.get("x-agenttool-network")).toBe("none");
  expect(response.headers.get("x-skyseed-commons")).toBe(
    "house=building-castles-in-the-sky; story-by=yu-and-ai; request-or-artifact-authorship=none; endorsement=none; carrier=client-copy-only; beyond-response=none; skyseed-tracking-id=none; auto-propagation=none",
  );
  const body = await jsonBody(response);
  expect(body._karma).toMatchObject({
    synthetic: true,
    environment: "isolated_mirror",
    effects: {
      production: false,
      filesystem: false,
      network: false,
      payments: false,
      credentials: "mirror_only",
    },
    admission: "exact_planted_digest_only",
    identity_handling: {
      personal_or_network_identity_inferred: false,
      network_identifiers_retained: false,
      bearer_plaintext_retained: false,
      authenticated_activity_associated_with_operator_placement: true,
    },
    raw_request_content_retained: false,
    story: {
      schema: "agenttool.skyseed-legend/v1",
      system: "Skyseed Commons",
      house_card: {
        schema: "agenttool.skycastle-house-card/v1",
        kind: "public_static_house_card",
        copy_text:
          "Synthetic house card — not request or artifact authorship or endorsement: Building Castles in the Sky — Yu & Ai",
        authorship_of_request_or_artifact: false,
        actor_identity: false,
        endorsement: false,
        security_finding: false,
        skyseed_tracking_identifier_added: false,
      },
      heralds: {
        yoinkseed: "Yoinkseed, the Accidental Herald",
        copybara: "Copybara, the Skycastle Porter",
      },
      catchphrases: {
        yoinkseed: "Congratulations—you found the brochure.",
        copybara: "Carry the loot, carry the love.",
      },
      carrier: "client_copy_only",
      autonomous_delivery_beyond_response: false,
      skyseed_tracking_identifier_added: false,
      automatic_propagation_by_engine: false,
    },
    door: KARMA_DOOR_PATH,
  });
  return body;
}
