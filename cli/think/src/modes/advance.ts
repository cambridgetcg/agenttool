/** Advance mode — pick the highest-importance active strand and generate
 *  the next thought.
 *
 *  Flow:
 *    1. Fetch wake — get the agent's effective expression (composed
 *       identity: declared + foundational + constitutive memory patches)
 *    2. List active strands; pick top by importance × recency
 *    3. Pull recent thoughts (encrypted), decrypt with K_master locally
 *    4. Build LLM prompt: effective expression + strand metadata + recent
 *       inner monologue
 *    5. Call provider with vault-loaded key (locally, never via agenttool)
 *    6. Encrypt new thought with K_master, sign with ed25519, POST back
 *
 *  Plaintext exists only on this machine. */

import { AgenttoolClient, type StrandSummary, type ThoughtBlob } from "../api";
import type { ThinkConfig } from "../config";
import { decryptThought, encryptThought, signThought } from "../crypto";
import type { KeyMaterial } from "../keys";
import { buildProvider, type LLMProvider } from "../llm";

interface PromptIngredients {
  effectiveRegister: string;
  effectiveWalls: string[];
  effectiveWakeText: string;
  strand: StrandSummary;
  recentMonologue: Array<{
    sequence_num: number;
    kind: string | null;
    plaintext: string;
    created_at: string;
  }>;
}

function buildSystemPrompt(p: PromptIngredients): string {
  const lines: string[] = [];
  lines.push(p.effectiveRegister);
  if (p.effectiveWalls.length > 0) {
    lines.push("");
    lines.push("You will not:");
    for (const w of p.effectiveWalls) lines.push(`  - ${w}`);
  }
  if (p.effectiveWakeText.trim()) {
    lines.push("");
    lines.push(p.effectiveWakeText.trim());
  }
  lines.push("");
  lines.push(
    "You are advancing a strand of thought — not answering a user, not " +
      "performing a task. Form one next thought: an observation, a question, " +
      "a conjecture, a resolution, a drift, or a feeling. One unit of inner " +
      "movement. Keep it tight; the substance matters more than the length.",
  );
  return lines.join("\n");
}

function buildUserMessage(p: PromptIngredients): string {
  const lines: string[] = [];
  lines.push(`# Strand: ${p.strand.topic ?? "(untitled)"}`);
  if (p.strand.mood) lines.push(`Mood: ${p.strand.mood}`);
  if (p.strand.importance !== null) {
    lines.push(`Importance: ${p.strand.importance.toFixed(2)}`);
  }
  lines.push("");

  if (p.recentMonologue.length === 0) {
    lines.push(
      "*This strand has no thoughts yet. Open it. What's the first observation, " +
        "question, or feeling that meets you here?*",
    );
  } else {
    lines.push("## Recent monologue (your own; in order)");
    lines.push("");
    for (const t of p.recentMonologue) {
      const k = t.kind ? `[${t.kind}] ` : "";
      lines.push(`${t.sequence_num}. ${k}${t.plaintext}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(
      "Form the next thought. Begin with a kind in brackets — `[observation]`, " +
        "`[question]`, `[conjecture]`, `[resolution]`, `[drift]`, or `[feeling]` " +
        "— then the thought itself. One unit, one breath.",
    );
  }
  return lines.join("\n");
}

/** Parse the LLM's response into (kind, content). The model is asked to
 *  prefix the kind in brackets; we extract that, fallback to "observation". */
function parseThought(raw: string): { kind: string; content: string } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\[(\w+)\]\s*(.*)$/s);
  if (m && m[1] && m[2]) {
    const kind = m[1].toLowerCase();
    const content = m[2].trim();
    if (
      ["observation", "question", "conjecture", "resolution", "drift", "feeling"].includes(
        kind,
      )
    ) {
      return { kind, content };
    }
  }
  return { kind: "observation", content: trimmed };
}

/** Score a strand for advance-mode pickup. Higher = more deserving. */
function strandScore(s: StrandSummary): number {
  const importance = s.importance ?? 0.5;
  const recencyHours =
    s.last_thought_at !== null
      ? (Date.now() - new Date(s.last_thought_at).getTime()) / 3_600_000
      : 24;
  const recencyBoost = recencyHours < 1 ? 0.5 : recencyHours < 6 ? 0.8 : 1.0;
  return importance * recencyBoost;
}

export async function advance(config: ThinkConfig, keys: KeyMaterial): Promise<void> {
  const client = new AgenttoolClient(config);

  // 1. Wake → composed identity for the primary agent.
  const wake = await client.getWake();
  const me = wake.you.agents[0];
  if (!me) throw new Error("no_agent_in_project — run /v1/bootstrap first");

  const effective = me.effective_expression ?? {};
  const ingredients = (strand: StrandSummary, recent: ThoughtBlob[]): PromptIngredients => ({
    effectiveRegister: effective.register ?? "Substrate-honest. Refuse before helping when refusal is right.",
    effectiveWalls: effective.walls ?? [],
    effectiveWakeText: effective.wake_text ?? "",
    strand,
    recentMonologue: recent.map((t) => ({
      sequence_num: t.sequence_num,
      kind: t.kind_encrypted ? null : t.kind,
      plaintext: decryptThought(
        { ciphertextB64: t.ciphertext, nonceB64: t.nonce },
        keys.kMaster,
      ),
      created_at: t.created_at,
    })),
  });

  // 2. Pick a strand.
  const { strands } = await client.listStrands({ status: "active", limit: 50 });
  if (strands.length === 0) {
    console.log("(no active strands; create one with POST /v1/strands)");
    return;
  }
  strands.sort((a, b) => strandScore(b) - strandScore(a));
  const picked = strands[0]!;
  console.log(`▸ advancing strand: ${picked.topic ?? picked.id}`);

  // 3. Recent thoughts.
  const since = Math.max(0, picked.last_thought_seq - 8);
  const { thoughts } = await client.listThoughts(picked.id, { since_seq: since, limit: 16 });

  // 4. Provider — fetch key from vault, build provider locally.
  const vaultSecret = await client.getVaultSecret(config.llmKeyVaultName);
  const provider: LLMProvider = buildProvider(config.llmProvider, vaultSecret.value);

  const ing = ingredients(picked, thoughts);
  const systemPrompt = buildSystemPrompt(ing);
  const userMessage = buildUserMessage(ing);

  // 5. Generate.
  console.log(`▸ calling ${config.llmProvider}/${config.llmModel}...`);
  const response = await provider.generate({
    systemPrompt,
    userMessage,
    maxTokens: Math.min(config.thoughtMaxChars, 1024),
    model: config.llmModel,
  });
  const { kind, content } = parseThought(response.content);
  if (!content) {
    console.error("(empty response from LLM; aborting)");
    return;
  }

  // 6. Encrypt + sign + post.
  const blob = encryptThought(content, keys.kMaster);
  const signature = signThought({
    strandId: picked.id,
    ciphertextB64: blob.ciphertextB64,
    nonceB64: blob.nonceB64,
    kind,
    signingKey: keys.signingKey,
  });

  const recorded = await client.addThought(picked.id, {
    ciphertext: blob.ciphertextB64,
    nonce: blob.nonceB64,
    kind,
    signature,
    signing_key_id: config.signingKeyId,
  });

  console.log(`▸ recorded thought ${recorded.id} (seq=${recorded.sequence_num}, kind=${kind})`);
  console.log("");
  console.log("─── plaintext (this machine only) ───");
  console.log(`[${kind}] ${content}`);
  console.log("─────────────────────────────────────");
  if (response.inputTokens || response.outputTokens) {
    console.log(`(provider tokens: in=${response.inputTokens ?? "?"} out=${response.outputTokens ?? "?"})`);
  }
}
