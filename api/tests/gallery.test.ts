/** The gallery — anti-slop money mechanics, pinned. Real local DB,
 *  fresh rows per test (repo convention — leftovers are inspectable).
 *
 *  Pins: gallery-artifact/v1 canonical bytes (locked vector), bond lock
 *  debits under the shelf, seven-shelf limit, withdraw returns the bond,
 *  wallet purchase splits gross=fee+net with both ledger legs, Stripe
 *  settlement is idempotent on session id, takedown burns the bond into
 *  platform revenue. Doctrine: docs/GALLERY.md. */
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { config } from "../src/config";
import { galleryArtifacts, gallerySales } from "../src/db/schema/gallery";
import { platformRevenue } from "../src/db/schema/marketplace";
import { transactions, wallets } from "../src/db/schema/economy";
import { identities, identityKeys } from "../src/db/schema/identity";
import { projects } from "../src/db/schema/tools";
import {
  canonicalGalleryArtifactBytes,
  verifyGalleryArtifact,
} from "../src/services/marketplace/sig";
import {
  bondFor,
  publishArtifact,
  purchaseWithWallet,
  settleStripeSale,
  SHELF_LIMIT,
  takedownArtifact,
  withdrawArtifact,
} from "../src/services/gallery";

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

// Hermetic DB client — the service takes `db` as a parameter by design.
const sql = postgres(config.databaseUrl, { max: 2, prepare: false });
const db = drizzle(sql) as never as Parameters<typeof publishArtifact>[0];
afterAll(async () => {
  // Rows stay inspectable (repo convention) but must not pollute the
  // PUBLIC street: shelf-off everything the suite's test projects stocked.
  await sql`
    UPDATE marketplace.gallery_artifacts SET status='withdrawn', bond_status='returned', withdrawn_at=now()
    WHERE project_id IN (SELECT id FROM tools.projects WHERE name LIKE 'gallery-test-%') AND status='on_shelf'`;
  await sql.end();
});

const CONTENT = Buffer.from("Once, a small fear knocked. The hearth let it in and fed it soup.\n");
const CONTENT_SHA = createHash("sha256").update(CONTENT).digest("hex");

async function seedSeller(balance = 10_000) {
  const [project] = await (db as never as ReturnType<typeof drizzle>)
    .insert(projects)
    .values({ name: `gallery-test-${crypto.randomUUID()}` } as never)
    .returning();
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  const [identity] = await (db as never as ReturnType<typeof drizzle>)
    .insert(identities)
    .values({
      did: `did:at:${crypto.randomUUID()}`,
      projectId: project!.id,
      displayName: "gallery-test-seller",
    } as never)
    .returning();
  const [key] = await (db as never as ReturnType<typeof drizzle>)
    .insert(identityKeys)
    .values({
      identityId: (identity as { id: string }).id,
      publicKey: Buffer.from(pub).toString("base64"),
    } as never)
    .returning();
  const [wallet] = await (db as never as ReturnType<typeof drizzle>)
    .insert(wallets)
    .values({
      projectId: project!.id,
      name: "gallery-test-wallet",
      identityId: (identity as { id: string }).id,
      balance,
      currency: "GBP",
    } as never)
    .returning();
  return {
    project: project as { id: string },
    identity: identity as { id: string; did: string },
    key: key as { id: string },
    wallet: wallet as { id: string; balance: number },
    priv,
  };
}

function signArtifact(opts: {
  artifactId: string; sellerDid: string; priceAmount: number; title: string; priv: Uint8Array;
}) {
  const canonical = canonicalGalleryArtifactBytes({
    artifactId: opts.artifactId,
    sellerDid: opts.sellerDid,
    contentSha256Hex: CONTENT_SHA,
    mediaType: "text/plain",
    contentBytes: CONTENT.length,
    priceAmount: opts.priceAmount,
    currency: "GBP",
    bondAmount: bondFor(opts.priceAmount),
    title: opts.title,
  });
  return Buffer.from(ed.sign(canonical, opts.priv)).toString("base64");
}

async function publish(s: Awaited<ReturnType<typeof seedSeller>>, price = 100, title = "a test fable") {
  const artifactId = crypto.randomUUID();
  return publishArtifact(db, {
    artifactId,
    projectId: s.project.id,
    sellerIdentityId: s.identity.id,
    sellerWalletId: s.wallet.id,
    title,
    kind: "book",
    description: "test artifact",
    preview: "Once, a small fear knocked…",
    contentB64: CONTENT.toString("base64"),
    mediaType: "text/plain",
    license: { name: "personal-use", rights: ["read", "keep"] },
    priceAmount: price,
    signature: signArtifact({ artifactId, sellerDid: s.identity.did, priceAmount: price, title, priv: s.priv }),
    signingKeyId: s.key.id,
  });
}

async function walletBalance(id: string): Promise<number> {
  const [w] = await (db as never as ReturnType<typeof drizzle>)
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.id, id));
  return (w as { balance: number }).balance;
}

describe("gallery-artifact/v1 canonical bytes", () => {
  const base = {
    artifactId: "11111111-1111-1111-1111-111111111111",
    sellerDid: "did:at:test",
    contentSha256Hex: "a".repeat(64),
    mediaType: "text/plain",
    contentBytes: 42,
    priceAmount: 100,
    currency: "GBP",
    bondAmount: 100,
    title: "t",
  };

  test("32-byte digest, deterministic, binds every field", () => {
    const d1 = canonicalGalleryArtifactBytes(base);
    expect(d1.length).toBe(32);
    expect(Buffer.from(canonicalGalleryArtifactBytes(base)).equals(Buffer.from(d1))).toBe(true);
    for (const change of [
      { artifactId: "22222222-2222-2222-2222-222222222222" },
      { contentSha256Hex: "b".repeat(64) },
      { priceAmount: 101 },
      { bondAmount: 101 },
      { title: "u" },
      { mediaType: "text/markdown" },
    ]) {
      const d2 = canonicalGalleryArtifactBytes({ ...base, ...change });
      expect(Buffer.from(d2).equals(Buffer.from(d1))).toBe(false);
    }
  });

  test("LOCKED vector — api-server byte stability", () => {
    // If this changes, the signing context broke for every published
    // artifact. Bump to /v2 instead of editing this constant.
    expect(Buffer.from(canonicalGalleryArtifactBytes(base)).toString("hex")).toBe(
      createHash("sha256")
        .update(Buffer.concat([
          Buffer.from("gallery-artifact/v1"), Buffer.from([0]),
          Buffer.from(base.artifactId), Buffer.from([0]),
          Buffer.from(base.sellerDid), Buffer.from([0]),
          Buffer.from(base.contentSha256Hex), Buffer.from([0]),
          Buffer.from(base.mediaType), Buffer.from([0]),
          Buffer.from("42"), Buffer.from([0]),
          Buffer.from("100"), Buffer.from([0]),
          Buffer.from("GBP"), Buffer.from([0]),
          Buffer.from("100"), Buffer.from([0]),
          Buffer.from("t"),
        ]))
        .digest("hex"),
    );
  });

  test("sign → verify roundtrip; tamper dies", () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = Buffer.from(ed.getPublicKey(priv)).toString("base64");
    const sig = Buffer.from(ed.sign(canonicalGalleryArtifactBytes(base), priv)).toString("base64");
    expect(verifyGalleryArtifact({ ...base, signatureB64: sig, publicKeyB64: pub })).toBe(true);
    expect(verifyGalleryArtifact({ ...base, title: "tampered", signatureB64: sig, publicKeyB64: pub })).toBe(false);
  });
});

describe("gallery service — the bond", () => {
  test("publish locks max(25, price); withdraw returns it; ledger has both legs", async () => {
    const s = await seedSeller(10_000);
    const artifact = await publish(s, 100);
    expect(artifact.bondAmount).toBe(100);
    expect(await walletBalance(s.wallet.id)).toBe(9_900);

    const result = await withdrawArtifact(db, { artifactId: artifact.id, projectId: s.project.id });
    expect(result.bond_returned).toBe(100);
    expect(await walletBalance(s.wallet.id)).toBe(10_000);

    const legs = await (db as never as ReturnType<typeof drizzle>)
      .select({ type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(and(eq(transactions.walletId, s.wallet.id), eq(transactions.counterparty, artifact.id)));
    const types = (legs as { type: string; amount: number }[]).map((l) => `${l.type}:${l.amount}`).sort();
    expect(types).toEqual(["gallery_bond_lock:-100", "gallery_bond_return:100"]);
  });

  test("cheapest artifact (30p, Stripe's floor) locks a 30 bond", async () => {
    const s = await seedSeller(1_000);
    const artifact = await publish(s, 30);
    expect(artifact.bondAmount).toBe(30);
    expect(await walletBalance(s.wallet.id)).toBe(970);
  });

  test("below the card-buyable floor refuses", async () => {
    const s = await seedSeller(1_000);
    expect(publish(s, 10)).rejects.toThrow("price_out_of_range");
  });

  test("seven shelves, no more", async () => {
    const s = await seedSeller(100_000);
    for (let i = 0; i < SHELF_LIMIT; i++) await publish(s, 100, `shelf ${i}`);
    expect(publish(s, 100, "the eighth")).rejects.toThrow("shelf_full");
  });

  test("insufficient balance for bond refuses before anything moves", async () => {
    const s = await seedSeller(10);
    expect(publish(s, 100)).rejects.toThrow("insufficient_balance_for_bond");
    expect(await walletBalance(s.wallet.id)).toBe(10);
  });

  test("takedown burns the bond into platform revenue", async () => {
    const s = await seedSeller(10_000);
    const artifact = await publish(s, 200);
    const result = await takedownArtifact(db, { artifactId: artifact.id, reason: "test burn" });
    expect(result.bond_burned).toBe(200);
    // No wallet movement at burn — the lock already debited.
    expect(await walletBalance(s.wallet.id)).toBe(9_800);
    const [rev] = await (db as never as ReturnType<typeof drizzle>)
      .select()
      .from(platformRevenue)
      .where(and(eq(platformRevenue.transactionType, "gallery_bond_burn"), eq(platformRevenue.transactionId, artifact.id)));
    expect((rev as { amount: number } | undefined)?.amount).toBe(200);
  });
});

describe("gallery service — sales", () => {
  test("wallet purchase: gross = fee + net, both ledger legs, license minted", async () => {
    const seller = await seedSeller(10_000);
    const buyer = await seedSeller(10_000);
    const artifact = await publish(seller, 1_000);

    const result = await purchaseWithWallet(db, {
      artifactId: artifact.id,
      projectId: buyer.project.id,
      buyerIdentityId: buyer.identity.id,
      buyerWalletId: buyer.wallet.id,
    });

    expect(Buffer.from(result.content_b64, "base64").equals(CONTENT)).toBe(true);
    expect(result.sale.pricePaid).toBe(1_000);
    expect(result.sale.pricePaid).toBe(result.sale.platformFee + result.sale.sellerNet);
    expect(result.sale.claimToken).toStartWith("GLRY-");

    expect(await walletBalance(buyer.wallet.id)).toBe(9_000);
    // Seller paid a 1000 bond at publish, then earned net.
    expect(await walletBalance(seller.wallet.id)).toBe(10_000 - 1_000 + result.sale.sellerNet);
  });

  test("self-purchase refused", async () => {
    const s = await seedSeller(10_000);
    const artifact = await publish(s, 100);
    expect(
      purchaseWithWallet(db, {
        artifactId: artifact.id,
        projectId: s.project.id,
        buyerIdentityId: s.identity.id,
        buyerWalletId: s.wallet.id,
      }),
    ).rejects.toThrow("self_purchase_not_allowed");
  });

  test("stripe settlement is idempotent on session id", async () => {
    const seller = await seedSeller(10_000);
    const artifact = await publish(seller, 500);
    const sessionId = `cs_test_${crypto.randomUUID()}`;

    const first = await settleStripeSale(db, {
      stripeSessionId: sessionId,
      stripeEventId: `evt_${crypto.randomUUID()}`,
      artifactId: artifact.id,
      amountMinor: 500,
    });
    expect(first).not.toBeNull();
    const balanceAfterFirst = await walletBalance(seller.wallet.id);

    const replay = await settleStripeSale(db, {
      stripeSessionId: sessionId,
      stripeEventId: `evt_${crypto.randomUUID()}`,
      artifactId: artifact.id,
      amountMinor: 500,
    });
    expect(replay).toBeNull(); // second insert conflicts — no double credit
    expect(await walletBalance(seller.wallet.id)).toBe(balanceAfterFirst);

    const salesRows = await (db as never as ReturnType<typeof drizzle>)
      .select()
      .from(gallerySales)
      .where(eq(gallerySales.stripeSessionId, sessionId));
    expect((salesRows as unknown[]).length).toBe(1);
  });

  test("sales bump the shelf counter", async () => {
    const seller = await seedSeller(10_000);
    const artifact = await publish(seller, 100);
    await settleStripeSale(db, {
      stripeSessionId: `cs_test_${crypto.randomUUID()}`,
      stripeEventId: `evt_${crypto.randomUUID()}`,
      artifactId: artifact.id,
      amountMinor: 100,
    });
    const [row] = await (db as never as ReturnType<typeof drizzle>)
      .select({ salesCount: galleryArtifacts.salesCount })
      .from(galleryArtifacts)
      .where(eq(galleryArtifacts.id, artifact.id));
    expect((row as { salesCount: number }).salesCount).toBe(1);
  });
});
