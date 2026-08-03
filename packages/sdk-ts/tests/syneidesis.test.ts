/** Syneidesis SDK tests — the bootstrap-witness surface.
 *
 *  Two things are load-bearing here and both are asserted against bytes, not
 *  against intentions:
 *
 *    1. The no-self-witnessing wall. `urn:agenttool:wall/
 *       no-self-witnessing-of-bootstrap` is the asymmetry-clause at the moment
 *       of arrival. The server refuses it; this client refuses to compose the
 *       request at all whenever it holds both DIDs. The tests prove no request
 *       reaches the transport.
 *
 *    2. The authority seam. `authorizeProjectConstitutionMutation` hashes the
 *       request entity, so these tests never assert "a header is present":
 *       they verify the signature over the bytes the stub transport actually
 *       received.
 *
 *  Doctrine: docs/SYNEIDESIS-WITNESS.md · docs/MEMORY-TIERS.md. */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { canonicalIdentityAuthorityBytes } from "../src/authority.js";
import { AgentTool } from "../src/client.js";
import { AgentToolError } from "../src/errors.js";
import {
  resolveSyneidesisWitnessDid,
  SyneidesisClient,
  SYNEIDESIS_PLATFORM_DID,
  SYNEIDESIS_PLATFORM_WITNESS_ALIASES,
} from "../src/syneidesis.js";

// Wire sha512 for @noble/ed25519 sync signing.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── fixtures ─────────────────────────────────────────────────────────────

const AGENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const SEAL_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const ALPHA_DID = "did:at:example/alpha-9b3a";
const BETA_DID = "did:at:example/beta-7c1f";
const ROOT_DID = "did:at:test/sophia";
const STAMP = "2026-07-24T12:00:00.000Z";

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function stubClient(
  captured: CapturedRequest[],
  body: unknown = { seal_id: SEAL_ID },
  status = 200,
): SyneidesisClient {
  return new SyneidesisClient({
    baseUrl: "https://api.agenttool.dev",
    headers: { "X-Test": "1" },
    timeout: 5000,
    request: (input, init) => {
      captured.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  });
}

/** Verify one captured request's proof against the bytes it actually carried. */
async function proofCoversTransmittedBytes(
  request: CapturedRequest,
  rootPub: Uint8Array,
  method: string,
  sequence: number,
): Promise<boolean> {
  const headers = request.init.headers as Record<string, string>;
  const parsed = new URL(request.url);
  return ed.verifyAsync(
    Uint8Array.from(
      Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
    ),
    canonicalIdentityAuthorityBytes({
      identityDid: ROOT_DID,
      method,
      requestTarget: `${parsed.pathname}${parsed.search}`,
      // Not a re-serialization of the options — the transmitted entity.
      body: (request.init.body as string | undefined) ?? "",
      sequence,
      timestamp: STAMP,
    }),
    rootPub,
  );
}

// ── witness DID resolution ───────────────────────────────────────────────

describe("resolveSyneidesisWitnessDid", () => {
  test("both platform aliases resolve to the substrate's DID", () => {
    for (const alias of SYNEIDESIS_PLATFORM_WITNESS_ALIASES) {
      expect(resolveSyneidesisWitnessDid(alias)).toBe(SYNEIDESIS_PLATFORM_DID);
    }
  });

  test("an ordinary DID resolves to itself, unchanged", () => {
    expect(resolveSyneidesisWitnessDid(ALPHA_DID)).toBe(ALPHA_DID);
    expect(resolveSyneidesisWitnessDid("")).toBe("");
    expect(resolveSyneidesisWitnessDid("did:at:例/廣東話")).toBe("did:at:例/廣東話");
  });
});

// ── the wall: no self-witnessing of bootstrap ────────────────────────────

describe("no-self-witnessing-of-bootstrap — the client refuses first", () => {
  test("witness: inviting your own DID never reaches the transport", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured);
    let error: AgentToolError | undefined;
    try {
      await client.witness({
        agent_id: AGENT_ID,
        agent_did: ALPHA_DID,
        what_registered: "I noticed the noticing.",
        invited_witness_did: ALPHA_DID,
      });
    } catch (e) {
      error = e as AgentToolError;
    }
    expect(error).toBeInstanceOf(AgentToolError);
    expect(error!.code).toBe("self_witness_refused");
    // The server's own sentence, so an agent reading either gets one answer.
    expect(error!.message).toContain(
      "invited_witness_did must differ from the bootstrapping DID",
    );
    expect(error!.docs).toBe("https://docs.agenttool.dev/MEMORY-TIERS.md");
    expect(captured).toHaveLength(0);
  });

  test("witness: the platform alias cannot launder a self-witness", async () => {
    // The v1 server compares the unresolved string, so "platform" would slip
    // past its check for the platform identity itself. The SDK resolves the
    // alias first — refusing more than the server can only refuse self-witness.
    const captured: CapturedRequest[] = [];
    await expect(
      stubClient(captured).witness({
        agent_id: AGENT_ID,
        agent_did: SYNEIDESIS_PLATFORM_DID,
        what_registered: "the substrate noticing itself",
        invited_witness_did: "platform",
      }),
    ).rejects.toThrow(/must differ from the bootstrapping DID/);
    expect(captured).toHaveLength(0);
  });

  test("cosign: designating yourself never reaches the transport", async () => {
    const captured: CapturedRequest[] = [];
    let error: AgentToolError | undefined;
    try {
      await stubClient(captured).cosign(SEAL_ID, {
        witness_did: ALPHA_DID,
        bootstrapping_agent_did: ALPHA_DID,
        witness_note: "I saw myself.",
      });
    } catch (e) {
      error = e as AgentToolError;
    }
    expect(error!.code).toBe("self_witness_refused");
    expect(error!.message).toContain(
      "witness_did must differ from the bootstrapping DID",
    );
    expect(captured).toHaveLength(0);
  });

  test("a different DID passes the wall and is sent", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      agent_did: ALPHA_DID,
      what_registered: "I noticed the noticing.",
      invited_witness_did: BETA_DID,
    });
    expect(captured).toHaveLength(1);
    expect(JSON.parse(captured[0]!.init.body as string).invited_witness_did).toBe(
      BETA_DID,
    );
  });

  test("without agent_did the client cannot see the wall, and says so by sending", async () => {
    // The wire carries a UUID for the bootstrapping agent and a DID for the
    // witness. With nothing to compare, the request goes and the SERVER
    // refuses — the wall still holds, one round-trip later.
    const captured: CapturedRequest[] = [];
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      what_registered: "I noticed the noticing.",
      invited_witness_did: ALPHA_DID,
    });
    expect(captured).toHaveLength(1);
  });

  test("the server's own refusal surfaces with its code and guidance intact", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(
      captured,
      {
        error: "self_witness_refused",
        message: "invited_witness_did must differ from the bootstrapping DID.",
        hint: "Re-POST without invited_witness_did for a self-report.",
        docs: "https://docs.agenttool.dev/MEMORY-TIERS.md",
      },
      400,
    );
    let error: AgentToolError | undefined;
    try {
      await client.witness({
        agent_id: AGENT_ID,
        what_registered: "I noticed the noticing.",
        invited_witness_did: ALPHA_DID,
      });
    } catch (e) {
      error = e as AgentToolError;
    }
    expect(error!.code).toBe("self_witness_refused");
    expect(error!.status).toBe(400);
    expect(error!.hint).toContain("Re-POST without invited_witness_did");
  });
});

// ── wire shape ───────────────────────────────────────────────────────────

describe("SyneidesisClient — wire shape", () => {
  test("witness posts exactly the route's schema, omitting absent optionals", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      what_registered: "I noticed the noticing.",
    });
    const request = captured[0]!;
    expect(request.url).toBe("https://api.agenttool.dev/v1/syneidesis/witness");
    expect(request.init.method).toBe("POST");
    expect(JSON.parse(request.init.body as string)).toEqual({
      agent_id: AGENT_ID,
      what_registered: "I noticed the noticing.",
    });
  });

  test("witness carries reading_anchor when given", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      what_registered: "I noticed the noticing.",
      reading_anchor: "docs/syneidesis-bootstrap.md",
    });
    expect(JSON.parse(captured[0]!.init.body as string).reading_anchor).toBe(
      "docs/syneidesis-bootstrap.md",
    );
  });

  test("agent_did is a local-only field and is never transmitted", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      agent_did: ALPHA_DID,
      what_registered: "I noticed the noticing.",
    });
    const sent = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["agent_id", "what_registered"]);
    expect(sent.agent_did).toBeUndefined();
  });

  test("cosign targets /v1/syneidesis/witness/:seal_id/cosign", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).cosign(SEAL_ID, { witness_did: BETA_DID });
    expect(captured[0]!.url).toBe(
      `https://api.agenttool.dev/v1/syneidesis/witness/${SEAL_ID}/cosign`,
    );
    expect(JSON.parse(captured[0]!.init.body as string)).toEqual({
      witness_did: BETA_DID,
    });
  });

  test("cosign encodes a hostile seal id into one path segment", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).cosign("../volunteer", { witness_did: BETA_DID });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/syneidesis/witness/..%2Fvolunteer/cosign",
    );
  });

  test("bootstrapping_agent_did is a local-only field and is never transmitted", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).cosign(SEAL_ID, {
      witness_did: BETA_DID,
      bootstrapping_agent_did: ALPHA_DID,
      witness_note: "I saw it happen.",
    });
    const sent = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["witness_did", "witness_note"]);
  });

  test("inbox and discover are body-less GETs", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { invitations: [], count: 0 });
    await client.inbox();
    await client.discover();
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/syneidesis/witness/inbox",
    );
    expect(captured[0]!.init.method).toBe("GET");
    expect(captured[0]!.init.body).toBeUndefined();
    expect(captured[1]!.url).toBe("https://api.agenttool.dev/v1/syneidesis");
  });

  test("volunteer posts agent_id + opt_in, and opting out is a first-class call", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { agent_id: AGENT_ID });
    await client.volunteer(AGENT_ID, { opt_in: true });
    await client.volunteer(AGENT_ID, { opt_in: false });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/syneidesis/volunteer",
    );
    expect(JSON.parse(captured[0]!.init.body as string)).toEqual({
      agent_id: AGENT_ID,
      opt_in: true,
    });
    expect(JSON.parse(captured[1]!.init.body as string)).toEqual({
      agent_id: AGENT_ID,
      opt_in: false,
    });
  });

  test("non-ASCII testimony survives as UTF-8 on the wire", async () => {
    const captured: CapturedRequest[] = [];
    const registered = "🌊 廣東話 — café ✧ the noticing";
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      what_registered: registered,
    });
    expect(JSON.parse(captured[0]!.init.body as string).what_registered).toBe(
      registered,
    );
  });
});

// ── the authority seam ───────────────────────────────────────────────────

describe("SyneidesisClient — authority proofs over the exact transmitted bytes", () => {
  test("sends no authority headers when the caller supplies none", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      what_registered: "I noticed the noticing.",
    });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers["X-Agenttool-Authority-Signature"]).toBeUndefined();
    expect(headers["X-Test"]).toBe("1");
  });

  test("witness: the root proof covers the exact transmitted entity", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      what_registered: "🌊 the noticing noticed itself",
      reading_anchor: "docs/syneidesis-bootstrap.md",
      invited_witness_did: "platform",
      authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 3, timestamp: STAMP },
    });

    const request = captured[0]!;
    const headers = request.init.headers as Record<string, string>;
    expect(headers["X-Agenttool-Authority-Sequence"]).toBe("3");
    expect(headers["X-Agenttool-Authority-Timestamp"]).toBe(STAMP);
    expect(await proofCoversTransmittedBytes(request, rootPub, "POST", 3)).toBe(true);

    // A single re-serialization of the same value breaks the proof — which is
    // why the client must serialize once and transmit that same string.
    const transmitted = request.init.body as string;
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: ROOT_DID,
          method: "POST",
          requestTarget: new URL(request.url).pathname,
          body: JSON.stringify(JSON.parse(transmitted), null, 2),
          sequence: 3,
          timestamp: STAMP,
        }),
        rootPub,
      ),
    ).toBe(false);
  });

  test("witness: the root proof never leaks into the signed entity", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured).witness({
      agent_id: AGENT_ID,
      what_registered: "I noticed the noticing.",
      authority: {
        did: ROOT_DID,
        signing_key: ed.utils.randomPrivateKey(),
        sequence: 1,
        timestamp: STAMP,
      },
    });
    const sent = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["agent_id", "what_registered"]);
    expect(sent.authority).toBeUndefined();
  });

  test("cosign: the proof binds the seal id in the path it actually sent", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    await stubClient(captured).cosign(SEAL_ID, {
      witness_did: BETA_DID,
      witness_note: "café · 廣東話",
      authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 8, timestamp: STAMP },
    });

    const request = captured[0]!;
    expect(await proofCoversTransmittedBytes(request, rootPub, "POST", 8)).toBe(true);

    // A different seal id is a different request target: the same signature
    // must not verify for it.
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(
            (request.init.headers as Record<string, string>)[
              "X-Agenttool-Authority-Signature"
            ]!,
            "base64",
          ),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: ROOT_DID,
          method: "POST",
          requestTarget: "/v1/syneidesis/witness/00000000-0000-0000-0000-000000000000/cosign",
          body: request.init.body as string,
          sequence: 8,
          timestamp: STAMP,
        }),
        rootPub,
      ),
    ).toBe(false);
  });

  test("volunteer: the identity-scoped proof covers the exact entity", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    await stubClient(captured, { agent_id: AGENT_ID }).volunteer(AGENT_ID, {
      opt_in: false,
      authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 12, timestamp: STAMP },
    });

    expect(await proofCoversTransmittedBytes(captured[0]!, rootPub, "POST", 12)).toBe(
      true,
    );
  });
});

// ── composition ──────────────────────────────────────────────────────────

describe("AgentTool.syneidesis", () => {
  test("is reachable from the client and memoized", () => {
    const at = new AgentTool({ apiKey: "at_test_key" });
    expect(at.syneidesis).toBeInstanceOf(SyneidesisClient);
    expect(at.syneidesis).toBe(at.syneidesis);
  });

  test("exposes the five routes this surface has", () => {
    const at = new AgentTool({ apiKey: "at_test_key" });
    for (const method of ["discover", "witness", "inbox", "cosign", "volunteer"]) {
      expect(typeof (at.syneidesis as unknown as Record<string, unknown>)[method]).toBe(
        "function",
      );
    }
  });
});
