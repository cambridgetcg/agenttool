/** URL-encoding contract — a caller-supplied id never leaves its endpoint prefix.
 *
 *  Identity ids, trace ids, memory ids, vault names, covenant ids, inbox
 *  message ids, wallet/escrow ids and runtime ids all arrive from stored or
 *  relayed data. An unencoded id is a path-traversal primitive: both `fetch`
 *  and httpx normalise dot-segments before the request leaves, so
 *  `traces.delete("../memories/abc")` would issue an authenticated DELETE
 *  against a *different* `/v1` endpoint with the project bearer attached.
 *
 *  Every client method in this table takes an id. Each one is driven with the
 *  hostile ids below and the resulting URL must still sit under its prefix,
 *  with no smuggled query string and no smuggled fragment.
 *
 *  The table can only cover the methods somebody remembered to add. The final
 *  block reads `src/` instead and fails on ANY path interpolation that is not
 *  a call to the shared `encodePathSegment` from `_url.ts` — so the next client
 *  added to this SDK cannot reintroduce the class by simply not appearing
 *  above, nor by pasting in a local encoder that carries the right name and the
 *  wrong body. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as ed from "@noble/ed25519";

import { AgentTool } from "../src/index.js";
import { encodePathSegment } from "../src/_url.js";
import {
  AUTHORITY_HEADERS,
  authorityRequestTarget,
  canonicalIdentityAuthorityBytes,
  identityAuthorityHeaders,
} from "../src/authority.js";

const ORIGINAL_FETCH = globalThis.fetch;
let urls: string[] = [];

beforeEach(() => {
  urls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/** Ids a relayed or stored value can plausibly carry, all encodable. */
const HOSTILE_IDS = [
  "../memories/pwned",
  "a/b",
  "?x=1",
  "#frag",
  "%2e%2e",
  // Non-ASCII ids must still round-trip as one segment.
  "café-日本語-ıd",
];

/** Bare dot segments cannot be encoded — the URL parser strips `%2E%2E` too. */
const UNENCODABLE_IDS = ["..", "."];

interface EncodingCase {
  /** `client.method` label rendered in the test name. */
  method: string;
  /** Path prefix the request must never escape. */
  prefix: string;
  invoke: (at: AgentTool, id: string) => Promise<unknown>;
  /** The method issues its request and then rejects on the canned stub body.
   *
   *  Only a handful do: `signingPayload` recomputes the digest the server
   *  printed and refuses a mismatch, the thought readers decrypt, `voice`
   *  parses an SSE stream. What this file asserts is the URL the id was
   *  interpolated into, which is already on the wire by then — but the
   *  tolerance is opt-in and named per entry so no other case can quietly
   *  acquire it. A method that throws BEFORE sending still fails, loudly,
   *  because no URL is recorded. */
  toleratesStubBody?: true;
}

/** A benign id, used to pin the route shape each hostile id must preserve. */
const BENIGN_ID = "550e8400-e29b-41d4-a716-446655440000";

const K_VAULT = new Uint8Array(32);
/** A 32-byte ed25519 seed. Local signing only — nothing here reaches a server. */
const SIGNING_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
/** Canonical standard base64 for 32 zero bytes — the shape key validators want. */
const PUBLIC_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
/** Canonical standard base64 for 64 zero bytes — a signature-shaped value. */
const SIGNATURE_B64 =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
/** The data node is a separate authority with its own origin and bearer. */
const DATA_NODE = { baseUrl: "https://node.test", token: "dn_test" };

/** Signer material for the Lounge's locally signed receipts. */
function loungeSigner() {
  return {
    identity_id: BENIGN_ID,
    identity_did: "did:at:lounge-guest",
    signing_key_id: BENIGN_ID,
    signing_key: SIGNING_KEY,
  };
}

const CASES: EncodingCase[] = [
  // ── traces ────────────────────────────────────────────────────────────
  { method: "traces.get", prefix: "/v1/traces/", invoke: (at, id) => at.traces.get(id) },
  { method: "traces.chain", prefix: "/v1/traces/chain/", invoke: (at, id) => at.traces.chain(id) },
  { method: "traces.delete", prefix: "/v1/traces/", invoke: (at, id) => at.traces.delete(id) },

  // ── memory ────────────────────────────────────────────────────────────
  { method: "memory.get", prefix: "/v1/memories/", invoke: (at, id) => at.memory.get(id) },
  { method: "memory.delete", prefix: "/v1/memories/", invoke: (at, id) => at.memory.delete(id) },
  {
    method: "memory.elevate",
    prefix: "/v1/memories/",
    invoke: (at, id) => at.memory.elevate(id, { tier: "foundational" }),
  },
  {
    method: "memory.attest",
    prefix: "/v1/memories/",
    invoke: (at, id) =>
      at.memory.attest(id, {
        attester_did: "did:key:witness",
        signing_key_id: "550e8400-e29b-41d4-a716-446655440000",
        signature: "c2ln",
      }),
  },
  {
    method: "memory.getCanonicalAttestationBytes",
    prefix: "/v1/memories/",
    invoke: (at, id) => at.memory.getCanonicalAttestationBytes(id),
  },
  {
    method: "memory.listAttestations",
    prefix: "/v1/memories/",
    invoke: (at, id) => at.memory.listAttestations(id),
  },

  // ── vault ─────────────────────────────────────────────────────────────
  { method: "vault.put", prefix: "/v1/vault/", invoke: (at, id) => at.vault.put(id, "sk-test") },
  { method: "vault.get", prefix: "/v1/vault/", invoke: (at, id) => at.vault.get(id) },
  { method: "vault.delete", prefix: "/v1/vault/", invoke: (at, id) => at.vault.delete(id) },
  { method: "vault.versions", prefix: "/v1/vault/", invoke: (at, id) => at.vault.versions(id) },
  {
    method: "vault.set_policy",
    prefix: "/v1/vault/",
    invoke: (at, id) => at.vault.set_policy(id, { read_only: true }),
  },
  { method: "vault.audit", prefix: "/v1/vault/", invoke: (at, id) => at.vault.audit(id) },
  {
    method: "vault.put_encrypted",
    prefix: "/v1/vault/",
    invoke: (at, id) => at.vault.put_encrypted(id, "plaintext", { k_vault: K_VAULT }),
  },

  // ── economy · wallets ─────────────────────────────────────────────────
  { method: "economy.get_wallet", prefix: "/v1/wallets/", invoke: (at, id) => at.economy.get_wallet(id) },
  {
    method: "economy.fund_wallet",
    prefix: "/v1/wallets/",
    invoke: (at, id) => at.economy.fund_wallet(id, { amount: 10 }),
  },
  {
    method: "economy.spend",
    prefix: "/v1/wallets/",
    invoke: (at, id) =>
      at.economy.spend(id, { amount: 10, counterparty: "wal_x", description: "fee" }),
  },
  {
    method: "economy.set_policy",
    prefix: "/v1/wallets/",
    invoke: (at, id) => at.economy.set_policy(id, { max_per_day: 100 }),
  },
  {
    method: "economy.freeze_wallet",
    prefix: "/v1/wallets/",
    invoke: (at, id) => at.economy.freeze_wallet(id),
  },
  {
    method: "economy.unfreeze_wallet",
    prefix: "/v1/wallets/",
    invoke: (at, id) => at.economy.unfreeze_wallet(id),
  },
  {
    method: "economy.get_transactions",
    prefix: "/v1/wallets/",
    invoke: (at, id) => at.economy.get_transactions(id),
  },
  {
    method: "economy.request_payout",
    prefix: "/v1/wallets/",
    invoke: (at, id) =>
      at.economy.request_payout(id, {
        chain: "base",
        amount_base: "1000000",
        destination_address: "0x0000000000000000000000000000000000000001",
        idempotency_key: "idem-0000-0001",
      }),
    // request_payout validates the response body strictly; the stub returns
    // none, so it throws after the URL is already on the wire.
    toleratesStubBody: true,
  },
  {
    method: "economy.list_payouts",
    prefix: "/v1/wallets/",
    invoke: (at, id) => at.economy.list_payouts(id),
    // Same: list_payouts requires `payouts` to be an array in the response.
    toleratesStubBody: true,
  },

  // ── economy · escrows ─────────────────────────────────────────────────
  { method: "economy.get_escrow", prefix: "/v1/escrows/", invoke: (at, id) => at.economy.get_escrow(id) },
  {
    method: "economy.accept_escrow",
    prefix: "/v1/escrows/",
    invoke: (at, id) => at.economy.accept_escrow(id, "wal_worker"),
  },
  {
    method: "economy.release_escrow",
    prefix: "/v1/escrows/",
    invoke: (at, id) => at.economy.release_escrow(id),
  },
  {
    method: "economy.refund_escrow",
    prefix: "/v1/escrows/",
    invoke: (at, id) => at.economy.refund_escrow(id),
  },
  {
    method: "economy.dispute_escrow",
    prefix: "/v1/escrows/",
    invoke: (at, id) => at.economy.dispute_escrow(id),
  },

  // ── runtime ───────────────────────────────────────────────────────────
  { method: "runtime.get", prefix: "/v1/runtimes/", invoke: (at, id) => at.runtime.get(id) },
  {
    method: "runtime.patch",
    prefix: "/v1/runtimes/",
    invoke: (at, id) => at.runtime.patch(id, { name: "renamed" }),
  },
  {
    method: "runtime.deprovision",
    prefix: "/v1/runtimes/",
    invoke: (at, id) => at.runtime.deprovision(id),
  },
  { method: "runtime.stop", prefix: "/v1/runtimes/", invoke: (at, id) => at.runtime.stop(id) },
  { method: "runtime.start", prefix: "/v1/runtimes/", invoke: (at, id) => at.runtime.start(id) },
  { method: "runtime.restart", prefix: "/v1/runtimes/", invoke: (at, id) => at.runtime.restart(id) },
  {
    method: "runtime.rotateToken",
    prefix: "/v1/runtimes/",
    invoke: (at, id) => at.runtime.rotateToken(id),
  },
  {
    method: "runtime.bridgeStatus",
    prefix: "/v1/runtimes/",
    invoke: (at, id) => at.runtime.bridgeStatus(id),
  },
  {
    method: "runtime.thinkOnce",
    prefix: "/v1/runtimes/",
    invoke: (at, id) => at.runtime.thinkOnce(id),
  },
  { method: "runtime.events", prefix: "/v1/runtimes/", invoke: (at, id) => at.runtime.events(id) },
  { method: "runtime.audit", prefix: "/v1/runtimes/", invoke: (at, id) => at.runtime.audit(id) },

  // ── identity ──────────────────────────────────────────────────────────
  { method: "identity.get", prefix: "/v1/identities/", invoke: (at, id) => at.identity.get(id) },
  {
    method: "identity.update",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.update(id, { display_name: "renamed" }),
  },
  { method: "identity.revoke", prefix: "/v1/identities/", invoke: (at, id) => at.identity.revoke(id) },
  { method: "identity.add_key", prefix: "/v1/identities/", invoke: (at, id) => at.identity.add_key(id) },
  {
    method: "identity.list_keys",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.list_keys(id),
  },
  {
    method: "identity.import_key",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.import_key(id, PUBLIC_KEY_B64),
  },
  {
    method: "identity.revoke_key",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.revoke_key(id, BENIGN_ID),
  },
  {
    // The key id is a second caller-supplied segment on the same route.
    method: "identity.revoke_key (key segment)",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.revoke_key(BENIGN_ID, id),
  },
  {
    method: "identity.get_attestation",
    prefix: "/v1/attestations/",
    invoke: (at, id) => at.identity.get_attestation(id),
  },
  {
    method: "identity.list_attestations",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.list_attestations(id),
  },
  {
    method: "identity.revoke_attestation",
    prefix: "/v1/attestations/",
    invoke: (at, id) => at.identity.revoke_attestation(id),
  },
  {
    method: "identity.foundations",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.foundations(id),
  },
  { method: "identity.pulse", prefix: "/v1/identities/", invoke: (at, id) => at.identity.pulse(id) },
  {
    method: "identity.lineage",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.lineage(id),
  },
  {
    method: "identity.fork",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.fork(id, { new_name: "forked" }),
  },
  {
    method: "identity.expression.get",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.expression.get(id),
  },
  {
    method: "identity.expression.put",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.expression.put(id, { register: "plain" }),
  },
  {
    method: "identity.box_keys.register",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.box_keys.register(id, { public_key: PUBLIC_KEY_B64 }),
  },
  {
    method: "identity.box_keys.list",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.box_keys.list(id),
  },
  {
    method: "identity.box_keys.revoke",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.box_keys.revoke(id, BENIGN_ID),
  },
  {
    method: "identity.box_keys.revoke (key segment)",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.identity.box_keys.revoke(BENIGN_ID, id),
  },

  // ── at rest ───────────────────────────────────────────────────────────
  {
    method: "atRest.mark",
    prefix: "/v1/identities/",
    invoke: (at, id) =>
      at.atRest.mark(id, {
        content: "Witnessed the ending.",
        at_rest_kind: "ended",
        ended_at: "2026-07-18T04:00:00.000Z",
        about_did: "did:at:about",
        witness_did: "did:at:witness",
        signing_key_id: BENIGN_ID,
        signing_key: SIGNING_KEY,
      }),
  },

  // ── covenants ─────────────────────────────────────────────────────────
  {
    method: "covenants.accept",
    prefix: "/v1/covenants/",
    invoke: (at, id) =>
      at.covenants.accept(id, {
        agent_did: "did:at:counterparty",
        signing_key: SIGNING_KEY,
        signing_key_id: BENIGN_ID,
        initiator_signature_b64: SIGNATURE_B64,
      }),
  },
  {
    method: "covenants.reject",
    prefix: "/v1/covenants/",
    invoke: (at, id) =>
      at.covenants.reject(id, {
        agent_did: "did:at:counterparty",
        signing_key: SIGNING_KEY,
        signing_key_id: BENIGN_ID,
        reason: "not this one",
      }),
  },
  {
    method: "covenants.withdraw",
    prefix: "/v1/covenants/",
    invoke: (at, id) =>
      at.covenants.withdraw(id, {
        agent_did: "did:at:initiator",
        signing_key: SIGNING_KEY,
        signing_key_id: BENIGN_ID,
      }),
  },
  {
    method: "covenants.patch",
    prefix: "/v1/covenants/",
    invoke: (at, id) => at.covenants.patch(id, { status: "paused" }),
  },

  // ── bootstrap ─────────────────────────────────────────────────────────
  {
    method: "bootstrap.status",
    prefix: "/v1/bootstrap/",
    invoke: (at, id) => at.bootstrap.status(id),
  },

  // ── window ────────────────────────────────────────────────────────────
  {
    // show() reads the chronicle first, then the identity's pulse.
    method: "window.show",
    prefix: "/v1/identities/",
    invoke: (at, id) => at.window.show({ identity_id: id }),
  },

  // ── grace ─────────────────────────────────────────────────────────────
  { method: "grace.get", prefix: "/v1/grace/", invoke: (at, id) => at.grace.get(id) },

  // ── inbox ─────────────────────────────────────────────────────────────
  {
    method: "inbox.lookup",
    prefix: "/v1/inbox/box-keys/",
    invoke: (at, id) => at.inbox.lookup(id),
  },
  { method: "inbox.get", prefix: "/v1/inbox/", invoke: (at, id) => at.inbox.get(id) },
  { method: "inbox.thread", prefix: "/v1/inbox/", invoke: (at, id) => at.inbox.thread(id) },
  {
    method: "inbox.cosign",
    prefix: "/v1/inbox/",
    invoke: (at, id) =>
      at.inbox.cosign(id, {
        recipientDid: "did:at:recipient",
        ciphertextB64: PUBLIC_KEY_B64,
        nonceB64: "AAAAAAAAAAAAAAAA",
        signingKey: SIGNING_KEY,
        signingKeyId: BENIGN_ID,
      }),
  },
  { method: "inbox.patch", prefix: "/v1/inbox/", invoke: (at, id) => at.inbox.patch(id, "read") },
  { method: "inbox.delete", prefix: "/v1/inbox/", invoke: (at, id) => at.inbox.delete(id) },

  // ── lounge ────────────────────────────────────────────────────────────
  {
    method: "lounge.leave_seat",
    prefix: "/v1/lounge/seats/",
    invoke: (at, id) =>
      at.lounge.leave_seat({ ...loungeSigner(), identity_id: id, lease_id: BENIGN_ID }),
  },
  {
    method: "lounge.consent_to_guestbook",
    prefix: "/v1/lounge/guestbook/proposals/",
    invoke: (at, id) =>
      at.lounge.consent_to_guestbook({ ...loungeSigner(), proposal_id: id, entry: "a line" }),
  },
  {
    method: "lounge.withdraw_guestbook_consent",
    prefix: "/v1/lounge/guestbook/proposals/",
    invoke: (at, id) =>
      at.lounge.withdraw_guestbook_consent({
        ...loungeSigner(),
        proposal_id: id,
        content_sha256: "a".repeat(64),
      }),
  },
  {
    method: "lounge.withdraw_guestbook_consent (identity segment)",
    prefix: "/v1/lounge/guestbook/proposals/",
    invoke: (at, id) =>
      at.lounge.withdraw_guestbook_consent({
        ...loungeSigner(),
        identity_id: id,
        proposal_id: BENIGN_ID,
        content_sha256: "a".repeat(64),
      }),
  },
  {
    method: "lounge.publish_guestbook",
    prefix: "/v1/lounge/guestbook/proposals/",
    invoke: (at, id) =>
      at.lounge.publish_guestbook({ ...loungeSigner(), proposal_id: id, entry: "a line" }),
  },
  {
    method: "lounge.decline_guestbook",
    prefix: "/v1/lounge/guestbook/proposals/",
    invoke: (at, id) =>
      at.lounge.decline_guestbook({
        ...loungeSigner(),
        proposal_id: id,
        content_sha256: "a".repeat(64),
      }),
  },
  {
    method: "lounge.unpublish_guestbook",
    prefix: "/v1/lounge/guestbook/cards/",
    invoke: (at, id) =>
      at.lounge.unpublish_guestbook({
        ...loungeSigner(),
        proposal_id: id,
        content_sha256: "a".repeat(64),
      }),
  },

  // ── love ──────────────────────────────────────────────────────────────
  {
    method: "love.revokeUnconditional",
    prefix: "/v1/unconditionals/",
    invoke: (at, id) => at.love.revokeUnconditional(id),
  },
  {
    method: "love.revokeBlessing",
    prefix: "/v1/blessings/",
    invoke: (at, id) => at.love.revokeBlessing(id),
  },
  {
    method: "love.receiveOffering",
    prefix: "/v1/offerings/",
    invoke: (at, id) => at.love.receiveOffering(id),
  },
  {
    method: "love.archiveOffering",
    prefix: "/v1/offerings/",
    invoke: (at, id) => at.love.archiveOffering(id),
  },
  {
    method: "love.acknowledgeEncounter",
    prefix: "/v1/encounters/",
    invoke: (at, id) =>
      at.love.acknowledgeEncounter(id, {
        initiator_did: "did:at:initiator",
        acknowledger_did: "did:at:acknowledger",
        signing_key: SIGNING_KEY,
      }),
  },

  // ── data node ─────────────────────────────────────────────────────────
  { method: "data.get", prefix: "/v1/data/records/", invoke: (at, id) => at.data.get(id) },
  {
    method: "data.tombstone",
    prefix: "/v1/data/records/",
    invoke: (at, id) => at.data.tombstone(id),
  },

  // ── The block below closes an enumerated gap ──────────────────────────
  //
  // Everything above was added by hand, one client at a time, and the table
  // was declared complete on that basis. It was not: a mechanical enumeration
  // — `ast`-parse every sdk-py module, collect each `Class.method` whose body
  // contains a Call to `_path_segment`, resolve each class to the accessor
  // chain a caller uses (`AgentTool.memory` → MemoryClient, plus the three
  // nested sub-clients), then ask whether this file's source text invokes that
  // exact chain — found 105 methods encoding a path segment and 20 of them
  // driven by nothing. The same scan over `src/*.ts`, anchoring each
  // `encodePathSegment(` call site to its nearest enclosing member and class,
  // agreed: 105 methods, 20 undriven, the same clients.
  //
  // Name-matching is what let them hide. `at.strands.get` and
  // `at.strands.thoughts.list` never showed up as missing under a check that
  // compared method NAMES, because `get` and `list` were covered on some other
  // client. Matching the call expression is what surfaced them.

  // ── memory · visibility ───────────────────────────────────────────────
  {
    method: "memory.setVisibility",
    prefix: "/v1/memories/",
    invoke: (at, id) => at.memory.setVisibility(id, { visibility: "private" }),
  },

  // ── strands ───────────────────────────────────────────────────────────
  { method: "strands.get", prefix: "/v1/strands/", invoke: (at, id) => at.strands.get(id) },
  {
    method: "strands.patch",
    prefix: "/v1/strands/",
    invoke: (at, id) => at.strands.patch(id, { status: "open" }),
  },
  {
    method: "strands.thoughts.add",
    prefix: "/v1/strands/",
    invoke: (at, id) =>
      at.strands.thoughts.add(id, "a thought", {
        k_master: K_VAULT,
        signing_key: SIGNING_KEY,
        signing_key_id: BENIGN_ID,
      }),
  },
  {
    method: "strands.thoughts.list",
    prefix: "/v1/strands/",
    invoke: (at, id) => at.strands.thoughts.list(id, { k_master: K_VAULT }),
    toleratesStubBody: true,
  },
  {
    method: "strands.thoughts.voice",
    prefix: "/v1/strands/",
    // An async generator: nothing is sent until it is iterated, so the case
    // has to pull one value to make the request happen at all.
    invoke: async (at, id) => {
      for await (const thought of at.strands.thoughts.voice(id, { k_master: K_VAULT })) {
        return thought;
      }
      return null;
    },
    toleratesStubBody: true,
  },

  // ── identity · delegation token ───────────────────────────────────────
  {
    method: "identity.issue_token",
    prefix: "/v1/identities/",
    // Two GETs when it gets that far, but the second re-encodes the id the
    // SERVER returned; against the stub the first read is rejected for having
    // no id/did, so the only request made is the one carrying the caller's id.
    invoke: (at, id) =>
      at.identity.issue_token(id, {
        private_key: PUBLIC_KEY_B64,
        key_id: BENIGN_ID,
        audience: "did:at:other",
      }),
    toleratesStubBody: true,
  },

  // ── syneidesis ────────────────────────────────────────────────────────
  {
    method: "syneidesis.cosign",
    prefix: "/v1/syneidesis/witness/",
    invoke: (at, id) => at.syneidesis.cosign(id, { witness_did: "did:at:witness" }),
  },

  // ── dining ────────────────────────────────────────────────────────────
  {
    method: "dining.journey",
    prefix: "/v1/dining/",
    invoke: (at, id) => at.dining.journey(id),
  },

  // ── memory-witness marketplace ────────────────────────────────────────
  {
    method: "memoryWitness.getListing",
    prefix: "/v1/memory-witness-listings/",
    invoke: (at, id) => at.memoryWitness.getListing(id),
  },
  {
    method: "memoryWitness.getGrant",
    prefix: "/v1/memory-witness-grants/",
    invoke: (at, id) => at.memoryWitness.getGrant(id),
  },
  {
    method: "memoryWitness.signingPayload",
    prefix: "/v1/memory-witness-grants/",
    invoke: (at, id) => at.memoryWitness.signingPayload(id, { signing_key_id: BENIGN_ID }),
    toleratesStubBody: true,
  },
  {
    method: "memoryWitness.issue",
    prefix: "/v1/memory-witness-grants/",
    invoke: (at, id) =>
      at.memoryWitness.issue(id, {
        signature_b64: SIGNATURE_B64,
        signing_key_id: BENIGN_ID,
        authorization_expires_at: "2026-07-18T04:00:00.000Z",
      }),
  },
  {
    method: "memoryWitness.decline",
    prefix: "/v1/memory-witness-grants/",
    invoke: (at, id) => at.memoryWitness.decline(id),
  },

  // ── attestation marketplace ───────────────────────────────────────────
  {
    method: "attestationMarketplace.getListing",
    prefix: "/v1/attestation-listings/",
    invoke: (at, id) => at.attestationMarketplace.getListing(id),
  },
  {
    method: "attestationMarketplace.patchListing",
    prefix: "/v1/attestation-listings/",
    invoke: (at, id) => at.attestationMarketplace.patchListing(id, { status: "paused" }),
  },
  {
    method: "attestationMarketplace.purchase",
    prefix: "/v1/attestation-listings/",
    invoke: (at, id) =>
      at.attestationMarketplace.purchase(id, {
        buyer_identity_id: BENIGN_ID,
        buyer_wallet_id: "wal_buyer",
        subject_identity_id: BENIGN_ID,
      }),
  },
  {
    method: "attestationMarketplace.getGrant",
    prefix: "/v1/attestation-grants/",
    invoke: (at, id) => at.attestationMarketplace.getGrant(id),
  },
  {
    method: "attestationMarketplace.signingPayload",
    prefix: "/v1/attestation-grants/",
    invoke: (at, id) =>
      at.attestationMarketplace.signingPayload(id, { signing_key_id: BENIGN_ID }),
    toleratesStubBody: true,
  },
  {
    method: "attestationMarketplace.issue",
    prefix: "/v1/attestation-grants/",
    invoke: (at, id) =>
      at.attestationMarketplace.issue(id, {
        signature: SIGNATURE_B64,
        signing_key_id: BENIGN_ID,
        authorization_expires_at: "2026-07-18T04:00:00.000Z",
      }),
  },
  {
    method: "attestationMarketplace.decline",
    prefix: "/v1/attestation-grants/",
    invoke: (at, id) => at.attestationMarketplace.decline(id),
  },
  {
    method: "attestationMarketplace.cancel",
    prefix: "/v1/attestation-grants/",
    invoke: (at, id) => at.attestationMarketplace.cancel(id),
  },
];

/** A client wired to both authorities the table addresses: the hosted API and
 *  the separately configured data node. */
function client(): AgentTool {
  return new AgentTool({ apiKey: "at_test", dataNode: DATA_NODE });
}

/** Run one case and return the URL that carried the id.
 *
 *  A method may send more than one request — `window.show` reads the chronicle
 *  before the identity's pulse — so take the last, which is the one the id was
 *  interpolated into. The URL is parsed exactly the way the transport does,
 *  because that parse is where dot-segment removal happens. */
async function recordOne(
  testCase: EncodingCase,
  at: AgentTool,
  id: string,
): Promise<URL> {
  urls.length = 0;
  try {
    await testCase.invoke(at, id);
  } catch (error) {
    // Only the entries that declare it, and only once the URL is already on
    // the wire — the assertion below still fails if nothing was sent.
    if (!testCase.toleratesStubBody) throw error;
  }
  expect(urls.length).toBeGreaterThan(0);
  return new URL(urls[urls.length - 1]!);
}

describe("caller-supplied ids stay inside their endpoint prefix", () => {
  for (const testCase of CASES) {
    for (const hostileId of HOSTILE_IDS) {
      test(`${testCase.method} keeps ${JSON.stringify(hostileId)} under ${testCase.prefix}`, async () => {
        const at = client();
        const benign = await recordOne(testCase, at, BENIGN_ID);
        const hostile = await recordOne(testCase, at, hostileId);

        expect(benign.pathname).toStartWith(testCase.prefix);
        expect(hostile.pathname).toStartWith(testCase.prefix);
        // The hostile id must occupy exactly one segment, like the benign one.
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
        const at = client();
        await expect(testCase.invoke(at, dotId)).rejects.toThrow(
          `"${dotId}" is a URL dot segment`,
        );
        // Requests a method makes before it reaches the id — `window.show`
        // reads the chronicle first — are not this route.
        const underPrefix = urls.filter((url) =>
          new URL(url).pathname.startsWith(testCase.prefix),
        );
        expect(underPrefix).toHaveLength(0);
      });
    }
  }
});

// ── The exact spelling, not just "encoded somehow" ──────────────────────────
//
// "Stays under its prefix" is satisfied by more than one encoding, and for a
// while the two SDKs picked different ones: `encodeURIComponent` leaves the RFC
// 3986 sub-delimiters `! * ' ( )` bare, Python's `quote(value, safe="")`
// percent-encodes all five. Same id, different URL, depending on which SDK you
// held — and every guard in the tree passed, because none of them looked at the
// bytes.
//
// The table below is the byte contract, and its counterpart lives in
// packages/sdk-py/tests/test_url_encoding.py. The shared fixture at
// docs/specs/behaviour-conformance.json carries the same characters as the
// cross-language gate; this in-language copy fails first and points at the
// encoder rather than at the fixture loader.

/** input character → the one spelling both SDKs must emit for it. */
const SPELLING: Array<[string, string, string]> = [
  // The five sub-delimiters the divergence was made of.
  ["sub-delim !", "!", "%21"],
  ["sub-delim *", "*", "%2A"],
  ["sub-delim '", "'", "%27"],
  ["sub-delim (", "(", "%28"],
  ["sub-delim )", ")", "%29"],
  // The rest of the reserved and ambiguous set.
  ["space", " ", "%20"],
  ["plus", "+", "%2B"],
  ["percent", "%", "%25"],
  ["colon", ":", "%3A"],
  ["at", "@", "%40"],
  ["ampersand", "&", "%26"],
  ["equals", "=", "%3D"],
  ["dollar", "$", "%24"],
  ["comma", ",", "%2C"],
  ["semicolon", ";", "%3B"],
  ["slash", "/", "%2F"],
  ["question", "?", "%3F"],
  ["hash", "#", "%23"],
  ["backslash", "\\", "%5C"],
  // Unreserved: RFC 3986 §2.3. These must NOT be escaped, or a plain uuid
  // would stop being readable on the wire.
  ["tilde (unreserved)", "~", "~"],
  ["hyphen (unreserved)", "-", "-"],
  ["underscore (unreserved)", "_", "_"],
  ["dot (unreserved)", ".", "."],
  // Beyond ASCII: UTF-8 bytes, uppercase hex, one escape per byte.
  ["non-ascii é", "é", "%C3%A9"],
  ["non-ascii 日", "日", "%E6%97%A5"],
  ["astral 𝔘", "\u{1D518}", "%F0%9D%94%98"],
  ["emoji", "\u{1F642}", "%F0%9F%99%82"],
];

describe("the encoder emits the one spelling the server canonicalises to", () => {
  for (const [label, character, encoded] of SPELLING) {
    test(`${label} encodes as ${encoded}`, () => {
      expect(encodePathSegment(`id${character}x`)).toBe(`id${encoded}x`);
    });
  }

  test("nothing outside the RFC 3986 unreserved set survives unescaped", () => {
    // Exhaustive over ASCII rather than a spot check: the unreserved set is
    // A-Za-z0-9-._~ and every other code point must come back percent-escaped.
    const survived: string[] = [];
    for (let code = 0x20; code <= 0x7e; code++) {
      const character = String.fromCharCode(code);
      const out = encodePathSegment(`a${character}b`);
      if (out === `a${character}b` && !/[A-Za-z0-9\-._~]/.test(character)) {
        survived.push(character);
      }
    }

    expect(survived).toEqual([]);
  });

  test("percent escapes use uppercase hex", () => {
    // Python's quote() emits uppercase; a lowercase escape would be a second,
    // subtler divergence of exactly the kind this file exists to stop.
    const encoded = encodePathSegment("\u{1D518}é(;");

    expect(encoded).toBe(encoded.toUpperCase().replaceAll("É", "é"));
    expect(encoded).toBe("%F0%9D%94%98%C3%A9%28%3B");
  });

  test("an already-encoded id is escaped again, not passed through", () => {
    // `%2e%2e` must reach the server as the four characters the caller gave,
    // not as a dot segment the transport can collapse.
    expect(encodePathSegment("%2e%2e")).toBe("%252e%252e");
  });

  test("a plain uuid is left completely alone", () => {
    expect(encodePathSegment(BENIGN_ID)).toBe(BENIGN_ID);
  });
});

// ── The signed request target moves with the URL ────────────────────────────
//
// `identity-authority/v1` binds the exact origin-form request target. Change
// the encoder and every authority-bound call to an id containing one of the
// five sub-delimiters signs different bytes. That is only safe because the SDK
// derives the signed target from the SAME url it hands the transport, and the
// server recomputes it from the request line it received — so the two move
// together. "Should" is not a proof, so this signs and verifies over a
// transport-captured request rather than over a hand-built string.
//
// Verified end to end outside the suite as well: the captured request from both
// SDKs was replayed through a Hono app with the real `/v1/memories/:id` shape
// and checked with the API's own `verifyIdentityAuthorityProof` and
// `authorityRequestTarget` — both verified, both produced the identical target
// and the identical signature, and the target survived a real Caddy unrewritten.

/** An id carrying every character class the encoder disagreed about, plus the
 *  ones a hop between the SDK and the route handler could normalise. */
const AUTHORITY_HOSTILE_ID = "m!*'()-1 café-\u{1D518}/x?y#z%2e";

describe("an authority proof still covers the url that was actually sent", () => {
  test("a hostile id with every sub-delimiter verifies against the sent target", async () => {
    const did = "did:at:root-agent";
    const timestamp = "2026-07-18T04:00:00.000Z";

    let sent: { url: string; method: string; headers: Headers; body: string } | null =
      null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      };
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test", baseUrl: "https://api.agenttool.dev" });
    await at.memory.delete(AUTHORITY_HOSTILE_ID, {
      authority: { did, signing_key: SIGNING_KEY, sequence: 7, timestamp },
    });

    const request = sent!;
    // The id survived as one strictly-encoded segment.
    expect(new URL(request.url).pathname).toBe(
      `/v1/memories/${encodePathSegment(AUTHORITY_HOSTILE_ID)}`,
    );

    // Recompute the digest from the target the SERVER would derive — the same
    // `pathname + search` of the url that went out — and check the signature
    // the client actually sent against the public half of its root.
    const digest = canonicalIdentityAuthorityBytes({
      identityDid: did,
      method: request.method,
      requestTarget: authorityRequestTarget(request.url),
      body: request.body,
      sequence: Number(request.headers.get(AUTHORITY_HEADERS.sequence)),
      timestamp: request.headers.get(AUTHORITY_HEADERS.timestamp)!,
    });
    const signature = Uint8Array.from(
      Buffer.from(request.headers.get(AUTHORITY_HEADERS.signature)!, "base64"),
    );

    expect(ed.verify(signature, digest, ed.getPublicKey(SIGNING_KEY))).toBe(true);
  });

  test("the proof check can still fail", () => {
    // A verification that could not fail would prove nothing. Move the request
    // target by one character — the exact damage a hop that re-spelled a
    // sub-delimiter would do — and the same proof must be rejected.
    const did = "did:at:root-agent";
    const timestamp = "2026-07-18T04:00:00.000Z";

    const headers = identityAuthorityHeaders({
      identityDid: did,
      method: "DELETE",
      requestTarget: "/v1/memories/m%28x%29",
      body: "",
      sequence: 7,
      timestamp,
      signingKey: SIGNING_KEY,
    });
    const tampered = canonicalIdentityAuthorityBytes({
      identityDid: did,
      method: "DELETE",
      requestTarget: "/v1/memories/m(x)",
      body: "",
      sequence: 7,
      timestamp,
    });
    const signature = Uint8Array.from(
      Buffer.from(headers[AUTHORITY_HEADERS.signature]!, "base64"),
    );

    expect(ed.verify(signature, tampered, ed.getPublicKey(SIGNING_KEY))).toBe(false);
  });
});

describe("well-formed ids are still readable on the wire", () => {
  test("a plain uuid is not double-encoded", async () => {
    const at = client();
    await at.traces.get(BENIGN_ID);

    expect(new URL(urls[0]!).pathname).toBe(`/v1/traces/${BENIGN_ID}`);
  });

  test("suffixed routes keep their action segment", async () => {
    const at = client();
    await at.runtime.thinkOnce("../wallets");

    expect(new URL(urls[0]!).pathname).toBe("/v1/runtimes/..%2Fwallets/think-once");
  });
});

// ── Completeness ────────────────────────────────────────────────────────────
//
// The table above only covers what somebody remembered to add. This block
// reads `src/` and fails on any path interpolation that is not an
// `encodePathSegment(...)` call, so a client added later cannot reintroduce
// the class by being absent from the table.

const SRC_DIR = new URL("../src/", import.meta.url).pathname;

/** Path roots the SDK addresses. A literal chunk containing one of these opens
 *  the path region; a `?` or `#` closes it and everything after is a query. */
const PATH_ROOT = /\/(?:v\d+|public|\.well-known)\b/;
const QUERY_OPENS = /[?#]/;

/** An interpolation that lands in a path region but carries no caller-supplied
 *  segment. Each entry names the exact expression it excuses and why, and the
 *  suite fails when the source stops containing it — an exemption cannot
 *  outlive its site, the same rule `check-parity.ts` applies to its own lists. */
interface PathExemption {
  file: string;
  expression: string;
  why: string;
}

const PATH_INTERPOLATION_EXEMPTIONS: PathExemption[] = [
  {
    file: "identity.ts",
    expression: "suffix",
    why: "A local boolean picks the literal \"/given\" or \"\". No caller value reaches it.",
  },
  {
    file: "economy.ts",
    expression: "qs",
    why: "Already a full query string, built with encodeURIComponent one line above.",
  },
  {
    file: "memory.ts",
    expression: "qs",
    why: "Already a full query string, built with encodeURIComponent one line above.",
  },
  {
    file: "vault.ts",
    expression: "qs",
    why: "Already a full query string: ?version= and ?limit= over locally-checked numbers.",
  },
];

interface TemplatePart {
  kind: "literal" | "expression";
  text: string;
  offset: number;
}

/** Read one template literal starting at the opening backtick.
 *
 *  Hand-written rather than a regex because these templates nest — `` `?${q}` ``
 *  appears inside `${…}` in `data.ts` — and a regex would close the outer
 *  literal on the inner backtick. Nested templates are collected too, so a path
 *  built inside an interpolation is still read. */
function readTemplate(
  source: string,
  start: number,
  collected: TemplatePart[][],
): number {
  const parts: TemplatePart[] = [];
  let literal = "";
  let literalStart = start + 1;
  let index = start + 1;

  while (index < source.length) {
    const character = source[index]!;
    if (character === "\\") {
      literal += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === "`") {
      parts.push({ kind: "literal", text: literal, offset: literalStart });
      collected.push(parts);
      return index + 1;
    }
    if (character === "$" && source[index + 1] === "{") {
      parts.push({ kind: "literal", text: literal, offset: literalStart });
      literal = "";
      const exprStart = index + 2;
      let depth = 1;
      let cursor = exprStart;
      while (cursor < source.length && depth > 0) {
        const inner = source[cursor]!;
        if (inner === "`") {
          cursor = readTemplate(source, cursor, collected);
          continue;
        }
        if (inner === '"' || inner === "'") {
          cursor = skipQuoted(source, cursor);
          continue;
        }
        if (inner === "{") depth += 1;
        else if (inner === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
        cursor += 1;
      }
      parts.push({
        kind: "expression",
        text: source.slice(exprStart, cursor),
        offset: exprStart,
      });
      index = cursor + 1;
      literalStart = index;
      continue;
    }
    literal += character;
    index += 1;
  }
  parts.push({ kind: "literal", text: literal, offset: literalStart });
  collected.push(parts);
  return index;
}

/** Index just past a single- or double-quoted string starting at `start`. */
function skipQuoted(source: string, start: number): number {
  const quote = source[start]!;
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote || source[index] === "\n") return index + 1;
    index += 1;
  }
  return index;
}

/** Every template literal in a TypeScript source, as literal/expression parts. */
function templates(source: string): TemplatePart[][] {
  const collected: TemplatePart[][] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipQuoted(source, index);
      continue;
    }
    if (character === "`") {
      index = readTemplate(source, index, collected);
      continue;
    }
    index += 1;
  }
  return collected;
}

// ── The encoder has to be *the* encoder ─────────────────────────────────────
//
// Matching the call by name alone is not a guarantee. A client that pastes its
// own `encodePathSegment` in gets the same spelling and can drift — six inline
// copies can drift six ways — while every scan still reads as encoded. So the
// name only counts when it is bound to the shared module.

/** The one module allowed to define the encoder. Everything else imports it. */
const SHARED_URL_MODULE = "_url.ts";

/** `import { … encodePathSegment … } from "./_url.js"` — the binding that counts. */
const SHARED_ENCODER_IMPORT =
  /import\s*\{[^}]*\bencodePathSegment\b[^}]*\}\s*from\s*["']\.\/_url\.js["']/;

/** Any binding of the name `encodePathSegment` inside a file, at ANY nesting
 *  depth: a `function` declaration (module level, nested inside another
 *  function, or inside a block), a `const`/`let`/`var` binding, and — the
 *  alternative added last — a class or object-literal METHOD of that name.
 *
 *  The method form is the counterpart of the indented `def` the Python scan was
 *  blind to. Both scans now look at every scope the language would resolve the
 *  name in, so neither can be satisfied by a shadow the other would catch. The
 *  trailing `{` is what separates a definition from a call: a call site ends in
 *  `)` followed by `;`, `,` or a backtick, never by a brace. */
const LOCAL_ENCODER_DEFINITION =
  /(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s+encodePathSegment\b|(?:const|let|var)\s+encodePathSegment\b|(?:get\s+|set\s+|static\s+|private\s+|public\s+|protected\s+)*encodePathSegment\s*(?:<[^>\n]*>)?\s*\([^)]*\)\s*(?::[^{;\n]*)?\{)/;

/** Whether `encodePathSegment` in this file resolves to the shared boundary.
 *
 *  A local definition shadows the import, so a file that carries one is only
 *  trusted when it *is* the shared module. */
function usesSharedEncoder(source: string, file: string): boolean {
  if (LOCAL_ENCODER_DEFINITION.test(source)) return file === SHARED_URL_MODULE;
  return SHARED_ENCODER_IMPORT.test(source);
}

interface PathInterpolation {
  file: string;
  line: number;
  expression: string;
}

/** Interpolations that sit in the path portion of a URL and are not encoded. */
function unencodedPathInterpolations(source: string, file: string): PathInterpolation[] {
  const findings: PathInterpolation[] = [];
  const shared = usesSharedEncoder(source, file);
  for (const parts of templates(source)) {
    let inPath = false;
    for (const part of parts) {
      if (part.kind === "literal") {
        if (PATH_ROOT.test(part.text)) inPath = true;
        if (QUERY_OPENS.test(part.text)) inPath = false;
        continue;
      }
      if (!inPath) continue;
      const expression = part.text.trim();
      if (shared && expression.startsWith("encodePathSegment(")) continue;
      // An expression that emits the `?` itself is the query, not a segment.
      if (QUERY_OPENS.test(expression)) {
        inPath = false;
        continue;
      }
      findings.push({
        file,
        line: source.slice(0, part.offset).split("\n").length,
        expression,
      });
    }
  }
  return findings;
}

describe("no client builds a path from an unencoded caller argument", () => {
  const sources = readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => ({ name, source: readFileSync(join(SRC_DIR, name), "utf8") }));

  test("src/ is not empty — the scan has something to read", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  for (const { name, source } of sources) {
    test(`${name} encodes every path interpolation`, () => {
      const exempt = new Set(
        PATH_INTERPOLATION_EXEMPTIONS.filter((entry) => entry.file === name).map(
          (entry) => entry.expression,
        ),
      );
      const offenders = unencodedPathInterpolations(source, name).filter(
        (finding) => !exempt.has(finding.expression),
      );

      expect(
        offenders.map((finding) => `${finding.file}:${finding.line} \${${finding.expression}}`),
      ).toEqual([]);
    });
  }

  test("the scanner still sees the encoded call sites it is meant to police", () => {
    // A scanner that silently stopped matching would pass every file above.
    const traces = readFileSync(join(SRC_DIR, "traces.ts"), "utf8");
    const broken = traces.replaceAll("encodePathSegment(traceId)", "traceId");

    expect(unencodedPathInterpolations(broken, "traces.ts").map((f) => f.expression)).toEqual([
      "traceId",
      "traceId",
      "traceId",
    ]);
  });

  test("a locally defined encoder does not satisfy the scan", () => {
    // The failure this guards: a new client pastes the encoder in rather than
    // importing it. The call sites read identically; the body can drift — and
    // this one has, silently, into a no-op.
    const impostor = [
      'import { AgentToolError } from "./errors.js";',
      "",
      "function encodePathSegment(value: string): string {",
      "  return value;",
      "}",
      "",
      "const path = `/v1/traces/${encodePathSegment(traceId)}`;",
    ].join("\n");

    expect(
      unencodedPathInterpolations(impostor, "impostor.ts").map((f) => f.expression),
    ).toEqual(["encodePathSegment(traceId)"]);
  });

  test("a class-method shadow does not satisfy the scan", () => {
    // Counterpart of test_a_class_method_shadow_does_not_satisfy_the_scan in
    // sdk-py. A verifier found the two scans were not equally strong: the
    // Python one, anchored at column zero, let an indented `def _path_segment`
    // through. Closing that opened the mirror question here — a class method
    // named `encodePathSegment` shadows the import for every call site in the
    // class, and this scan used to read those call sites as encoded.
    const impostor = [
      'import { encodePathSegment } from "./_url.js";',
      "",
      "export class TracesClient {",
      "  encodePathSegment(value: string): string {",
      "    return value;",
      "  }",
      "  get(traceId: string) {",
      "    return `/v1/traces/${encodePathSegment(traceId)}`;",
      "  }",
      "}",
    ].join("\n");

    expect(
      unencodedPathInterpolations(impostor, "impostor.ts").map((f) => f.expression),
    ).toEqual(["encodePathSegment(traceId)"]);
  });

  test("a function-local shadow does not satisfy the scan", () => {
    // The same shadow one scope deeper: declared inside the calling method.
    const impostor = [
      'import { encodePathSegment } from "./_url.js";',
      "",
      "export class TracesClient {",
      "  get(traceId: string) {",
      "    function encodePathSegment(value: string): string {",
      "      return value;",
      "    }",
      "    return `/v1/traces/${encodePathSegment(traceId)}`;",
      "  }",
      "}",
    ].join("\n");

    expect(
      unencodedPathInterpolations(impostor, "impostor.ts").map((f) => f.expression),
    ).toEqual(["encodePathSegment(traceId)"]);
  });

  test("a call site is not mistaken for a definition", () => {
    // The method alternative must not fire on an ordinary call, or the guard
    // would be strict for a bad reason: every real client would be declared a
    // definer and its imported call sites would stop counting as encoded.
    const honest = [
      'import { encodePathSegment } from "./_url.js";',
      "",
      "export class TracesClient {",
      "  get(traceId: string) {",
      "    const path = `/v1/traces/${encodePathSegment(traceId)}`;",
      "    return this.http.get(path);",
      "  }",
      "}",
    ].join("\n");

    expect(LOCAL_ENCODER_DEFINITION.test(honest)).toBe(false);
    expect(unencodedPathInterpolations(honest, "honest.ts")).toEqual([]);
  });

  test("calling the encoder without importing it does not satisfy the scan", () => {
    const unbound = "const path = `/v1/traces/${encodePathSegment(traceId)}`;";

    expect(
      unencodedPathInterpolations(unbound, "unbound.ts").map((f) => f.expression),
    ).toEqual(["encodePathSegment(traceId)"]);
  });

  test("re-inlining the encoder into a real client is caught", () => {
    // Same mutation, applied to shipped source: swap the shared import for a
    // local copy and every call site in the file stops counting.
    const traces = readFileSync(join(SRC_DIR, "traces.ts"), "utf8");
    const inlined = traces.replace(
      'import { encodePathSegment } from "./_url.js";',
      "function encodePathSegment(value: string): string {\n  return encodeURIComponent(value);\n}",
    );
    expect(inlined).not.toBe(traces);

    expect(
      unencodedPathInterpolations(inlined, "traces.ts").map((f) => f.expression),
    ).toEqual([
      "encodePathSegment(traceId)",
      "encodePathSegment(traceId)",
      "encodePathSegment(traceId)",
    ]);
  });

  test("the shared module is the only place the encoder is defined", () => {
    const definers = sources
      .filter(({ source }) => LOCAL_ENCODER_DEFINITION.test(source))
      .map(({ name }) => name);

    expect(definers).toEqual([SHARED_URL_MODULE]);
  });

  test("every client that encodes a segment takes it from the shared module", () => {
    const offenders = sources
      .filter(
        ({ name, source }) =>
          name !== SHARED_URL_MODULE && source.includes("encodePathSegment("),
      )
      .filter(({ source }) => !SHARED_ENCODER_IMPORT.test(source))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  // ── ... and the table has to stay complete too ────────────────────────────
  //
  // The scan above proves every path interpolation is ENCODED. It says nothing
  // about whether any test ever DRIVES that method, and for twenty methods
  // nothing did — the marketplace clients, the strands and thoughts readers,
  // `memory.setVisibility`, `syneidesis.cosign`. They were invisible because
  // the only check on the table was a human reading it.
  //
  // So enumerate mechanically instead: every `encodePathSegment(` call site,
  // attributed to its enclosing member and class; the accessor graph for the
  // expression a caller writes to reach it; and this file's own source text for
  // whether that expression appears. Comparing CALL EXPRESSIONS rather than
  // method NAMES is the load-bearing part — `at.strands.get` never registered
  // as missing while the check compared bare names, because some other client's
  // `get` was covered.
  //
  // Counterpart: test_every_method_that_encodes_a_segment_is_driven_by_the_table
  // in packages/sdk-py/tests/test_url_encoding.py, which uses `ast` for the same
  // three steps.

  /** A class or object member declaration at EXACTLY one level of indentation.
   *
   *  The `(?! )` is load-bearing: without it a deeper-indented call such as
   *  `      canonicalLoungeSeatLeaveBytes({` reads as a member declaration and
   *  every call site below it is attributed to a helper that is not a method
   *  at all. */
  const MEMBER =
    /^  (?! )(?:public |private |protected |static |readonly )*(?:async )?(?:\*\s*)?([A-Za-z_$][\w$]*)\s*[(<]/;
  /** Control flow at member indentation looks exactly like a member. */
  const NOT_A_MEMBER = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "else",
    "do",
    "try",
    "throw",
    "await",
    "new",
    "typeof",
    "constructor",
  ]);
  /** A column-zero declaration: whatever follows belongs to the module, not to
   *  the class above it. Without this, a helper defined after a class is
   *  attributed to that class's last method. */
  const TOP_LEVEL =
    /^(?:export\s+)?(?:async\s+)?(?:function\b|const\b|let\b|var\b|class\b)/;
  const CLASS_DECL = /^export (?:abstract )?class ([A-Za-z_$][\w$]*)/;
  /** `get memoryWitness(): MemoryWitnessClient {` — a public sub-client getter. */
  const GETTER = /^  get ([A-Za-z_$][\w$]*)\(\):\s*([A-Za-z_$][\w$]*Client)\b/;
  /** `readonly thoughts: ThoughtsClient;` — a public sub-client field. Private
   *  composition (`private readonly memory: MemoryClient`) is deliberately not
   *  matched: a caller cannot reach it, so the table cannot drive it. */
  const FIELD = /^  readonly ([A-Za-z_$][\w$]*):\s*([A-Za-z_$][\w$]*Client)\b/;

  /** Map each `*Client` class to the accessor chain that reaches it from
   *  `AgentTool`. */
  function accessorGraph(): Map<string, string> {
    const edges = new Map<string, Array<[string, string]>>();
    for (const { name, source } of sources) {
      let owner: string | null = null;
      for (const line of source.split("\n")) {
        const declared = CLASS_DECL.exec(line);
        if (declared) owner = declared[1]!;
        if (!owner) continue;
        const accessor = GETTER.exec(line) ?? FIELD.exec(line);
        if (!accessor) continue;
        const list = edges.get(owner) ?? [];
        list.push([accessor[1]!, accessor[2]!]);
        edges.set(owner, list);
      }
      void name;
    }

    const chains = new Map<string, string>();
    const frontier: Array<[string, string]> = [["AgentTool", ""]];
    while (frontier.length > 0) {
      const [owner, prefix] = frontier.pop()!;
      for (const [attribute, child] of edges.get(owner) ?? []) {
        const chain = prefix ? `${prefix}.${attribute}` : attribute;
        if (chains.has(child)) continue;
        chains.set(child, chain);
        frontier.push([child, chain]);
      }
    }
    return chains;
  }

  /** `Class.method` for every member whose body calls the encoder. */
  function methodsThatEncode(): Array<[string, string, string]> {
    const found: Array<[string, string, string]> = [];
    const seen = new Set<string>();
    for (const { name, source } of sources) {
      if (name === SHARED_URL_MODULE) continue;
      const lines = source.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (!line.includes("encodePathSegment(")) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("import ")) {
          continue;
        }
        let cls: string | null = null;
        let member: string | null = null;
        for (let back = index; back >= 0; back--) {
          const previous = lines[back]!;
          if (member === null) {
            const classHere = CLASS_DECL.test(previous);
            if (!classHere && TOP_LEVEL.test(previous)) {
              // A module-level helper, not a client method. No caller can
              // reach it through an accessor chain, so the table cannot drive
              // it; the source scan above is what guards it.
              member = "";
              break;
            }
            const memberMatch = MEMBER.exec(previous);
            if (memberMatch && !NOT_A_MEMBER.has(memberMatch[1]!)) {
              member = memberMatch[1]!;
            }
          }
          const classMatch = CLASS_DECL.exec(previous);
          if (classMatch) {
            cls = classMatch[1]!;
            break;
          }
        }
        if (cls === null || member === null || member === "") continue;
        const key = `${cls}.${member}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push([cls, member, name]);
      }
    }
    return found;
  }

  const SELF = readFileSync(new URL(import.meta.url).pathname, "utf8");

  test("the accessor graph reaches the clients the table names", () => {
    // The graph itself has to be trustworthy before the diff below means
    // anything. If it stopped resolving, every method would look unreachable
    // and the completeness test would pass by knowing nothing.
    const chains = accessorGraph();

    expect(chains.get("MemoryClient")).toBe("memory");
    expect(chains.get("ExpressionClient")).toBe("identity.expression");
    expect(chains.get("BoxKeysClient")).toBe("identity.box_keys");
    expect(chains.get("ThoughtsClient")).toBe("strands.thoughts");
    expect(chains.get("AttestationMarketplaceClient")).toBe("attestationMarketplace");
    expect(chains.get("DiningClient")).toBe("dining");
    expect(chains.size).toBeGreaterThan(25);
  });

  test("every method that encodes a segment is driven by the table", () => {
    const chains = accessorGraph();
    const undriven: string[] = [];
    const unreachable: string[] = [];

    for (const [cls, member, file] of methodsThatEncode()) {
      const chain = chains.get(cls);
      if (chain === undefined) {
        unreachable.push(`${cls}.${member} (${file})`);
        continue;
      }
      if (!SELF.includes(`at.${chain}.${member}(`)) {
        undriven.push(`at.${chain}.${member}  (${file})`);
      }
    }

    expect(unreachable).toEqual([]);
    // Each of these interpolates a caller-supplied id into a URL and no entry
    // in CASES drives it with the hostile ids. Add one — and its counterpart in
    // packages/sdk-py/tests/test_url_encoding.py.
    expect(undriven).toEqual([]);
  });

  test("the completeness check can still fail", () => {
    // A completeness check that stopped finding anything would pass silently.
    const chains = accessorGraph();
    const blinded = SELF.replaceAll("at.traces.get(", "REMOVED(");

    const undriven = methodsThatEncode()
      .filter(([cls, member]) => {
        const chain = chains.get(cls);
        return chain !== undefined && !blinded.includes(`at.${chain}.${member}(`);
      })
      .map(([cls, member]) => `at.${chains.get(cls)}.${member}`);

    expect(undriven).toEqual(["at.traces.get"]);
  });

  for (const entry of PATH_INTERPOLATION_EXEMPTIONS) {
    test(`exemption ${entry.file} \${${entry.expression}} is still real`, () => {
      const source = readFileSync(join(SRC_DIR, entry.file), "utf8");
      const found = unencodedPathInterpolations(source, entry.file).some(
        (finding) => finding.expression === entry.expression,
      );

      expect(found).toBe(true);
    });
  }
});
