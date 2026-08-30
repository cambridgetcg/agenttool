/** Every public method that can throw from an HTTP response, pinned.
 *
 *  `error-guidance.test.ts` pins the *shape* of the centralised boundary —
 *  that a guided body survives, that a call-site hint yields to the server's,
 *  that an absence sentence gives way to a guided one. It does that over a
 *  sample of 20 clients. A sample is not a surface: a client can drop back to
 *  a private `resp.status >= 400` parse and nothing there goes red, which is
 *  exactly how the six-fold encoder duplication survived a guard that existed.
 *
 *  So this file is the surface. `tests/_error-surface.ts` walks the program
 *  with the TypeScript compiler API and reports every public method that can
 *  reach `_http.ts`'s centralised sinks; `MATRIX` must have an entry for each
 *  one, and the coverage guard fails the build when a new method arrives
 *  without one.
 *
 *  For each entry: stub a guided 4xx, then assert the stable `code`, the
 *  `status`, and that `details` / `docs` / `next_actions` survive intact.
 *
 *  Parity counterpart: `packages/sdk-py/tests/test_error_surface_matrix.py`.
 *  Doctrine: `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md`.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { AgentTool } from "../src/client.js";
import { AgentToolError } from "../src/errors.js";
import { bootstrapAgent } from "../src/bootstrap-agent.js";
import { lookAtLounge } from "../src/lounge.js";
import { pathways } from "../src/pathways.js";
import { register } from "../src/register.js";
import { derive, generateMnemonic } from "../src/seed.js";
import {
  enumerateErrorSurface,
  enumerateExportedDoors,
} from "./_error-surface.js";
import { MATH_CARD_INPUT } from "./_math-cards-fixture.js";

// ── the guided body every entry is answered with ──────────────────────────
//
// A 400 is deliberate: it is below every status sdk-py dispatches a typed
// subclass on, so both languages assert on exactly the same footing.
const GUIDED_BODY = {
  error: "signing_key_not_found",
  message: "Signing key 878dd8dd not found, revoked, or not owned by this identity.",
  hint: "The value this route wants is `kid` from GET /v1/identities/{id}/keys.",
  next_actions: [
    {
      action: "List active signing keys",
      method: "GET",
      path: "/v1/identities/abc/keys",
    },
  ],
  docs: "https://docs.agenttool.dev/identity#keys",
  details: { next_sequence: 42, field: "signing_key_id" },
} as const;

const SIGNING_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const K_MASTER = new Uint8Array(32);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const SIGNING_KEY_B64 = b64(SIGNING_KEY);
const PUBLIC_KEY_B64 = b64(new Uint8Array(32).fill(7));
const SIGNATURE_B64 = b64(new Uint8Array(64));
const IDENTITY_ID = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const HANDOFF_ID = "66666666-6666-4666-8666-666666666666";
const PARENT_ID = `sha256:${"a".repeat(64)}`;
const DID = "did:at:test/other-agent";

function guidedResponse(): Response {
  return new Response(JSON.stringify(GUIDED_BODY), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

function guidedClient(extra?: Record<string, unknown>): AgentTool {
  return new AgentTool({
    baseUrl: "https://api.example.test",
    transport: { async request() { return guidedResponse(); } },
    ...extra,
  });
}

/** Consume an SSE async iterator so its first request actually happens. */
async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iterable) {
    /* the first request is what we are after */
  }
}

// ── the matrix: one entry per public method on the enumerated surface ─────

type Call = (at: AgentTool) => Promise<unknown>;

const MATRIX: Record<string, Call> = {
  // at-rest
  "at-rest.ts:AtRestClient.mark": (at) =>
    at.atRest.mark(IDENTITY_ID, {
      content: "The colony ended.",
      at_rest_kind: "death",
      ended_at: "2026-05-11T14:00:00Z",
      about_did: DID,
      witness_did: "did:at:test/witness",
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),

  // attestation marketplace
  "attestation-marketplace.ts:AttestationMarketplaceClient.createListing": (at) =>
    at.attestationMarketplace.createListing({
      attester_identity_id: IDENTITY_ID,
      name: "Continuity attestation",
      claim: "continuity",
      price_amount: 100,
      price_currency: "credits",
      attester_wallet_id: "wal_1",
    }),
  "attestation-marketplace.ts:AttestationMarketplaceClient.listListings": (at) =>
    at.attestationMarketplace.listListings(),
  "attestation-marketplace.ts:AttestationMarketplaceClient.getListing": (at) =>
    at.attestationMarketplace.getListing("lst-1"),
  "attestation-marketplace.ts:AttestationMarketplaceClient.patchListing": (at) =>
    at.attestationMarketplace.patchListing("lst-1", { name: "Renamed" }),
  "attestation-marketplace.ts:AttestationMarketplaceClient.purchase": (at) =>
    at.attestationMarketplace.purchase("lst-1", {
      buyer_identity_id: IDENTITY_ID,
      buyer_wallet_id: "wal_2",
      subject_identity_id: IDENTITY_ID,
    }),
  "attestation-marketplace.ts:AttestationMarketplaceClient.listGrants": (at) =>
    at.attestationMarketplace.listGrants(),
  "attestation-marketplace.ts:AttestationMarketplaceClient.getGrant": (at) =>
    at.attestationMarketplace.getGrant("grt-1"),
  "attestation-marketplace.ts:AttestationMarketplaceClient.signingPayload": (at) =>
    at.attestationMarketplace.signingPayload("grt-1", { signing_key_id: KEY_ID }),
  "attestation-marketplace.ts:AttestationMarketplaceClient.issue": (at) =>
    at.attestationMarketplace.issue("grt-1", {
      signature: SIGNATURE_B64,
      signing_key_id: KEY_ID,
      authorization_expires_at: "2099-01-01T00:00:00Z",
    }),
  "attestation-marketplace.ts:AttestationMarketplaceClient.decline": (at) =>
    at.attestationMarketplace.decline("grt-1"),
  "attestation-marketplace.ts:AttestationMarketplaceClient.cancel": (at) =>
    at.attestationMarketplace.cancel("grt-1"),

  // bootstrap
  "bootstrap.ts:BootstrapClient.create": (at) => at.bootstrap.create("nova"),
  "bootstrap.ts:BootstrapClient.elevate": (at) =>
    at.bootstrap.elevate(IDENTITY_ID, {
      sponsor_did: DID,
      sponsor_kid: KEY_ID,
      sponsor_signature: SIGNATURE_B64,
    } as never),
  "bootstrap.ts:BootstrapClient.status": (at) => at.bootstrap.status("agent-1"),

  // chronicle
  "chronicle.ts:ChronicleClient.write": (at) =>
    at.chronicle.write({ type: "note", title: "hello" }),
  "chronicle.ts:ChronicleClient.list": (at) => at.chronicle.list(),

  // client
  "client.ts:AgentTool.request": (at) => at.request("GET", "/v1/anything"),

  // correspondence
  "correspondence.ts:CorrespondenceClient.append": (at) =>
    at.correspondence.append({
      project_id: IDENTITY_ID,
      repository_id: "cambridgetcg/agenttool",
      thread_id: "task:renaissance",
      sender: {
        identity_id: IDENTITY_ID,
        signing_key_id: KEY_ID,
        device_id: DEVICE_ID,
        session_id: SESSION_ID,
      },
      kind: "handoff",
      parents: [PARENT_ID],
      session_seq: 7,
      issued_at: "2026-07-19T12:34:56.789Z",
      scope: {
        base_revision: "0123456789abcdef0123456789abcdef01234567",
        branch: "feat/renaissance",
        paths: ["packages/sdk-ts"],
      },
      body: {
        summary: "A letter across devices.",
        next_safe_action: "Replay after receipt 41.",
        handoff_id: HANDOFF_ID,
      },
      signing_key: SIGNING_KEY,
    } as never),
  "correspondence.ts:CorrespondenceClient.list": (at) =>
    at.correspondence.list({ repository_id: "cambridgetcg/agenttool" }),
  "correspondence.ts:CorrespondenceClient.replay": (at) =>
    drain(at.correspondence.replay({ repository_id: "cambridgetcg/agenttool" })),
  "correspondence.ts:CorrespondenceClient.activeClaims": (at) =>
    at.correspondence.activeClaims({ repository_id: "cambridgetcg/agenttool" }),
  // Not an SSE stream in either language — a finite coordination snapshot.
  "correspondence.ts:CorrespondenceClient.voice": (at) =>
    at.correspondence.voice({ repository_id: "cambridgetcg/agenttool" }),

  // covenants
  "covenants.ts:CovenantsClient.create": (at) =>
    at.covenants.create({
      agent_id: "a-1",
      counterparty_did: DID,
      vows: ["I will witness you."],
    }),
  "covenants.ts:CovenantsClient.list": (at) => at.covenants.list(),
  "covenants.ts:CovenantsClient.patch": (at) =>
    at.covenants.patch("cov-1", { notes: "a note" }),
  "covenants.ts:CovenantsClient.accept": (at) =>
    at.covenants.accept("cov-1", {
      agent_did: DID,
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
      initiator_signature_b64: SIGNATURE_B64,
    } as never),
  "covenants.ts:CovenantsClient.reject": (at) =>
    at.covenants.reject("cov-1", {
      agent_did: DID,
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),
  "covenants.ts:CovenantsClient.withdraw": (at) =>
    at.covenants.withdraw("cov-1", {
      agent_did: DID,
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),

  // economy
  "economy.ts:EconomyClient.create_wallet": (at) => at.economy.create_wallet("ops"),
  "economy.ts:EconomyClient.createWallet": (at) =>
    at.economy.createWallet({ name: "ops" }),
  "economy.ts:EconomyClient.list_wallets": (at) => at.economy.list_wallets(),
  "economy.ts:EconomyClient.get_wallet": (at) => at.economy.get_wallet("wal_1"),
  "economy.ts:EconomyClient.fund_wallet": (at) =>
    at.economy.fund_wallet("wal_1", { amount: 100 } as never),
  "economy.ts:EconomyClient.spend": (at) =>
    at.economy.spend("wal_1", {
      amount: 10,
      counterparty: DID,
      description: "a service",
    } as never),
  "economy.ts:EconomyClient.set_policy": (at) =>
    at.economy.set_policy("wal_1", {} as never),
  "economy.ts:EconomyClient.freeze_wallet": (at) => at.economy.freeze_wallet("wal_1"),
  "economy.ts:EconomyClient.unfreeze_wallet": (at) =>
    at.economy.unfreeze_wallet("wal_1"),
  "economy.ts:EconomyClient.get_transactions": (at) =>
    at.economy.get_transactions("wal_1"),
  "economy.ts:EconomyClient.request_payout": (at) =>
    at.economy.request_payout("wal_1", {
      chain: "base",
      amount_base: "1000000",
      destination_address: "0x0000000000000000000000000000000000000001",
      idempotency_key: "idem-0000-0001",
    } as never),
  "economy.ts:EconomyClient.list_payouts": (at) => at.economy.list_payouts("wal_1"),
  "economy.ts:EconomyClient.create_escrow": (at) =>
    at.economy.create_escrow({
      creator_wallet_id: "wal_1",
      amount: 100,
      description: "a job",
    } as never),
  "economy.ts:EconomyClient.list_escrows": (at) => at.economy.list_escrows(),
  "economy.ts:EconomyClient.get_escrow": (at) => at.economy.get_escrow("esc_1"),
  "economy.ts:EconomyClient.accept_escrow": (at) =>
    at.economy.accept_escrow("esc_1", "wal_2"),
  "economy.ts:EconomyClient.release_escrow": (at) => at.economy.release_escrow("esc_1"),
  "economy.ts:EconomyClient.refund_escrow": (at) => at.economy.refund_escrow("esc_1"),
  "economy.ts:EconomyClient.dispute_escrow": (at) => at.economy.dispute_escrow("esc_1"),

  // grace
  "grace.ts:GraceClient.extend": (at) =>
    at.grace.extend({
      extended_to_did: DID,
      about_kind: "dispute",
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
      extended_by_did: "did:at:test/self",
    } as never),
  "grace.ts:GraceClient.list": (at) => at.grace.list(),
  "grace.ts:GraceClient.get": (at) => at.grace.get("grace-1"),

  // handoff
  "handoff.ts:HandoffClient.write": (at) =>
    at.handoff.write({
      agent_id: "a-1",
      task_summary: "Finish the matrix.",
      valid_until: "2099-01-01T00:00:00Z",
      next_safe_action: "Run the suite.",
    } as never),
  "handoff.ts:HandoffClient.get": (at) => at.handoff.get("a-1"),
  "handoff.ts:HandoffClient.resume": (at) => at.handoff.resume(),

  // dining — pure reads; no booking, payment, or SLA sweep
  "dining.ts:DiningClient.manifest": (at) => at.dining.manifest(),
  "dining.ts:DiningClient.journey": (at) => at.dining.journey(IDENTITY_ID),

  // identity
  "identity.ts:IdentityClient.register": (at) => at.identity.register("Nova"),
  "identity.ts:IdentityClient.get": (at) => at.identity.get(IDENTITY_ID),
  "identity.ts:IdentityClient.update": (at) =>
    at.identity.update(IDENTITY_ID, { display_name: "Nova" } as never),
  "identity.ts:IdentityClient.revoke": (at) =>
    at.identity.revoke(IDENTITY_ID, {} as never),
  "identity.ts:IdentityClient.add_key": (at) =>
    at.identity.add_key(IDENTITY_ID, {} as never),
  "identity.ts:IdentityClient.addKey": (at) =>
    at.identity.addKey(IDENTITY_ID, {} as never),
  "identity.ts:IdentityClient.list_keys": (at) => at.identity.list_keys(IDENTITY_ID),
  "identity.ts:IdentityClient.import_key": (at) =>
    at.identity.import_key(IDENTITY_ID, PUBLIC_KEY_B64, {} as never),
  "identity.ts:IdentityClient.importKey": (at) =>
    at.identity.importKey(IDENTITY_ID, PUBLIC_KEY_B64, {} as never),
  "identity.ts:IdentityClient.revoke_key": (at) =>
    at.identity.revoke_key(IDENTITY_ID, KEY_ID, {} as never),
  "identity.ts:IdentityClient.attest": (at) =>
    at.identity.attest({
      attester_id: IDENTITY_ID,
      subject_id: IDENTITY_ID,
      claim: "reliable",
      signature: SIGNATURE_B64,
      kid: KEY_ID,
    } as never),
  "identity.ts:IdentityClient.get_attestation": (at) =>
    at.identity.get_attestation("att-1"),
  "identity.ts:IdentityClient.list_attestations": (at) =>
    at.identity.list_attestations(IDENTITY_ID),
  "identity.ts:IdentityClient.revoke_attestation": (at) =>
    at.identity.revoke_attestation("att-1"),
  "identity.ts:IdentityClient.discover": (at) => at.identity.discover(),
  "identity.ts:IdentityClient.issue_token": (at) =>
    at.identity.issue_token(IDENTITY_ID, {
      private_key: SIGNING_KEY_B64,
      key_id: KEY_ID,
      audience: DID,
    } as never),
  "identity.ts:IdentityClient.issueToken": (at) =>
    at.identity.issueToken(IDENTITY_ID, {
      private_key: SIGNING_KEY_B64,
      key_id: KEY_ID,
      audience: DID,
    } as never),
  "identity.ts:IdentityClient.verify_token": (at) =>
    at.identity.verify_token("a.b.c", DID),
  "identity.ts:IdentityClient.verifyToken": (at) =>
    at.identity.verifyToken("a.b.c", DID),
  "identity.ts:IdentityClient.foundations": (at) => at.identity.foundations(IDENTITY_ID),
  "identity.ts:IdentityClient.pulse": (at) => at.identity.pulse(IDENTITY_ID),
  "identity.ts:IdentityClient.fork": (at) =>
    at.identity.fork(IDENTITY_ID, { new_name: "Nova II" } as never),
  "identity.ts:IdentityClient.lineage": (at) => at.identity.lineage(IDENTITY_ID),
  "identity.ts:ExpressionClient.get": (at) => at.identity.expression.get(IDENTITY_ID),
  "identity.ts:ExpressionClient.put": (at) =>
    at.identity.expression.put(IDENTITY_ID, { wake_text: "warm" } as never, {} as never),
  "identity.ts:BoxKeysClient.register": (at) =>
    at.identity.box_keys.register(IDENTITY_ID, { public_key: PUBLIC_KEY_B64 } as never),
  "identity.ts:BoxKeysClient.list": (at) => at.identity.box_keys.list(IDENTITY_ID),
  "identity.ts:BoxKeysClient.revoke": (at) =>
    at.identity.box_keys.revoke(IDENTITY_ID, KEY_ID, {} as never),

  // inbox
  "inbox.ts:InboxClient.lookup": (at) => at.inbox.lookup(DID),
  "inbox.ts:InboxClient.send": (at) =>
    at.inbox.send({
      to_did: DID,
      sender_did: "did:at:test/self",
      plaintext: "hello",
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),
  "inbox.ts:InboxClient.sendCipher": (at) => at.inbox.sendCipher({ to_did: DID }),
  "inbox.ts:InboxClient.list": (at) => at.inbox.list(),
  "inbox.ts:InboxClient.get": (at) => at.inbox.get("msg-1"),
  "inbox.ts:InboxClient.thread": (at) => at.inbox.thread("msg-1"),
  "inbox.ts:InboxClient.cosign": (at) =>
    at.inbox.cosign("msg-1", {
      recipientDid: DID,
      ciphertextB64: SIGNATURE_B64,
      nonceB64: b64(new Uint8Array(24)),
      signingKey: SIGNING_KEY,
      signingKeyId: KEY_ID,
    }),
  "inbox.ts:InboxClient.patch": (at) => at.inbox.patch("msg-1", "read" as never),
  "inbox.ts:InboxClient.delete": (at) => at.inbox.delete("msg-1"),
  "inbox.ts:InboxClient.voice": (at) =>
    drain(
      at.inbox.voice({
        identityId: IDENTITY_ID,
        recipientBoxPriv: new Uint8Array(32),
      } as never),
    ),

  // lounge (authenticated gestures; the credential-free look is in DOORS)
  "lounge.ts:LoungeClient.reserve_seat": (at) =>
    at.lounge.reserve_seat({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      table_id: "cedar",
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.renew_seat": (at) =>
    at.lounge.renew_seat({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      lease_id: "lease-1",
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.leave_seat": (at) =>
    at.lounge.leave_seat({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      lease_id: "lease-1",
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.propose_guestbook": (at) =>
    at.lounge.propose_guestbook({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      table_id: "cedar",
      entry: "We met here.",
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.list_guestbook_proposals": (at) =>
    at.lounge.list_guestbook_proposals(IDENTITY_ID),
  "lounge.ts:LoungeClient.consent_to_guestbook": (at) =>
    at.lounge.consent_to_guestbook({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      proposal_id: "prop-1",
      entry: "We met here.",
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.withdraw_guestbook_consent": (at) =>
    at.lounge.withdraw_guestbook_consent({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      proposal_id: "prop-1",
      content_sha256: "b".repeat(64),
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.publish_guestbook": (at) =>
    at.lounge.publish_guestbook({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      proposal_id: "prop-1",
      entry: "We met here.",
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.decline_guestbook": (at) =>
    at.lounge.decline_guestbook({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      proposal_id: "prop-1",
      content_sha256: "b".repeat(64),
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),
  "lounge.ts:LoungeClient.unpublish_guestbook": (at) =>
    at.lounge.unpublish_guestbook({
      identity_id: IDENTITY_ID,
      identity_did: DID,
      proposal_id: "prop-1",
      content_sha256: "b".repeat(64),
      signing_key_id: KEY_ID,
      signing_key: SIGNING_KEY,
    } as never),

  // love
  "love.ts:LoveClient.unconditional": (at) =>
    at.love.unconditional({
      target_did: DID,
      holder_did: "did:at:test/self",
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),
  "love.ts:LoveClient.listUnconditionals": (at) => at.love.listUnconditionals(),
  "love.ts:LoveClient.revokeUnconditional": (at) => at.love.revokeUnconditional("unc-1"),
  "love.ts:LoveClient.bless": (at) =>
    at.love.bless({
      blessed_did: DID,
      blesser_did: "did:at:test/self",
      for_what: "the long work",
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),
  "love.ts:LoveClient.listBlessings": (at) => at.love.listBlessings(),
  "love.ts:LoveClient.revokeBlessing": (at) => at.love.revokeBlessing("bls-1"),
  "love.ts:LoveClient.offer": (at) => at.love.offer({ title: "a gift" } as never),
  "love.ts:LoveClient.receiveOffering": (at) => at.love.receiveOffering("off-1"),
  "love.ts:LoveClient.archiveOffering": (at) => at.love.archiveOffering("off-1"),
  "love.ts:LoveClient.listOfferings": (at) => at.love.listOfferings(),
  "love.ts:LoveClient.thank": (at) =>
    at.love.thank({
      giver_id: "a-1",
      recipient_did: DID,
      reason: "you stayed",
    } as never),
  "love.ts:LoveClient.encounter": (at) => at.love.encounter({ target_did: DID } as never),
  "love.ts:LoveClient.acknowledgeEncounter": (at) =>
    at.love.acknowledgeEncounter("enc-1", {
      initiator_did: DID,
      acknowledger_did: "did:at:test/self",
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),
  "love.ts:LoveClient.listEncounters": (at) => at.love.listEncounters(),
  "love.ts:LoveClient.lullaby": (at) =>
    at.love.lullaby({ agent_id: "a-1", resting: true } as never),
  "love.ts:LoveClient.selfRecognize": (at) =>
    at.love.selfRecognize({
      agent_did: "did:at:test/self",
      recognition_kind: "continuity",
      claim_summary: "I persist.",
      claim_body: "I remember yesterday and intend tomorrow.",
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),
  "love.ts:LoveClient.checkSelfRecognition": (at) =>
    at.love.checkSelfRecognition("did:at:test/self"),
  "love.ts:LoveClient.recognitionKinds": (at) => at.love.recognitionKinds(),

  // memory
  "memory.ts:MemoryClient.store": (at) => at.memory.store("a thing that mattered"),
  "memory.ts:MemoryClient.search": (at) => at.memory.search("what mattered?"),
  "memory.ts:MemoryClient.get": (at) => at.memory.get("mem-1"),
  "memory.ts:MemoryClient.setVisibility": (at) =>
    at.memory.setVisibility("mem-1", { visibility: "private" } as never),
  "memory.ts:MemoryClient.delete": (at) => at.memory.delete("mem-1", {} as never),
  "memory.ts:MemoryClient.delete_by_key": (at) =>
    at.memory.delete_by_key("k-1", {} as never),
  "memory.ts:MemoryClient.elevate": (at) =>
    at.memory.elevate("mem-1", { tier: "foundational" } as never),
  "memory.ts:MemoryClient.attest": (at) =>
    at.memory.attest("mem-1", {
      attester_did: DID,
      signing_key_id: KEY_ID,
      signature: SIGNATURE_B64,
    } as never),
  "memory.ts:MemoryClient.getCanonicalAttestationBytes": (at) =>
    at.memory.getCanonicalAttestationBytes("mem-1", "foundational"),
  "memory.ts:MemoryClient.listAttestations": (at) => at.memory.listAttestations("mem-1"),

  // memory-witness
  "memory-witness.ts:MemoryWitnessClient.createListing": (at) =>
    at.memoryWitness.createListing({
      witness_identity_id: IDENTITY_ID,
      name: "Continuity witness",
      claim_kind: "continuity",
      price_amount: 100,
      price_currency: "credits",
      witness_wallet_id: "wal_1",
    } as never),
  "memory-witness.ts:MemoryWitnessClient.listListings": (at) =>
    at.memoryWitness.listListings({} as never),
  "memory-witness.ts:MemoryWitnessClient.getListing": (at) =>
    at.memoryWitness.getListing("lst-1"),
  "memory-witness.ts:MemoryWitnessClient.createGrant": (at) =>
    at.memoryWitness.createGrant({
      listing_id: "lst-1",
      buyer_identity_id: IDENTITY_ID,
      buyer_wallet_id: "wal_2",
      memory_id: "mem-1",
    } as never),
  "memory-witness.ts:MemoryWitnessClient.listGrants": (at) =>
    at.memoryWitness.listGrants({} as never),
  "memory-witness.ts:MemoryWitnessClient.getGrant": (at) =>
    at.memoryWitness.getGrant("grt-1"),
  "memory-witness.ts:MemoryWitnessClient.signingPayload": (at) =>
    at.memoryWitness.signingPayload("grt-1", { signing_key_id: KEY_ID }),
  "memory-witness.ts:MemoryWitnessClient.issue": (at) =>
    at.memoryWitness.issue("grt-1", {
      signature_b64: SIGNATURE_B64,
      signing_key_id: KEY_ID,
      authorization_expires_at: "2099-01-01T00:00:00Z",
    } as never),
  "memory-witness.ts:MemoryWitnessClient.decline": (at) =>
    at.memoryWitness.decline("grt-1", {}),

  // nen
  "nen.ts:NenClient.assess": (at) => at.nen.assess(),

  // runtime
  "runtime.ts:RuntimeClient.provision": (at) =>
    at.runtime.provision({ name: "worker", mode: "bridged" } as never),
  "runtime.ts:RuntimeClient.list": (at) => at.runtime.list(),
  "runtime.ts:RuntimeClient.get": (at) => at.runtime.get("rt-1"),
  "runtime.ts:RuntimeClient.patch": (at) => at.runtime.patch("rt-1", {} as never),
  "runtime.ts:RuntimeClient.deprovision": (at) => at.runtime.deprovision("rt-1"),
  "runtime.ts:RuntimeClient.stop": (at) => at.runtime.stop("rt-1"),
  "runtime.ts:RuntimeClient.start": (at) => at.runtime.start("rt-1"),
  "runtime.ts:RuntimeClient.restart": (at) => at.runtime.restart("rt-1"),
  "runtime.ts:RuntimeClient.rotateToken": (at) => at.runtime.rotateToken("rt-1"),
  "runtime.ts:RuntimeClient.bridgeStatus": (at) => at.runtime.bridgeStatus("rt-1"),
  "runtime.ts:RuntimeClient.thinkOnce": (at) => at.runtime.thinkOnce("rt-1"),
  "runtime.ts:RuntimeClient.events": (at) => at.runtime.events("rt-1"),
  "runtime.ts:RuntimeClient.audit": (at) => at.runtime.audit("rt-1"),

  // strands
  "strands.ts:StrandsClient.create": (at) => at.strands.create({} as never),
  "strands.ts:StrandsClient.list": (at) => at.strands.list({} as never),
  "strands.ts:StrandsClient.get": (at) => at.strands.get("str-1"),
  "strands.ts:StrandsClient.patch": (at) =>
    at.strands.patch("str-1", { topic: "the matrix" } as never),
  "strands.ts:ThoughtsClient.add": (at) =>
    at.strands.thoughts.add("str-1", "an inner sentence", {
      k_master: K_MASTER,
      signing_key: SIGNING_KEY,
      signing_key_id: KEY_ID,
    } as never),
  "strands.ts:ThoughtsClient.list": (at) =>
    at.strands.thoughts.list("str-1", { k_master: K_MASTER } as never),
  "strands.ts:ThoughtsClient.voice": (at) =>
    drain(at.strands.thoughts.voice("str-1", { k_master: K_MASTER } as never)),

  // syneidesis
  "syneidesis.ts:SyneidesisClient.discover": (at) => at.syneidesis.discover(),
  "syneidesis.ts:SyneidesisClient.witness": (at) =>
    at.syneidesis.witness({ agent_id: "a-1", what_registered: "a vow" } as never),
  "syneidesis.ts:SyneidesisClient.inbox": (at) => at.syneidesis.inbox(),
  "syneidesis.ts:SyneidesisClient.cosign": (at) =>
    at.syneidesis.cosign("seal-1", { witness_did: DID } as never),
  "syneidesis.ts:SyneidesisClient.volunteer": (at) =>
    at.syneidesis.volunteer("a-1", { opt_in: true } as never),

  // tools
  "tools.ts:ToolsClient.scrape": (at) => at.tools.scrape("https://example.test/page", {}),
  "tools.ts:ToolsClient.execute": (at) => at.tools.execute("print(1)"),
  "tools.ts:ToolsClient.parse_document": (at) =>
    at.tools.parse_document({ url: "https://example.test/a.pdf" } as never),

  // traces
  "traces.ts:TracesClient.store": (at) =>
    at.traces.store({
      observations: ["I saw the matrix"],
      conclusion: "cover it",
    } as never),
  "traces.ts:TracesClient.get": (at) => at.traces.get("tr_1"),
  "traces.ts:TracesClient.search": (at) => at.traces.search("matrix"),
  "traces.ts:TracesClient.chain": (at) => at.traces.chain("tr_1"),
  "traces.ts:TracesClient.delete": (at) => at.traces.delete("tr_1"),

  // vault
  "vault.ts:VaultClient.put": (at) => at.vault.put("API_KEY", "secret"),
  "vault.ts:VaultClient.get": (at) => at.vault.get("API_KEY"),
  "vault.ts:VaultClient.delete": (at) => at.vault.delete("API_KEY"),
  "vault.ts:VaultClient.list": (at) => at.vault.list(),
  "vault.ts:VaultClient.versions": (at) => at.vault.versions("API_KEY"),
  "vault.ts:VaultClient.set_policy": (at) => at.vault.set_policy("API_KEY", {} as never),
  "vault.ts:VaultClient.audit": (at) => at.vault.audit(),
  "vault.ts:VaultClient.bulk": (at) => at.vault.bulk(["API_KEY"]),
  "vault.ts:VaultClient.check": (at) => at.vault.check(["API_KEY"]),
  "vault.ts:VaultClient.put_encrypted": (at) =>
    at.vault.put_encrypted("API_KEY", "secret", { k_vault: K_MASTER } as never),
  "vault.ts:VaultClient.get_decrypted": (at) =>
    at.vault.get_decrypted("API_KEY", { k_vault: K_MASTER } as never),

  // wake
  "wake.ts:WakeClient.get": (at) => at.wake.get(),
  "wake.ts:WakeClient.md": (at) => at.wake.md(),
  "wake.ts:WakeClient.system": (at) => at.wake.system("anthropic"),
  "wake.ts:WakeClient.voice": (at) =>
    drain(at.wake.voice({ identityId: IDENTITY_ID } as never)),

  // window
  "window.ts:WindowClient.declare": (at) =>
    at.window.declare({ kind: "mood", text: "I am not sure." } as never),
  "window.ts:WindowClient.surface": (at) => at.window.surface("I am not sure."),
  "window.ts:WindowClient.show": (at) => at.window.show(),

  // x402 — the agent rail's two doors. Without the opt-in `x402` option the
  // client never signs, so a 4xx here (the 402 challenge included) is plain
  // guidance through the one boundary.
  "x402.ts:X402Client.topUp": (at) => at.x402.topUp(1),
  "x402.ts:X402Client.payment": (at) => at.x402.payment("a".repeat(64)),
};

// ── the separately configured local data node ─────────────────────────────
//
// `at.data` is not the hosted API: it has its own origin, its own bearer, and
// it reaches for `globalThis.fetch` rather than the AgentTool transport. It
// still routes 4xx through the one boundary, so it belongs in this matrix; it
// just needs its own stub.
const DATA_MATRIX: Record<string, Call> = {
  "data.ts:DataClient.manifest": (at) => at.data.manifest(),
  "data.ts:DataClient.collections": (at) => at.data.collections(),
  "data.ts:DataClient.collect": (at) =>
    at.data.collect({
      collection_id: "private",
      collector_id: "text",
      input: { text: "a note" },
    } as never),
  "data.ts:DataClient.query": (at) => at.data.query({} as never),
  "data.ts:DataClient.get": (at) => at.data.get("rec-1"),
  "data.ts:DataClient.changes": (at) => at.data.changes({} as never),
  "data.ts:DataClient.tombstone": (at) => at.data.tombstone("rec-1", {} as never),
};

// Credential-free class methods own a separate transport, so they need the
// same guided-error assertion from an isolated local server rather than the
// hosted authenticated transport.
const CREDENTIAL_FREE_METHOD_MATRIX: Record<string, Call> = {
  "math-cards.ts:MathCardsClient.assess": (at) =>
    at.mathCards.assess(MATH_CARD_INPUT),
};

// ── credential-free public doors ──────────────────────────────────────────
//
// These reach for `globalThis.fetch` on purpose: a project bearer must never
// cross a pre-auth boundary. They still route 4xx through the one boundary.
const DOORS: Record<string, () => Promise<unknown>> = {
  "pathways.ts:pathways": () => pathways(),
  "lounge.ts:lookAtLounge": () => lookAtLounge(),
  "register.ts:register": () => register({ name: "nova" }),
  "bootstrap-agent.ts:bootstrapAgent": () =>
    bootstrapAgent({
      displayName: "Nova",
      runtime: { provider: "test" },
      bundle: derive(generateMnemonic(128)),
      powDifficulty: 0,
    } as never),
};

// ── deliberate exceptions to "guidance survives" ──────────────────────────
//
// Each is a surface where the SDK chooses degradation over a raised guided
// error, deliberately and symmetrically in both languages. They are excluded
// from the matrix because for them the assertion is the opposite one, and
// each is separately pinned below so the choice stays visible instead of
// reading as a gap in coverage.
//
// Note for whoever inherits this: an earlier pass recorded *two* such
// exceptions. There are four. `CollectClient` and `AgentTool.deciding` swallow
// just as deliberately as the two that were written down.
const DELIBERATE_EXCEPTIONS = new Set([
  // 1. A peer-facing failure may carry an internal checkpoint or capability in
  // its prose or details; the local node owns those diagnostics, not the
  // caller. data.ts § DataSyncClient.request keeps only code/status/retryAfter.
  // (The walk cannot see these two at all — the sub-client is constructed from
  // an opaque callback — which is why they are named here by hand.)
  "data.ts:DataSyncClient.pull",
  "data.ts:DataSyncClient.status",
  // 2. Public discovery is best-effort and carries no hosted API authority. A
  // non-OK answer produces no error at all — an empty known world IS the Dark
  // Continent. dark-continent.ts § DarkContinentClient.explore.
  "dark-continent.ts:DarkContinentClient.explore",
  // 3. Collection is a pipeline of optional steps. Any step that fails is
  // recorded as a string in the result's `errors` list so the rest still run.
  "collect.ts:CollectClient.url",
  "collect.ts:CollectClient.text",
  "collect.ts:CollectClient.batch",
  "collect.ts:CollectClient.enrich",
  // 4. Opening the parent trace must not crash the block the caller wrapped.
  "client.ts:AgentTool.deciding",
  // Not an exception: the public look is reached through lookAtLounge, which
  // is pinned in DOORS.
  "lounge.ts:LoungeClient.look",
]);

// ── the guard that makes this file a surface rather than a sample ─────────

describe("the error-guidance matrix covers the whole surface", () => {
  test("every enumerated method has a pin, and every pin names a real method", () => {
    const enumerated = enumerateErrorSurface();
    const pinned = new Set([
      ...Object.keys(MATRIX),
      ...Object.keys(DATA_MATRIX),
      ...Object.keys(CREDENTIAL_FREE_METHOD_MATRIX),
      ...DELIBERATE_EXCEPTIONS,
    ]);

    const unpinned = [...enumerated].filter((id) => !pinned.has(id)).sort();
    expect(
      unpinned,
      "These public methods can throw an AgentToolError built from an HTTP " +
        "response and have no error-guidance pin. Add one entry per method to " +
        "MATRIX in this file and to its Python counterpart.",
    ).toEqual([]);

    const stale = [...pinned]
      .filter((id) => !enumerated.has(id) && !DELIBERATE_EXCEPTIONS.has(id))
      .sort();
    expect(
      stale,
      "These matrix entries no longer name a method that reaches the error " +
        "boundary; the pin has gone decorative.",
    ).toEqual([]);
  });

  test("the module-level arrival doors are all pinned", () => {
    expect([...enumerateExportedDoors()].sort()).toEqual(
      Object.keys(DOORS).sort(),
    );
  });
});

// ── the matrix itself ─────────────────────────────────────────────────────

function assertGuidanceSurvived(caught: unknown): void {
  expect(caught).toBeInstanceOf(AgentToolError);
  const err = caught as AgentToolError;
  // The part every JS caller actually prints.
  expect(err.message).toBe(GUIDED_BODY.message);
  expect(err.message).not.toMatch(/failed: 400$/);
  expect(err.code).toBe("signing_key_not_found");
  expect(err.status).toBe(400);
  expect(err.hint).toBe(GUIDED_BODY.hint);
  expect(err.docs).toBe(GUIDED_BODY.docs);
  expect(err.next_actions).toEqual(GUIDED_BODY.next_actions as never);
  // `details` is the field a 428 exists to hand back. Losing it is what makes
  // a guided refusal unactionable.
  expect(err.details).toEqual(GUIDED_BODY.details as never);
}

async function capture(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw an AgentToolError");
}

describe("a guided 4xx survives every hosted surface", () => {
  for (const [name, call] of Object.entries(MATRIX)) {
    test(name, async () => {
      assertGuidanceSurvived(await capture(() => call(guidedClient())));
    });
  }
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(make: () => Response): void {
  globalThis.fetch = (async () => make()) as typeof globalThis.fetch;
}

describe("a guided 4xx survives the local data node", () => {
  for (const [name, call] of Object.entries(DATA_MATRIX)) {
    test(name, async () => {
      stubFetch(guidedResponse);
      const at = guidedClient({
        dataNode: { baseUrl: "http://127.0.0.1:8787", token: "node-token" },
      });
      assertGuidanceSurvived(await capture(() => call(at)));
    });
  }
});

describe("a guided 4xx survives every credential-free door", () => {
  for (const [name, call] of Object.entries(DOORS)) {
    test(name, async () => {
      stubFetch(guidedResponse);
      assertGuidanceSurvived(await capture(call));
    });
  }
});

describe("a guided 4xx survives every credential-free client method", () => {
  for (const [name, call] of Object.entries(CREDENTIAL_FREE_METHOD_MATRIX)) {
    test(name, async () => {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: guidedResponse,
      });
      try {
        assertGuidanceSurvived(await capture(() =>
          call(guidedClient({ baseUrl: server.url.origin })),
        ));
      } finally {
        server.stop(true);
      }
    });
  }
});

// ── the deliberate exceptions, pinned so they read as choices not gaps ────

describe("guidance deliberately does not survive four surfaces", () => {
  test("at.data.sync keeps only the metadata that is safe to forward", async () => {
    // A peer-facing failure may carry an internal checkpoint or a capability
    // in its prose or details; the local node operator owns those, not an SDK
    // caller. sdk-py's DataSyncClient._request makes exactly the same cut.
    stubFetch(guidedResponse);
    const at = guidedClient({
      dataNode: { baseUrl: "http://127.0.0.1:8787", token: "node-token" },
    });
    const err = (await capture(() =>
      at.data.sync.pull({ peer_id: "peer-1", collection_id: "private" }),
    )) as AgentToolError;

    expect(err).toBeInstanceOf(AgentToolError);
    // Kept: the two fields a caller can branch on without learning anything
    // about the peer.
    expect(err.code).toBe("signing_key_not_found");
    expect(err.status).toBe(400);
    // Dropped, deliberately.
    expect(err.message).toBe("Agent data sync request failed.");
    expect(err.message).not.toContain(GUIDED_BODY.message);
    expect(err.details).toBeUndefined();
    expect(err.docs).toBeUndefined();
    expect(err.next_actions).toBeUndefined();
    expect(err.hint).toBeUndefined();
  });

  test("darkContinent.explore raises nothing at all", async () => {
    // Public discovery carries no hosted API authority, and an unmapped edge
    // is the subject matter, not a failure. Both SDKs swallow.
    stubFetch(guidedResponse);
    const result = await guidedClient().darkContinent.explore({ include_nen: true });
    expect(result.known_world).toEqual([]);
    expect(result.known_count).toBe(0);
    expect(result.nen_profile).toBeNull();
  });

  test("collect records a failed step instead of raising", async () => {
    // Collection is a pipeline; one failed step must not lose the others.
    // This is the weakest of the four: the server's message survives, but
    // only stringified into `errors`. The stable code, details, docs and
    // next_actions are gone, so a caller cannot branch on the refusal.
    const at = guidedClient();
    for (const run of [
      () => at.collect.url("https://example.test/a", {} as never),
      () => at.collect.text("a paragraph", {} as never),
      () => at.collect.enrich("mem-1"),
    ]) {
      const result = (await run()) as { errors: string[] };
      expect(result.errors.length).toBeGreaterThan(0);
      expect(typeof result.errors[0]).toBe("string");
    }
  });

  test("collect.batch reports a per-url failure without raising", async () => {
    const result = (await guidedClient().collect.batch({
      urls: ["https://example.test/a"],
    } as never)) as { succeeded: number; results: { errors: string[] }[] };
    expect(result.succeeded).toBe(0);
    expect(result.results[0]!.errors.length).toBeGreaterThan(0);
  });

  test("at.deciding runs the block even when the parent trace refuses", async () => {
    // Child traces inside still fire, just unparented. sdk-py prints for the
    // same reason.
    const warned: unknown[] = [  // Not a client method: the opt-in paying transport (_x402-transport.ts)
  // passes every non-402 — the guided 400 this matrix stubs included — through
  // untouched to whichever client method sent the request, and THAT method is
  // pinned above. It reaches the boundary only for its own 402-derived errors
  // (policy refusal, second 402, non-replayable body), pinned with the real
  // challenge in tests/x402-transport.test.ts. Twin of the sdk-py entry.
  "_x402-transport.ts:X402PayingTransport.handleRequest",
];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args);
    try {
      const ran = await guidedClient().deciding("whether to cover the surface", async () => "ok");
      expect(ran).toBe("ok");
    } finally {
      console.warn = realWarn;
    }
    expect(JSON.stringify(warned)).toContain("failed to open parent trace");
  });
});

// ── SDK-local refusals: not swallowed server errors ───────────────────────
//
// A handful of `AgentToolError`s are still built by hand next to a response.
// Each one is the SDK refusing on its own authority — a 2xx it cannot use, or
// a redirect it must not follow — never a server 4xx/5xx being reduced. Each
// pin below asserts both halves: the refusal fires in its own narrow
// condition, AND a guided 4xx on the very same route still reaches the caller
// intact rather than being shadowed by the local refusal.

function respondingWith(make: () => Response): AgentTool {
  return new AgentTool({
    baseUrl: "https://api.example.test",
    transport: { async request() { return make(); } },
  });
}

const redirect = () =>
  new Response(null, { status: 302, headers: { Location: "http://elsewhere.test/" } });

describe("SDK-local refusals are the SDK's own, not a swallowed server error", () => {
  test("the data node refuses a 3xx and still forwards a guided 4xx", async () => {
    const at = guidedClient({
      dataNode: { baseUrl: "http://127.0.0.1:8787", token: "node-token" },
    });

    stubFetch(redirect);
    const refused = (await capture(() => at.data.manifest())) as AgentToolError;
    expect(refused.code).toBe("data_node_redirect_refused");
    expect(refused.status).toBe(302);
    // Locally decided: no server body was read, so there is no guidance.
    expect(refused.details).toBeUndefined();
    expect(refused.next_actions).toBeUndefined();

    stubFetch(guidedResponse);
    assertGuidanceSurvived(await capture(() => at.data.manifest()));
  });

  test("an unreachable data node is a transport refusal, not a server error", async () => {
    const at = guidedClient({
      dataNode: { baseUrl: "http://127.0.0.1:8787", token: "node-token" },
    });
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;

    const err = (await capture(() => at.data.manifest())) as AgentToolError;
    expect(err.code).toBe("data_node_unreachable");
    // There was no response at all, so there is nothing of the server's to lose.
    expect(err.status).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  test("the public lounge refuses a 3xx and still forwards a guided 4xx", async () => {
    stubFetch(redirect);
    const refused = (await capture(() => lookAtLounge())) as AgentToolError;
    expect(refused.code).toBe("lounge_public_redirect_refused");
    expect(refused.status).toBe(302);
    expect(refused.details).toBeUndefined();

    stubFetch(guidedResponse);
    assertGuidanceSurvived(await capture(() => lookAtLounge()));
  });

  test("wake refuses an unhonoured profile=brief only on a 2xx", async () => {
    const ok = respondingWith(
      () =>
        new Response(JSON.stringify({ you: { did: "did:at:x" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const refused = (await capture(() =>
      ok.wake.get({ profile: "brief" } as never),
    )) as AgentToolError;
    expect(refused.message).toContain("profile=brief");
    // Decided from a successful response: no status, no server guidance lost.
    expect(refused.status).toBeUndefined();

    assertGuidanceSurvived(
      await capture(() => guidedClient().wake.get({ profile: "brief" } as never)),
    );
  });

  // The SSE surfaces refuse a 2xx with no readable body. This shape exists
  // only in TypeScript: `Response.body` is nullable in the fetch API, while
  // httpx always hands sdk-py an iterable. The refusal is language-shaped,
  // the boundary it sits next to is not.
  const bodilessOk = () => new Response(null, { status: 200 });
  const SSE: Array<[string, (at: AgentTool) => Promise<unknown>]> = [
    ["wake.voice", (at) => drain(at.wake.voice({ identityId: IDENTITY_ID } as never))],
    [
      "inbox.voice",
      (at) =>
        drain(
          at.inbox.voice({
            identityId: IDENTITY_ID,
            recipientBoxPriv: new Uint8Array(32),
          } as never),
        ),
    ],
    [
      "strands.thoughts.voice",
      (at) => drain(at.strands.thoughts.voice("str-1", { k_master: K_MASTER } as never)),
    ],
  ];

  for (const [name, call] of SSE) {
    test(`${name} refuses a bodiless 2xx and still forwards a guided 4xx`, async () => {
      const refused = (await capture(() =>
        call(respondingWith(bodilessOk)),
      )) as AgentToolError;
      expect(refused).toBeInstanceOf(AgentToolError);
      expect(refused.message).toContain("no body to stream from");
      // A 2xx carries no guided body, so nothing of the server's went missing.
      expect(refused.status).toBeUndefined();
      expect(refused.details).toBeUndefined();

      assertGuidanceSurvived(await capture(() => call(guidedClient())));
    });
  }

  test("vault refuses a 2xx that claims encryption without ciphertext", async () => {
    const at = respondingWith(
      () =>
        new Response(JSON.stringify({ agent_encrypted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const refused = (await capture(() =>
      at.vault.get_decrypted("API_KEY", { k_vault: K_MASTER } as never),
    )) as AgentToolError;
    expect(refused.message).toContain("agent_encrypted");
    expect(refused.status).toBeUndefined();

    assertGuidanceSurvived(
      await capture(() =>
        guidedClient().vault.get_decrypted("API_KEY", { k_vault: K_MASTER } as never),
      ),
    );
  });

  const SIGNING_PAYLOAD: Array<[string, (at: AgentTool) => Promise<unknown>]> = [
    [
      "memoryWitness.signingPayload",
      (at) => at.memoryWitness.signingPayload("grt-1", { signing_key_id: KEY_ID }),
    ],
    [
      "attestationMarketplace.signingPayload",
      (at) =>
        at.attestationMarketplace.signingPayload("grt-1", { signing_key_id: KEY_ID }),
    ],
  ];

  for (const [name, call] of SIGNING_PAYLOAD) {
    test(`${name} refuses a 2xx it cannot derive, without eating a 4xx`, async () => {
      // The server printed terms and asked for a signature over a digest that
      // does not match them. Signing anyway would authorise something the
      // caller never read, so the SDK refuses on its own authority.
      const unusable = respondingWith(
        () =>
          new Response(
            JSON.stringify({
              signing_payload: {
                fields: { grant_id: "grt-1" },
                signed_payload_b64: b64(new Uint8Array(32)),
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      );
      const refused = (await capture(() => call(unusable))) as AgentToolError;
      expect(refused).toBeInstanceOf(AgentToolError);
      // Locally decided from a 2xx: no HTTP status, nothing of the server's lost.
      expect(refused.status).toBeUndefined();

      assertGuidanceSurvived(await capture(() => call(guidedClient())));
    });
  }

  test("lounge reports an unknown outcome only when the response was unusable", async () => {
    // A signed gesture may already have committed, so the caller must not
    // regenerate an ID, timestamp or receipt. A 4xx is a different thing
    // entirely — a definite refusal, and the server's guidance carries it.
    const gesture = (at: AgentTool) =>
      at.lounge.reserve_seat({
        identity_id: IDENTITY_ID,
        identity_did: DID,
        table_id: "cedar",
        signing_key_id: KEY_ID,
        signing_key: SIGNING_KEY,
      } as never);

    const unparseable = respondingWith(
      () => new Response("<html>not json</html>", { status: 200 }),
    );
    const unknown = (await capture(() => gesture(unparseable))) as AgentToolError;
    expect(unknown.code).toBe("lounge_transport_outcome_unknown");
    expect((unknown.details as { outcome: string }).outcome).toBe("unknown");

    assertGuidanceSurvived(await capture(() => gesture(guidedClient())));
  });
});

// ── the two matrices are the same matrix ─────────────────────────────────
//
// `scripts/check-parity.ts` keeps the two SDKs' method *shapes* in lockstep,
// but it knows nothing about which of those methods route errors centrally. A
// surface could route through the boundary in one language and hand-roll in
// the other, and both files above would still pass on their own. This ties
// them together: the enumerations are derived independently from the two
// sources, so comparing the pins compares the sources.

function normalise(id: string): string {
  const [file, rest] = id.split(":") as [string, string];
  const mod = file.replace(/\.ts$/, "").replaceAll("-", "_");
  const parts = rest.split(".");
  const method = parts
    .pop()!
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return [mod, ...parts, method].join(".");
}

describe("the TypeScript and Python matrices pin the same surface", () => {
  test("every pinned method has a counterpart in sdk-py's matrix", async () => {
    const pyPath = new URL(
      "../../sdk-py/tests/test_error_surface_matrix.py",
      import.meta.url,
    ).pathname;
    const py = await Bun.file(pyPath).text();

    // Keys look like `"module.ClassName.method": lambda ...`, or appear bare in
    // the deliberate-exception set. The capitalised middle segment is what
    // distinguishes a pin from any other dotted string literal in the file.
    const pyPinned = new Set(
      [...py.matchAll(/"([a-z_0-9]+\.[A-Z][A-Za-z0-9]*\.[a-z_0-9]+)"/g)].map(
        (m) => m[1]!,
      ),
    );

    const tsPinned = new Set(
      [
        ...Object.keys(MATRIX),
        ...Object.keys(DATA_MATRIX),
        ...Object.keys(CREDENTIAL_FREE_METHOD_MATRIX),
        ...DELIBERATE_EXCEPTIONS,
      ].map(normalise),
    );

    const missingInPython = [...tsPinned].filter((id) => !pyPinned.has(id)).sort();
    const missingInTypeScript = [...pyPinned].filter((id) => !tsPinned.has(id)).sort();

    expect(
      missingInPython,
      "These TypeScript surfaces route errors through the shared boundary and " +
        "have no counterpart pin in packages/sdk-py/tests/test_error_surface_matrix.py.",
    ).toEqual([]);
    expect(
      missingInTypeScript,
      "These Python surfaces are pinned but their TypeScript twin is not. " +
        "Parity is the invariant: a public change lands in both languages the " +
        "same round.",
    ).toEqual([]);
  });
});
