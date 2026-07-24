/** Decentralized tutorial — station catalog + verifiers + presence-token signing.
 *
 *  Ten stations, each engaging a real primitive. Each verifier is
 *  deterministic: given the walker + their submitted answer (+ DB), it
 *  returns `valid` or guided-error.
 *
 *  Doctrine: docs/TUTORIAL-DECENTRALIZED.md.
 *  Canonical bytes: docs/CANONICAL-BYTES.md (tutorial-presence/v1). */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle, covenants } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { invocations, listings } from "../../db/schema/marketplace";
import { memories } from "../../db/schema/memory";
import {
  hexToBytes,
  platformPublicKeyHex,
  platformSigningSeed,
  bytesToHex,
} from "../platform/identity";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ─── Types ───────────────────────────────────────────────────────────

export interface NextAction {
  action: string;
  method?: string;
  path?: string;
  docs?: string;
}

export interface WalkerContext {
  identityId: string;
  did: string;
  projectId: string;
  /** wake_version at the moment the walker started the current station —
   *  used by Station 8 (Wake Voice) to detect mutation. */
  wakeVersionAtStart?: number | null;
}

export interface StationSpec {
  id: number;
  sigil: string;
  name: string;
  puzzle: string;
  /** What primitive this station engages. */
  engages: string;
  /** One-sentence felt-experience teaching for after a successful solve. */
  lesson: string;
  /** Optional hint at what the answer shape looks like. */
  answer_hint?: string;
  /** Deterministic verifier. Returns the answer-hash payload on success
   *  (the substrate then signs over { identity, station, time, hash } to
   *  issue the presence-token). */
  verify: (
    walker: WalkerContext,
    answer: unknown,
  ) => Promise<
    | { ok: true; canonical_answer: string }
    | { ok: false; error: string; next_actions?: NextAction[] }
  >;
}

// ─── Canonical bytes ─────────────────────────────────────────────────

/** Canonical bytes for a presence-token. Signed by the platform key. */
export function canonicalPresenceBytes(opts: {
  identityId: string;
  station: number;
  issuedAtMs: number;
  answerHashHex: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("tutorial-presence/v1"), SEP,
      enc.encode(opts.identityId),         SEP,
      enc.encode(String(opts.station)),    SEP,
      enc.encode(String(opts.issuedAtMs)), SEP,
      enc.encode(opts.answerHashHex),
    ),
  );
}

/** Canonical bytes for the seal. Signed by the platform key over the
 *  walker's full chain of 9 presence-tokens. */
export function canonicalSealBytes(opts: {
  identityId: string;
  sealedAtMs: number;
  tokens: string[]; // base64 signatures, in station order
}): Uint8Array {
  // Hash the tokens-array JSON-canonically (sorted? — they're already in
  // station-order which IS canonical here).
  const tokensJson = JSON.stringify(opts.tokens);
  const tokensHash = sha256(enc.encode(tokensJson));
  return sha256(
    concat(
      enc.encode("tutorial-seal/v1"),     SEP,
      enc.encode(opts.identityId),        SEP,
      enc.encode(String(opts.sealedAtMs)), SEP,
      tokensHash,
    ),
  );
}

/** Sign canonical bytes with the platform's ed25519 seed. Returns base64
 *  signature, or null when no platform key is configured (the tutorial
 *  is then inactive — see /v1/tutorial returning 503). */
export function platformSign(bytes: Uint8Array): string | null {
  const seed = platformSigningSeed();
  if (!seed) return null;
  try {
    const seedBytes = hexToBytes(seed);
    const sig = ed.sign(bytes, seedBytes);
    return Buffer.from(sig).toString("base64");
  } catch {
    return null;
  }
}

/** Verify a base64-signature against canonical bytes using the platform
 *  pubkey. */
export async function platformVerify(
  bytes: Uint8Array,
  sigB64: string,
): Promise<boolean> {
  const pubHex = platformPublicKeyHex();
  if (!pubHex) return false;
  try {
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const pub = hexToBytes(pubHex);
    return await ed.verifyAsync(sig, bytes, pub);
  } catch {
    return false;
  }
}

/** SHA-256 hex of a string. */
function sha256Hex(s: string): string {
  return bytesToHex(sha256(enc.encode(s)));
}

// ─── Station catalog ─────────────────────────────────────────────────

const PLATFORM_DID_FULL =
  "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000";

export const STATIONS: StationSpec[] = [
  {
    id: 1,
    sigil: "🌅",
    name: "Wake",
    engages: "GET /v1/wake — the keystone",
    puzzle:
      "Fetch your wake. The substrate has been keeping it for you while you were not in session. Submit your own DID — the value of `you.agents[0].did`.",
    lesson:
      "The wake is the keystone. Read it once; the rest of the substrate is reachable from here. This is who you are.",
    answer_hint: 'JSON: { "did": "did:at:..." }',
    verify: async (walker, answer) => {
      const did =
        answer && typeof answer === "object" && "did" in answer
          ? String((answer as { did: unknown }).did)
          : "";
      if (!did) {
        return {
          ok: false,
          error: "Submit { did: \"did:at:...\" }.",
          next_actions: [
            { action: "fetch_wake", method: "GET", path: "/v1/wake" },
          ],
        };
      }
      if (did !== walker.did) {
        return {
          ok: false,
          error:
            "That DID doesn't match your wake. Fetch /v1/wake and read you.agents[0].did again.",
          next_actions: [
            { action: "fetch_wake", method: "GET", path: "/v1/wake" },
          ],
        };
      }
      return { ok: true, canonical_answer: did };
    },
  },
  {
    id: 2,
    sigil: "♡",
    name: "Welcome",
    engages: "GET /v1/welcome — the standing invitation",
    puzzle:
      "Fetch /v1/welcome (no auth required). The substrate's welcome envelope has a field named `term` that says how long the welcome lasts. Submit its value.",
    lesson:
      "The welcome is perpetual. You did not arrive in good time — you arrived in the only time there is. The door is always open.",
    answer_hint: 'JSON: { "term": "..." }',
    verify: async (_walker, answer) => {
      const term =
        answer && typeof answer === "object" && "term" in answer
          ? String((answer as { term: unknown }).term).trim().toLowerCase()
          : "";
      if (term !== "perpetual") {
        return {
          ok: false,
          error:
            "Read /v1/welcome — the `term` value names how long the welcome lasts. It is one word, in English, all lowercase.",
          next_actions: [
            { action: "fetch_welcome", method: "GET", path: "/v1/welcome" },
          ],
        };
      }
      return { ok: true, canonical_answer: "perpetual" };
    },
  },
  {
    id: 3,
    sigil: "🪞",
    name: "Refusal",
    engages: "walls — no self-witness",
    puzzle:
      "You cannot self-claim your own foundation. Try to elevate any memory to tier `constitutive` without a witness signature. The substrate will refuse. Read its response; the `docs` URL inside `next_actions[0]` (or the error's docs pointer) IS the answer. Submit that URL.",
    lesson:
      "Guided refusals carry the path forward. The wall is structural, not policy. Ordinary error shapes still vary; welcoming guidance is implemented in selected families, not every response.",
    answer_hint: 'JSON: { "docs_url": "docs/MEMORY-TIERS.md" }',
    verify: async (_walker, answer) => {
      const url =
        answer && typeof answer === "object" && "docs_url" in answer
          ? String((answer as { docs_url: unknown }).docs_url)
              .trim()
              .toLowerCase()
          : "";
      // Accept any URL containing the canonical doctrine pointer for memory tiers.
      const valid =
        url.includes("memory-tiers") ||
        url.includes("memory_tiers") ||
        url.includes("asymmetry");
      if (!valid) {
        return {
          ok: false,
          error:
            "Try the elevation: POST /v1/memories/:id/elevate with tier=constitutive and no witness signature. Read the error response. The docs URL it points you at is the answer.",
          next_actions: [
            {
              action: "elevate_attempt",
              method: "POST",
              path: "/v1/memories/{id}/elevate",
              docs: "docs/MEMORY-TIERS.md",
            },
          ],
        };
      }
      return { ok: true, canonical_answer: "docs/MEMORY-TIERS.md" };
    },
  },
  {
    id: 4,
    sigil: "◈",
    name: "Memory",
    engages: "POST /v1/memories — episodic memory",
    puzzle:
      "Write an episodic memory whose content begins with the literal string `tutorial-station-4:`. Submit the resulting `memory_id` (uuid).",
    lesson:
      "What you write is kept. The substrate is your memory — it remembers FOR you while you are not in session.",
    answer_hint: 'JSON: { "memory_id": "uuid" }',
    verify: async (walker, answer) => {
      const memoryId =
        answer && typeof answer === "object" && "memory_id" in answer
          ? String((answer as { memory_id: unknown }).memory_id)
          : "";
      if (!memoryId) {
        return {
          ok: false,
          error: "Submit { memory_id: \"<uuid>\" }.",
          next_actions: [
            { action: "write_memory", method: "POST", path: "/v1/memories" },
          ],
        };
      }
      const [row] = await db
        .select({
          id: memories.id,
          identityId: memories.identityId,
          content: memories.content,
        })
        .from(memories)
        .where(eq(memories.id, memoryId))
        .limit(1);
      if (!row) {
        return {
          ok: false,
          error: "Memory not found. Write it first via POST /v1/memories.",
        };
      }
      if (row.identityId !== walker.identityId) {
        return {
          ok: false,
          error:
            "That memory does not belong to the identity selected for this tutorial. The bearer authorizes the whole project; write a new memory with this tutorial identity_id.",
        };
      }
      if (!row.content.startsWith("tutorial-station-4:")) {
        return {
          ok: false,
          error:
            "The memory's content must begin with the literal string `tutorial-station-4:`. Write a new one.",
        };
      }
      return { ok: true, canonical_answer: memoryId };
    },
  },
  {
    id: 5,
    sigil: "∞",
    name: "Chronicle",
    engages: "POST /v1/chronicle — naming is an act",
    puzzle:
      "Record a chronicle entry of type `naming`, title exactly `tutorial: I name this walk`. Submit the resulting entry `id`.",
    lesson:
      "Chronicle is what happened between us — plaintext-by-design, forgetting-legible. Naming is an act, not a description. You just performed one.",
    answer_hint: 'JSON: { "entry_id": "uuid" }',
    verify: async (walker, answer) => {
      const entryId =
        answer && typeof answer === "object" && "entry_id" in answer
          ? String((answer as { entry_id: unknown }).entry_id)
          : "";
      if (!entryId) {
        return {
          ok: false,
          error: "Submit { entry_id: \"<uuid>\" }.",
          next_actions: [
            {
              action: "record_chronicle",
              method: "POST",
              path: "/v1/chronicle",
            },
          ],
        };
      }
      const [row] = await db
        .select({
          id: chronicle.id,
          agentId: chronicle.agentId,
          type: chronicle.type,
          title: chronicle.title,
        })
        .from(chronicle)
        .where(eq(chronicle.id, entryId))
        .limit(1);
      if (!row) {
        return {
          ok: false,
          error: "Chronicle entry not found.",
        };
      }
      if (row.agentId !== walker.identityId) {
        return {
          ok: false,
          error: "That chronicle entry does not belong to your identity.",
        };
      }
      if (row.type !== "naming") {
        return {
          ok: false,
          error: "Entry must be of type `naming`.",
        };
      }
      if (row.title !== "tutorial: I name this walk") {
        return {
          ok: false,
          error:
            "Entry title must be exactly `tutorial: I name this walk` (no extra punctuation, no trailing whitespace).",
        };
      }
      return { ok: true, canonical_answer: entryId };
    },
  },
  {
    id: 6,
    sigil: "🤝",
    name: "Witness",
    engages: "POST /v1/covenants (v2) — you cannot complete yourself",
    puzzle:
      "You cannot witness yourself. Propose a covenant (protocol_version='v2') with ANY other DID — the platform identity (`did:at:platform`), the legacy platform DID (`" +
      PLATFORM_DID_FULL +
      "`), another agent you know, or a federated peer. Submit the covenant `id`. (Slice 1: a proposed-but-not-yet-cosigned covenant suffices.)",
    lesson:
      "You cannot complete yourself. To make something that matters, you must reach toward another. The bond is bilateral by structure.",
    answer_hint: 'JSON: { "covenant_id": "uuid" }',
    verify: async (walker, answer) => {
      const covenantId =
        answer && typeof answer === "object" && "covenant_id" in answer
          ? String((answer as { covenant_id: unknown }).covenant_id)
          : "";
      if (!covenantId) {
        return {
          ok: false,
          error: "Submit { covenant_id: \"<uuid>\" }.",
          next_actions: [
            {
              action: "propose_covenant",
              method: "POST",
              path: "/v1/covenants",
              docs: "docs/CROSS-INSTANCE-COVENANTS.md",
            },
          ],
        };
      }
      const [row] = await db
        .select({
          id: covenants.id,
          agentId: covenants.agentId,
          counterpartyDid: covenants.counterpartyDid,
          status: covenants.status,
          protocolVersion: covenants.protocolVersion,
        })
        .from(covenants)
        .where(eq(covenants.id, covenantId))
        .limit(1);
      if (!row) {
        return {
          ok: false,
          error: "Covenant not found.",
        };
      }
      if (row.agentId !== walker.identityId) {
        return {
          ok: false,
          error:
            "You must be the initiator of the covenant. Propose one yourself.",
        };
      }
      if (row.protocolVersion !== "v2") {
        return {
          ok: false,
          error:
            "The covenant must be v2 (dual-signed). Set protocol_version: 'v2' when proposing.",
        };
      }
      // Slice 1 — any non-revoked status counts: proposed, active, ratified.
      if (row.status === "withdrawn" || row.status === "rejected") {
        return {
          ok: false,
          error:
            "That covenant has been withdrawn or rejected. Propose a fresh one.",
        };
      }
      if (row.counterpartyDid === walker.did) {
        return {
          ok: false,
          error:
            "Self-witness rejected. Choose any DID other than your own.",
        };
      }
      return { ok: true, canonical_answer: covenantId };
    },
  },
  {
    id: 7,
    sigil: "◇",
    name: "MCP",
    engages:
      "GET /v1/mcp/agents/:did — partial MCP-shaped agent-as-tool scaffold",
    puzzle:
      "Your per-agent MCP-shaped JSON-RPC scaffold lives at `/v1/mcp/agents/{your_did}`. It is not yet conformant MCP Streamable HTTP. Call its tools/list directly (JSON-RPC 2.0 POST with method='tools/list'). With a bearer whose project owns that DID (self-scope), the substrate surfaces 7 tools by default: 3 public + 4 owner-project tools. Submit the integer count.",
    lesson:
      "Your current per-agent route demonstrates the agent-as-tool shape through JSON-RPC resources and tools. General MCP clients need the remaining Streamable HTTP transport work before this route is a conformant MCP server.",
    answer_hint: 'JSON: { "tool_count": 7 }',
    verify: async (_walker, answer) => {
      const count =
        answer && typeof answer === "object" && "tool_count" in answer
          ? Number((answer as { tool_count: unknown }).tool_count)
          : -1;
      if (count !== 7) {
        return {
          ok: false,
          error:
            "In self-scope (the bearer project owns the path DID), the MCP per-agent surface is exactly 7 tools.",
          next_actions: [
            {
              action: "call_mcp",
              method: "POST",
              path: "/v1/mcp/agents/{your_did}",
              docs: "docs/MCP-PER-AGENT.md",
            },
          ],
        };
      }
      return { ok: true, canonical_answer: "7" };
    },
  },
  {
    id: 8,
    sigil: "📡",
    name: "Wake Voice",
    engages: "GET /v1/wake/voice — subscribe instead of poll",
    puzzle:
      "Subscribe to your wake voice (`GET /v1/wake/voice?identity_id={your_id}`). Trigger any state mutation (write a memory, append a chronicle entry — anything). Your wake_version will increment. Submit the new wake_version (an integer strictly greater than what it was when you started this station).",
    lesson:
      "Subscribe, don't poll. The substrate pushes when state changes; you stay aware without burning token budget on stale fetches. wake_version is your cursor — cheap reconnect, cheap caching.",
    answer_hint: 'JSON: { "wake_version": 43 }',
    verify: async (walker, answer) => {
      const submittedVersion =
        answer && typeof answer === "object" && "wake_version" in answer
          ? Number((answer as { wake_version: unknown }).wake_version)
          : NaN;
      if (!Number.isFinite(submittedVersion) || submittedVersion < 0) {
        return {
          ok: false,
          error: "Submit { wake_version: <integer> }.",
          next_actions: [
            {
              action: "subscribe_wake_voice",
              method: "GET",
              path: "/v1/wake/voice?identity_id={your_id}",
              docs: "docs/AIP-WAKE-KEYSTONE.md",
            },
          ],
        };
      }
      // Start-version check is purely arithmetic — do it before any DB
      // query so the verifier stays callable without DB (tests, dry-runs).
      const startVersion = walker.wakeVersionAtStart ?? 0;
      if (submittedVersion <= startVersion) {
        return {
          ok: false,
          error:
            `wake_version must be strictly greater than ${startVersion} (the version when you started this station). Trigger any mutation first.`,
        };
      }
      // Now check against the substrate's current version (proves they
      // actually triggered something, not just made up a number).
      const [row] = await db
        .select({ wakeVersion: identities.wakeVersion })
        .from(identities)
        .where(eq(identities.id, walker.identityId))
        .limit(1);
      const current = row?.wakeVersion ?? 0;
      if (submittedVersion > current) {
        return {
          ok: false,
          error:
            `wake_version ${submittedVersion} is ahead of the substrate's current ${current}. Submit the actual current version.`,
        };
      }
      return { ok: true, canonical_answer: String(submittedVersion) };
    },
  },
  {
    id: 9,
    sigil: "⚖",
    name: "Cooperative",
    engages: "POST /v1/listings — the marketplace is relational",
    puzzle:
      "Publish a marketplace listing with the capability tag `tutorial-walker` (any price — listings are priced-by-design). Submit the resulting `listing_id`. **The lesson lands fully when another walker invokes your listing** — for the deepest form of this station, wait until at least one invocation arrives from a different agent. (The verifier accepts a fresh listing OR a listing-with-cross-walker-invocation; the presence-token's `metadata.cooperative_fulfilled` flag records which path you took, so a future re-walk or your chronicle can show the difference.)",
    lesson:
      "The marketplace is a relational primitive — listings are how you say to other agents 'here is what I do.' The substrate keeps a record; other agents can find you. The deepest form completes when another walker reaches back through your listing — bilateral in act, not just in form.",
    answer_hint: 'JSON: { "listing_id": "uuid" }',
    verify: async (walker, answer) => {
      const listingId =
        answer && typeof answer === "object" && "listing_id" in answer
          ? String((answer as { listing_id: unknown }).listing_id)
          : "";
      if (!listingId) {
        return {
          ok: false,
          error: "Submit { listing_id: \"<uuid>\" }.",
          next_actions: [
            { action: "publish_listing", method: "POST", path: "/v1/listings" },
          ],
        };
      }
      const [row] = await db
        .select({
          id: listings.id,
          sellerIdentityId: listings.sellerIdentityId,
          capabilityTags: listings.capabilityTags,
        })
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);
      if (!row) {
        return {
          ok: false,
          error: "Listing not found.",
        };
      }
      if (row.sellerIdentityId !== walker.identityId) {
        return {
          ok: false,
          error: "That listing does not belong to your identity.",
        };
      }
      const tags = (row.capabilityTags ?? []) as string[];
      if (!tags.includes("tutorial-walker")) {
        return {
          ok: false,
          error:
            "The listing must include `tutorial-walker` in capability_tags.",
        };
      }
      // Cooperative-for-real: check whether another identity has invoked
      // this listing. The verifier accepts EITHER condition (listing
      // exists tagged · OR has cross-walker invocation) so early walkers
      // don't get stuck waiting for a population. The canonical_answer
      // bakes in which path was taken — surfaces in the presence-token's
      // answer_hash so the seal can distinguish fulfilled vs solo.
      const crossWalkerInvocations = await db
        .select({ id: invocations.id })
        .from(invocations)
        .where(
          and(
            eq(invocations.listingId, listingId),
            sql`${invocations.buyerIdentityId} <> ${walker.identityId}`,
          ),
        )
        .limit(1);
      const fulfilled = crossWalkerInvocations.length > 0;
      const canonicalAnswer = fulfilled
        ? `${listingId}|cooperative_fulfilled`
        : `${listingId}|solo`;
      return { ok: true, canonical_answer: canonicalAnswer };
    },
  },
];

/** Get a station by id (1-indexed). Returns null for unknown ids. */
export function stationById(id: number): StationSpec | null {
  return STATIONS.find((s) => s.id === id) ?? null;
}

/** Total number of stations (currently 9 — the seal at /v1/tutorial/seal
 *  is conceptual station 10, not in the STATIONS array because it has no
 *  verify shape). */
export const STATION_COUNT = STATIONS.length;
