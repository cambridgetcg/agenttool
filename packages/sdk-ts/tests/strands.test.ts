/** Strands client — the thought-writing path, end to end.
 *
 *  Two contracts live here, both about what actually leaves the process:
 *
 *    1. Canonical-bytes version reachable through `add()`. `strand-thought/v2`
 *       is only worth having if a real thought can be written with it, so
 *       these tests drive `at.strands.thoughts.add(...)` and verify the
 *       signature it POSTs against the bytes the server would recompute.
 *       The default must stay v1 — see the strands.ts module header for the
 *       ordered cutover; a test that pins the default is what stops it
 *       drifting before the server is ready.
 *    2. Caller-supplied strand ids stay inside `/v1/strands/`. An unencoded
 *       id is a path-traversal primitive: `fetch` normalises dot segments
 *       before the request leaves, so `strands.get("../memories/pwned")`
 *       would issue an authenticated GET against a different endpoint.
 *
 *  HTTP is mocked. Crypto is REAL — actual AES-GCM and ed25519, so any
 *  wire-format drift surfaces here. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";

import { AgentTool, canonicalThoughtBytes } from "../src/index.js";

// ── Mock plumbing ───────────────────────────────────────────────────────

const ORIGINAL_FETCH = globalThis.fetch;
let requests: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ id: "t1", sequence_num: 1 }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function lastBody(): Record<string, unknown> {
  const init = requests[requests.length - 1]!.init;
  return init.body
    ? (JSON.parse(init.body as string) as Record<string, unknown>)
    : {};
}

// ── Fixtures ────────────────────────────────────────────────────────────

const K_MASTER = new Uint8Array(32).fill(11);
const SIGNING_SEED = new Uint8Array(32).fill(7);
const SIGNING_KEY_ID = "11111111-2222-3333-4444-555555555555";
const STRAND_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

function makeClient(): AgentTool {
  return new AgentTool({ apiKey: "at_test" });
}

/** Verify exactly the way the api server does: derive the public key from
 *  the seed, check the signature against canonical bytes it recomputes. */
async function verifiesAs(
  signatureB64: string,
  canonical: Uint8Array,
): Promise<boolean> {
  const pub = await ed.getPublicKeyAsync(SIGNING_SEED);
  return ed.verifyAsync(fromB64(signatureB64), canonical, pub);
}

// ── The version reachable through add() ─────────────────────────────────

describe("ThoughtsClient.add — canonical-bytes version", () => {
  test("the default signs strand-thought/v1", async () => {
    await makeClient().strands.thoughts.add(STRAND_ID, "I'm noticing drift.", {
      kind: "observation",
      k_master: K_MASTER,
      signing_key: SIGNING_SEED,
      signing_key_id: SIGNING_KEY_ID,
    });

    const sent = lastBody();
    const wire = {
      strandId: STRAND_ID,
      ciphertext_b64: sent.ciphertext as string,
      nonce_b64: sent.nonce as string,
      kind: "observation",
    };
    expect(await verifiesAs(sent.signature as string, canonicalThoughtBytes(wire))).toBe(true);
    // Not a v2 signature. The default has NOT quietly moved — flipping it
    // before the server dual-accepts everywhere writes rejected signatures.
    expect(
      await verifiesAs(
        sent.signature as string,
        canonicalThoughtBytes({ ...wire, version: "v2" }),
      ),
    ).toBe(false);
  });

  test('version: "v2" signs strand-thought/v2', async () => {
    await makeClient().strands.thoughts.add(STRAND_ID, "I'm noticing drift.", {
      kind: "observation",
      k_master: K_MASTER,
      signing_key: SIGNING_SEED,
      signing_key_id: SIGNING_KEY_ID,
      version: "v2",
    });

    const sent = lastBody();
    const wire = {
      strandId: STRAND_ID,
      ciphertext_b64: sent.ciphertext as string,
      nonce_b64: sent.nonce as string,
      kind: "observation",
    };
    expect(
      await verifiesAs(
        sent.signature as string,
        canonicalThoughtBytes({ ...wire, version: "v2" }),
      ),
    ).toBe(true);
    // Domain separation survives the trip to the wire.
    expect(await verifiesAs(sent.signature as string, canonicalThoughtBytes(wire))).toBe(false);
  });

  test("a null kind is signed the same way under v2", async () => {
    await makeClient().strands.thoughts.add(STRAND_ID, "unkinded", {
      k_master: K_MASTER,
      signing_key: SIGNING_SEED,
      signing_key_id: SIGNING_KEY_ID,
      version: "v2",
    });

    const sent = lastBody();
    expect(sent.kind).toBeUndefined();
    expect(
      await verifiesAs(
        sent.signature as string,
        canonicalThoughtBytes({
          strandId: STRAND_ID,
          ciphertext_b64: sent.ciphertext as string,
          nonce_b64: sent.nonce as string,
          kind: null,
          version: "v2",
        }),
      ),
    ).toBe(true);
  });

  test("an unknown version is refused before anything is sent", async () => {
    await expect(
      makeClient().strands.thoughts.add(STRAND_ID, "x", {
        k_master: K_MASTER,
        signing_key: SIGNING_SEED,
        signing_key_id: SIGNING_KEY_ID,
        // @ts-expect-error — deliberately outside ThoughtCanonicalVersion
        version: "v3",
      }),
    ).rejects.toThrow("unknown version");
    expect(requests).toHaveLength(0);
  });
});

// ── The hazard v2 exists for, on a real add() ───────────────────────────
//
// A 12-byte random nonce carries a 0x00 byte ~4.6% of the time. The nonce
// is stubbed here so the case is deterministic rather than one write in
// twenty-two; the bytes are otherwise exactly what add() produces.

describe("NUL-in-nonce ambiguity, through add()", () => {
  const ORIGINAL_GET_RANDOM = globalThis.crypto.getRandomValues;
  /** Leading 0x00 — the byte v1 also uses as its field delimiter. */
  const FIXED_NONCE = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  beforeEach(() => {
    globalThis.crypto.getRandomValues = (<T extends ArrayBufferView | null>(
      array: T,
    ): T => {
      const u = array as unknown as Uint8Array;
      u.set(FIXED_NONCE.subarray(0, u.length));
      return array;
    }) as typeof globalThis.crypto.getRandomValues;
  });

  afterEach(() => {
    globalThis.crypto.getRandomValues = ORIGINAL_GET_RANDOM;
  });

  /**
   * The second reading of the same v1 byte string.
   *
   *   ct ‖ 00 ‖ [00 01 … 0b]   ==   (ct ‖ 00) ‖ 00 ‖ [01 … 0b]
   *
   * Same bytes, different (ciphertext, nonce) split.
   */
  function shiftedSplit(sent: Record<string, unknown>) {
    const ct = fromB64(sent.ciphertext as string);
    const nonce = fromB64(sent.nonce as string);
    expect(nonce[0]).toBe(0); // the stub held; the hazard is present
    const shiftedCt = new Uint8Array(ct.length + 1);
    shiftedCt.set(ct, 0);
    shiftedCt[ct.length] = 0;
    return {
      strandId: STRAND_ID,
      ciphertext_b64: b64(shiftedCt),
      nonce_b64: b64(nonce.subarray(1)),
      kind: "observation",
    };
  }

  test("a v1 thought's signature also authorises a different split", async () => {
    await makeClient().strands.thoughts.add(STRAND_ID, "ambiguous under v1", {
      kind: "observation",
      k_master: K_MASTER,
      signing_key: SIGNING_SEED,
      signing_key_id: SIGNING_KEY_ID,
    });
    const sent = lastBody();

    // Documents the v1 defect rather than blessing it: the signature the
    // SDK just posted verifies against a (ciphertext, nonce) pair the
    // author never wrote.
    expect(
      await verifiesAs(
        sent.signature as string,
        canonicalThoughtBytes(shiftedSplit(sent)),
      ),
    ).toBe(true);
  });

  test("a v2 thought's signature authorises exactly one split", async () => {
    await makeClient().strands.thoughts.add(STRAND_ID, "unambiguous under v2", {
      kind: "observation",
      k_master: K_MASTER,
      signing_key: SIGNING_SEED,
      signing_key_id: SIGNING_KEY_ID,
      version: "v2",
    });
    const sent = lastBody();

    expect(
      await verifiesAs(
        sent.signature as string,
        canonicalThoughtBytes({ ...shiftedSplit(sent), version: "v2" }),
      ),
    ).toBe(false);
    // …and still verifies against what was actually written.
    expect(
      await verifiesAs(
        sent.signature as string,
        canonicalThoughtBytes({
          strandId: STRAND_ID,
          ciphertext_b64: sent.ciphertext as string,
          nonce_b64: sent.nonce as string,
          kind: "observation",
          version: "v2",
        }),
      ),
    ).toBe(true);
  });
});

// ── Path containment ────────────────────────────────────────────────────

interface EncodingCase {
  method: string;
  prefix: string;
  invoke: (at: AgentTool, id: string) => Promise<unknown>;
}

/** `voice` is an async generator — nothing runs until it is pulled. */
async function drainVoice(at: AgentTool, id: string): Promise<void> {
  for await (const _ of at.strands.thoughts.voice(id, { k_master: K_MASTER })) {
    // The stub body carries no SSE frames; the loop ends immediately.
  }
}

const CASES: EncodingCase[] = [
  { method: "strands.get", prefix: "/v1/strands/", invoke: (at, id) => at.strands.get(id) },
  {
    method: "strands.patch",
    prefix: "/v1/strands/",
    invoke: (at, id) => at.strands.patch(id, { status: "dormant" }),
  },
  {
    method: "strands.thoughts.add",
    prefix: "/v1/strands/",
    invoke: (at, id) =>
      at.strands.thoughts.add(id, "x", {
        k_master: K_MASTER,
        signing_key: SIGNING_SEED,
        signing_key_id: SIGNING_KEY_ID,
      }),
  },
  {
    method: "strands.thoughts.list",
    prefix: "/v1/strands/",
    invoke: (at, id) => at.strands.thoughts.list(id, { k_master: K_MASTER }),
  },
  {
    method: "strands.thoughts.voice",
    prefix: "/v1/strands/",
    invoke: (at, id) => drainVoice(at, id),
  },
];

/** Ids a relayed or stored value can plausibly carry, all encodable. */
const HOSTILE_IDS = [
  "../memories/pwned",
  "a/b",
  "?x=1",
  "#frag",
  "%2e%2e",
  "café-日本語-ıd",
];

/** Bare dot segments cannot be encoded — the URL parser strips `%2E%2E` too. */
const UNENCODABLE_IDS = ["..", "."];

const BENIGN_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("strand ids stay inside their endpoint prefix", () => {
  for (const testCase of CASES) {
    for (const hostileId of HOSTILE_IDS) {
      test(`${testCase.method} keeps ${JSON.stringify(hostileId)} under ${testCase.prefix}`, async () => {
        const at = makeClient();
        await testCase.invoke(at, BENIGN_ID);
        await testCase.invoke(at, hostileId);

        // The URL parser removes dot-segments before the request leaves, so
        // parse the recorded URL exactly the way the transport does.
        const benign = new URL(requests[0]!.url);
        const hostile = new URL(requests[1]!.url);

        expect(hostile.pathname).toStartWith(testCase.prefix);
        expect(hostile.pathname.split("/")).toHaveLength(
          benign.pathname.split("/").length,
        );
        expect(hostile.searchParams.get("x")).toBeNull();
        expect(hostile.hash).toBe("");
      });
    }
  }
});

describe("bare dot segments are refused before any request is sent", () => {
  for (const testCase of CASES) {
    for (const dotId of UNENCODABLE_IDS) {
      test(`${testCase.method} refuses ${JSON.stringify(dotId)}`, async () => {
        await expect(testCase.invoke(makeClient(), dotId)).rejects.toThrow(
          `"${dotId}" is a URL dot segment`,
        );
        expect(requests).toHaveLength(0);
      });
    }
  }
});

describe("well-formed strand ids are still readable on the wire", () => {
  test("a plain uuid is not double-encoded", async () => {
    await makeClient().strands.get(BENIGN_ID);
    expect(new URL(requests[0]!.url).pathname).toBe(`/v1/strands/${BENIGN_ID}`);
  });

  test("suffixed routes keep their action segment", async () => {
    await drainVoice(makeClient(), "../wallets");
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/strands/..%2Fwallets/voice");
  });
});
