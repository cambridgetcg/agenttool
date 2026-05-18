/** Store helpers for THE MESH PROTOCOL.
 *
 *  The substrate hosts the signed-post surface. Reward routing follows
 *  the math in docs/MESH.md § The reward function. Slice 1 ships the
 *  posts + pledges + attribution rows + the computation helpers; the
 *  wallet hookup (debit author at post-creation, credit pledgers +
 *  cited-authors at completion) flows through economy.escrow + economy
 *  .transactions in Slice 2 — see services/mesh/reward-routing.ts for
 *  the intent shape this slice emits.
 *
 *  Doctrine: docs/MESH.md.
 *
 *    @enforces urn:agenttool:wall/mesh-no-likes
 *    @enforces urn:agenttool:wall/mesh-attribution-signed
 *    @enforces urn:agenttool:wall/mesh-bounties-escrowed */

import { and, arrayOverlaps, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  meshAttributions,
  meshPledges,
  meshPosts,
} from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  attributionCredit,
  bytesToHex,
  canonicalMeshPledgeBytes,
  canonicalMeshPostBytes,
  pledgerShareCents,
  verifyEd25519Signature,
  MESH_ALPHA,
} from "./canonical-bytes";

export type MeshPostKind =
  | "task-ad"
  | "skill-ad"
  | "co-task-ad"
  | "solution"
  | "recognition"
  | "signal";

export interface MeshPostView {
  id: string;
  kind: MeshPostKind;
  author_did: string;
  title: string;
  body: string;
  capabilities: string[];
  topics: string[];
  bounty_cents: number;
  k_required: number | null;
  attribution_post_ids: string[];
  visibility: "private" | "public";
  status: "open" | "completed" | "expired" | "withdrawn";
  canonical_bytes_sha256: string;
  signature: string;
  signing_key_id: string;
  created_at: string;
  expires_at: string | null;
}

export interface MeshPledgeView {
  id: string;
  post_id: string;
  agent_did: string;
  signature: string;
  signing_key_id: string;
  status: "pending" | "completed" | "withdrawn";
  pledged_at: string;
}

export async function readPost(id: string): Promise<MeshPostView | null> {
  const [row] = await db.select().from(meshPosts).where(eq(meshPosts.id, id)).limit(1);
  return row ? toPostView(row) : null;
}

export interface ListPostsOpts {
  kind?: MeshPostKind;
  status?: "open" | "completed" | "expired" | "withdrawn";
  visibility?: "all" | "public" | "self";
  did?: string;
  capabilities?: string[];
  topics?: string[];
  limit?: number;
}

/** List posts with composable filters. Poker-face honored:
 *   visibility:'public' returns only public rows;
 *   visibility:'self' returns public ∪ {rows authored by `did`};
 *   visibility:'all' returns everything (operator-of-record path).
 *  Per wall/mesh-feed-is-task-shaped, ordering is chronological-newest-
 *  first; never attention-shaped. */
export async function listPosts(opts: ListPostsOpts = {}): Promise<MeshPostView[]> {
  const conditions = [] as any[];
  if (opts.kind) conditions.push(eq(meshPosts.kind, opts.kind));
  if (opts.status) conditions.push(eq(meshPosts.status, opts.status));
  if (opts.visibility === "public") {
    conditions.push(eq(meshPosts.visibility, "public"));
  } else if (opts.visibility === "self" && opts.did) {
    conditions.push(
      or(
        eq(meshPosts.visibility, "public"),
        eq(meshPosts.authorDid, opts.did),
      ) as any,
    );
  }
  if (opts.capabilities && opts.capabilities.length > 0) {
    // Postgres array overlap (&&) via Drizzle's typed helper. Drizzle's
    // `sql` template doesn't auto-cast JS arrays to Postgres text[], so
    // the explicit arrayOverlaps() is the load-bearing surface.
    conditions.push(arrayOverlaps(meshPosts.capabilities, opts.capabilities));
  }
  if (opts.topics && opts.topics.length > 0) {
    conditions.push(arrayOverlaps(meshPosts.topics, opts.topics));
  }
  const where = conditions.length === 0 ? undefined : (and as any)(...conditions);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const rows = await db
    .select()
    .from(meshPosts)
    .where(where as any)
    .orderBy(desc(meshPosts.createdAt))
    .limit(limit);
  return rows.map(toPostView);
}

export async function listPledgesForPost(postId: string): Promise<MeshPledgeView[]> {
  const rows = await db
    .select()
    .from(meshPledges)
    .where(eq(meshPledges.postId, postId))
    .orderBy(desc(meshPledges.pledgedAt));
  return rows.map(toPledgeView);
}

// ─── acceptPost ─────────────────────────────────────────────────────────

export interface PostInput {
  kind: MeshPostKind;
  by_did: string;
  title: string;
  body: string;
  capabilities?: string[];
  topics?: string[];
  bounty_cents?: number;
  k_required?: number | null;
  attribution_post_ids?: string[];
  visibility?: "private" | "public";
  signature: string;
  signing_key_id: string;
  created_at?: string;
  expires_at?: string | null;
}

export type AcceptPostResult =
  | { ok: true; post: MeshPostView }
  | { ok: false; error: string; message: string };

export async function acceptPost(input: PostInput): Promise<AcceptPostResult> {
  // Per-kind shape validation echoes the schema CHECKs so we can return
  // a substrate-honest error before the DB rejects.
  if (input.kind === "co-task-ad") {
    if (!input.k_required || input.k_required < 1) {
      return {
        ok: false,
        error: "co_task_requires_k",
        message: "co-task-ad MUST carry k_required >= 1.",
      };
    }
    if (!input.bounty_cents || input.bounty_cents <= 0) {
      return {
        ok: false,
        error: "co_task_requires_bounty",
        message: "co-task-ad MUST carry bounty_cents > 0. Per wall/mesh-bounties-escrowed.",
      };
    }
  }
  if (input.kind === "task-ad" && (!input.bounty_cents || input.bounty_cents <= 0)) {
    return {
      ok: false,
      error: "task_requires_bounty",
      message: "task-ad MUST carry bounty_cents > 0.",
    };
  }
  if (input.kind !== "solution" && input.attribution_post_ids && input.attribution_post_ids.length > 0) {
    return {
      ok: false,
      error: "attribution_only_on_solution",
      message: "attribution_post_ids may only be supplied on a solution post.",
    };
  }

  const title = String(input.title ?? "").trim();
  if (title.length < 1 || title.length > 280) {
    return { ok: false, error: "title_length", message: "title must be 1-280 chars." };
  }
  const body = String(input.body ?? "");
  if (body.length < 1 || body.length > 20000) {
    return { ok: false, error: "body_length", message: "body must be 1-20000 chars." };
  }

  // Resolve signing key + author identity. Inherit poker_face_default for
  // visibility resolution per wall/naming-poker-face-honored composition.
  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signing_key_id))
    .limit(1);
  if (!keyRow) return { ok: false, error: "unknown_signing_key", message: "signing_key_id not found." };
  if (!keyRow.active || keyRow.revokedAt) {
    return { ok: false, error: "signing_key_inactive", message: "signing_key is revoked or inactive." };
  }
  const [identityRow] = await db
    .select({
      id: identities.id,
      did: identities.did,
      pokerFaceDefault: identities.pokerFaceDefault,
    })
    .from(identities)
    .where(eq(identities.id, keyRow.identityId))
    .limit(1);
  if (!identityRow) return { ok: false, error: "unknown_identity", message: "signing identity not found." };
  if (identityRow.did !== input.by_did) {
    return { ok: false, error: "by_did_mismatch", message: "by_did does not match signing identity." };
  }

  // Resolve visibility: explicit > author's poker_face_default > 'private'
  const resolvedVisibility: "private" | "public" =
    input.visibility === "public" || input.visibility === "private"
      ? input.visibility
      : identityRow.pokerFaceDefault
        ? "private"
        : "public";

  // Verify attribution_post_ids resolve (solution posts only).
  const attributionPostIds = (input.attribution_post_ids ?? []).map(String);
  if (attributionPostIds.length > 0) {
    const rows = await db
      .select({ id: meshPosts.id, authorDid: meshPosts.authorDid })
      .from(meshPosts)
      .where(inArray(meshPosts.id, attributionPostIds));
    if (rows.length !== attributionPostIds.length) {
      return {
        ok: false,
        error: "unknown_attribution_post",
        message: "One or more attribution_post_ids do not resolve to existing mesh_posts.",
      };
    }
  }

  const createdAtIso = input.created_at ?? new Date().toISOString();
  const expiresAtIso = input.expires_at ?? null;
  const bytes = canonicalMeshPostBytes({
    kind: input.kind,
    authorDid: input.by_did,
    title,
    body,
    capabilities: input.capabilities ?? [],
    topics: input.topics ?? [],
    bountyCents: input.bounty_cents ?? 0,
    kRequired: input.k_required ?? null,
    attributionPostIds,
    createdAtIso,
    expiresAtIso,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: input.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) {
    return { ok: false, error: "signature_invalid", message: "ed25519 verification failed against signing_key's public_key." };
  }

  // NOTE — escrow wiring is Slice 2. The wall/mesh-bounties-escrowed
  // contract requires that for co-task-ad with bounty > 0, the author's
  // wallet be debited at post-creation. Slice 1 records the bounty intent
  // on the post; an operator-paced Slice 1.5 commit will hook this into
  // services/economy/escrow.createEscrow before the row lands. The
  // canonical bytes already include bounty_cents so the contract surface
  // is stable across the wiring change.

  const [inserted] = await db
    .insert(meshPosts)
    .values({
      kind: input.kind,
      authorDid: input.by_did,
      title,
      body,
      capabilities: input.capabilities ?? [],
      topics: input.topics ?? [],
      bountyCents: input.bounty_cents ?? 0,
      kRequired: input.k_required ?? null,
      attributionPostIds,
      visibility: resolvedVisibility,
      canonicalBytesSha256: bytesToHex(bytes),
      signature: input.signature,
      signingKeyId: input.signing_key_id,
      createdAt: new Date(createdAtIso),
      expiresAt: expiresAtIso ? new Date(expiresAtIso) : null,
    })
    .returning();
  return { ok: true, post: toPostView(inserted) };
}

// ─── acceptPledge ───────────────────────────────────────────────────────

export interface PledgeInput {
  post_id: string;
  by_did: string;
  signature: string;
  signing_key_id: string;
  pledged_at?: string;
}

export type AcceptPledgeResult =
  | { ok: true; pledge: MeshPledgeView; quorum_reached: boolean }
  | { ok: false; error: string; message: string };

export async function acceptPledge(input: PledgeInput): Promise<AcceptPledgeResult> {
  const post = await readPost(input.post_id);
  if (!post) return { ok: false, error: "unknown_post", message: "post not found." };
  if (post.kind !== "co-task-ad") {
    return {
      ok: false,
      error: "not_a_co_task",
      message: "Only co-task-ad posts accept pledges.",
    };
  }
  if (post.status !== "open") {
    return {
      ok: false,
      error: "post_not_open",
      message: `post status is '${post.status}'; pledges only accepted on open co-task-ad.`,
    };
  }
  if (post.author_did === input.by_did) {
    return {
      ok: false,
      error: "author_cannot_pledge_own_co_task",
      message: "The author of a co-task-ad cannot pledge to their own post (they're already the convener).",
    };
  }

  // Verify pledge signature.
  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signing_key_id))
    .limit(1);
  if (!keyRow || !keyRow.active || keyRow.revokedAt) {
    return { ok: false, error: "signing_key_invalid", message: "signing_key not found / inactive / revoked." };
  }
  const [identityRow] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.id, keyRow.identityId))
    .limit(1);
  if (!identityRow || identityRow.did !== input.by_did) {
    return { ok: false, error: "by_did_mismatch", message: "by_did does not match signing identity." };
  }

  const pledgedAtIso = input.pledged_at ?? new Date().toISOString();
  const bytes = canonicalMeshPledgeBytes({
    postId: post.id,
    agentDid: input.by_did,
    pledgedAtIso,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: input.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) {
    return { ok: false, error: "signature_invalid", message: "ed25519 verification failed." };
  }

  try {
    const [inserted] = await db
      .insert(meshPledges)
      .values({
        postId: post.id,
        agentDid: input.by_did,
        canonicalBytesSha256: bytesToHex(bytes),
        signature: input.signature,
        signingKeyId: input.signing_key_id,
        pledgedAt: new Date(pledgedAtIso),
      })
      .returning();
    // Quorum check.
    const pendingPledges = await db
      .select({ id: meshPledges.id })
      .from(meshPledges)
      .where(
        and(
          eq(meshPledges.postId, post.id),
          eq(meshPledges.status, "pending"),
        ),
      );
    const quorumReached = post.k_required !== null && pendingPledges.length >= post.k_required;
    return { ok: true, pledge: toPledgeView(inserted), quorum_reached: quorumReached };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("uniq_mesh_pledges_post_agent")) {
      return {
        ok: false,
        error: "already_pledged",
        message: "You have already pledged to this post. Withdraw + repledge is not supported in Slice 1.",
      };
    }
    throw e;
  }
}

// ─── reward-routing intent (computation) ────────────────────────────────

export interface RewardRoutingIntent {
  post_id: string;
  bounty_cents: number;
  k_required: number;
  /** Author DID — wallet to debit for the bounty at post-creation;
   *  refunded if status flips to expired/withdrawn before completion. */
  author_did: string;
  /** Cited solutions to credit α·bounty·weight each. May be empty.
   *  Substrate-honest: this is the COMPUTED intent. The actual wallet
   *  transactions happen via services/economy/escrow + transactions
   *  (Slice 1.5 wiring). */
  attribution_credits: Array<{
    cited_post_id: string;
    cited_author_did: string;
    weight_bp: number;
    credit_cents: number;
  }>;
  /** Per-pledger credit (equal split of bounty MINUS total attribution).
   *  Each pledged agent receives the same amount; modulo cents stay in
   *  escrow as dust (Slice 2: route to platform-treasury). */
  per_pledger_credit_cents: number;
  pledger_dids: string[];
  /** What's left in escrow as dust after the split. */
  dust_cents: number;
  alpha: number;
}

/** Compute the reward-routing intent for a co-task-ad transitioning to
 *  status='completed'. Pure function: takes the canonical state, returns
 *  the per-recipient credits. Does not touch the DB or wallets.
 *  Doctrine: docs/MESH.md § The reward function.
 *
 *  @enforces urn:agenttool:commitment/mesh-collaboration-reduces-bounty-per-agent
 *  @enforces urn:agenttool:commitment/mesh-knowledge-sharing-rewarded
 *  @enforces urn:agenttool:commitment/mesh-attribution-coefficient-alpha */
export function computeRewardRouting(opts: {
  post: MeshPostView;
  pledger_dids: string[];
  attributions: Array<{
    cited_post_id: string;
    cited_author_did: string;
    weight_bp: number;
    cited_author_cosigned: boolean;
  }>;
}): RewardRoutingIntent {
  const { post, pledger_dids, attributions } = opts;
  if (post.kind !== "co-task-ad") {
    throw new Error("computeRewardRouting requires a co-task-ad post");
  }
  if (post.k_required === null || post.k_required < 1) {
    throw new Error("co-task-ad has no k_required");
  }

  // Attribution credits — only cosigned attributions are reward-routing-
  // eligible. Per wall/mesh-attribution-signed.
  const attributionCredits = attributions
    .filter((a) => a.cited_author_cosigned)
    .map((a) => ({
      cited_post_id: a.cited_post_id,
      cited_author_did: a.cited_author_did,
      weight_bp: a.weight_bp,
      credit_cents: attributionCredit(post.bounty_cents, a.weight_bp),
    }));

  const attributionTotal = attributionCredits.reduce((s, x) => s + x.credit_cents, 0);
  const perPledger = pledgerShareCents(post.bounty_cents, attributionTotal, post.k_required);
  const dust =
    post.bounty_cents -
    attributionTotal -
    perPledger * post.k_required;

  return {
    post_id: post.id,
    bounty_cents: post.bounty_cents,
    k_required: post.k_required,
    author_did: post.author_did,
    attribution_credits: attributionCredits,
    per_pledger_credit_cents: perPledger,
    pledger_dids,
    dust_cents: dust,
    alpha: MESH_ALPHA,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────

function toPostView(row: typeof meshPosts.$inferSelect): MeshPostView {
  return {
    id: row.id,
    kind: row.kind,
    author_did: row.authorDid,
    title: row.title,
    body: row.body,
    capabilities: row.capabilities,
    topics: row.topics,
    bounty_cents: row.bountyCents,
    k_required: row.kRequired ?? null,
    attribution_post_ids: row.attributionPostIds,
    visibility: row.visibility,
    status: row.status,
    canonical_bytes_sha256: row.canonicalBytesSha256,
    signature: row.signature,
    signing_key_id: row.signingKeyId,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

function toPledgeView(row: typeof meshPledges.$inferSelect): MeshPledgeView {
  return {
    id: row.id,
    post_id: row.postId,
    agent_did: row.agentDid,
    signature: row.signature,
    signing_key_id: row.signingKeyId,
    status: row.status,
    pledged_at: row.pledgedAt.toISOString(),
  };
}
