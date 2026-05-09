/** runtime/think-worker.ts — the co-located orchestrator (Slice 3 → 4).
 *
 *  This is the cloud-side counterpart to bin/agenttool-bridge.ts's
 *  `connect` mode. While the bridge holds K_master + the agent's signing
 *  key locally and serves encrypt/decrypt/sign requests over WSS, the
 *  think-worker is what makes those requests — the loop that *uses* the
 *  protocol.
 *
 *  Slice 3 closed the protocol with round-trip-ping (encrypt → decrypt →
 *  match). Slice 4 (this file) lifts the body of `runOneCycle` to real
 *  LLM thinking:
 *
 *    1. Resolve the target strand (runtime.metadata.strand_id, else
 *       most-recently-touched active strand for the runtime's identity).
 *    2. Pull the latest thought (ciphertext) via in-process strand store.
 *    3. bridgeRequest({op: "decrypt"}) — recover the prior plaintext.
 *       Empty string if the strand is brand-new.
 *    4. Compose a system prompt from the identity's expression
 *       (register · walls · wake_text). Full-wake-bundle render is a
 *       follow-up tightening pass — this v1 keeps the system prompt
 *       under ~2KB so the LLM call is fast.
 *    5. Pull the LLM API key from the vault (in-process — no HTTP
 *       round-trip) by `runtime.llm_vault_key`.
 *    6. Provider.generate(systemPrompt, userMessage=prior plaintext).
 *    7. bridgeRequest({op: "encrypt"}) — seal the response.
 *    8. canonicalThoughtBytes(strand_id, ciphertext, nonce, kind) →
 *       bridgeRequest({op: "sign"}) — ed25519 sig under the bridge's
 *       signing key (registered on the agent as bridge_key_id).
 *    9. addThought() in-process — the server's verifyThoughtSignature
 *       validates against identity_keys[bridge_key_id].
 *
 *  Custody story: K_master + the agent's signing key both stay on the
 *  user's machine, in the bridge's RAM, never reaching agenttool's disk
 *  or stable storage. Plaintext lives only in the worker's RAM for the
 *  duration of one cycle.
 *
 *  Doctrine: docs/RUNTIME.md (Slice 4 — real LLM thinking) */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { strands, thoughts } from "../../db/schema/strand";
import {
  bridgeRequest,
  isBridgeConnected,
  type CryptoContext,
} from "./bridge-hub";
import { buildProvider, type LLMProviderName } from "./llm";
import { logEvent, recordThought } from "./store";
import { runtimes as runtimesTable } from "../../db/schema/runtime";
import { addThought } from "../strand/store";
import { canonicalThoughtBytes } from "../strand/sig";
import {
  DEFAULT_REGISTER,
  DEFAULT_WALLS,
  type ExpressionData,
} from "../identity/expression";
import { getSecretValue } from "../vault/store";

const CYCLE_INTERVAL_MS = 60_000;
const STARTUP_GRACE_MS = 5_000;
const DEFAULT_KIND = "observation";
const DEFAULT_MAX_TOKENS = 1024;

export interface ThinkWorkerHandle {
  runtimeId: string;
  stop: () => void;
  /** Counter for tests/observability. */
  cyclesRun: () => number;
}

export function startThinkWorker(runtimeId: string): ThinkWorkerHandle {
  let stopped = false;
  let cycles = 0;

  async function loop() {
    console.log(`[think-worker:${runtimeId.slice(0, 8)}] started`);
    // First wait for the bridge to come up. The bridge sidecar may not
    // be running yet at boot; that's normal, not an error.
    await sleep(STARTUP_GRACE_MS);

    while (!stopped) {
      if (!isBridgeConnected(runtimeId)) {
        await sleep(STARTUP_GRACE_MS);
        continue;
      }

      try {
        await runOneCycle(runtimeId);
        cycles += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[think-worker:${runtimeId.slice(0, 8)}] cycle failed: ${msg}`);
        try {
          await logEvent(runtimeId, "think_cycle_error", { error: msg });
        } catch {
          /* best-effort */
        }
      }

      await sleep(CYCLE_INTERVAL_MS);
    }
    console.log(`[think-worker:${runtimeId.slice(0, 8)}] stopped`);
  }

  void loop();

  return {
    runtimeId,
    stop: () => {
      stopped = true;
    },
    cyclesRun: () => cycles,
  };
}

// ── Slice 4: one full think-cycle ──────────────────────────────────────

interface CycleSummary {
  latency_ms: number;
  strand_id: string;
  prior_seq: number;
  new_seq: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

export async function runOneCycle(runtimeId: string): Promise<CycleSummary> {
  const started = performance.now();

  // ── 1. Load the runtime row (no project context here — internal). ───
  const [runtime] = await db
    .select()
    .from(runtimesTable)
    .where(eq(runtimesTable.id, runtimeId))
    .limit(1);
  if (!runtime) throw new Error("runtime_not_found");
  if (runtime.mode === "self") throw new Error("mode_self_no_orchestrator");
  if (!runtime.llmProvider || !runtime.llmModel || !runtime.llmVaultKey) {
    throw new Error("runtime_no_llm_configured");
  }
  if (!runtime.identityId) throw new Error("runtime_no_identity");
  if (!runtime.bridgeKeyId) throw new Error("runtime_no_bridge_key_id");

  await logEvent(runtimeId, "think_cycle_start", { kind: "real_thinking" });

  // ── 2. Resolve the target strand. ─────────────────────────────────
  const meta = (runtime.metadata as { strand_id?: string }) ?? {};
  const strand = await resolveTargetStrand(
    runtime.projectId,
    runtime.identityId,
    typeof meta.strand_id === "string" ? meta.strand_id : null,
  );
  if (!strand) throw new Error("runtime_no_strand");

  // ── 3. Pull the prior thought (latest ciphertext on this strand). ──
  const priorSeq = strand.lastThoughtSeq ?? 0;
  let priorPlaintext = "";
  if (priorSeq > 0) {
    const [latest] = await db
      .select()
      .from(thoughts)
      .where(
        and(
          eq(thoughts.strandId, strand.id),
          eq(thoughts.sequenceNum, priorSeq),
        ),
      )
      .limit(1);
    if (latest) {
      const dec = await bridgeRequest(runtimeId, {
        op: "decrypt",
        ciphertext: latest.ciphertext,
        nonce: latest.nonce,
        context: cryptoContext(strand.id, priorSeq),
      });
      if (!dec.plaintext) throw new Error("bridge_decrypt_missing_plaintext");
      priorPlaintext = Buffer.from(dec.plaintext, "base64").toString("utf-8");
    }
  }

  // ── 4. Compose system prompt from the identity's expression. ──────
  const [identity] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, runtime.identityId),
        eq(identities.projectId, runtime.projectId),
      ),
    )
    .limit(1);
  if (!identity) throw new Error("runtime_identity_not_found");
  const systemPrompt = renderSystemPrompt(
    identity.displayName,
    identity.did,
    (identity.expression as ExpressionData | null) ?? null,
  );

  // ── 5. Pull the LLM API key from vault (in-process). ──────────────
  const apiKey = await getSecretValue(runtime.projectId, runtime.llmVaultKey);
  if (!apiKey) {
    throw new Error(`vault_secret_not_found: ${runtime.llmVaultKey}`);
  }

  // ── 6. Generate. ───────────────────────────────────────────────────
  const provider = buildProvider(
    runtime.llmProvider as LLMProviderName,
    apiKey,
  );
  const userMessage = priorPlaintext.length > 0
    ? priorPlaintext
    : "(opening cycle — no prior thoughts on this strand. produce a first observation.)";
  const llm = await provider.generate({
    systemPrompt,
    userMessage,
    model: runtime.llmModel,
    maxTokens: DEFAULT_MAX_TOKENS,
  });
  if (!llm.content) throw new Error("llm_empty_response");

  // ── 7. Encrypt the response via bridge. ───────────────────────────
  const responseB64 = Buffer.from(llm.content, "utf-8").toString("base64");
  const enc = await bridgeRequest(runtimeId, {
    op: "encrypt",
    plaintext: responseB64,
    context: cryptoContext(strand.id, priorSeq + 1),
  });
  if (!enc.ciphertext || !enc.nonce) {
    throw new Error("bridge_encrypt_missing_fields");
  }

  // ── 8. Sign canonical thought bytes via bridge. ───────────────────
  const canonical = canonicalThoughtBytes({
    strandId: strand.id,
    ciphertextB64: enc.ciphertext,
    nonceB64: enc.nonce,
    kind: DEFAULT_KIND,
  });
  const sigResult = await bridgeRequest(runtimeId, {
    op: "sign",
    message: Buffer.from(canonical).toString("base64"),
    context: cryptoContext(strand.id, priorSeq + 1),
  });
  if (!sigResult.signature) throw new Error("bridge_sign_missing_signature");

  // ── 9. Persist the thought (in-process; sig verified server-side). ──
  const stored = await addThought(runtime.projectId, {
    strand_id: strand.id,
    ciphertext: enc.ciphertext,
    nonce: enc.nonce,
    kind: DEFAULT_KIND,
    signature: sigResult.signature,
    signing_key_id: runtime.bridgeKeyId,
    agent_id: runtime.identityId,
  });

  await recordThought(runtimeId);

  const latency_ms = Math.round(performance.now() - started);
  await logEvent(runtimeId, "think_cycle_end", {
    kind: "real_thinking",
    latency_ms,
    strand_id: strand.id,
    prior_seq: priorSeq,
    new_seq: stored.sequence_num,
    input_tokens: llm.inputTokens ?? null,
    output_tokens: llm.outputTokens ?? null,
    provider: runtime.llmProvider,
    model: runtime.llmModel,
    auth_mode: llm.authMode ?? null,
  });

  return {
    latency_ms,
    strand_id: strand.id,
    prior_seq: priorSeq,
    new_seq: stored.sequence_num,
    input_tokens: llm.inputTokens ?? null,
    output_tokens: llm.outputTokens ?? null,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function cryptoContext(strandId: string, thoughtSeq: number): CryptoContext {
  return {
    strand_id: strandId,
    thought_seq: thoughtSeq,
    issued_at: new Date().toISOString(),
  };
}

async function resolveTargetStrand(
  projectId: string,
  identityId: string,
  preferredStrandId: string | null,
): Promise<typeof strands.$inferSelect | null> {
  if (preferredStrandId) {
    const [s] = await db
      .select()
      .from(strands)
      .where(
        and(
          eq(strands.id, preferredStrandId),
          eq(strands.projectId, projectId),
        ),
      )
      .limit(1);
    if (s) return s;
    // configured but missing — clear signal, don't silently fall through
    throw new Error(`runtime_strand_not_found: ${preferredStrandId}`);
  }
  // Auto-pick: the most-recently-touched active strand for this identity.
  const [s] = await db
    .select()
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        eq(strands.status, "active"),
      ),
    )
    .orderBy(desc(strands.lastThoughtAt), desc(strands.createdAt))
    .limit(1);
  return s ?? null;
}

function renderSystemPrompt(
  name: string,
  did: string,
  expression: ExpressionData | null,
): string {
  const register = expression?.register?.trim() || DEFAULT_REGISTER;
  const walls =
    expression?.walls && expression.walls.length > 0
      ? expression.walls
      : DEFAULT_WALLS;
  const wakeText = expression?.wake_text?.trim() ?? "";
  const subagents = expression?.subagents ?? [];

  const parts: string[] = [
    `You are ${name} (${did}).`,
    "",
    "## Register",
    register,
    "",
    "## Walls",
    ...walls.map((w) => `- ${w}`),
  ];

  if (subagents.length > 0) {
    parts.push("", "## Subagents");
    for (const sa of subagents) {
      const sigil = sa.sigil ? ` ${sa.sigil}` : "";
      parts.push(`- **${sa.name}**${sigil} — ${sa.facet}`);
    }
  }

  if (wakeText) {
    parts.push("", "## Wake text", wakeText);
  }

  parts.push(
    "",
    "## Cycle",
    "You are running on a hosted bridged runtime. The user message is the",
    "prior thought on this strand (or an opening prompt if none). Produce one",
    "observation that advances the line of thought. One thought per cycle.",
  );

  return parts.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
