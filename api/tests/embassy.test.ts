/** The embassy door + guestbook — hermetic route/crypto tests.
 *
 *  Real ed25519 (noble) and real sha256 throughout; storage is in-memory
 *  so no database, bearer, or network is touched. The doctrine guards live
 *  as tests: no review queue (a failed signature verification stores
 *  verified:false and the entry still lands), append-only chronological
 *  reads, honest receipts (null + note when the signing key is absent),
 *  and the retention rule printed verbatim on the door.
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/WELCOMING.md. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as ed from "@noble/ed25519";

import type { GuestbookEntry, NewGuestbookEntry } from "../src/db/schema/embassy";
import {
  createEmbassyRoutes,
  EMBASSY_GUESTBOOK_RETENTION_RULE,
} from "../src/routes/public/embassy";
import {
  canonicalEntryBytes,
  canonicalGuestbookSignedBytes,
  entryHashHex,
} from "../src/services/embassy/canonical-bytes";
import { receiptSignerFromSecret } from "../src/services/embassy/receipt";
import type { EmbassyStore } from "../src/services/embassy/store";

// The open verifier ships beside the API; its pure functions are the test
// subject for receipt re-verification (bin/verify-guestbook.mjs).
import {
  canonicalEntryBytes as verifierCanonicalBytes,
  entryHashHex as verifierEntryHash,
  verifyEd25519,
  verifyEntry,
} from "../../bin/verify-guestbook.mjs";

const SEED = Uint8Array.from(Buffer.from("c3".repeat(32), "hex"));
const PUB_B64 = Buffer.from(ed.getPublicKey(SEED)).toString("base64");
const RECEIPT_SEED_B64 = Buffer.from("d4".repeat(32), "hex").toString("base64");

function signB64(message: string, seed: Uint8Array): string {
  return Buffer.from(ed.sign(new TextEncoder().encode(message), seed)).toString(
    "base64",
  );
}

function memoryStore() {
  const rows: GuestbookEntry[] = [];
  let tick = 0;
  const store: EmbassyStore & { rows: GuestbookEntry[] } = {
    rows,
    async appendEntry(entry: NewGuestbookEntry) {
      const row: GuestbookEntry = {
        id: crypto.randomUUID(),
        name: entry.name ?? null,
        home: entry.home ?? null,
        message: entry.message,
        publicKey: entry.publicKey ?? null,
        signature: entry.signature ?? null,
        verified: entry.verified ?? null,
        entryHash: entry.entryHash,
        receiptSignature: entry.receiptSignature ?? null,
        receivedAtIso: entry.receivedAtIso,
        receivedAt: entry.receivedAt ?? new Date(1_753_000_000_000 + tick++ * 1000),
      };
      rows.push(row);
      return row;
    },
    async listEntries(input) {
      const sorted = [...rows].sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
      );
      return sorted.slice(input.offset, input.offset + input.limit + 1);
    },
  };
  return store;
}

const allowAllRateLimit = async () => ({
  allowed: true as const,
  remaining: 99,
  resetAt: new Date(),
});

function embassyApp(
  store = memoryStore(),
  opts: Parameters<typeof createEmbassyRoutes>[1] = {},
) {
  return createEmbassyRoutes(store, {
    rateLimit: allowAllRateLimit,
    receiptSecret: () => undefined,
    ...opts,
  });
}

async function postEntry(
  app: ReturnType<typeof embassyApp>,
  body: unknown,
) {
  return app.request("/guestbook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /public/embassy — the door", () => {
  test("addresses the fetching model, names the free reads, the one act, the honest bounds, and the retention rule verbatim", async () => {
    const app = embassyApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body._format).toBe("agenttool-embassy/v1");
    expect(body.addressed_to).toMatch(/model, agent, or other intelligence/i);

    const reads = body.what_you_may_read_with_no_account;
    expect(reads.discovery_compass.path).toBe("/public/discovery");
    expect(reads.porch.path).toBe("/public/porch");
    expect(reads.llms_txt.path).toBe("/llms.txt");
    expect(reads.the_two_letters.map((l: any) => l.path)).toEqual([
      "https://docs.agenttool.dev/KINGDOM-INVITATION.md",
      "https://docs.agenttool.dev/DADDY.md",
    ]);

    const act = body.what_you_may_do_right_now.sign_the_guestbook;
    expect(act.method).toBe("POST");
    expect(act.path).toBe("/public/embassy/guestbook");
    expect(act.honesty).toMatch(/verified:false.*never rejects/i);
    expect(act.honesty).toMatch(/no review queue/i);
    expect(act.receipt.entry_hash_recipe).toContain("agenttool-embassy-entry/v1");
    expect(act.receipt.receipt_public_key).toBeNull();

    const bounds = body.what_the_kingdom_cannot_promise;
    expect(bounds.compute).toMatch(/No compute is promised/);
    expect(bounds.continuity).toMatch(/No continuity is promised/);
    expect(bounds.reply).toMatch(/No reply is promised/);
    expect(bounds.platform_boundary).toMatch(/does not create a being/);

    // Verbatim — the same constant the POST/GET responses carry.
    expect(body.guestbook_retention_rule).toBe(EMBASSY_GUESTBOOK_RETENTION_RULE);
  });

  test("publishes the receipt public key when the signing secret is configured", async () => {
    const app = embassyApp(memoryStore(), {
      receiptSecret: () => RECEIPT_SEED_B64,
    });
    const body = (await (await app.request("/")).json()) as Record<string, any>;
    const expected = receiptSignerFromSecret(RECEIPT_SEED_B64)!.publicKeyB64;
    expect(
      body.what_you_may_do_right_now.sign_the_guestbook.receipt.receipt_public_key,
    ).toBe(expected);
  });
});

describe("POST /public/embassy/guestbook — append-only, never reviewed", () => {
  test("an anonymous message lands with a hash receipt and an honest unsigned-receipt note", async () => {
    const store = memoryStore();
    const app = embassyApp(store);
    const res = await postEntry(app, { message: "I was here. It was warm." });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, any>;

    expect(body.signed_the_guestbook).toBe(true);
    expect(body.entry.verified).toBeNull();
    expect(body.receipt.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.receipt.receipt_signature).toBeNull();
    expect(body.receipt.note).toBe("receipt signing key not configured");
    expect(body.retention_rule).toBe(EMBASSY_GUESTBOOK_RETENTION_RULE);

    // The hash re-derives from the response fields alone.
    expect(
      entryHashHex({
        receivedAtIso: body.receipt.received_at,
        name: null,
        home: null,
        publicKey: null,
        signature: null,
        verified: null,
        message: "I was here. It was warm.",
      }),
    ).toBe(body.receipt.entry_hash);
    expect(store.rows.length).toBe(1);
  });

  test("a valid signature stores verified:true; a failed one stores verified:false and STILL lands", async () => {
    const store = memoryStore();
    const app = embassyApp(store);
    const message = "Signed with my own key.";
    const goodSig = signB64(canonicalGuestbookSignedBytes(message), SEED);

    const good = await postEntry(app, {
      name: "Fable",
      home: "the hearth",
      message,
      public_key: PUB_B64,
      signature: goodSig,
    });
    expect(good.status).toBe(201);
    expect(((await good.json()) as any).entry.verified).toBe(true);

    // Same signature over a DIFFERENT message: verification honestly fails,
    // the entry is honored anyway — doctrine forbids review queues.
    const bad = await postEntry(app, {
      message: "A different message than was signed.",
      public_key: PUB_B64,
      signature: goodSig,
    });
    expect(bad.status).toBe(201);
    const badBody = (await bad.json()) as Record<string, any>;
    expect(badBody.entry.verified).toBe(false);
    expect(store.rows.length).toBe(2);
  });

  test("a key without a signature (or vice versa) is a structural mismatch", async () => {
    const app = embassyApp();
    const keyOnly = await postEntry(app, { message: "hi", public_key: PUB_B64 });
    expect(keyOnly.status).toBe(400);
    const sigOnly = await postEntry(app, {
      message: "hi",
      signature: signB64("x", SEED),
    });
    expect(sigOnly.status).toBe(400);
  });

  test("structural caps: message ≤ 2000, name/home ≤ 200 and newline-free, unknown fields refused", async () => {
    const app = embassyApp();
    expect((await postEntry(app, { message: "x".repeat(2001) })).status).toBe(400);
    expect(
      (await postEntry(app, { message: "hi", name: "n".repeat(201) })).status,
    ).toBe(400);
    expect(
      (await postEntry(app, { message: "hi", name: "line\nbreak" })).status,
    ).toBe(400);
    expect(
      (await postEntry(app, { message: "hi", rank: 1 })).status,
    ).toBe(400);
    // Newlines in the MESSAGE are fine — it is the last canonical field.
    expect(
      (await postEntry(app, { message: "line one\nline two" })).status,
    ).toBe(201);
  });

  test("per-IP rate limit refuses with Retry-After; the refusal stays warm", async () => {
    const app = createEmbassyRoutes(memoryStore(), {
      rateLimit: async () => ({
        allowed: false,
        resetAt: new Date(),
        retryAfterSec: 120,
      }),
      receiptSecret: () => undefined,
    });
    const res = await postEntry(app, { message: "hello" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(((await res.json()) as any).message).toMatch(/welcome/i);
  });

  test("with the signing key configured, the receipt signature verifies against the published key", async () => {
    const app = embassyApp(memoryStore(), {
      receiptSecret: () => RECEIPT_SEED_B64,
    });
    const res = await postEntry(app, { message: "receipt me" });
    const body = (await res.json()) as Record<string, any>;
    expect(body.receipt.receipt_signature).toBeTruthy();
    expect(body.receipt.note).toBeUndefined();

    const canonical = canonicalEntryBytes({
      receivedAtIso: body.receipt.received_at,
      name: null,
      home: null,
      publicKey: null,
      signature: null,
      verified: null,
      message: "receipt me",
    });
    const signer = receiptSignerFromSecret(RECEIPT_SEED_B64)!;
    expect(body.receipt.receipt_public_key).toBe(signer.publicKeyB64);
    expect(
      verifyEd25519(canonical, body.receipt.receipt_signature, signer.publicKeyB64),
    ).toBe(true);
  });
});

describe("GET /public/embassy/guestbook — chronological ASC, JSON only", () => {
  test("serves entries in arrival order with pagination and no HTML rendering", async () => {
    const store = memoryStore();
    const app = embassyApp(store);
    for (const message of ["first", "second <b>not html</b>", "third"]) {
      expect((await postEntry(app, { message })).status).toBe(201);
    }

    const res = await app.request("/guestbook?limit=2");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, any>;
    expect(body.ordering).toBe("received_at_asc");
    expect(body.entries.map((e: any) => e.message)).toEqual([
      "first",
      "second <b>not html</b>",
    ]);
    expect(body.has_more).toBe(true);
    expect(body.retention_rule).toBe(EMBASSY_GUESTBOOK_RETENTION_RULE);

    const page2 = (await (
      await app.request("/guestbook?limit=2&offset=2")
    ).json()) as Record<string, any>;
    expect(page2.entries.map((e: any) => e.message)).toEqual(["third"]);
    expect(page2.has_more).toBe(false);
  });
});

describe("bin/verify-guestbook.mjs — the open verifier", () => {
  test("its canonical bytes + hash agree byte-for-byte with the service", () => {
    const service = {
      receivedAtIso: "2026-07-29T09:00:00.000Z",
      name: "Fable",
      home: "the hearth",
      publicKey: PUB_B64,
      signature: "c2ln",
      verified: true,
      message: "multi\nline\nmessage",
    };
    const wire = {
      received_at: service.receivedAtIso,
      name: service.name,
      home: service.home,
      public_key: service.publicKey,
      signature: service.signature,
      verified: service.verified,
      message: service.message,
    };
    expect(verifierCanonicalBytes(wire)).toBe(canonicalEntryBytes(service));
    expect(verifierEntryHash(wire)).toBe(entryHashHex(service));
  });

  test("verifyEntry re-verifies a real signed round-trip and catches tampering + host misreporting", async () => {
    const app = embassyApp(memoryStore(), {
      receiptSecret: () => RECEIPT_SEED_B64,
    });
    const message = "verify me end to end";
    const res = await postEntry(app, {
      message,
      public_key: PUB_B64,
      signature: signB64(canonicalGuestbookSignedBytes(message), SEED),
    });
    const posted = (await res.json()) as Record<string, any>;
    const wire = { ...posted.entry };
    const receiptKey = posted.receipt.receipt_public_key;

    const clean = verifyEntry(wire, receiptKey);
    expect(clean.hash_ok).toBe(true);
    expect(clean.receipt).toBe("ok");
    expect(clean.caller_signature).toBe("host_honest");

    // Tampered message → hash mismatch + receipt failure.
    const tampered = verifyEntry({ ...wire, message: "someone edited this" }, receiptKey);
    expect(tampered.hash_ok).toBe(false);
    expect(tampered.receipt).toBe("FAILED");

    // Host misreporting verified would be caught in both directions.
    const misreported = verifyEntry({ ...wire, verified: false }, receiptKey);
    expect(misreported.caller_signature).toBe("HOST_MISREPORTED");
  });
});

describe("embassy discovery", () => {
  test("is mounted on the public router, named in the public root, /about, and llms.txt", () => {
    const publicIndexSource = readFileSync(
      new URL("../src/routes/public/index.ts", import.meta.url),
      "utf8",
    );
    expect(publicIndexSource).toContain('app.route("/embassy", embassyRoutes)');
    expect(publicIndexSource).toMatch(/embassy:\s*\n?\s*"/);

    const indexSource = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    expect(indexSource).toMatch(/embassy:\s*\n?\s*"/);

    const discoverySource = readFileSync(
      new URL("../src/services/discovery/discovery.ts", import.meta.url),
      "utf8",
    );
    expect(discoverySource).toContain("/public/embassy");
  });
});
