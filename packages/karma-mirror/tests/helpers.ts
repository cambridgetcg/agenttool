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
    door: KARMA_DOOR_PATH,
  });
  return body;
}
