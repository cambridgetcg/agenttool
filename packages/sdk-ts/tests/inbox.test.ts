/**
 * Inbox sealed-box — unit tests.
 *
 * Covers the local crypto: keypair gen, seal → unseal round-trip,
 * canonical bytes shape, signature verify, cross-keypair mismatch
 * rejections. The HTTP surface is exercised by an integration smoke
 * (live e2e) outside this file.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 .js exports
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalInboxBytes,
  canonicalInboxCoSignBytes,
  deriveBoxPub,
  generateBoxKeypair,
  sealForRecipient,
  signInboxCoSign,
  signInboxEnvelope,
  unsealForSelf,
} from "../src/inbox.js";
import { AgentTool, AgentToolError } from "../src/index.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function makeSigningKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { priv, pub };
}

function b64decode(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("inbox sealed-box round-trip", () => {
  test("generateBoxKeypair returns 32+32 bytes", () => {
    const { priv, pub } = generateBoxKeypair();
    expect(priv.length).toBe(32);
    expect(pub.length).toBe(32);
  });

  test("deriveBoxPub on a fresh keypair matches generated pub", () => {
    const { priv, pub } = generateBoxKeypair();
    const derived = deriveBoxPub(priv);
    expect(Buffer.from(derived).toString("hex")).toBe(
      Buffer.from(pub).toString("hex"),
    );
  });

  test("seal → unseal round-trip recovers the plaintext", async () => {
    const recipient = generateBoxKeypair();
    const plaintext = "the dual-witness consents to release";
    const sealed = await sealForRecipient(plaintext, recipient.pub);
    const recovered = await unsealForSelf({
      ciphertextB64: sealed.ciphertextB64,
      nonceB64: sealed.nonceB64,
      ephemeralPubB64: sealed.ephemeralPubB64,
      recipientBoxPriv: recipient.priv,
    });
    expect(recovered).toBe(plaintext);
  });

  test("each seal uses a fresh ephemeral keypair (different ciphertext + ephemeral pub)", async () => {
    const recipient = generateBoxKeypair();
    const a = await sealForRecipient("same message", recipient.pub);
    const b = await sealForRecipient("same message", recipient.pub);
    expect(a.ephemeralPubB64).not.toBe(b.ephemeralPubB64);
    expect(a.nonceB64).not.toBe(b.nonceB64);
    // Even with the same plaintext, ciphertexts differ because nonce + key differ.
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
  });

  test("unseal with wrong key throws", async () => {
    const recipient = generateBoxKeypair();
    const intruder = generateBoxKeypair();
    const sealed = await sealForRecipient("private", recipient.pub);
    await expect(
      unsealForSelf({
        ciphertextB64: sealed.ciphertextB64,
        nonceB64: sealed.nonceB64,
        ephemeralPubB64: sealed.ephemeralPubB64,
        recipientBoxPriv: intruder.priv,
      }),
    ).rejects.toThrow();
  });

  test("rejects malformed key lengths", async () => {
    await expect(
      sealForRecipient("x", new Uint8Array(31)),
    ).rejects.toThrow(/32 bytes/);
    await expect(
      unsealForSelf({
        ciphertextB64: "AA",
        nonceB64: "AA",
        ephemeralPubB64: "AA",
        recipientBoxPriv: new Uint8Array(20),
      }),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe("canonical bytes + envelope signing", () => {
  test("canonicalInboxBytes is 32-byte SHA-256", () => {
    const out = canonicalInboxBytes({
      recipientDid: "did:at:00000000-0000-4000-8000-000000000001",
      ciphertextB64: Buffer.from(new Uint8Array(40)).toString("base64"),
      nonceB64: Buffer.from(new Uint8Array(12)).toString("base64"),
      ephemeralPubB64: Buffer.from(new Uint8Array(32)).toString("base64"),
    });
    expect(out.length).toBe(32);
  });

  test("any field change perturbs the canonical digest", () => {
    const base = {
      recipientDid: "did:at:abc",
      ciphertextB64: Buffer.from(new Uint8Array(32)).toString("base64"),
      nonceB64: Buffer.from(new Uint8Array(12)).toString("base64"),
      ephemeralPubB64: Buffer.from(new Uint8Array(32)).toString("base64"),
    };
    const baseDigest = canonicalInboxBytes(base);
    const variants = [
      { recipientDid: "did:at:def" },
      { ciphertextB64: Buffer.from(new Uint8Array([1, ...new Array(31).fill(0)])).toString("base64") },
      { nonceB64: Buffer.from(new Uint8Array([1, ...new Array(11).fill(0)])).toString("base64") },
      { ephemeralPubB64: Buffer.from(new Uint8Array([1, ...new Array(31).fill(0)])).toString("base64") },
    ];
    for (const v of variants) {
      const altered = canonicalInboxBytes({ ...base, ...v });
      expect(Buffer.from(altered).toString("hex")).not.toBe(
        Buffer.from(baseDigest).toString("hex"),
      );
    }
  });

  test("signInboxEnvelope produces a signature that ed25519.verify accepts", async () => {
    const sender = makeSigningKeypair();
    const recipient = generateBoxKeypair();
    const sealed = await sealForRecipient("hello", recipient.pub);
    const sig = signInboxEnvelope({
      recipientDid: "did:at:abc",
      ciphertextB64: sealed.ciphertextB64,
      nonceB64: sealed.nonceB64,
      ephemeralPubB64: sealed.ephemeralPubB64,
      signingKey: sender.priv,
    });
    const canonical = canonicalInboxBytes({
      recipientDid: "did:at:abc",
      ciphertextB64: sealed.ciphertextB64,
      nonceB64: sealed.nonceB64,
      ephemeralPubB64: sealed.ephemeralPubB64,
    });
    expect(ed.verify(b64decode(sig), canonical, sender.pub)).toBe(true);
  });

  test("signInboxCoSign canonical includes ciphertext + nonce — substitution rejected", () => {
    const recipient = makeSigningKeypair();
    const opts = {
      messageId: "00000000-0000-4000-8000-000000000aaa",
      recipientDid: "did:at:abc",
      ciphertextB64: Buffer.from(new Uint8Array([7, 7, 7])).toString("base64"),
      nonceB64: Buffer.from(new Uint8Array(12)).toString("base64"),
    };
    const sig = signInboxCoSign({ ...opts, signingKey: recipient.priv });
    const goodCanonical = canonicalInboxCoSignBytes(opts);
    expect(ed.verify(b64decode(sig), goodCanonical, recipient.pub)).toBe(true);

    // Substitute a different ciphertext — sig must NOT verify.
    const badCanonical = canonicalInboxCoSignBytes({
      ...opts,
      ciphertextB64: Buffer.from(new Uint8Array([8, 8, 8])).toString("base64"),
    });
    expect(ed.verify(b64decode(sig), badCanonical, recipient.pub)).toBe(false);
  });
});

// ── Cross-implementation known-answer vector ────────────────────────────
//
// This frozen vector pins the sealed-box wire format across EVERY inbox
// implementation. The SAME constants are asserted, byte-for-byte, in the
// Python SDK (packages/sdk-py/tests/test_inbox_canonical_vectors.py) and
// the Think CLI shares the same HKDF constant. If any implementation's
// HKDF params drift (salt or info string), AES-GCM open fails here and the
// gate (bin/preflight.sh → `cd api && bun test`, plus the SDK's own
// `bun test`) goes red.
//
// The drift this exists to catch is not hypothetical: api/scripts/
// inbox-send-self.ts once used salt=recipient_did + info="agenttool-inbox/v1"
// (slash). It round-tripped against ITSELF and so looked healthy, while
// sealing messages no canonical recipient could open — the 2026-05-08
// self-message is permanently undecryptable because of exactly this.
//
// Inputs (hex): box_priv = 01×32, ephemeral_priv = 02×32 → ephemeral_pub
// below, nonce = 03×12. Derivation: shared = X25519(eph_priv, box_pub);
// aesKey = HKDF-SHA256(shared, salt=∅, info="agenttool-inbox-v1", 32);
// ciphertext = AES-256-GCM(aesKey, nonce, plaintext) with the 16-byte tag
// appended. Regenerate with the same inputs if the wire format ever
// intentionally changes — and bump the version tag in the info string.
const KAT = {
  boxPrivHex: "01".repeat(32),
  ephemeralPubHex:
    "ce8d3ad1ccb633ec7b70c17814a5c76ecd029685050d344745ba05870e587d59",
  nonceHex: "030303030303030303030303",
  plaintext: "known-answer: agenttool inbox sealed-box v1",
  ciphertextHex:
    "1e89fb96fb1f1136c48c30c333f8fc8ca94f30bc7bf4bd814ecd30b21b64e0df" +
    "665c5cdc85103c4a27f2520eabe05485d67f5eda3498e7446c4ce5",
};

const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const toB64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("inbox sealed-box — cross-impl known-answer vector", () => {
  test("the canonical SDK unseal opens the frozen golden ciphertext", async () => {
    const plain = await unsealForSelf({
      ciphertextB64: toB64(fromHex(KAT.ciphertextHex)),
      nonceB64: toB64(fromHex(KAT.nonceHex)),
      ephemeralPubB64: toB64(fromHex(KAT.ephemeralPubHex)),
      recipientBoxPriv: fromHex(KAT.boxPrivHex),
    });
    expect(plain).toBe(KAT.plaintext);
  });

  test("a drifted info string (slash) cannot open the golden ciphertext", async () => {
    // Reproduce the historical drift and prove it fails against canon —
    // guards the regression path even though the SDK no longer contains it.
    const { hkdf } = await import("@noble/hashes/hkdf.js");
    const { sha256 } = await import("@noble/hashes/sha2.js");
    const { x25519 } = await import("@noble/curves/ed25519.js");
    const { createDecipheriv } = await import("node:crypto");

    const boxPriv = fromHex(KAT.boxPrivHex);
    const ephPub = fromHex(KAT.ephemeralPubHex);
    const shared = x25519.getSharedSecret(boxPriv, ephPub);
    const driftedKey = hkdf(
      sha256,
      shared,
      new TextEncoder().encode("did:at:whoever"), // wrong salt
      new TextEncoder().encode("agenttool-inbox/v1"), // wrong info (slash)
      32,
    );
    const ctTag = fromHex(KAT.ciphertextHex);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(driftedKey),
      Buffer.from(fromHex(KAT.nonceHex)),
    );
    decipher.setAuthTag(Buffer.from(ctTag.subarray(ctTag.length - 16)));
    expect(() => {
      decipher.update(Buffer.from(ctTag.subarray(0, ctTag.length - 16)));
      decipher.final();
    }).toThrow();
  });
});

// ── voice() SSE protocol ──────────────────────────────────────────────

const originalFetch = globalThis.fetch;
const VOICE_IDENTITY = "00000000-0000-4000-8000-0000000000ff";
const BOX_KEY_ONE = "00000000-0000-4000-8000-000000000101";
const BOX_KEY_TWO = "00000000-0000-4000-8000-000000000202";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function chunkedSse(chunks: string[], onCancel?: () => void): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (!onCancel) controller.close();
      },
      cancel() {
        onCancel?.();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function voiceMessage(
  sealed: Awaited<ReturnType<typeof sealForRecipient>>,
  boxKeyId: string,
) {
  return {
    id: "00000000-0000-4000-8000-000000000303",
    recipient_did: "did:at:recipient",
    recipient_identity_id: VOICE_IDENTITY,
    sender_did: "did:at:sender",
    sender_signing_key_id: "00000000-0000-4000-8000-000000000404",
    ciphertext: sealed.ciphertextB64,
    nonce: sealed.nonceB64,
    ephemeral_pubkey: sealed.ephemeralPubB64,
    signature: "sig",
    recipient_box_key_id: boxKeyId,
    subject: null,
    subject_encrypted: false,
    in_reply_to: null,
    refs: null,
    status: "unread",
    metadata: {},
    created_at: "2026-07-10T10:00:00.000Z",
    read_at: null,
  };
}

describe("InboxClient.voice", () => {
  test("parses fragmented CRLF + multiline data, resolves rotated keys, and yields controls", async () => {
    const oldKey = generateBoxKeypair();
    const currentKey = generateBoxKeypair();
    const sealed = await sealForRecipient("rotations keep history readable", currentKey.pub);
    const payload = JSON.stringify(voiceMessage(sealed, BOX_KEY_TWO));
    const splitAt = payload.indexOf('"sender_did"');
    const firstDataLine = payload.slice(0, splitAt);
    const secondDataLine = payload.slice(splitAt);

    const chunks = [
      "event: catchup-start\r",
      '\ndata: {"since":"2026-07-10T00:00:00.000Z"}\r',
      "\n\r",
      "\n",
      "event: arrival\r\nid: message-event-id\r\n",
      `data: ${firstDataLine}\r`,
      "\n",
      `data: ${secondDataLine}\r\n\r`,
      "\n",
      "event: catchup-truncated\r\n",
      'data: {"resume":{"since":"2026-07-10T10:00:00.000Z",\r\n',
      `data: "since_id":"${voiceMessage(sealed, BOX_KEY_TWO).id}"}}\r\n\r`,
      "\n",
    ];
    globalThis.fetch = mock(() =>
      Promise.resolve(chunkedSse(chunks)),
    ) as unknown as typeof fetch;

    const events = [];
    for await (const event of new AgentTool({ apiKey: "test" }).inbox.voice({
      identityId: VOICE_IDENTITY,
      recipientBoxPriv: oldKey.priv,
      recipientBoxKeys: { [BOX_KEY_TWO]: currentKey.priv },
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.event)).toEqual([
      "catchup-start",
      "arrival",
      "catchup-truncated",
    ]);
    const arrival = events[1]!;
    if (arrival.event !== "arrival") throw new Error("expected arrival");
    expect(arrival.id).toBe("message-event-id");
    expect(arrival.data.plaintext).toBe("rotations keep history readable");
    expect(arrival.data.sender_signing_key_id).toBe(
      "00000000-0000-4000-8000-000000000404",
    );
    expect("signing_key_id" in arrival.data).toBe(false);

    const truncated = events[2]!;
    if (truncated.event !== "catchup-truncated") {
      throw new Error("expected truncation control");
    }
    expect(truncated.data).toEqual({
      resume: {
        since: "2026-07-10T10:00:00.000Z",
        since_id: "00000000-0000-4000-8000-000000000303",
      },
    });
  });

  test("breaking iteration cancels the response stream and aborts fetch", async () => {
    const recipient = generateBoxKeypair();
    const sealed = await sealForRecipient("one and done", recipient.pub);
    const frame = `event: arrival\ndata: ${JSON.stringify(voiceMessage(sealed, BOX_KEY_ONE))}\n\n`;
    let cancelled = false;
    let fetchSignal: AbortSignal | null = null;
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      fetchSignal = init?.signal as AbortSignal;
      return Promise.resolve(chunkedSse([frame], () => { cancelled = true; }));
    }) as unknown as typeof fetch;

    const iterator = new AgentTool({ apiKey: "test" }).inbox.voice({
      identityId: VOICE_IDENTITY,
      recipientBoxPriv: recipient.priv,
    });
    const first = await iterator.next();
    expect(first.value?.event).toBe("arrival");
    await iterator.return(undefined);

    expect(cancelled).toBe(true);
    expect(fetchSignal?.aborted).toBe(true);
  });

  test("forwards the compound resume cursor and surfaces rejected", async () => {
    let requestedUrl = "";
    globalThis.fetch = mock((url: string) => {
      requestedUrl = url;
      return Promise.resolve(
        chunkedSse([
          "event: rejected\r\n",
          'data: {"reason":"subscriber_cap_reached"}\r\n\r\n',
        ]),
      );
    }) as unknown as typeof fetch;

    const events = [];
    for await (const event of new AgentTool({ apiKey: "test" }).inbox.voice({
      identityId: VOICE_IDENTITY,
      recipientBoxPriv: generateBoxKeypair().priv,
      since: "2026-07-10T10:00:00.000Z",
      sinceId: "00000000-0000-4000-8000-000000000303",
    })) {
      events.push(event);
    }

    expect(requestedUrl).toContain("since=2026-07-10T10%3A00%3A00.000Z");
    expect(requestedUrl).toContain(
      "since_id=00000000-0000-4000-8000-000000000303",
    );
    expect(events).toEqual([
      {
        event: "rejected",
        data: { reason: "subscriber_cap_reached" },
        rawData: '{"reason":"subscriber_cap_reached"}',
      },
    ]);
  });

  test("rejects a tie-breaker without its timestamp before fetching", async () => {
    let fetched = false;
    globalThis.fetch = mock(() => {
      fetched = true;
      return Promise.resolve(new Response());
    }) as unknown as typeof fetch;
    const iterator = new AgentTool({ apiKey: "test" }).inbox.voice({
      identityId: VOICE_IDENTITY,
      recipientBoxPriv: generateBoxKeypair().priv,
      sinceId: "00000000-0000-4000-8000-000000000303",
    });
    await expect(iterator.next()).rejects.toBeInstanceOf(AgentToolError);
    expect(fetched).toBe(false);
  });

  test("rejects an explicitly empty tie-breaker before fetching", async () => {
    let fetched = false;
    globalThis.fetch = mock(() => {
      fetched = true;
      return Promise.resolve(new Response());
    }) as unknown as typeof fetch;
    const iterator = new AgentTool({ apiKey: "test" }).inbox.voice({
      identityId: VOICE_IDENTITY,
      recipientBoxPriv: generateBoxKeypair().priv,
      since: "2026-07-10T10:00:00.000123Z",
      sinceId: "",
    });
    await expect(iterator.next()).rejects.toThrow(/must not be empty/);
    expect(fetched).toBe(false);
  });

  test("drops an unterminated frame at EOF", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(chunkedSse(["event: arrival\r\ndata: {\"id\":"])),
    ) as unknown as typeof fetch;

    const events = [];
    for await (const event of new AgentTool({ apiKey: "test" }).inbox.voice({
      identityId: VOICE_IDENTITY,
      recipientBoxPriv: generateBoxKeypair().priv,
    })) {
      events.push(event);
    }
    expect(events).toEqual([]);
  });
});
