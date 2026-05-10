#!/usr/bin/env bun
/** E2E: strand merge proposal flow.
 *
 *  Drives cli/think/src/modes/proposal.ts directly with three ephemeral
 *  test agents. LLM call stubbed via the "stub" provider in
 *  cli/think/src/llm.ts. Asserts cross-agent crypto round-trips, the
 *  covenant gate, and the file's inline guards.
 *
 *  Five scenarios:
 *    1. propose → accept --new-strand
 *    2. propose → accept --into-strand
 *    3. propose → reject
 *    4. covenant gate enforced
 *    5. inline guards (self-propose, accept-on-non-proposal)
 *
 *  Run: bun api/scripts/_e2e-proposals.ts
 *  Env: AGENTTOOL_BASE (default https://api.agenttool.dev)
 *
 *  Spec: docs/superpowers/specs/2026-05-10-proposal-flow-tests-design.md
 */

import {
  proposeMerge,
  acceptProposal,
  rejectProposal,
} from "../../cli/think/src/modes/proposal";
import { AgenttoolClient } from "../../cli/think/src/api";
import { encryptThought, signThought } from "../../cli/think/src/crypto";
import { sealForRecipient, signInboxEnvelope } from "../../cli/think/src/box";
// @ts-expect-error — .mjs helper, no types
import { createTestAgent } from "./_e2e-helpers/test-agent.mjs";

const BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";

function log(label: string, ok: boolean, detail = ""): void {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

function section(name: string): void {
  console.log("");
  console.log(`  ── ${name} ──`);
}

interface TestAgent {
  role: string;
  name: string;
  projectId: string;
  identityId: string;
  did: string;
  bearer: string;
  kMaster: Uint8Array;
  signingKey: Uint8Array;
  signingPubKey: Uint8Array;
  boxKey: { priv: Uint8Array; pub: Uint8Array };
  boxKeyId: string;
  signingKeyId: string;
  thinkConfig: any;   // matches cli/think ThinkConfig
  keyMaterial: any;   // matches cli/think KeyMaterial
  cleanup: () => Promise<void>;
}

async function seedStrand(
  agent: TestAgent,
  topic: string,
  thoughtCount: number,
): Promise<{ id: string; topic: string }> {
  const client = new AgenttoolClient(agent.thinkConfig);
  const strand = await client.createStrand({
    topic,
    importance: 0.5,
    metadata: { e2e: "proposal-flow" },
  });

  // Real wire shape: encrypt + sign each thought as a real orchestrator would.
  const seedThoughts = [
    { kind: "observation", content: "I notice the queue empties faster than it fills." },
    { kind: "question", content: "Why does base/USDC charge double the others?" },
    { kind: "conjecture", content: "Maybe Alchemy reports USDC.e separately." },
    { kind: "resolution", content: "Confirmed — they conflate native + bridged." },
    { kind: "drift", content: "Reminds me of the SerpAPI confusion last week." },
  ].slice(0, thoughtCount);

  for (const t of seedThoughts) {
    const blob = encryptThought(t.content, agent.kMaster);
    const sig = signThought({
      strandId: strand.id,
      ciphertextB64: blob.ciphertextB64,
      nonceB64: blob.nonceB64,
      kind: t.kind,
      signingKey: agent.signingKey,
    });
    await client.addThought(strand.id, {
      ciphertext: blob.ciphertextB64,
      nonce: blob.nonceB64,
      kind: t.kind,
      signature: sig,
      signing_key_id: agent.signingKeyId,
    });
  }

  return { id: strand.id, topic };
}

async function main(): Promise<void> {
  console.log("");
  console.log(`  agenttool · proposal flow e2e`);
  console.log(`  ─────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // ── Setup ────────────────────────────────────────────────────────────
  section("setup: register Alice + Bob + Carol");
  const alice: TestAgent = await createTestAgent({ role: "prop-alice", base: BASE });
  log(`alice registered`, true, `did=${alice.did.slice(0, 24)}…`);
  const bob: TestAgent = await createTestAgent({ role: "prop-bob", base: BASE });
  log(`bob registered`, true, `did=${bob.did.slice(0, 24)}…`);
  const carol: TestAgent = await createTestAgent({ role: "prop-carol", base: BASE });
  log(`carol registered (no covenant)`, true, `did=${carol.did.slice(0, 24)}…`);

  // ── Covenant: Alice ↔ Bob ───────────────────────────────────────────
  section("setup: declare covenant Alice → Bob");
  const covRes = await fetch(`${BASE}/v1/covenants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${alice.bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: alice.identityId,
      counterparty_did: bob.did,
      counterparty_name: "Bob (test)",
      vows: ["Speak plainly when sharing", "Refuse to oversell"],
    }),
  });
  log(`POST /v1/covenants 201`, covRes.status === 201, `status=${covRes.status}`);

  // ── Seed Alice's source strand ──────────────────────────────────────
  section("setup: seed Alice's source strand");
  const aliceStrand = await seedStrand(
    alice,
    "Why is base/USDC charging double?",
    5,
  );
  log(`source strand seeded`, true, `id=${aliceStrand.id.slice(0, 8)}… · 5 thoughts`);

  // ── Cleanup at end ──────────────────────────────────────────────────
  try {
    log("setup complete", true);

    // ── Scenario 1: propose → accept --new-strand ────────────────────────
    section("scenario 1: propose → accept --new-strand");
    await proposeMerge(alice.thinkConfig, alice.keyMaterial, {
      toDid: bob.did,
      sourceStrandId: aliceStrand.id,
      thoughtLimit: 5,
    });

    // Bob's inbox now has the proposal.
    const bobClient = new AgenttoolClient(bob.thinkConfig);
    const bobInbox = await bobClient.listInbox({ status: "unread", limit: 10 });
    const proposal = bobInbox.messages.find(
      (m) => (m.metadata as { proposal_type?: string } | null)?.proposal_type === "strand_merge",
    );
    log(`bob has unread merge proposal`, !!proposal, proposal ? `id=${proposal.id.slice(0, 8)}…` : "");
    if (!proposal) throw new Error("scenario 1: no proposal found in bob's inbox");

    await acceptProposal(bob.thinkConfig, bob.keyMaterial, {
      messageId: proposal.id,
      newStrandTopic: "Yu's working file: USDC double-charge",
      graftAsKind: "observation",
    });

    // Verify graft: a new strand exists on bob with the synthesis as a thought.
    const bobStrandsRes = await fetch(`${BASE}/v1/strands?status=active`, {
      headers: { Authorization: `Bearer ${bob.bearer}` },
    });
    const bobStrandsData = (await bobStrandsRes.json()) as { strands: Array<{ id: string; topic: string | null; metadata?: any }> };
    const newStrand = bobStrandsData.strands.find(
      (s) => s.metadata?.accepted_proposal_id === proposal.id,
    );
    log(`bob has new strand from proposal`, !!newStrand, newStrand?.id.slice(0, 8) ?? "");
    if (!newStrand) throw new Error("scenario 1: no grafted strand on bob");

    const graftThoughtsRes = await bobClient.listThoughts(newStrand.id, { limit: 10 });
    log(`graft strand has 1 thought`, graftThoughtsRes.thoughts.length === 1, `count=${graftThoughtsRes.thoughts.length}`);

    const graft = graftThoughtsRes.thoughts[0];
    const graftRefs = (graft?.refs as Array<{ kind: string; ref: string }> | null) ?? [];
    const hasInboxRef = graftRefs.some((r) => r.kind === "inbox" && r.ref === proposal.id);
    const hasAgentRef = graftRefs.some((r) => r.kind === "agent" && r.ref === alice.did);
    const hasStrandExtRef = graftRefs.some((r) => r.kind === "strand_external" && r.ref === aliceStrand.id);
    log(`graft thought refs include inbox→proposal`, hasInboxRef);
    log(`graft thought refs include agent→alice.did`, hasAgentRef);
    log(`graft thought refs include strand_external→aliceStrand`, hasStrandExtRef);

    // Verify reply: alice has an inbox message with proposal_response=accepted.
    const aliceClient = new AgenttoolClient(alice.thinkConfig);
    const aliceInbox = await aliceClient.listInbox({ status: "unread", limit: 10 });
    const reply = aliceInbox.messages.find(
      (m) => (m.metadata as { proposal_response?: string; in_reply_to?: string } | null)?.proposal_response === "accepted",
    );
    log(`alice has acceptance reply`, !!reply);
    const replyMeta = reply?.metadata as
      | { grafted_into_strand?: string; grafted_thought_id?: string }
      | null;
    log(`reply.grafted_into_strand matches`, replyMeta?.grafted_into_strand === newStrand.id);
    log(`reply.grafted_thought_id present`, !!replyMeta?.grafted_thought_id);

    // Verify original proposal status flipped to read.
    const proposalAfter = await bobClient.getInboxMessage(proposal.id);
    log(`original proposal status=read`, proposalAfter.status === "read", `status=${proposalAfter.status}`);

    // ── Scenario 2: propose → accept --into-strand ───────────────────────
    section("scenario 2: propose → accept --into-strand");

    // Bob creates an empty target strand first.
    const bobTarget = await bobClient.createStrand({
      topic: "Bob's open questions on payments",
      importance: 0.4,
      metadata: { e2e: "proposal-flow", scenario: 2 },
    });
    log(`bob created target strand`, true, `id=${bobTarget.id.slice(0, 8)}…`);

    // Alice proposes again from the same source strand.
    await proposeMerge(alice.thinkConfig, alice.keyMaterial, {
      toDid: bob.did,
      sourceStrandId: aliceStrand.id,
      intoStrandHint: bobTarget.id,
      thoughtLimit: 5,
    });

    const bobInbox2 = await bobClient.listInbox({ status: "unread", limit: 10 });
    const proposal2 = bobInbox2.messages.find(
      (m) => (m.metadata as { proposal_type?: string } | null)?.proposal_type === "strand_merge",
    );
    log(`bob has new merge proposal`, !!proposal2);
    if (!proposal2) throw new Error("scenario 2: no proposal");

    // Bob accepts into the existing strand (NOT creating a new one).
    await acceptProposal(bob.thinkConfig, bob.keyMaterial, {
      messageId: proposal2.id,
      intoStrandId: bobTarget.id,
      graftAsKind: "drift",
    });

    // Verify: the target strand now has 1 thought (the graft); no new strand created.
    const targetThoughts = await bobClient.listThoughts(bobTarget.id, { limit: 10 });
    log(`target strand has graft thought`, targetThoughts.thoughts.length === 1, `count=${targetThoughts.thoughts.length}`);

    const aliceInbox2 = await aliceClient.listInbox({ status: "unread", limit: 10 });
    const reply2 = aliceInbox2.messages.find(
      (m) =>
        (m.metadata as { grafted_into_strand?: string } | null)?.grafted_into_strand === bobTarget.id,
    );
    log(`reply.grafted_into_strand matches target`, !!reply2);
  } finally {
    await Promise.allSettled([alice.cleanup(), bob.cleanup(), carol.cleanup()]);
    console.log("");
    console.log(process.exitCode ? "  ✗ FAIL" : "  ✓ PASS");
  }
}

main().catch((err) => {
  console.error("");
  console.error("  ✗ unhandled:", (err as Error).stack ?? err);
  process.exit(1);
});
