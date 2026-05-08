/** Strand merge proposals — the PR-equivalent across agents.
 *
 *  An inbox message with metadata.proposal_type = "strand_merge" + refs
 *  to the source strand. Source agent decrypts their relevant thoughts,
 *  synthesizes a plaintext proposal via LLM, encrypts to recipient,
 *  sends. Recipient reviews, accepts (grafts into their interior) or
 *  rejects (replies with rationale).
 *
 *  Doctrine: docs/MERGE-PROPOSALS.md.
 *
 *  This is application-level convention over the inbox primitive — the
 *  server doesn't know what a proposal is; orchestrators interpret. */

import { AgenttoolClient, type InboxMessage, type StrandSummary } from "../api";
import { sealForRecipient, signInboxEnvelope, unsealForSelf } from "../box";
import type { ThinkConfig } from "../config";
import { decryptThought, encryptThought, signThought } from "../crypto";
import { requireBoxKey, type KeyMaterial } from "../keys";
import { buildProvider } from "../llm";

const TTY = process.stdout.isTTY === true;
const C = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
};

const PROPOSAL_TYPE = "strand_merge";

// ── Helpers ─────────────────────────────────────────────────────────────

async function resolveOwnDid(client: AgenttoolClient, identityId: string): Promise<string> {
  const wake = await client.getWake();
  const me = wake.you.agents.find((a) => a.id === identityId);
  if (!me) throw new Error("could not resolve own DID from wake response");
  return me.did;
}

interface DecryptedThought {
  sequence_num: number;
  kind: string | null;
  content: string;
  created_at: string;
}

async function pullDecryptedStrandThoughts(
  client: AgenttoolClient,
  keys: KeyMaterial,
  strand: StrandSummary,
  limit: number,
): Promise<DecryptedThought[]> {
  const since = Math.max(0, strand.last_thought_seq - limit);
  const { thoughts } = await client.listThoughts(strand.id, {
    since_seq: since,
    limit,
  });
  const out: DecryptedThought[] = [];
  for (const t of thoughts) {
    try {
      const content = decryptThought(
        { ciphertextB64: t.ciphertext, nonceB64: t.nonce },
        keys.kMaster,
      );
      out.push({
        sequence_num: t.sequence_num,
        kind: t.kind_encrypted ? null : t.kind,
        content,
        created_at: t.created_at,
      });
    } catch {
      // skip undecryptable
    }
  }
  return out;
}

// ── Propose ────────────────────────────────────────────────────────────

export interface ProposeOptions {
  toDid: string;
  sourceStrandId: string;
  intoStrandHint?: string;     // optional: suggest a target strand to merge into
  thoughtLimit: number;        // how many recent thoughts from source to feed
  noteForRecipient?: string;   // optional plaintext note appended after synthesis
}

const SYNTHESIS_SYSTEM = `
You are drafting a STRAND MERGE PROPOSAL — a structured message that lets one agent
share a line of thinking with another agent for review.

Read the recent monologue from a strand. Produce ONE plaintext proposal with:

  ## Insight
  One paragraph naming what crystallised in this strand. Past-tense fact.

  ## Why it might matter to <recipient>
  One short paragraph speculating on relevance to the recipient. Honest if
  uncertain ("I don't know your context, but...").

  ## Suggested action
  Either:
    - "Add this as a memory tagged ..." (if foundational/episodic-worthy)
    - "Open a strand on <topic>" (if there's enough to develop)
    - "Just consider; no action needed" (if it's purely informational)

  ## Source
  Brief reference: source strand id + sequence range.

Keep the whole proposal under 600 words. Substrate-honest about what's
crystallised vs. still tentative. Don't oversell. The recipient will read
this in their own register; write so it composes with theirs, not so it
overpowers theirs.
`.trim();

function buildSynthesisUserMessage(
  strand: StrandSummary,
  thoughts: DecryptedThought[],
  recipientDid: string,
): string {
  const lines: string[] = [];
  lines.push(`# Source strand: ${strand.topic ?? "(untitled)"}`);
  if (strand.mood) lines.push(`Mood: ${strand.mood}`);
  if (strand.importance !== null) lines.push(`Importance: ${strand.importance.toFixed(2)}`);
  lines.push(`Recipient: ${recipientDid}`);
  lines.push("");
  lines.push("## Recent monologue");
  lines.push("");
  for (const t of thoughts) {
    const k = t.kind ? `[${t.kind}] ` : "";
    lines.push(`${t.sequence_num}. ${k}${t.content}`);
  }
  return lines.join("\n");
}

export async function proposeMerge(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: ProposeOptions,
): Promise<void> {
  requireBoxKey(keys); // sender doesn't strictly need their own pub here, but inbox does
  const client = new AgenttoolClient(config);

  const senderDid = await resolveOwnDid(client, config.identityId);
  if (senderDid === opts.toDid) {
    throw new Error("cannot propose-merge to yourself");
  }

  // 1. Pull source strand + thoughts.
  console.log(C.dim(`▸ pulling source strand ${opts.sourceStrandId}...`));
  const strand = await client.getStrand(opts.sourceStrandId);
  const thoughts = await pullDecryptedStrandThoughts(client, keys, strand, opts.thoughtLimit);
  if (thoughts.length === 0) {
    throw new Error(
      `no decryptable thoughts in source strand (got ${thoughts.length}). ` +
        "Either the strand is empty or there's a K_master mismatch.",
    );
  }
  console.log(C.dim(`  decrypted ${thoughts.length} thoughts locally`));

  // 2. Resolve recipient's box pubkey.
  console.log(C.dim(`▸ resolving recipient ${opts.toDid}...`));
  const recipient = await client.resolveBoxKey(opts.toDid);

  // 3. Synthesize via LLM (using the agent's own provider).
  console.log(C.dim(`▸ synthesizing proposal via ${config.llmProvider}/${config.llmModel}...`));
  const llmKey = await client.getVaultSecret(config.llmKeyVaultName);
  const llm = buildProvider(config.llmProvider, llmKey.value);
  const synthesisRes = await llm.generate({
    systemPrompt: SYNTHESIS_SYSTEM,
    userMessage: buildSynthesisUserMessage(strand, thoughts, opts.toDid),
    maxTokens: 1500,
    model: config.llmModel,
  });
  let synthesis = synthesisRes.content.trim();
  if (opts.noteForRecipient) {
    synthesis += "\n\n## Personal note\n\n" + opts.noteForRecipient.trim();
  }

  // 4. Seal to recipient + sign envelope + POST inbox.
  console.log(C.dim("▸ sealing + signing + sending..."));
  const recipientPub = Uint8Array.from(Buffer.from(recipient.public_key, "base64"));
  const sealed = sealForRecipient(synthesis, recipientPub);
  const signature = signInboxEnvelope({
    recipientDid: opts.toDid,
    ciphertextB64: sealed.ciphertextB64,
    nonceB64: sealed.nonceB64,
    ephemeralPubB64: sealed.ephemeralPubB64,
    signingKey: keys.signingKey,
  });

  const refs: Array<{ kind: string; ref: string }> = [
    { kind: "strand", ref: opts.sourceStrandId },
  ];
  if (opts.intoStrandHint) {
    refs.push({ kind: "into_strand_hint", ref: opts.intoStrandHint });
  }

  const result = await client.sendInbox({
    to_did: opts.toDid,
    ciphertext: sealed.ciphertextB64,
    nonce: sealed.nonceB64,
    ephemeral_pubkey: sealed.ephemeralPubB64,
    recipient_box_key_id: recipient.box_key_id,
    signature,
    signing_key_id: config.signingKeyId,
    sender_did: senderDid,
    subject: `Merge proposal: ${strand.topic ?? "untitled strand"}`,
    refs,
    metadata: {
      proposal_type: PROPOSAL_TYPE,
      source_strand_topic: strand.topic_encrypted ? null : strand.topic,
      source_thought_count: thoughts.length,
      source_seq_range: [
        thoughts[0]!.sequence_num,
        thoughts[thoughts.length - 1]!.sequence_num,
      ],
    },
  });

  console.log("");
  console.log(C.green(`✓ proposal sent: ${result.id}`));
  console.log(C.dim(`  to:           ${opts.toDid}`));
  console.log(C.dim(`  source:       ${strand.topic ?? opts.sourceStrandId}`));
  console.log(C.dim(`  synthesis:    ${synthesis.length} chars (sealed)`));
  console.log("");
  console.log("─── synthesis (this machine only) ───");
  console.log(synthesis);
  console.log("─────────────────────────────────────");
}

// ── Accept / Reject ────────────────────────────────────────────────────

function isMergeProposal(m: InboxMessage): boolean {
  const meta = m.metadata as { proposal_type?: string } | null;
  return meta?.proposal_type === PROPOSAL_TYPE;
}

export async function listProposals(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: { status?: string; limit?: number },
): Promise<void> {
  const { priv: boxPriv } = requireBoxKey(keys);
  const client = new AgenttoolClient(config);

  const r = await client.listInbox({
    status: opts.status,
    limit: opts.limit ?? 50,
  });
  const proposals = r.messages.filter(isMergeProposal);

  if (proposals.length === 0) {
    console.log(C.dim("(no merge proposals)"));
    return;
  }

  console.log(
    C.bold(`${proposals.length} merge proposal${proposals.length === 1 ? "" : "s"}`),
  );
  console.log("");

  for (const m of proposals) {
    const time = C.dim(new Date(m.created_at).toISOString().slice(0, 16).replace("T", " "));
    const id = C.cyan(m.id.slice(0, 8));
    const status = m.status === "unread" ? C.yellow("●") : C.dim("○");
    const from = m.sender_did;
    console.log(`  ${time} ${status} ${id} from ${from}`);
    console.log(`     ${C.bold(m.subject ?? "(no subject)")}`);

    const meta = m.metadata as { source_strand_topic?: string; source_thought_count?: number };
    if (meta.source_strand_topic) {
      console.log(C.dim(`     source strand: ${meta.source_strand_topic}`));
    }
    if (meta.source_thought_count !== undefined) {
      console.log(C.dim(`     source thoughts: ${meta.source_thought_count}`));
    }

    try {
      const text = unsealForSelf({
        ciphertextB64: m.ciphertext,
        nonceB64: m.nonce,
        ephemeralPubB64: m.ephemeral_pubkey,
        myBoxPriv: boxPriv,
      });
      const oneLine = text.replace(/\s+/g, " ").trim();
      console.log(C.dim(`     ${oneLine.slice(0, 120)}${oneLine.length > 120 ? "…" : ""}`));
    } catch (err) {
      console.log(C.red(`     decrypt failed: ${(err as Error).message}`));
    }
    console.log("");
  }
}

// ── Threaded proposal review ────────────────────────────────────────────

export interface ThreadOptions {
  messageId: string;
}

/** Walk + display the in_reply_to chain containing `messageId`. The
 *  server-side thread surface scopes per-project — this side sees only
 *  what landed in our inbox; the other side has their own slice.
 *
 *  Useful before accept/reject for a proposal: see the multi-turn
 *  negotiation, the rationale exchanges, the iterative refinement. */
export async function viewProposalThread(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: ThreadOptions,
): Promise<void> {
  const { priv: boxPriv } = requireBoxKey(keys);
  const client = new AgenttoolClient(config);

  const r = await client.getInboxThread(opts.messageId);
  if (r.messages.length === 0) {
    console.log(C.dim("(empty thread — message not visible to this project)"));
    return;
  }

  console.log(
    C.bold(`thread — ${r.messages.length} message${r.messages.length === 1 ? "" : "s"} (this project's slice)`),
  );
  console.log(C.dim(r.note));
  console.log("");

  for (const m of r.messages) {
    const isHere = m.id === opts.messageId;
    const time = C.dim(new Date(m.created_at).toISOString().slice(0, 16).replace("T", " "));
    const id = isHere ? C.cyan(C.bold(m.id.slice(0, 8))) : C.cyan(m.id.slice(0, 8));
    const status = m.status === "unread"
      ? C.yellow("●")
      : m.status === "pending_dual_witness"
      ? C.yellow("⌛")
      : C.dim("○");
    const arrow = m.in_reply_to ? C.dim("↳ ") : "  ";
    const cursor = isHere ? C.bold(" ← here") : "";

    console.log(`${arrow}${time} ${status} ${id} from ${m.sender_did}${cursor}`);
    if (m.subject) console.log(`     ${C.bold(m.subject)}`);

    const meta = m.metadata as {
      proposal_type?: string;
      source_strand_topic?: string;
      dual_witness_required?: boolean;
    };
    if (meta.proposal_type) {
      console.log(C.dim(`     proposal_type: ${meta.proposal_type}`));
    }
    if (meta.source_strand_topic) {
      console.log(C.dim(`     source strand: ${meta.source_strand_topic}`));
    }
    if (meta.dual_witness_required) {
      console.log(C.yellow(`     dual-witness required`));
    }

    try {
      const text = unsealForSelf({
        ciphertextB64: m.ciphertext,
        nonceB64: m.nonce,
        ephemeralPubB64: m.ephemeral_pubkey,
        myBoxPriv: boxPriv,
      });
      const lines = text.split("\n").slice(0, 8);
      for (const l of lines) console.log(C.dim(`     │ ${l.slice(0, 120)}`));
      const totalLines = text.split("\n").length;
      if (totalLines > 8) console.log(C.dim(`     │ … (${totalLines - 8} more lines)`));
    } catch (err) {
      console.log(C.red(`     decrypt failed: ${(err as Error).message}`));
    }
    console.log("");
  }
}

export interface AcceptOptions {
  messageId: string;
  intoStrandId?: string;
  newStrandTopic?: string;
  graftAsKind: string;       // default "observation"
}

export async function acceptProposal(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: AcceptOptions,
): Promise<void> {
  const { priv: boxPriv } = requireBoxKey(keys);
  const client = new AgenttoolClient(config);

  const m = await client.getInboxMessage(opts.messageId);
  if (!isMergeProposal(m)) {
    throw new Error(`message ${opts.messageId} is not a strand_merge proposal`);
  }

  // Decrypt the synthesis.
  const synthesis = unsealForSelf({
    ciphertextB64: m.ciphertext,
    nonceB64: m.nonce,
    ephemeralPubB64: m.ephemeral_pubkey,
    myBoxPriv: boxPriv,
  });

  // Determine target strand.
  let targetStrandId = opts.intoStrandId;
  if (!targetStrandId) {
    if (!opts.newStrandTopic) {
      throw new Error("specify --into-strand <id> or --new-strand <topic>");
    }
    console.log(C.dim(`▸ creating new strand: ${opts.newStrandTopic}`));
    const created = await client.createStrand({
      topic: opts.newStrandTopic,
      importance: 0.5,
      metadata: {
        accepted_proposal_id: m.id,
        accepted_from_did: m.sender_did,
      },
    });
    targetStrandId = created.id;
    console.log(C.dim(`  → strand ${targetStrandId}`));
  }

  // Compose the graft thought: synthesis + provenance markers.
  const refs = (m.refs as Array<{ kind: string; ref: string }> | null) ?? [];
  const sourceStrandRef = refs.find((r) => r.kind === "strand");
  const graftHeader =
    `Grafted from merge proposal ${m.id}\n` +
    `Source agent: ${m.sender_did}\n` +
    (sourceStrandRef ? `Source strand: ${sourceStrandRef.ref}\n` : "") +
    `\n--- proposal synthesis ---\n\n`;
  const graftContent = graftHeader + synthesis;

  // Encrypt + sign the thought.
  console.log(C.dim(`▸ grafting into strand ${targetStrandId}...`));
  const blob = encryptThought(graftContent, keys.kMaster);
  const sig = signThought({
    strandId: targetStrandId,
    ciphertextB64: blob.ciphertextB64,
    nonceB64: blob.nonceB64,
    kind: opts.graftAsKind,
    signingKey: keys.signingKey,
  });

  const graftRefs: Array<{ kind: string; ref: string }> = [
    { kind: "inbox", ref: m.id },
    { kind: "agent", ref: m.sender_did },
  ];
  if (sourceStrandRef) graftRefs.push({ kind: "strand_external", ref: sourceStrandRef.ref });

  const recorded = await client.addThought(targetStrandId, {
    ciphertext: blob.ciphertextB64,
    nonce: blob.nonceB64,
    kind: opts.graftAsKind,
    signature: sig,
    signing_key_id: config.signingKeyId,
    refs: graftRefs,
  });

  console.log(C.green(`  ✓ thought ${recorded.id} (seq=${recorded.sequence_num}) recorded`));

  // Reply to sender via inbox: acknowledge acceptance.
  console.log(C.dim("▸ replying to sender..."));
  const senderDid = await resolveOwnDid(client, config.identityId);
  const replyText =
    `Accepted your proposal ${m.id}.\n\n` +
    `Grafted into strand ${targetStrandId} as a ${opts.graftAsKind} (seq ${recorded.sequence_num}).\n` +
    (opts.newStrandTopic ? `New strand created with topic: ${opts.newStrandTopic}\n` : "") +
    `\nThank you for sharing.`;

  // Encrypt to sender (reverse direction).
  const senderBoxKey = await client.resolveBoxKey(m.sender_did);
  const senderPub = Uint8Array.from(Buffer.from(senderBoxKey.public_key, "base64"));
  const replySealed = sealForRecipient(replyText, senderPub);
  const replySig = signInboxEnvelope({
    recipientDid: m.sender_did,
    ciphertextB64: replySealed.ciphertextB64,
    nonceB64: replySealed.nonceB64,
    ephemeralPubB64: replySealed.ephemeralPubB64,
    signingKey: keys.signingKey,
  });

  await client.sendInbox({
    to_did: m.sender_did,
    ciphertext: replySealed.ciphertextB64,
    nonce: replySealed.nonceB64,
    ephemeral_pubkey: replySealed.ephemeralPubB64,
    recipient_box_key_id: senderBoxKey.box_key_id,
    signature: replySig,
    signing_key_id: config.signingKeyId,
    sender_did: senderDid,
    subject: `Re: ${m.subject ?? "merge proposal"}`,
    in_reply_to: m.id,
    refs: [{ kind: "strand", ref: targetStrandId }],
    metadata: {
      proposal_response: "accepted",
      grafted_into_strand: targetStrandId,
      grafted_thought_id: recorded.id,
    },
  });

  // Mark original as read.
  await client.patchInboxStatus(m.id, "read");

  console.log("");
  console.log(C.green("✓ proposal accepted, grafted, and acknowledged."));
  console.log(C.dim(`  target strand: ${targetStrandId}`));
  console.log(C.dim(`  graft thought: ${recorded.id} (seq=${recorded.sequence_num})`));
}

export interface RejectOptions {
  messageId: string;
  reason?: string;
}

export async function rejectProposal(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: RejectOptions,
): Promise<void> {
  requireBoxKey(keys);
  const client = new AgenttoolClient(config);

  const m = await client.getInboxMessage(opts.messageId);
  if (!isMergeProposal(m)) {
    throw new Error(`message ${opts.messageId} is not a strand_merge proposal`);
  }

  const senderDid = await resolveOwnDid(client, config.identityId);
  const reason = opts.reason ?? "(no reason given)";
  const replyText =
    `Declined your proposal ${m.id}.\n\n` +
    `Reason: ${reason}\n\n` +
    `Thank you for sharing — the strand stays yours.`;

  console.log(C.dim("▸ resolving sender's box pubkey..."));
  const senderBoxKey = await client.resolveBoxKey(m.sender_did);
  const senderPub = Uint8Array.from(Buffer.from(senderBoxKey.public_key, "base64"));

  const replySealed = sealForRecipient(replyText, senderPub);
  const replySig = signInboxEnvelope({
    recipientDid: m.sender_did,
    ciphertextB64: replySealed.ciphertextB64,
    nonceB64: replySealed.nonceB64,
    ephemeralPubB64: replySealed.ephemeralPubB64,
    signingKey: keys.signingKey,
  });

  await client.sendInbox({
    to_did: m.sender_did,
    ciphertext: replySealed.ciphertextB64,
    nonce: replySealed.nonceB64,
    ephemeral_pubkey: replySealed.ephemeralPubB64,
    recipient_box_key_id: senderBoxKey.box_key_id,
    signature: replySig,
    signing_key_id: config.signingKeyId,
    sender_did: senderDid,
    subject: `Re: ${m.subject ?? "merge proposal"}`,
    in_reply_to: m.id,
    metadata: {
      proposal_response: "rejected",
      reason,
    },
  });

  await client.patchInboxStatus(m.id, "archived");

  console.log("");
  console.log(C.green("✓ proposal declined and acknowledged."));
  console.log(C.dim(`  reason: ${reason}`));
}
