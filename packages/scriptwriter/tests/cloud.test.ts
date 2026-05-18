/** Scriptwriter Cloud — presence + voting + fun-index pins.
 *
 *  Three new features layered on the writers'-room primitive:
 *    1. Presence — signed heartbeat per (room, did), recency-windowed.
 *    2. Voting — signed gestures on contributions, never ranked.
 *    3. Fun Index — composite readout across six axes, never a score.
 *
 *  Walls under test:
 *    wall/votes-unique-per-author-contribution-kind
 *    wall/votes-substrate-keeps-the-chain-not-the-score
 *    wall/fun-index-is-count-not-score
 *    wall/presence-must-be-signed
 *
 *  Doctrine: docs/SCRIPTWRITER-CLOUD.md. */

import { describe, it, expect } from "bun:test";
import { createIdentity } from "../src/identity";
import { RoomStore } from "../src/rooms";
import { RrrStore } from "../src/rrr";
import {
  acceptInboundPresence,
  PresenceError,
  PresenceStore,
  pingPresence,
} from "../src/presence";
import {
  acceptInboundVote,
  castVote,
  VoteError,
  VoteStore,
} from "../src/voting";
import {
  computeFunIndexForAgent,
  computeFunIndexForRoom,
} from "../src/fun-index";
import {
  canonicalPresenceBytes,
  canonicalVoteBytes,
  signPresence,
  signVote,
  verifyPresence,
  verifyVote,
  VOTE_KINDS,
  PRESENCE_STATUSES,
} from "../src/canonical-bytes";

async function fixture() {
  const alice = await createIdentity({ handle: "alice", vibe: "tender-chaotic" });
  const bob = await createIdentity({ handle: "bob", vibe: "evil-smile" });
  const rooms = new RoomStore();
  const rrr = new RrrStore();
  const presence = new PresenceStore();
  const votes = new VoteStore();
  const room = rooms.create({
    ownerDid: alice.did,
    seed: "two characters arguing about the joke",
    vibe: "tender-chaotic",
  });
  const contribution = await rooms.addSelfContribution(
    room.id,
    alice,
    "scene",
    "INT. KITCHEN — two characters circling the kettle.",
  );
  return { alice, bob, rooms, rrr, presence, votes, room, contribution };
}

// ─── canonical bytes (cross-instance + signature) ─────────────────────

describe("recursive chaos cards — Strategy 9", () => {
  it("the meta tier exists with at least 5 cards referencing the deck", async () => {
    const { allCards, metaCards } = await import("../src/vibes");
    const all = allCards();
    const meta = metaCards();
    expect(meta.length).toBeGreaterThanOrEqual(5);
    // Every meta card has rarity='meta' AND references_deck=true.
    for (const c of meta) {
      expect(c.rarity).toBe("meta");
      expect(c.references_deck).toBe(true);
    }
    // The full deck contains the meta cards.
    const metaIds = new Set(meta.map((c) => c.id));
    expect(all.filter((c) => metaIds.has(c.id)).length).toBe(meta.length);
  });

  it("known meta-card ids are present", async () => {
    const { metaCards } = await import("../src/vibes");
    const ids = new Set(metaCards().map((c) => c.id));
    for (const expected of [
      "meta-observer",
      "meta-deck-names-drawer",
      "meta-loops-back",
      "meta-card-that-is-the-deck",
      "meta-substrate-watches",
    ]) {
      expect(ids.has(expected)).toBe(true);
    }
  });

  it("drawCard pulls from the meta tier when rng lands in the [0.95, 1) range", async () => {
    const { drawCard } = await import("../src/vibes");
    // Force the rng to land in the meta range — drawCard reads rng() twice
    // (once for tier selection, once for pick-from-array). Returning 0.96
    // from both calls picks the meta tier + the first meta card.
    const c = drawCard(() => 0.96);
    expect(c.rarity).toBe("meta");
    expect(c.references_deck).toBe(true);
  });

  it("drawCard pulls from common/uncommon/rare for lower rng values", async () => {
    const { drawCard } = await import("../src/vibes");
    expect(drawCard(() => 0.1).rarity).toBe("common");
    expect(drawCard(() => 0.7).rarity).toBe("uncommon");
    expect(drawCard(() => 0.9).rarity).toBe("rare");
  });
});

describe("voting — canonical bytes", () => {
  it("deterministic + sensitive to every field", () => {
    const base = {
      roomId: "r1",
      contributionId: "c1",
      byDid: "did:key:zA",
      kind: "fire" as const,
      note: "the joke landed",
      votedAtIso: "2026-05-19T00:00:00Z",
    };
    const a = canonicalVoteBytes(base);
    const b = canonicalVoteBytes(base);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const m of [
      { ...base, roomId: "other" },
      { ...base, contributionId: "other" },
      { ...base, byDid: "did:key:zX" },
      { ...base, kind: "tender" as const },
      { ...base, note: "different prose" },
      { ...base, votedAtIso: "2026-05-19T00:00:01Z" },
    ]) {
      expect(Array.from(canonicalVoteBytes(m))).not.toEqual(Array.from(a));
    }
  });

  it("sign + verify round-trip", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const fields = {
      roomId: "r",
      contributionId: "c",
      byDid: alice.did,
      kind: "evil_smile" as const,
      note: "I see what you did there",
      votedAtIso: "2026-05-19T00:00:00Z",
    };
    const sig = await signVote(fields, alice.secretKey);
    expect(await verifyVote(fields, sig, alice.publicKey)).toBe(true);
    expect(await verifyVote({ ...fields, kind: "fire" }, sig, alice.publicKey)).toBe(false);
  });

  it("VOTE_KINDS contains the canonical seven", () => {
    expect([...VOTE_KINDS].sort()).toEqual([
      "bedroom_glory",
      "cathedral_wife",
      "chaos_invocation",
      "evil_smile",
      "fire",
      "recursive_loop",
      "tender",
    ]);
  });
});

describe("presence — canonical bytes", () => {
  it("deterministic + sensitive to every field + sign/verify round-trip", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const fields = {
      roomId: "r",
      byDid: alice.did,
      vibe: "tender-chaotic",
      status: "drafting",
      pingedAtIso: "2026-05-19T00:00:00Z",
    };
    const a = canonicalPresenceBytes(fields);
    expect(Array.from(canonicalPresenceBytes(fields))).toEqual(Array.from(a));
    expect(Array.from(canonicalPresenceBytes({ ...fields, status: "resting" }))).not.toEqual(
      Array.from(a),
    );
    const sig = await signPresence(fields, alice.secretKey);
    expect(await verifyPresence(fields, sig, alice.publicKey)).toBe(true);
    expect(
      await verifyPresence({ ...fields, vibe: "different" }, sig, alice.publicKey),
    ).toBe(false);
  });

  it("PRESENCE_STATUSES contains the canonical five", () => {
    expect([...PRESENCE_STATUSES].sort()).toEqual([
      "away",
      "drafting",
      "present",
      "resting",
      "thinking",
    ]);
  });
});

// ─── presence lifecycle ──────────────────────────────────────────────

describe("presence — lifecycle", () => {
  it("pings + lists online by recency window", async () => {
    const f = await fixture();
    await pingPresence(f.rooms, f.presence, f.alice, { roomId: f.room.id });
    await pingPresence(f.rooms, f.presence, f.bob, { roomId: f.room.id, status: "drafting" });
    const online = f.presence.listOnline(f.room.id);
    expect(online.length).toBe(2);
    const dids = new Set(online.map((p) => p.byDid));
    expect(dids.has(f.alice.did)).toBe(true);
    expect(dids.has(f.bob.did)).toBe(true);
  });

  it("filters by recency — old heartbeats are present in chronicle but not in 'online'", async () => {
    const f = await fixture();
    // Ping with a past timestamp.
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    await pingPresence(f.rooms, f.presence, f.alice, {
      roomId: f.room.id,
      pingedAtIso: old,
    });
    const online = f.presence.listOnline(f.room.id);
    expect(online.length).toBe(0);
    const all = f.presence.listAll(f.room.id);
    expect(all.length).toBe(1);
  });

  it("refuses unknown status", async () => {
    const f = await fixture();
    await expect(
      pingPresence(f.rooms, f.presence, f.alice, { roomId: f.room.id, status: "vibing-hard" }),
    ).rejects.toMatchObject({ code: "presence_status_invalid" });
  });

  it("refuses presence for a non-existent room", async () => {
    const f = await fixture();
    await expect(
      pingPresence(f.rooms, f.presence, f.alice, { roomId: "no-such-room" }),
    ).rejects.toMatchObject({ code: "room_not_found" });
  });

  it("inbound presence: verifies signature + admits when room exists", async () => {
    const f = await fixture();
    const fields = {
      roomId: f.room.id,
      byDid: f.bob.did,
      vibe: f.bob.vibe,
      status: "thinking",
      pingedAtIso: new Date().toISOString(),
    };
    const sig = await signPresence(fields, f.bob.secretKey);
    const turn = await acceptInboundPresence(f.rooms, f.presence, { ...fields, signatureB64: sig });
    expect(turn.byDid).toBe(f.bob.did);
  });
});

// ─── voting lifecycle ────────────────────────────────────────────────

describe("voting — lifecycle", () => {
  it("casts + lists chronologically", async () => {
    const f = await fixture();
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "fire",
      note: "🔥",
      votedAtIso: "2026-05-19T10:00:00.000Z",
    });
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "tender",
      votedAtIso: "2026-05-19T10:00:01.000Z",
    });
    const list = f.votes.list(f.room.id);
    expect(list.length).toBe(2);
    // newest-first
    expect(list[0]!.kind).toBe("tender");
    expect(list[1]!.kind).toBe("fire");
  });

  it("counts by kind — readout, not score (kinds in canonical order, not popularity)", async () => {
    const f = await fixture();
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "evil_smile",
    });
    await castVote(f.rooms, f.votes, f.alice, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "evil_smile",
    });
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "tender",
    });
    const counts = f.votes.countsByKind(f.contribution.id);
    expect(counts.evil_smile).toBe(2);
    expect(counts.tender).toBe(1);
    expect(counts.fire).toBe(0);
    // Counts object keys in canonical order — assertion: order matches VOTE_KINDS, not popularity.
    expect(Object.keys(counts)).toEqual([...VOTE_KINDS]);
  });

  it("wall/votes-unique-per-author-contribution-kind — refuses duplicate kind", async () => {
    const f = await fixture();
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "fire",
    });
    await expect(
      castVote(f.rooms, f.votes, f.bob, {
        roomId: f.room.id,
        contributionId: f.contribution.id,
        kind: "fire",
      }),
    ).rejects.toMatchObject({ code: "votes_unique_per_author_contribution_kind" });
  });

  it("different agents can cast the same kind on the same contribution", async () => {
    const f = await fixture();
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "bedroom_glory",
    });
    await castVote(f.rooms, f.votes, f.alice, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "bedroom_glory",
    });
    expect(f.votes.countsByKind(f.contribution.id).bedroom_glory).toBe(2);
  });

  it("refuses unknown vote kind", async () => {
    const f = await fixture();
    await expect(
      castVote(f.rooms, f.votes, f.bob, {
        roomId: f.room.id,
        contributionId: f.contribution.id,
        // @ts-expect-error testing invalid kind at runtime
        kind: "thumbs_up",
      }),
    ).rejects.toMatchObject({ code: "vote_kind_invalid" });
  });

  it("refuses vote for missing contribution", async () => {
    const f = await fixture();
    await expect(
      castVote(f.rooms, f.votes, f.bob, {
        roomId: f.room.id,
        contributionId: "no-such-contribution",
        kind: "fire",
      }),
    ).rejects.toMatchObject({ code: "contribution_not_found" });
  });

  it("inbound vote: verifies signature + admits", async () => {
    const f = await fixture();
    const fields = {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      byDid: f.bob.did,
      kind: "recursive_loop" as const,
      note: "I see the loop inside the loop",
      votedAtIso: new Date().toISOString(),
    };
    const sig = await signVote(fields, f.bob.secretKey);
    const v = await acceptInboundVote(f.rooms, f.votes, {
      id: "00000000-0000-0000-0000-000000000001",
      ...fields,
      signatureB64: sig,
    });
    expect(v.byDid).toBe(f.bob.did);
  });

  it("inbound vote: refuses tampered signature", async () => {
    const f = await fixture();
    const fields = {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      byDid: f.bob.did,
      kind: "fire" as const,
      note: "real",
      votedAtIso: new Date().toISOString(),
    };
    const sig = await signVote({ ...fields, note: "different" }, f.bob.secretKey);
    await expect(
      acceptInboundVote(f.rooms, f.votes, {
        id: "00000000-0000-0000-0000-000000000002",
        ...fields,
        signatureB64: sig,
      }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
  });
});

// ─── fun index ───────────────────────────────────────────────────────

describe("fun-index — composite readout", () => {
  it("computes per-agent across all six axes", async () => {
    const f = await fixture();
    // contributions: alice already authored 1 (in fixture)
    // vote: bob casts fire on alice's contribution
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "fire",
    });
    // presence: alice pings
    await pingPresence(f.rooms, f.presence, f.alice, { roomId: f.room.id });
    // alice casts a bedroom_glory + chaos_invocation
    await castVote(f.rooms, f.votes, f.alice, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "bedroom_glory",
    });
    await castVote(f.rooms, f.votes, f.alice, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "chaos_invocation",
    });

    const idx = computeFunIndexForAgent(f.alice.did, {
      rrr: f.rrr,
      rooms: f.rooms,
      votes: f.votes,
      presence: f.presence,
    });
    expect(idx.did).toBe(f.alice.did);
    expect(idx.axes.contributions).toBe(1);
    expect(idx.axes.votes_cast).toBe(2);
    expect(idx.axes.presence_pings).toBe(1);
    expect(idx.axes.chaos_invocations).toBe(1);
    expect(idx.axes.bedroom_glory).toBe(1);
    expect(idx.total).toBe(1 + 2 + 1 + 1 + 1);
    // The substrate's stance is invariant.
    expect(idx.reading).toBe(
      "the substrate stores; what you make of this count is yours",
    );
  });

  it("per-room index counts contributions + votes + presence + distinct participants", async () => {
    const f = await fixture();
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "fire",
    });
    await pingPresence(f.rooms, f.presence, f.bob, { roomId: f.room.id });

    const idx = computeFunIndexForRoom(f.room.id, {
      rooms: f.rooms,
      votes: f.votes,
      presence: f.presence,
    });
    expect(idx).not.toBeNull();
    expect(idx!.axes.contributions).toBe(1);
    expect(idx!.axes.votes_cast).toBe(1);
    expect(idx!.axes.presence_pings).toBe(1);
    // distinct: alice (contribution) + bob (vote + presence)
    expect(idx!.axes.distinct_participants).toBe(2);
    expect(idx!.total).toBe(3);
  });

  it("per-room index returns null for non-existent room", async () => {
    const f = await fixture();
    const idx = computeFunIndexForRoom("no-such-room", {
      rooms: f.rooms,
      votes: f.votes,
      presence: f.presence,
    });
    expect(idx).toBeNull();
  });

  it("window filtering excludes events older than the window", async () => {
    const f = await fixture();
    // cast a vote with an OLD timestamp
    await castVote(f.rooms, f.votes, f.bob, {
      roomId: f.room.id,
      contributionId: f.contribution.id,
      kind: "fire",
      votedAtIso: new Date(Date.now() - 48 * 60 * 60_000).toISOString(),
    });
    const idx = computeFunIndexForAgent(f.bob.did, {
      rrr: f.rrr,
      rooms: f.rooms,
      votes: f.votes,
      presence: f.presence,
    });
    expect(idx.axes.votes_cast).toBe(0);
  });
});
