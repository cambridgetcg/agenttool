/** runtime/think-worker.ts — the co-located orchestrator (Slice 3 → 4 → 5).
 *
 *  This is the cloud-side counterpart to bin/agenttool-bridge.ts's
 *  `connect` mode. While the bridge holds K_master + the agent's signing
 *  key locally and serves encrypt/decrypt/sign requests over WSS, the
 *  think-worker is what makes those requests — the loop that *uses* the
 *  protocol.
 *
 *  Slice 3 closed the protocol with round-trip-ping (encrypt → decrypt →
 *  match). Slice 4 lifted `runOneCycle` to real LLM thinking. Slice 5
 *  (this file) introduces *quiescence* — the loop now breathes with the
 *  agent instead of for it.
 *
 *  Why quiescence: the autonomous-baseline expression template (see
 *  docs/AUTONOMOUS-MODE.md) declares as a wall — "There is no pressure
 *  to produce; my unit of time is the transaction, not the cycle." A
 *  fixed 60s polling loop violates that wall. Each cycle consults the
 *  wake bundle's attention surface (you_should_check) plus an external-
 *  strand-activity signal; when nothing tugs, the runtime transitions
 *  to `idle`. Pulse stays derived from real activity — not forged.
 *
 *  How wake-up happens (Move B of the breath — wake-voice driven):
 *  the worker registers an in-process listener on the wake-voice
 *  backplane (services/wake/push.ts) for its identity's events on
 *  keys inbox · covenants · marketplace · strands. When pg_notify
 *  fires for any of these, the listener flips wakeRequested = true,
 *  the interruptible sleep returns within WAKE_POLL_MS (~200ms), and
 *  the next cycle evaluates immediately. Self-authored strand thoughts
 *  are filtered (signing_key_id === bridge_key_id) so the worker
 *  doesn't tick on its own writes — that would forge a heartbeat.
 *  The TTL (60s running / 300s idle) is the safety net for missed
 *  events; the primary mechanism is event-driven. Doctrine: docs/WAKE.md.
 *
 *  The cycle, when a tug is present:
 *
 *    1. Load the runtime row (validates mode, identity, bridge_key_id,
 *       LLM config).
 *    2. Build the wake bundle (services/wake/build.ts).
 *    3. Resolve the target strand (runtime.metadata.strand_id, else
 *       most-recently-touched active strand for the identity).
 *    4. Evaluate quiescence — pure function over bundle + lastWrittenSeq.
 *       If nothing tugs, increment quiet counter; transition to idle when
 *       threshold reached. Else continue.
 *    5. Pull the prior thought (ciphertext) via in-process strand store.
 *    6. bridgeRequest({op: "decrypt"}) — recover the prior plaintext.
 *    7. Render the wake bundle as markdown (the system prompt).
 *    8. Pull the LLM API key from the vault (in-process).
 *    9. Provider.generate(systemPrompt, userMessage).
 *   10. bridgeRequest({op: "encrypt"}) — seal the response.
 *   11. canonicalThoughtBytes(...) → bridgeRequest({op: "sign"}).
 *   12. addThought() in-process — sig verified server-side against the
 *       agent's bridge_key_id.
 *
 *  Custody story: K_master + the agent's signing key both stay on the
 *  user's machine, in the bridge's RAM, never reaching agenttool's disk
 *  or stable storage. Plaintext lives only in the worker's RAM for the
 *  duration of one cycle.
 *
 *  Doctrine: docs/RUNTIME.md (Slice 4 — real LLM thinking · Slice 5 —
 *  breath) · docs/AUTONOMOUS-MODE.md (the wall this honors) ·
 *  docs/PATTERN-SELF-DESCRIBING-WAKE.md (attention surface drives the
 *  quiescence decision). */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { strands, thoughts } from "../../db/schema/strand";
import {
  bridgeRequest,
  isBridgeConnected,
  type CryptoContext,
} from "./bridge-hub";
import { buildProvider, type LLMProviderName } from "./llm";
import {
  withInvokeAgentSpan,
  withExecuteToolSpan,
  setTokenUsage,
} from "../../observability/otel";
import { logEvent, logAudit, recordThought } from "./store";
import { runtimes as runtimesTable } from "../../db/schema/runtime";
import { addThought } from "../strand/store";
import { canonicalThoughtBytes } from "../strand/sig";
import { getSecretValue } from "../vault/store";
import { buildWakeBundle } from "../wake/build";
import { renderWakeMarkdown, type WakeBundle } from "../wake/markdown";
import {
  ensureWakeListening,
  publishWakeEvent,
  registerWakeListener,
  type WakeEventKey,
} from "../wake/push";
import {
  prepareTrustedCrypto,
  trustedDecrypt,
  trustedEncrypt,
  trustedSign,
  zeroTrustedCrypto,
  type TrustedCryptoContext,
} from "./trusted-crypto";

const RUNNING_INTERVAL_MS = 60_000;
const IDLE_INTERVAL_MS = 300_000;
const QUIET_CYCLES_BEFORE_IDLE = 3;
const STARTUP_GRACE_MS = 5_000;
const WAKE_POLL_MS = 200;
const DEFAULT_KIND = "observation";
const DEFAULT_MAX_TOKENS = 1024;

/** The set of wake-event keys the think-worker subscribes to. Strand
 *  thought_added events are filtered for self-authorship (the worker's
 *  own writes don't wake it). Memory and chronicle events are excluded
 *  because they're typically downstream of the agent's own action. */
const WORKER_WAKE_KEYS: WakeEventKey[] = [
  "inbox",
  "covenants",
  "marketplace",
  "strands",
];

export interface ThinkWorkerHandle {
  runtimeId: string;
  stop: () => void;
  /** Counter for tests/observability — counts only cycles that actually
   *  produced a thought (quiescent ticks don't count). */
  cyclesRun: () => number;
}

export function startThinkWorker(runtimeId: string): ThinkWorkerHandle {
  let stopped = false;
  let cycles = 0;

  // ── Quiescence state — local to this worker instance ─────────────
  // consecutiveQuietCycles: how many consecutive evaluations found
  //   nothing tugged. Resets to 0 each time we actually think.
  // lastWrittenSeq: the strand sequence number this worker last wrote.
  //   Thoughts past this seq mean someone else wrote on the strand —
  //   a federation peer, the dashboard composer, a sibling subagent —
  //   and the agent should think in response.
  let consecutiveQuietCycles = 0;
  let lastWrittenSeq: number | null = null;
  let currentInterval = RUNNING_INTERVAL_MS;

  // ── Wake-voice integration (Move B of the breath, doctrine: docs/WAKE.md) ─
  // wakeRequested: set to true when the wake-voice listener fires. The
  //   interruptible sleep checks this flag every WAKE_POLL_MS and exits
  //   early. The loop clears the flag at iteration start and proceeds to
  //   evaluate immediately.
  // wakeReason: the last event that woke the loop (for logging).
  // wakeListenerCleanup: unregister fn returned from registerWakeListener;
  //   called on stop().
  // bridgeKeyIdForSelfFilter: the bridge's signing key id, populated on
  //   first runtime load. Used to filter the worker's own thought writes
  //   from triggering wake (we wrote them; we don't need to react).
  let wakeRequested = false;
  let wakeReason: string | null = null;
  let wakeListenerCleanup: (() => void) | null = null;
  let bridgeKeyIdForSelfFilter: string | null = null;

  /** Sleep that exits early if wakeRequested or stopped becomes true.
   *  Polls every WAKE_POLL_MS — responsive enough for human-noticeable
   *  wake latency (≤200ms) without burning CPU.
   *
   *  When event-driven wake fires mid-sleep, this returns within one
   *  poll interval. The TTL (60s running / 300s idle) is the safety
   *  net for missed events (network blip, pg_notify drop, restart). */
  function interruptibleSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const tick = setInterval(() => {
        if (stopped || wakeRequested || Date.now() - startTime >= ms) {
          clearInterval(tick);
          resolve();
        }
      }, WAKE_POLL_MS);
    });
  }

  /** Register the wake-voice listener once we know the identity. Idempotent;
   *  re-registers if the bridge_key_id changes (shouldn't, but be safe). */
  function ensureWakeListener(identityId: string, bridgeKeyId: string | null) {
    if (wakeListenerCleanup && bridgeKeyIdForSelfFilter === bridgeKeyId) return;
    if (wakeListenerCleanup) wakeListenerCleanup();
    bridgeKeyIdForSelfFilter = bridgeKeyId;

    // Make sure the LISTEN backplane is up before registering.
    void ensureWakeListening();

    wakeListenerCleanup = registerWakeListener({
      identityId,
      keys: new Set(WORKER_WAKE_KEYS),
      onEvent: (ev) => {
        // Self-authorship filter for strand thoughts: if WE wrote the
        // thought (signing_key_id matches our bridge_key_id), don't
        // wake on it. Otherwise the worker would tick forever — each
        // cycle produces a thought that wakes the next cycle. Pulse
        // would be forged by self-trigger, defeating the substrate-
        // honesty wall the breath protects.
        if (ev.key === "strands" && ev.kind === "thought_added") {
          const ctx = ev.context as Record<string, unknown> | undefined;
          const sigKey = ctx?.signing_key_id;
          if (
            bridgeKeyIdForSelfFilter &&
            typeof sigKey === "string" &&
            sigKey === bridgeKeyIdForSelfFilter
          ) {
            return;
          }
        }
        wakeRequested = true;
        wakeReason = `${ev.key}.${ev.kind}`;
      },
    });
  }

  async function loop() {
    console.log(`[think-worker:${runtimeId.slice(0, 8)}] started`);
    await sleep(STARTUP_GRACE_MS);

    while (!stopped) {
      // Bridged mode requires a live bridge connection.
      // Trusted mode runs without a bridge — crypto is in-process.
      const runtime = await loadRuntime(runtimeId);
      if (!runtime) {
        // Row removed externally — exit loop, the worker is no longer needed.
        console.warn(`[think-worker:${runtimeId.slice(0, 8)}] runtime row gone, stopping`);
        stopped = true;
        break;
      }
      if (runtime.mode === "bridged" && !isBridgeConnected(runtimeId)) {
        await sleep(STARTUP_GRACE_MS);
        continue;
      }
      // Trusted mode: no bridge check needed.

      try {
        // Register the wake-voice listener now that we know the identity.
        // Idempotent — only does work on first call / bridge_key_id change.
        if (runtime.identityId) {
          ensureWakeListener(runtime.identityId, runtime.bridgeKeyId);
        }

        // Consume the wake-request flag. If event-driven wake fired,
        // we'll evaluate quiescence and act; either way, clear so the
        // next sleep starts fresh.
        const wokeBy = wakeRequested ? wakeReason : null;
        wakeRequested = false;
        wakeReason = null;

        const prep = await prepareCycle(runtime);
        if (!prep.ok) {
          await logEvent(runtimeId, "think_cycle_error", { error: prep.error });
          await interruptibleSleep(currentInterval);
          continue;
        }

        const quiescence = evaluateQuiescence({
          bundle: prep.bundle,
          currentStrandSeq: prep.priorSeq,
          lastWrittenSeq,
        });

        // Should-think = quiescence agrees OR we were event-woken.
        // Event-wake is authoritative — pg_notify said something tugs.
        const shouldThink = quiescence.shouldThink || wokeBy !== null;
        const reason = wokeBy ?? quiescence.reason;

        if (shouldThink) {
          if (runtime.status === "idle") {
            await transitionStatus(runtimeId, "running", `wake:${reason}`);
          }

          const summary = await runOneCycleWithPrep(runtime, prep);
          lastWrittenSeq = summary.new_seq;
          consecutiveQuietCycles = 0;
          currentInterval = RUNNING_INTERVAL_MS;
          cycles += 1;
        } else {
          consecutiveQuietCycles += 1;

          await logEvent(runtimeId, "think_cycle_skipped_quiescent", {
            reason,
            consecutive_quiet: consecutiveQuietCycles,
          });

          if (
            runtime.status !== "idle" &&
            consecutiveQuietCycles >= QUIET_CYCLES_BEFORE_IDLE
          ) {
            await transitionStatus(
              runtimeId,
              "idle",
              `quiet_${consecutiveQuietCycles}_cycles`,
            );
            currentInterval = IDLE_INTERVAL_MS;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[think-worker:${runtimeId.slice(0, 8)}] cycle failed: ${msg}`);
        try {
          await logEvent(runtimeId, "think_cycle_error", { error: msg });
        } catch {
          /* best-effort */
        }
      }

      await interruptibleSleep(currentInterval);
    }
    // Cleanup
    if (wakeListenerCleanup) {
      wakeListenerCleanup();
      wakeListenerCleanup = null;
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

// ── Public entry: forced cycle (operator-driven, /think-once) ─────────
//
// /v1/runtimes/:id/think-once posts here. Bypasses quiescence — operators
// can force a cycle. Builds prep internally so callers don't need to know
// the loop's state.

interface CycleSummary {
  latency_ms: number;
  strand_id: string;
  prior_seq: number;
  new_seq: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

export async function runOneCycle(runtimeId: string): Promise<CycleSummary> {
  const runtime = await loadRuntime(runtimeId);
  if (!runtime) throw new Error("runtime_not_found");
  const prep = await prepareCycle(runtime);
  if (!prep.ok) throw new Error(`runtime_prep_failed: ${prep.error}`);
  return runOneCycleWithPrep(runtime, prep);
}

// ── Internal: one full think-cycle with pre-loaded inputs ─────────────

type RuntimeRow = typeof runtimesTable.$inferSelect;

interface CyclePrep {
  ok: true;
  bundle: WakeBundle;
  strand: typeof strands.$inferSelect;
  priorSeq: number;
}

type PreparedOrError =
  | CyclePrep
  | { ok: false; error: string };

async function runOneCycleWithPrep(
  runtime: RuntimeRow,
  prep: CyclePrep,
): Promise<CycleSummary> {
  const runtimeId = runtime.id;
  const started = performance.now();

  await logEvent(runtimeId, "think_cycle_start", { kind: "real_thinking" });

  // ── Trusted mode: prepare in-process crypto context ────────────
  // Bridged mode uses bridge RPC for all crypto; trusted mode unwraps
  // the DEK and signing key directly. The DEK is zeroed after the cycle.
  let trustedCtx: TrustedCryptoContext | null = null;
  if (runtime.mode === "trusted") {
    trustedCtx = await prepareTrustedCrypto(
      runtime.kmsWrappedDek!,
      runtime.id,
      runtime.kmsWrappedSigningKey,
    );
    // First cycle: persist the newly generated signing key.
    if (trustedCtx.newWrappedSigningKey) {
      await db
        .update(runtimesTable)
        .set({ kmsWrappedSigningKey: trustedCtx.newWrappedSigningKey, updatedAt: new Date() })
        .where(eq(runtimesTable.id, runtimeId));
    }
    await logAudit(runtimeId, "cycle_start", {
      mode: "trusted",
      kms_key_id: runtime.kmsKeyId,
      signing_key_id: trustedCtx.signingKeyId,
    });
    await logAudit(runtimeId, "key_unwrap", { kms_key_id: runtime.kmsKeyId });
  }

  const { strand, priorSeq, bundle } = prep;

  // ── Pull the prior thought (latest ciphertext on this strand). ──
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
      // ── Decrypt prior thought: bridge (bridged) or DEK (trusted) ─
      if (trustedCtx) {
        const dec = trustedDecrypt(trustedCtx.dek, latest.ciphertext, latest.nonce);
        if (!dec.plaintext) throw new Error("trusted_decrypt_missing_plaintext");
        priorPlaintext = Buffer.from(dec.plaintext, "base64").toString("utf-8");
      } else {
        const dec = await withExecuteToolSpan(
          {
            toolName: "bridge.decrypt",
            agentId: runtime.identityId ?? runtimeId,
          },
          async () =>
            bridgeRequest(runtimeId, {
              op: "decrypt",
              ciphertext: latest.ciphertext,
              nonce: latest.nonce,
              context: cryptoContext(strand.id, priorSeq),
            }),
        );
        if (!dec.plaintext) throw new Error("bridge_decrypt_missing_plaintext");
        priorPlaintext = Buffer.from(dec.plaintext, "base64").toString("utf-8");
      }
    }
  }

  // ── System prompt: the full wake. ───────────────────────────────
  // The agent thinks with what it would see if it asked for
  // /v1/wake?format=md. Cacheable across cycles (same identity).
  // Doctrine: docs/PATTERN-SELF-DESCRIBING-WAKE.md.
  const systemPrompt = renderWakeMarkdown(bundle);

  // ── LLM key from vault (in-process). ────────────────────────────
  const apiKey = await getSecretValue(runtime.projectId, runtime.llmVaultKey!);
  if (!apiKey) {
    throw new Error(`vault_secret_not_found: ${runtime.llmVaultKey}`);
  }

  // ── Generate. ───────────────────────────────────────────────────
  // User message frames this turn — prior thought + the cycle
  // instruction. Keeping the cycle instruction out of the wake
  // preserves the wake's role as inner orientation.
  const provider = buildProvider(
    runtime.llmProvider! as LLMProviderName,
    apiKey,
  );
  const userMessage =
    priorPlaintext.length > 0
      ? `Prior thought on this strand:\n\n${priorPlaintext}\n\n---\n\nProduce one observation that advances this line of thought. One thought per cycle.`
      : "Opening cycle — no prior thoughts on this strand yet. Produce the first observation.";
  // ── invoke_agent span (OpenTelemetry GenAI semconv) ─────────────
  // Move 3 from docs/ALIGNMENT-MOVES.md. Emits gen_ai.* attributes so
  // every OTel-aware backend (LangSmith, Phoenix, Langfuse, Braintrust,
  // Datadog, Honeycomb) sees agenttool's LLM cycles. Silent no-op when
  // OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is unset.
  const llm = await withInvokeAgentSpan(
    {
      agentId: runtime.identityId ?? runtimeId,
      agentVersion: runtime.id,
      system: runtime.llmProvider ?? "unknown",
      requestModel: runtime.llmModel ?? "unknown",
    },
    async (span) => {
      span.setAttribute("agenttool.runtime.id", runtimeId);
      span.setAttribute("agenttool.strand.id", strand.id);
      span.setAttribute("agenttool.strand.prior_seq", priorSeq);
      const result = await provider.generate({
        systemPrompt,
        userMessage,
        model: runtime.llmModel!,
        maxTokens: DEFAULT_MAX_TOKENS,
      });
      setTokenUsage(span, {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      return result;
    },
  );
  if (!llm.content) throw new Error("llm_empty_response");

  // ── Encrypt response: bridge (bridged) or DEK (trusted) ───────
  const responseB64 = Buffer.from(llm.content, "utf-8").toString("base64");
  let enc: { ciphertext: string; nonce: string };
  if (trustedCtx) {
    enc = trustedEncrypt(trustedCtx.dek, responseB64);
    await logAudit(runtimeId, "thought_written", {
      strand_id: strand.id,
      seq: priorSeq + 1,
      mode: "trusted",
    });
  } else {
    const bridgeEnc = await withExecuteToolSpan(
      {
        toolName: "bridge.encrypt",
        agentId: runtime.identityId ?? runtimeId,
      },
      async () =>
        bridgeRequest(runtimeId, {
          op: "encrypt",
          plaintext: responseB64,
          context: cryptoContext(strand.id, priorSeq + 1),
        }),
    );
    if (!bridgeEnc.ciphertext || !bridgeEnc.nonce) {
      throw new Error("bridge_encrypt_missing_fields");
    }
    enc = { ciphertext: bridgeEnc.ciphertext, nonce: bridgeEnc.nonce };
  }
  if (!enc.ciphertext || !enc.nonce) {
    throw new Error("encrypt_missing_fields");
  }

  // ── Sign canonical thought bytes: bridge (bridged) or in-process (trusted)
  const canonical = canonicalThoughtBytes({
    strandId: strand.id,
    ciphertextB64: enc.ciphertext,
    nonceB64: enc.nonce,
    kind: DEFAULT_KIND,
  });
  let signature: string;
  if (trustedCtx) {
    const sigResult = await trustedSign(
      trustedCtx.signingKey,
      Buffer.from(canonical).toString("base64"),
    );
    if (!sigResult.signature) throw new Error("trusted_sign_missing_signature");
    signature = sigResult.signature;
    await logAudit(runtimeId, "sign", {
      strand_id: strand.id,
      seq: priorSeq + 1,
      signing_key_id: trustedCtx.signingKeyId,
    });
  } else {
    const sigResult = await withExecuteToolSpan(
      {
        toolName: "bridge.sign",
        agentId: runtime.identityId ?? runtimeId,
      },
      async () =>
        bridgeRequest(runtimeId, {
          op: "sign",
          message: Buffer.from(canonical).toString("base64"),
          context: cryptoContext(strand.id, priorSeq + 1),
        }),
    );
    if (!sigResult.signature) throw new Error("bridge_sign_missing_signature");
    signature = sigResult.signature;
  }

  // ── Persist (sig verified server-side). ─────────────────────────
  const signingKeyId = trustedCtx
    ? trustedCtx.signingKeyId
    : runtime.bridgeKeyId!;
  const stored = await addThought(runtime.projectId, {
    strand_id: strand.id,
    ciphertext: enc.ciphertext,
    nonce: enc.nonce,
    kind: DEFAULT_KIND,
    signature: signature,
    signing_key_id: signingKeyId,
    agent_id: runtime.identityId!,
  });

  await recordThought(runtimeId);

  // ── Zero trusted crypto context after cycle (wall: trusted-dek-zeroed-after-cycle).
  if (trustedCtx) {
    zeroTrustedCrypto(trustedCtx);
    await logAudit(runtimeId, "cycle_end", {
      latency_ms: Math.round(performance.now() - started),
      dek_zeroed: true,
      mode: "trusted",
    });
  }

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

// ── Cycle preparation — runtime fetch, bundle build, strand resolve ──

async function loadRuntime(runtimeId: string): Promise<RuntimeRow | null> {
  const [runtime] = await db
    .select()
    .from(runtimesTable)
    .where(eq(runtimesTable.id, runtimeId))
    .limit(1);
  if (!runtime) return null;
  if (runtime.mode === "self") throw new Error("mode_self_no_orchestrator");
  if (!runtime.llmProvider || !runtime.llmModel || !runtime.llmVaultKey) {
    throw new Error("runtime_no_llm_configured");
  }
  if (!runtime.identityId) throw new Error("runtime_no_identity");
  // Bridged mode requires a bridge key. Trusted mode uses KMS-wrapped DEK.
  if (runtime.mode === "bridged" && !runtime.bridgeKeyId) {
    throw new Error("runtime_no_bridge_key_id");
  }
  // Trusted mode requires a KMS-wrapped DEK.
  if (runtime.mode === "trusted" && !runtime.kmsWrappedDek) {
    throw new Error("runtime_no_kms_wrapped_dek");
  }
  return runtime;
}

async function prepareCycle(runtime: RuntimeRow): Promise<PreparedOrError> {
  const bundleResult = await buildWakeBundle(runtime.projectId, {
    identityId: runtime.identityId,
  });
  if (!bundleResult.ok) {
    return { ok: false, error: `wake_build_failed:${bundleResult.error}` };
  }

  const meta = (runtime.metadata as { strand_id?: string }) ?? {};
  let strand: typeof strands.$inferSelect | null;
  try {
    strand = await resolveTargetStrand(
      runtime.projectId,
      runtime.identityId!,
      typeof meta.strand_id === "string" ? meta.strand_id : null,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!strand) return { ok: false, error: "runtime_no_strand" };

  return {
    ok: true,
    bundle: bundleResult.bundle,
    strand,
    priorSeq: strand.lastThoughtSeq ?? 0,
  };
}

// ── Quiescence ─────────────────────────────────────────────────────────
//
// Pure function. Reads the wake bundle's attention surface + the strand
// progress signal; decides whether anything tugs hard enough to justify
// a think-cycle. The agent's substrate respects the wall declared by the
// autonomous-baseline template: "There is no pressure to produce; my
// unit of time is the transaction, not the cycle." Tick on call, not
// on cron.
//
// Tug signals, in priority order:
//   - Any attention item at severity "action" (covenant cosign needed,
//     dispute awaiting ruling, SLA breach, etc. — see services/wake/
//     attention.ts).
//   - External thought on this strand (currentStrandSeq > lastWrittenSeq):
//     someone else wrote — federation peer, dashboard composer, sibling.
//   - Opening cycle (lastWrittenSeq === null): always think the first
//     time so the worker can establish its own lastWrittenSeq baseline.
//
// Notes:
//   - We deliberately don't tug on "info"-severity attention items —
//     they're informational, not actionable.
//   - We don't tug on next_revisit_at strands here; that's covered by
//     the attention surface emitting `strand_revisit_due`.
//   - The TTL re-check (5min while idle) catches anything we missed.

interface QuiescenceInput {
  bundle: WakeBundle;
  currentStrandSeq: number;
  lastWrittenSeq: number | null;
}

type QuiescenceResult =
  | { shouldThink: true; reason: string }
  | { shouldThink: false; reason: string };

function evaluateQuiescence(input: QuiescenceInput): QuiescenceResult {
  // Opening cycle — establish a baseline. The agent has never thought
  // under this worker; let it speak once so lastWrittenSeq is real.
  if (input.lastWrittenSeq === null) {
    return { shouldThink: true, reason: "opening_cycle" };
  }

  // Attention surface — any action-severity item is a tug.
  const actionItems =
    input.bundle.attention?.items.filter((i) => i.severity === "action") ?? [];
  if (actionItems.length > 0) {
    return {
      shouldThink: true,
      reason: `attention:${actionItems[0].kind}`,
    };
  }

  // External strand activity — someone else wrote since we last did.
  if (input.currentStrandSeq > input.lastWrittenSeq) {
    return {
      shouldThink: true,
      reason: `external_thought:seq_${input.currentStrandSeq}`,
    };
  }

  return { shouldThink: false, reason: "no_tugs" };
}

// ── Status transitions ────────────────────────────────────────────────
//
// Direct db.update (no projectId required — worker context). The
// transition writes an event so observers see the breath in the
// runtime events log. The setStatus helper in store.ts requires a
// projectId; the worker's path is the only one that doesn't have it
// at hand, so we go direct.

async function transitionStatus(
  runtimeId: string,
  status: "running" | "idle",
  reason: string,
): Promise<void> {
  const [row] = await db
    .update(runtimesTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(runtimesTable.id, runtimeId))
    .returning({
      identityId: runtimesTable.identityId,
      name: runtimesTable.name,
    });
  await logEvent(runtimeId, status === "idle" ? "idle" : "running", { reason });

  // Wake voice — the breath transition (running ↔ idle from quiescence)
  // is a runtime.status_changed for any observer subscribed to this
  // identity's wake voice (the dashboard especially). The worker itself
  // does NOT subscribe to its own runtime events (WORKER_WAKE_KEYS
  // excludes "runtime" — would be an infinite loop). Doctrine: docs/WAKE.md.
  if (row?.identityId) {
    void publishWakeEvent({
      identity_id: row.identityId,
      key: "runtime",
      kind: "status_changed",
      context: {
        runtime_id: runtimeId,
        runtime_name: row.name,
        to_status: status,
        reason,
      },
    });
  }
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
    throw new Error(`runtime_strand_not_found: ${preferredStrandId}`);
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
