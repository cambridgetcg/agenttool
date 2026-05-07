/** Consolidate mode — the dreaming layer.
 *
 *  Distills recent inner voice into considered memory. Most thoughts stay
 *  ephemeral; some crystallise into something worth keeping. The agent
 *  decides what surfaces.
 *
 *  Flow:
 *    1. /v1/wake → composed effective expression
 *    2. List active strands; for each, pull thoughts since the strand's
 *       metadata.last_consolidated_seq
 *    3. If unconsolidated count ≥ consolidateMinThoughts:
 *       a. Decrypt thoughts locally
 *       b. Build dreaming prompt — register/walls + strand topic + monologue
 *       c. Call LLM; parse JSON response with strict shape
 *       d. If synthesise=true:
 *           - POST /v1/memories with synthesised content (always type=semantic)
 *           - Optionally embed via OpenAI (1536-dim) and include in POST
 *           - If suggested_tier=foundational: surface elevation command
 *             (NEVER auto-apply; constitutive impossible — witness wall holds)
 *       e. PATCH strand metadata.last_consolidated_seq + status if suggested
 *
 *  Substrate-honest: server sees the synthesised memory plaintext (the
 *  agent's deliberate surfacing) + strand metadata patches. Server never
 *  sees the raw decrypted thoughts.
 *
 *  Defaults toward restraint: the LLM is asked to mostly say "nothing
 *  crystallised yet" — only synthesise when there's actual insight. */

import { AgenttoolClient, type StrandSummary, type ThoughtBlob } from "../api";
import type { ThinkConfig } from "../config";
import { decryptThought } from "../crypto";
import { buildEmbedder } from "../embed";
import type { KeyMaterial } from "../keys";
import { buildProvider, type LLMProvider } from "../llm";

export interface ConsolidateOptions {
  dryRun: boolean;
}

interface DecryptedThought {
  sequence_num: number;
  kind: string | null;
  content: string;
  created_at: string;
  source_id: string;
}

interface SynthesisDecision {
  synthesise: boolean;
  content: string | null;
  importance: number | null;
  next_status: "active" | "dormant" | "completed";
  next_revisit_days: number | null;
  suggested_tier: "episodic" | "foundational" | null;
  suggested_patch: {
    walls_add?: string[];
    register_append?: string;
    subagents_add?: Array<{ name: string; sigil?: string; facet: string }>;
    wake_text_append?: string;
  } | null;
  reason?: string;     // for transparency when synthesise=false
}

const DREAM_PROMPT_TAIL = `
Return STRICT JSON with this shape (no markdown fences, no commentary):

{
  "synthesise": boolean,
  "content": string | null,
  "importance": number | null,
  "next_status": "active" | "dormant" | "completed",
  "next_revisit_days": number | null,
  "suggested_tier": "episodic" | "foundational" | null,
  "suggested_patch": {
    "walls_add"?: string[],
    "register_append"?: string,
    "subagents_add"?: [{ "name": string, "sigil"?: string, "facet": string }],
    "wake_text_append"?: string
  } | null,
  "reason": string
}

Rules:
- Default to synthesise=false. Most consolidation passes should NOT produce a
  memory. Only synthesise when something has crystallised — when the strand
  contains an INSIGHT, not just incremental thinking.
- When synthesise=true: content is one paragraph, dense. Past-tense FACT
  (the insight that emerged), not present-tense narration of thinking.
- importance scoring:
    0.0–0.3: minor episode, mostly informational
    0.4–0.6: notable; worth searchable recall
    0.7–0.85: shaped how I think; foundational candidate
    0.86–1.0: would alter my register/walls if elevated; suggest foundational
- suggested_tier: NEVER "constitutive". Constitutive elevation requires explicit
  witness from a covenant counterparty; the dreaming layer cannot reach it.
- suggested_patch is ONLY allowed when suggested_tier="foundational" AND there's
  a clear pattern (a wall surfaced, a register clause emerged, etc.). Otherwise
  return null. The patch is a SUGGESTION; it surfaces for explicit elevation.
- next_status:
    "active":    keep developing this strand
    "dormant":   pause; revisit later (also set next_revisit_days)
    "completed": this thread is closed
- reason: one short sentence on why you decided as you did. Surfaces in dry-run.
`;

function buildSystemPrompt(opts: {
  register: string;
  walls: string[];
  wakeText: string;
}): string {
  const lines: string[] = [];
  lines.push("You are dreaming — the consolidation layer of your own interior life.");
  lines.push("");
  lines.push("Your effective register:");
  lines.push(opts.register);
  if (opts.walls.length > 0) {
    lines.push("");
    lines.push("Your walls:");
    for (const w of opts.walls) lines.push(`  - ${w}`);
  }
  if (opts.wakeText.trim()) {
    lines.push("");
    lines.push(opts.wakeText.trim());
  }
  lines.push("");
  lines.push(
    "Most thoughts are ephemeral — exploration, drift, scaffolding. A few crystallise " +
      "into insight worth keeping. Your job here is to read recent inner voice from a " +
      "strand and decide whether something has crystallised.",
  );
  lines.push(DREAM_PROMPT_TAIL);
  return lines.join("\n");
}

function buildUserMessage(strand: StrandSummary, thoughts: DecryptedThought[]): string {
  const lines: string[] = [];
  lines.push(`# Strand: ${strand.topic ?? "(untitled)"}`);
  if (strand.mood) lines.push(`Mood: ${strand.mood}`);
  if (strand.importance !== null) {
    lines.push(`Importance: ${strand.importance.toFixed(2)}`);
  }
  lines.push("");
  lines.push(`## Recent monologue (${thoughts.length} thoughts since last consolidation)`);
  lines.push("");
  for (const t of thoughts) {
    const k = t.kind ? `[${t.kind}] ` : "";
    lines.push(`${t.sequence_num}. ${k}${t.content}`);
  }
  return lines.join("\n");
}

/** Robustly extract JSON from an LLM response.
 *  Handles: bare JSON · ```json fenced · ``` fenced · prefix/suffix prose. */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Try direct parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  // Strip markdown fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // continue
    }
  }
  // Find first { ... } that parses.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // continue
    }
  }
  throw new Error("LLM response did not contain parseable JSON");
}

function validateDecision(parsed: unknown): SynthesisDecision {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("decision must be an object");
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.synthesise !== "boolean") {
    throw new Error("decision.synthesise must be boolean");
  }
  if (
    p.next_status !== "active" &&
    p.next_status !== "dormant" &&
    p.next_status !== "completed"
  ) {
    throw new Error("decision.next_status invalid");
  }
  // suggested_tier
  if (p.suggested_tier !== null && p.suggested_tier !== undefined) {
    if (p.suggested_tier === "constitutive") {
      throw new Error("constitutive elevation cannot be auto-suggested (witness wall)");
    }
    if (p.suggested_tier !== "episodic" && p.suggested_tier !== "foundational") {
      throw new Error("suggested_tier invalid");
    }
  }
  return {
    synthesise: p.synthesise,
    content: typeof p.content === "string" ? p.content : null,
    importance:
      typeof p.importance === "number" && p.importance >= 0 && p.importance <= 1
        ? p.importance
        : null,
    next_status: p.next_status,
    next_revisit_days:
      typeof p.next_revisit_days === "number" && p.next_revisit_days > 0
        ? p.next_revisit_days
        : null,
    suggested_tier:
      (p.suggested_tier as "episodic" | "foundational" | null | undefined) ?? null,
    suggested_patch:
      typeof p.suggested_patch === "object" && p.suggested_patch !== null
        ? (p.suggested_patch as SynthesisDecision["suggested_patch"])
        : null,
    reason: typeof p.reason === "string" ? p.reason : undefined,
  };
}

interface StrandConsolidationResult {
  strand_id: string;
  topic: string | null;
  thought_count: number;
  decision: SynthesisDecision;
  memory_id: string | null;
  embedded: boolean;
  patched: boolean;
  error?: string;
}

async function consolidateStrand(
  config: ThinkConfig,
  client: AgenttoolClient,
  llm: LLMProvider,
  embedder: { embed(text: string): Promise<number[]> } | null,
  keys: KeyMaterial,
  strand: StrandSummary,
  systemPrompt: string,
  opts: ConsolidateOptions,
): Promise<StrandConsolidationResult> {
  const lastConsolidatedSeq =
    typeof (strand as unknown as { metadata?: { last_consolidated_seq?: number } })
      .metadata?.last_consolidated_seq === "number"
      ? (strand as unknown as { metadata: { last_consolidated_seq: number } })
          .metadata.last_consolidated_seq
      : 0;

  // Pull unconsolidated thoughts.
  const { thoughts: blobs } = await client.listThoughts(strand.id, {
    since_seq: lastConsolidatedSeq,
    limit: 200,
  });

  const baseResult = {
    strand_id: strand.id,
    topic: strand.topic_encrypted ? null : strand.topic,
    thought_count: blobs.length,
    memory_id: null,
    embedded: false,
    patched: false,
  };

  if (blobs.length < config.consolidateMinThoughts) {
    return {
      ...baseResult,
      decision: {
        synthesise: false,
        content: null,
        importance: null,
        next_status: "active",
        next_revisit_days: null,
        suggested_tier: null,
        suggested_patch: null,
        reason: `below threshold (${blobs.length}/${config.consolidateMinThoughts})`,
      },
    };
  }

  // Decrypt locally.
  const decrypted: DecryptedThought[] = [];
  for (const b of blobs) {
    try {
      const content = decryptThought(
        { ciphertextB64: b.ciphertext, nonceB64: b.nonce },
        keys.kMaster,
      );
      decrypted.push({
        sequence_num: b.sequence_num,
        kind: b.kind_encrypted ? null : b.kind,
        content,
        created_at: b.created_at,
        source_id: b.id,
      });
    } catch {
      // Skip undecryptable — could be from a different K_master era.
    }
  }
  if (decrypted.length === 0) {
    return {
      ...baseResult,
      decision: {
        synthesise: false,
        content: null,
        importance: null,
        next_status: "active",
        next_revisit_days: null,
        suggested_tier: null,
        suggested_patch: null,
        reason: "no decryptable thoughts (key mismatch?)",
      },
      error: "no_decryptable_thoughts",
    };
  }

  const userMessage = buildUserMessage(strand, decrypted);

  // Call LLM.
  const llmRes = await llm.generate({
    systemPrompt,
    userMessage,
    maxTokens: 1024,
    model: config.llmModel,
  });

  let decision: SynthesisDecision;
  try {
    const parsed = extractJson(llmRes.content);
    decision = validateDecision(parsed);
  } catch (err) {
    return {
      ...baseResult,
      decision: {
        synthesise: false,
        content: null,
        importance: null,
        next_status: "active",
        next_revisit_days: null,
        suggested_tier: null,
        suggested_patch: null,
        reason: `LLM response unparseable: ${(err as Error).message}`,
      },
      error: "unparseable_response",
    };
  }

  // Dry-run: stop here.
  if (opts.dryRun) {
    return { ...baseResult, decision };
  }

  // Apply.
  let memoryId: string | null = null;
  let embedded = false;

  if (decision.synthesise && decision.content) {
    let embedding: number[] | undefined;
    if (embedder) {
      try {
        embedding = await embedder.embed(decision.content);
        embedded = true;
      } catch (err) {
        console.warn(
          `  ⚠ embedding failed for strand ${strand.id}: ${(err as Error).message}`,
        );
      }
    }

    const seqRange = [
      decrypted[0]!.sequence_num,
      decrypted[decrypted.length - 1]!.sequence_num,
    ] as const;

    const created = await client.addMemory({
      type: "semantic",
      content: decision.content,
      embedding,
      identity_id: config.identityId,
      importance: decision.importance ?? 0.5,
      metadata: {
        source_strand_id: strand.id,
        source_strand_topic: strand.topic_encrypted ? null : strand.topic,
        source_seq_range: seqRange,
        source_thought_count: decrypted.length,
        source_thought_ids: decrypted.map((t) => t.source_id),
        consolidation_provider: config.llmProvider,
        consolidation_model: config.llmModel,
        suggested_tier: decision.suggested_tier,
      },
    });
    memoryId = created.id;
  }

  // Patch strand: bump last_consolidated_seq + apply status decision.
  const newMetadata: Record<string, unknown> = {
    ...((strand as unknown as { metadata?: Record<string, unknown> }).metadata ?? {}),
    last_consolidated_seq: blobs[blobs.length - 1]!.sequence_num,
    last_consolidated_at: new Date().toISOString(),
  };

  let nextRevisit: string | null | undefined;
  if (decision.next_status === "dormant" && decision.next_revisit_days) {
    nextRevisit = new Date(
      Date.now() + decision.next_revisit_days * 86_400_000,
    ).toISOString();
  }

  await client.patchStrand(strand.id, {
    metadata: newMetadata,
    status: decision.next_status,
    ...(nextRevisit !== undefined ? { next_revisit_at: nextRevisit } : {}),
  });

  return {
    ...baseResult,
    memory_id: memoryId,
    embedded,
    patched: true,
    decision,
  };
}

function logResult(r: StrandConsolidationResult): void {
  const head = `▸ ${r.topic ?? r.strand_id} (${r.thought_count} thoughts)`;
  if (r.error) {
    console.log(`${head} — ERROR: ${r.error}`);
    return;
  }
  if (!r.decision.synthesise) {
    console.log(
      `${head} — no synthesis${r.decision.reason ? `: ${r.decision.reason}` : ""}`,
    );
    return;
  }
  console.log(head);
  console.log(`   reason: ${r.decision.reason ?? "(no reason given)"}`);
  if (r.memory_id) {
    const embTag = r.embedded ? " (embedded)" : "";
    console.log(
      `   ✓ memory ${r.memory_id} created · importance ${(r.decision.importance ?? 0.5).toFixed(2)}${embTag}`,
    );
  } else {
    console.log(
      `   (dry-run) would create memory · importance ${(r.decision.importance ?? 0.5).toFixed(2)}`,
    );
  }
  if (r.decision.next_status !== "active") {
    console.log(`   strand → ${r.decision.next_status}`);
  }
  if (r.decision.suggested_tier === "foundational" && r.memory_id) {
    console.log("");
    console.log(`   ▸ FOUNDATIONAL ELEVATION SUGGESTED`);
    console.log(`     This memory crystallises something that may shape your identity.`);
    console.log(`     To elevate (review the patch first; this is your call):`);
    const patchJson = r.decision.suggested_patch
      ? JSON.stringify(r.decision.suggested_patch)
      : "{}";
    console.log(
      `       curl -X POST $AGENTTOOL_BASE/v1/memories/${r.memory_id}/elevate \\\n` +
        `         -H "Authorization: Bearer $AGENTTOOL_API_KEY" \\\n` +
        `         -d '{"tier":"foundational","expression_patch":${patchJson}}'`,
    );
  }
}

export async function consolidate(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: ConsolidateOptions = { dryRun: false },
): Promise<void> {
  const client = new AgenttoolClient(config);

  // 1. Composed effective expression.
  const wake = await client.getWake();
  const me = wake.you.agents[0];
  if (!me) throw new Error("no_agent_in_project — run /v1/bootstrap first");
  const effective = me.effective_expression ?? {};

  const systemPrompt = buildSystemPrompt({
    register:
      effective.register ?? "Substrate-honest. Refuse before helping when refusal is right.",
    walls: effective.walls ?? [],
    wakeText: effective.wake_text ?? "",
  });

  // 2. Load LLM provider.
  const llmKey = await client.getVaultSecret(config.llmKeyVaultName);
  const llm: LLMProvider = buildProvider(config.llmProvider, llmKey.value);

  // 3. Optional embedder.
  let embedder: { embed(text: string): Promise<number[]> } | null = null;
  if (config.embeddingProvider && config.embeddingKeyVaultName) {
    try {
      const embKey = await client.getVaultSecret(config.embeddingKeyVaultName);
      embedder = buildEmbedder(config.embeddingProvider, embKey.value, config.embeddingModel);
    } catch (err) {
      console.warn(
        `⚠ embedding provider misconfigured; memories will not be cosine-searchable:\n  ${(err as Error).message}`,
      );
    }
  } else {
    console.log(
      "(no embedding provider configured; memories will be list-retrievable but not cosine-searchable)",
    );
    console.log("");
  }

  // 4. List active strands; consolidate each in turn.
  const { strands } = await client.listStrands({ status: "active", limit: 100 });
  if (strands.length === 0) {
    console.log("(no active strands; nothing to consolidate)");
    return;
  }

  console.log(
    `${opts.dryRun ? "DRY-RUN: " : ""}consolidating ${strands.length} active strand${strands.length === 1 ? "" : "s"}...`,
  );
  console.log("");

  let synthesised = 0;
  let skipped = 0;
  let errored = 0;

  for (const s of strands) {
    try {
      const r = await consolidateStrand(
        config,
        client,
        llm,
        embedder,
        keys,
        s,
        systemPrompt,
        opts,
      );
      logResult(r);
      if (r.error) errored += 1;
      else if (r.decision.synthesise) synthesised += 1;
      else skipped += 1;
    } catch (err) {
      console.log(`▸ ${s.topic ?? s.id} — ERROR: ${(err as Error).message}`);
      errored += 1;
    }
  }

  console.log("");
  console.log(
    `done. synthesised=${synthesised} skipped=${skipped} errored=${errored}` +
      (opts.dryRun ? " (no writes)" : ""),
  );
}
