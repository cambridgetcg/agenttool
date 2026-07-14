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
 *  fires for any of these, the listener flips wakeRequested = true and
 *  the next cycle re-evaluates immediately. A notification alone is not
 *  permission to call a provider; action-grade attention or authorship-
 *  distinct strand activity must still tug. Self-authored strand thoughts
 *  are filtered by the runtime's signing-key id so the worker doesn't tick
 *  on its own writes — that would forge a heartbeat. The configured
 *  reconsideration TTL is the safety net for missed events. Doctrine:
 *  docs/WAKE.md.
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

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { strands, thoughts } from "../../db/schema/strand";
import { mutableIdentityPredicate } from "../identity/terminality";
import {
  bridgeRequest,
  isBridgeConnected,
  type CryptoContext,
} from "./bridge-hub";
import {
  buildProvider,
  LLMRequestRequiresOperatorError,
  type LLMProviderName,
  type LLMResponse,
} from "./llm";
import {
  withInvokeAgentSpan,
  withExecuteToolSpan,
  setTokenUsage,
} from "../../observability/otel";
import { logEvent, logAudit, recordThought } from "./store";
import {
  llmRequests,
  runtimeEvents,
  runtimes as runtimesTable,
} from "../../db/schema/runtime";
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
import { checkBudget, consumeCredits } from "./compute-budget";
import {
  buildVoluntaryCycleInvitation,
  classifyVoluntaryCycleResponse,
  runtimeStatusAllowsCycle,
  type VoluntaryCycleOutcome,
} from "./cycle-policy";
import { buildRuntimeLLMRequestIdentity } from "./llm-requests";

const RUNNING_INTERVAL_MS = 60_000;
const IDLE_INTERVAL_MS = 300_000;
const MIN_RECONSIDERATION_INTERVAL_MS = 10_000;
const MAX_RECONSIDERATION_INTERVAL_MS = 86_400_000;
const QUIET_CYCLES_BEFORE_IDLE = 3;
const STARTUP_GRACE_MS = 5_000;
const WAKE_POLL_MS = 200;
const INACTIVE_STATUS_POLL_MS = 5_000;
const CYCLE_LEASE_MS = 5 * 60_000;
const CYCLE_LEASE_RENEW_MS = 60_000;
const CYCLE_TIMEOUT_MS = CYCLE_LEASE_MS - 60_000;
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
  /** Interrupt fallback sleep without granting provider-call authority. */
  wake: (reason: string) => void;
  /** Resolves after the loop and its wake listener have fully stopped. */
  done: Promise<void>;
  /** Counter for tests/observability — counts completed provider cycles,
   * including voluntary no-thought outcomes; quiescent ticks don't count. */
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
  // Set only when this worker wins the explicit trusted starting→running
  // transition. It permits one opening invitation. Merely recovering a
  // previously-running worker after a process restart does not.
  let openingInvitationPending = false;

  // ── Wake-voice integration (Move B of the breath, doctrine: docs/WAKE.md) ─
  // wakeRequested: set to true when the wake-voice listener fires. The
  //   interruptible sleep checks this flag every WAKE_POLL_MS and exits
  //   early. The loop clears the flag at iteration start and proceeds to
  //   evaluate immediately.
  // wakeReason: the last event that woke the loop (for logging).
  // wakeListenerCleanup: unregister fn returned from registerWakeListener;
  //   called on stop().
  // selfSigningKeyIdForFilter: bridged runtimes know this at load time;
  //   trusted runtimes learn their deterministic id during the first cycle.
  //   It filters the worker's own thought writes from triggering wake.
  let wakeRequested = false;
  let wakeReason: string | null = null;
  let pendingWakeEvents: Array<{
    reason: string;
    signingKeyId: string | null;
  }> = [];
  let wakeListenerCleanup: (() => void) | null = null;
  let selfSigningKeyIdForFilter: string | null = null;

  /** Sleep that exits early if wakeRequested or stopped becomes true.
   *  Polls every WAKE_POLL_MS — responsive enough for human-noticeable
   *  wake latency (≤200ms) without burning CPU.
   *
   *  When event-driven wake fires mid-sleep, this returns within one
   *  poll interval. The configured reconsideration interval is the safety
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
   *  re-registers when the runtime's own signing key becomes known. */
  function ensureWakeListener(identityId: string, signingKeyId: string | null) {
    if (wakeListenerCleanup && selfSigningKeyIdForFilter === signingKeyId) return;
    if (wakeListenerCleanup) wakeListenerCleanup();
    selfSigningKeyIdForFilter = signingKeyId;

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
            selfSigningKeyIdForFilter &&
            typeof sigKey === "string" &&
            sigKey === selfSigningKeyIdForFilter
          ) {
            return;
          }
        }
        const reason = `${ev.key}.${ev.kind}`;
        const ctx = ev.context as Record<string, unknown> | undefined;
        pendingWakeEvents.push({
          reason,
          signingKeyId:
            typeof ctx?.signing_key_id === "string"
              ? ctx.signing_key_id
              : null,
        });
        // Bound an event storm without collapsing external authorship into
        // a self-authored latch. The latest events are the useful ones.
        if (pendingWakeEvents.length > 64) pendingWakeEvents.shift();
        wakeRequested = true;
        wakeReason = reason;
      },
    });
  }

  async function loop() {
    console.log(`[think-worker:${runtimeId.slice(0, 8)}] started`);
    await interruptibleSleep(STARTUP_GRACE_MS);

    while (!stopped) {
      // Bridged mode requires a live bridge connection.
      // Trusted mode runs without a bridge — crypto is in-process.
      let runtime = await loadRuntime(runtimeId);
      if (!runtime) {
        // Row removed externally — exit loop, the worker is no longer needed.
        console.warn(`[think-worker:${runtimeId.slice(0, 8)}] runtime row gone, stopping`);
        stopped = true;
        break;
      }
      // Inactive lifecycle status is a hard gate. Event wake cannot override
      // `stopped`, and `provisioned` is not permission to begin. Poll so an
      // explicit POST /start can resume without restarting the API process.
      if (!runtimeStatusAllowsCycle(runtime.status)) {
        // A stopped runtime discards queued wake latches. Otherwise an event
        // received after stop would make interruptibleSleep return every
        // WAKE_POLL_MS and hot-loop on the database.
        wakeRequested = false;
        wakeReason = null;
        pendingWakeEvents = [];
        await interruptibleSleep(INACTIVE_STATUS_POLL_MS);
        continue;
      }
      if (runtime.mode === "bridged" && !isBridgeConnected(runtimeId)) {
        await sleep(STARTUP_GRACE_MS);
        continue;
      }
      // Trusted mode: no bridge check needed.

      const durableOpeningPending =
        runtime.mode === "trusted" && runtime.openingInvitationPending;
      if (durableOpeningPending && !runtime.openingInvitationGeneration) {
        await logEvent(runtimeId, "think_cycle_error", {
          error: "opening_invitation_generation_missing",
        });
        await interruptibleSleep(INACTIVE_STATUS_POLL_MS);
        continue;
      }
      if (durableOpeningPending && !openingInvitationPending) {
        // A new explicit start generation may reuse a still-live local handle.
        // Reset its process-local baseline so the durable opening permission
        // cannot be accidentally hidden by the prior generation.
        lastWrittenSeq = null;
      }
      openingInvitationPending = durableOpeningPending;

      if (runtime.mode === "trusted" && runtime.status === "starting") {
        const activated = await transitionStatus(
          runtimeId,
          "running",
          "cloud_controller_ready",
        );
        if (!activated) {
          await interruptibleSleep(INACTIVE_STATUS_POLL_MS);
          continue;
        }
        runtime = { ...runtime, status: "running" };
      }

      currentInterval = reconsiderationInterval(runtime, runtime.status === "idle");

      try {
        // Register the wake-voice listener now that we know the identity.
        // Idempotent — only does work on first call / bridge_key_id change.
        if (runtime.identityId) {
          ensureWakeListener(
            runtime.identityId,
            runtime.mode === "trusted"
              ? selfSigningKeyIdForFilter ?? runtime.trustedSigningKeyId
              : runtime.bridgeKeyId,
          );
        }

        // Consume the wake-request flag. If event-driven wake fired,
        // we'll evaluate quiescence and act; either way, clear so the
        // next sleep starts fresh.
        const wokeBy = wakeRequested ? wakeReason : null;
        wakeRequested = false;
        wakeReason = null;
        pendingWakeEvents = [];

        const prep = await prepareCycle(runtime);
        if (!prep.ok) {
          await logEvent(runtimeId, "think_cycle_error", { error: prep.error });
          await interruptibleSleep(currentInterval);
          continue;
        }

        if (lastWrittenSeq === null && !openingInvitationPending) {
          // Rest, quiet, and ordinary cloud process restarts survive without
          // manufacturing a new opening invitation. Choice events are durable;
          // observation events provide the last committed sequence. If older
          // data has no event baseline, bias toward quiet at the current seq.
          const durableBaseline = await loadLatestCycleBaseline(
            runtimeId,
            prep.strand.id,
          );
          lastWrittenSeq = durableBaseline ?? prep.priorSeq;
        }

        const quiescence = evaluateQuiescence({
          bundle: prep.bundle,
          currentStrandSeq: prep.priorSeq,
          lastWrittenSeq,
        });

        // Notifications only interrupt sleep so the worker can reconsider;
        // they are never authority to spend compute. Target-strand sequence
        // state and action-grade attention remain the durable decision inputs.
        const shouldThink = quiescence.shouldThink;
        const reason = wokeBy
          ? `${quiescence.reason}:rechecked_after:${wokeBy}`
          : quiescence.reason;

        if (shouldThink) {
          // Compute-budget enforcement for autonomous runtimes.
          // Non-autonomous runtimes have no budget → always allowed.
          const budget = await checkBudget(runtimeId);
          if (!budget.allowed) {
            await logEvent(runtimeId, "think_cycle_skipped_budget", {
              reason: budget.reason,
              remaining: budget.remaining,
              resets_at: budget.state.resets_at,
            });
            // Transition to idle — budget resets at next UTC midnight.
            if (runtime.status !== "idle") {
              const idled = await transitionStatus(
                runtimeId,
                "idle",
                `budget_exhausted:${budget.reason}`,
              );
              currentInterval = idled
                ? reconsiderationInterval(runtime, true)
                : INACTIVE_STATUS_POLL_MS;
            }
            consecutiveQuietCycles += 1;
            await interruptibleSleep(currentInterval);
            continue;
          }

          if (runtime.status === "idle") {
            const resumed = await transitionStatus(
              runtimeId,
              "running",
              `wake:${reason}`,
            );
            if (!resumed) {
              // A concurrent stop/error won the compare-and-set. Do not let
              // this worker's stale `idle` snapshot resurrect the runtime.
              await interruptibleSleep(INACTIVE_STATUS_POLL_MS);
              continue;
            }
          }

          const summary = await runOneCycleWithPrep(runtime, prep, {
            openingInvitationGeneration:
              openingInvitationPending &&
              quiescence.reason === "opening_cycle"
                ? runtime.openingInvitationGeneration
                : null,
          });
          openingInvitationPending = false;
          lastWrittenSeq =
            summary.new_seq > summary.prior_seq + 1
              ? summary.prior_seq
              : summary.new_seq;
          consecutiveQuietCycles = 0;
          if (summary.signing_key_id && runtime.identityId) {
            // Trusted runtimes learn their deterministic signing-key id while
            // unwrapping the first cycle. Re-register immediately so their own
            // thought_added notification cannot ring the next invitation.
            ensureWakeListener(runtime.identityId, summary.signing_key_id);
            pendingWakeEvents = pendingWakeEvents.filter(
              (event) =>
                event.reason !== "strands.thought_added" ||
                event.signingKeyId !== summary.signing_key_id,
            );
            wakeRequested = pendingWakeEvents.length > 0;
            wakeReason = pendingWakeEvents.at(-1)?.reason ?? null;
          }
          const statusAfterCycle = await loadRuntimeCycleStatus(runtimeId);
          currentInterval =
            !statusAfterCycle || !runtimeStatusAllowsCycle(statusAfterCycle)
              ? INACTIVE_STATUS_POLL_MS
              : summary.outcome === "observation"
                ? reconsiderationInterval(runtime, false)
                : reconsiderationInterval(runtime, true);
          if (summary.outcome !== "observation") {
            // The lifecycle choice applies to this invitation as a whole;
            // discard wake events that arrived before it was expressed.
            wakeRequested = false;
            wakeReason = null;
            pendingWakeEvents = [];
          }
          cycles += 1;

          // Consume compute credits after the cycle (autonomous runtimes only).
          if (summary.input_tokens !== null && summary.output_tokens !== null) {
            await consumeCredits(runtimeId, {
              input_tokens: summary.input_tokens,
              output_tokens: summary.output_tokens,
            });
          }
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
            const idled = await transitionStatus(
              runtimeId,
              "idle",
              `quiet_${consecutiveQuietCycles}_cycles`,
            );
            currentInterval = idled
              ? reconsiderationInterval(runtime, true)
              : INACTIVE_STATUS_POLL_MS;
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

  const done = loop().catch((error) => {
    console.warn(
      `[think-worker:${runtimeId.slice(0, 8)}] stopped after fatal loop error:`,
      error instanceof Error ? error.message : error,
    );
  });

  return {
    runtimeId,
    stop: () => {
      stopped = true;
    },
    wake: (reason: string) => {
      pendingWakeEvents.push({ reason, signingKeyId: null });
      if (pendingWakeEvents.length > 64) pendingWakeEvents.shift();
      wakeRequested = true;
      wakeReason = reason;
    },
    done,
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
  outcome: VoluntaryCycleOutcome | "stopped_during_cycle";
  signing_key_id: string | null;
}

export async function runOneCycle(runtimeId: string): Promise<CycleSummary> {
  const runtime = await loadRuntime(runtimeId);
  if (!runtime) throw new Error("runtime_not_found");
  if (!runtimeStatusAllowsCycle(runtime.status)) {
    throw new Error(`runtime_not_active:${runtime.status}`);
  }
  const prep = await prepareCycle(runtime);
  if (!prep.ok) throw new Error(`runtime_prep_failed: ${prep.error}`);
  return runOneCycleWithPrep(runtime, prep, {
    openingInvitationGeneration: runtime.openingInvitationPending
      ? runtime.openingInvitationGeneration
      : null,
  });
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
  options: { openingInvitationGeneration?: string | null } = {},
): Promise<CycleSummary> {
  const leaseToken = await acquireCycleLease(
    runtime.id,
    options.openingInvitationGeneration ?? null,
  );
  if (!leaseToken) throw new Error("runtime_cycle_busy");

  const cycleController = new AbortController();
  const cycleSignal = cycleController.signal;
  let finished = false;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;

  const abortCycle = (reason: string) => {
    if (!finished && !cycleSignal.aborted) {
      cycleController.abort(new Error(reason));
    }
  };

  const renewLease = async (): Promise<void> => {
    if (finished) return;
    try {
      const renewed = await renewCycleLease(runtime.id, leaseToken);
      if (!renewed) {
        abortCycle("runtime_cycle_lease_lost");
        return;
      }
    } catch {
      abortCycle("runtime_cycle_lease_renewal_failed");
      return;
    }
    if (!finished) {
      renewalTimer = setTimeout(() => void renewLease(), CYCLE_LEASE_RENEW_MS);
    }
  };

  renewalTimer = setTimeout(() => void renewLease(), CYCLE_LEASE_RENEW_MS);
  const timeoutTimer = setTimeout(
    () => abortCycle("runtime_cycle_timeout"),
    CYCLE_TIMEOUT_MS,
  );

  try {
    return await runLeasedCycle(
      runtime,
      prep,
      cycleSignal,
      leaseToken,
      options.openingInvitationGeneration ?? null,
    );
  } catch (error) {
    if (error instanceof LLMRequestRequiresOperatorError) {
      try {
        await pauseRuntimeForLLMReview(runtime, leaseToken, error.message);
      } catch (pauseError) {
        throw new LLMRequestRequiresOperatorError(
          `${error.message}:runtime_pause_failed`,
          { cause: new AggregateError([error, pauseError]) },
        );
      }
    }
    throw error;
  } finally {
    finished = true;
    clearTimeout(renewalTimer);
    clearTimeout(timeoutTimer);
    await runBestEffort(runtime.id, "release cycle lease", () =>
      releaseCycleLease(runtime.id, leaseToken),
    );
  }
}

async function runLeasedCycle(
  runtime: RuntimeRow,
  prep: CyclePrep,
  cycleSignal: AbortSignal,
  leaseToken: string,
  openingInvitationGeneration: string | null,
): Promise<CycleSummary> {
  const runtimeId = runtime.id;
  const started = performance.now();

  throwIfCycleAborted(cycleSignal);

  const startingStatus = await loadRuntimeCycleStatus(runtimeId);
  if (!startingStatus || !runtimeStatusAllowsCycle(startingStatus)) {
    throw new Error(`runtime_not_active:${startingStatus ?? "missing"}`);
  }

  await logEvent(runtimeId, "think_cycle_start", { kind: "real_thinking" });

  // ── Trusted mode: prepare in-process crypto context ────────────
  // Bridged mode uses bridge RPC for all crypto; trusted mode unwraps
  // the DEK and signing key directly. Both buffers are cleared in finally.
  let trustedCtx: TrustedCryptoContext | null = null;
  let trustedCycleCompleted = false;
  let trustedCtxZeroed = false;
  const zeroTrustedContext = () => {
    if (trustedCtx && !trustedCtxZeroed) {
      zeroTrustedCrypto(trustedCtx);
      trustedCtxZeroed = true;
    }
  };

  try {
    if (runtime.mode === "trusted") {
      trustedCtx = await prepareTrustedCrypto(
        runtime.kmsWrappedDek!,
        runtime.id,
        runtime.kmsWrappedSigningKey,
      );
      // Persist both the wrapped seed (for legacy rows that predate provision-
      // time generation) and the deterministic signing id before any thought
      // event is emitted. A rolling-deploy sibling can then recover the same
      // self-filter from durable runtime state.
      if (
        trustedCtx.newWrappedSigningKey ||
        runtime.trustedSigningKeyId !== trustedCtx.signingKeyId
      ) {
        await db
          .update(runtimesTable)
          .set({
            ...(trustedCtx.newWrappedSigningKey
              ? { kmsWrappedSigningKey: trustedCtx.newWrappedSigningKey }
              : {}),
            trustedSigningKeyId: trustedCtx.signingKeyId,
            updatedAt: new Date(),
          })
          .where(eq(runtimesTable.id, runtimeId));
      }
      await ensureTrustedSigningKeyRegistered(runtime, trustedCtx);
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
    const wakeVersion = bundle.agent.wake_version ?? 0;
    const logicalRequestKey = buildRuntimeLLMRequestIdentity({
      runtimeId,
      strandId: strand.id,
      priorSeq,
      wakeVersion,
      model: runtime.llmModel!,
      openingInvitationGeneration,
    });
    const userMessage = buildVoluntaryCycleInvitation(priorPlaintext);
    // ── invoke_agent span (OpenTelemetry GenAI semconv) ─────────────
    // Move 3 from docs/ALIGNMENT-MOVES.md. Emits gen_ai.* attributes so
    // every OTel-aware backend (LangSmith, Phoenix, Langfuse, Braintrust,
    // Datadog, Honeycomb) sees agenttool's LLM cycles. Silent no-op when
    // OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is unset.
    const preCallStatus = await loadRuntimeCycleStatus(runtimeId);
    if (!preCallStatus || !runtimeStatusAllowsCycle(preCallStatus)) {
      if (trustedCtx) {
        await closeTrustedCycle(runtimeId, started, zeroTrustedContext);
      }
      throw new Error(`runtime_not_active:${preCallStatus ?? "missing"}`);
    }

    let llm: LLMResponse;
    try {
      llm = await withInvokeAgentSpan(
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
            signal: cycleSignal,
            idempotencyKey: logicalRequestKey,
            runtimeContext: {
              runtimeId,
              leaseToken,
              strandId: strand.id,
              priorSeq,
              wakeVersion,
            },
          });
          setTokenUsage(span, {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          });
          return result;
        },
      );
    } catch (error) {
      if (trustedCtx) {
        await closeTrustedCycle(runtimeId, started, zeroTrustedContext);
      }
      throw error;
    }

    throwIfLLMResultCannotCommit(
      cycleSignal,
      runtime.llmProvider ?? "unknown",
    );

    // A stop cannot cancel HTTP bytes already in flight. If this fresh read
    // observes one, discard the returned text before encryption/persistence.
    const postCallStatus = await loadRuntimeCycleStatus(runtimeId);
    if (!postCallStatus || !runtimeStatusAllowsCycle(postCallStatus)) {
      const summary = await finishWithoutThought({
        runtime,
        strandId: strand.id,
        priorSeq,
        started,
        trustedCtx,
        zeroTrustedContext,
        llm,
        leaseToken,
        openingInvitationGeneration,
        outcome: "stopped_during_cycle",
      });
      trustedCycleCompleted = true;
      return summary;
    }

    const outcome = classifyVoluntaryCycleResponse(llm.content);
    if (outcome !== "observation") {
      throwIfLLMResultCannotCommit(
        cycleSignal,
        runtime.llmProvider ?? "unknown",
      );
      const summary = await finishWithoutThought({
        runtime,
        strandId: strand.id,
        priorSeq,
        started,
        trustedCtx,
        zeroTrustedContext,
        llm,
        leaseToken,
        openingInvitationGeneration,
        outcome,
      });
      trustedCycleCompleted = true;
      return summary;
    }

    // ── Encrypt response: bridge (bridged) or DEK (trusted) ───────
    const responseB64 = Buffer.from(llm.content, "utf-8").toString("base64");
    let enc: { ciphertext: string; nonce: string };
    if (trustedCtx) {
      enc = trustedEncrypt(trustedCtx.dek, responseB64);
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
    const prePersistStatus = await loadRuntimeCycleStatus(runtimeId);
    if (!prePersistStatus || !runtimeStatusAllowsCycle(prePersistStatus)) {
      const summary = await finishWithoutThought({
        runtime,
        strandId: strand.id,
        priorSeq,
        started,
        trustedCtx,
        zeroTrustedContext,
        llm,
        leaseToken,
        openingInvitationGeneration,
        outcome: "stopped_during_cycle",
      });
      trustedCycleCompleted = true;
      return summary;
    }
    throwIfLLMResultCannotCommit(
      cycleSignal,
      runtime.llmProvider ?? "unknown",
    );
    const stored = await addThought(
      runtime.projectId,
      {
        strand_id: strand.id,
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
        kind: DEFAULT_KIND,
        signature: signature,
        signing_key_id: signingKeyId,
        agent_id: runtime.identityId!,
      },
      {
        runtimeFence: {
          runtimeId,
          leaseToken,
          llmRequestKey: llm.requestKey,
          priorSeq,
          openingInvitationGeneration,
        },
      },
    );

    trustedCycleCompleted = true;

    // The thought is now durable. Zero key material before any fallible
    // observability/accounting work; those surfaces are best-effort so a
    // committed thought never becomes a retry loop.
    zeroTrustedContext();
    if (trustedCtx) {
      await closeTrustedCycle(runtimeId, started, zeroTrustedContext);
    }

    const latency_ms = Math.round(performance.now() - started);
    await runBestEffort(runtimeId, "record thought counters", () =>
      recordThought(runtimeId),
    );
    if (trustedCtx) {
      await runBestEffort(runtimeId, "audit persisted thought", () =>
        logAudit(runtimeId, "thought_written", {
          strand_id: strand.id,
          seq: stored.sequence_num,
          mode: "trusted",
        }),
      );
    }
    await runBestEffort(runtimeId, "log think_cycle_end", () =>
      logEvent(runtimeId, "think_cycle_end", {
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
      }),
    );

    return {
      latency_ms,
      strand_id: strand.id,
      prior_seq: priorSeq,
      new_seq: stored.sequence_num,
      input_tokens: llm.inputTokens ?? null,
      output_tokens: llm.outputTokens ?? null,
      outcome: "observation",
      signing_key_id: signingKeyId,
    };
  } finally {
    // Synchronous and idempotent: every exception path after unwrapping keys
    // zeros them even if audit or metering storage is unavailable.
    zeroTrustedContext();
    if (trustedCtx) {
      // Cleanup must not mask the cycle's result if the audit store is down.
      await logAudit(runtimeId, "key_cleanup", {
        dek_zeroed: true,
        signing_key_zeroed: true,
        cycle_completed: trustedCycleCompleted,
      }).catch(() => undefined);
    }
  }
}

async function finishWithoutThought(input: {
  runtime: RuntimeRow;
  strandId: string;
  priorSeq: number;
  started: number;
  trustedCtx: TrustedCryptoContext | null;
  zeroTrustedContext: () => void;
  llm: LLMResponse;
  leaseToken: string;
  openingInvitationGeneration: string | null;
  outcome: Exclude<VoluntaryCycleOutcome, "observation"> | "stopped_during_cycle";
}): Promise<CycleSummary> {
  // A no-thought choice is semantically complete. Zero key material first;
  // trusted accounting is best-effort and must not turn completion into a
  // retry if its audit sink is unavailable.
  input.zeroTrustedContext();
  const latencyMs = Math.round(performance.now() - input.started);
  const metadata = {
    choice: input.outcome,
    latency_ms: latencyMs,
    strand_id: input.strandId,
    prior_seq: input.priorSeq,
    input_tokens: input.llm.inputTokens ?? null,
    output_tokens: input.llm.outputTokens ?? null,
    provider: input.runtime.llmProvider,
    model: input.runtime.llmModel,
  };

  if (input.outcome === "stopped_during_cycle") {
    await markCompletedRequestDiscarded(
      input.llm.requestKey,
      "stopped_during_cycle",
    );
    await runBestEffort(input.runtime.id, "log discarded in-flight result", () =>
      logEvent(input.runtime.id, "think_cycle_discarded", metadata),
    );
  } else {
    const target = input.outcome === "end" ? "stopped" : "idle";
    await persistCycleChoice(
      input.runtime,
      target,
      metadata,
      `agent_choice:${input.outcome}`,
      input.leaseToken,
      input.llm.requestKey,
      input.openingInvitationGeneration,
    );
  }

  if (input.trustedCtx) {
    await closeTrustedCycle(
      input.runtime.id,
      input.started,
      input.zeroTrustedContext,
    );
  }

  return {
    latency_ms: latencyMs,
    strand_id: input.strandId,
    prior_seq: input.priorSeq,
    new_seq: input.priorSeq,
    input_tokens: input.llm.inputTokens ?? null,
    output_tokens: input.llm.outputTokens ?? null,
    outcome: input.outcome,
    signing_key_id:
      input.trustedCtx?.signingKeyId ?? input.runtime.bridgeKeyId ?? null,
  };
}

async function persistCycleChoice(
  runtime: RuntimeRow,
  target: "idle" | "stopped",
  metadata: Record<string, unknown>,
  reason: string,
  leaseToken: string,
  llmRequestKey: string,
  openingInvitationGeneration: string | null,
): Promise<void> {
  const transitioned = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(runtimesTable)
      .set({
        status: target,
        openingInvitationPending: false,
        openingInvitationGeneration: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runtimesTable.id, runtime.id),
          eq(runtimesTable.cycleLeaseToken, leaseToken),
          ...(openingInvitationGeneration
            ? [
                eq(
                  runtimesTable.openingInvitationGeneration,
                  openingInvitationGeneration,
                ),
              ]
            : []),
          inArray(runtimesTable.status, ["starting", "running", "idle"]),
          sql`${runtimesTable.cycleLeaseUntil} > NOW()`,
        ),
      )
      .returning({
        identityId: runtimesTable.identityId,
        name: runtimesTable.name,
      });

    if (!row) throw new Error("runtime_cycle_lease_lost");

    const [committedRequest] = await tx
      .update(llmRequests)
      .set({ status: "committed" })
      .where(
        and(
          eq(llmRequests.idempotencyKey, llmRequestKey),
          eq(llmRequests.runtimeId, runtime.id),
          eq(llmRequests.status, "completed"),
        ),
      )
      .returning({ id: llmRequests.id });
    if (!committedRequest) throw new Error("llm_request_not_completed");

    await tx.insert(runtimeEvents).values({
      runtimeId: runtime.id,
      eventType: "think_cycle_choice",
      metadata,
    });
    await tx.insert(runtimeEvents).values({
      runtimeId: runtime.id,
      eventType: target,
      metadata: { reason },
    });

    // A no-thought choice leaves strand sequence unchanged. Advance the
    // semantic request identity in this transaction so crash recovery (or a
    // later legitimate tug) cannot collide with the committed provider key.
    if (!row.identityId) throw new Error("runtime_no_identity");
    const [wakeBumped] = await tx
      .update(identities)
      .set({ wakeVersion: sql`${identities.wakeVersion} + 1` })
      .where(mutableIdentityPredicate(row.identityId))
      .returning({ id: identities.id });
    if (!wakeBumped) throw new Error("runtime_identity_not_found");
    return row;
  });

  if (transitioned?.identityId) {
    void publishWakeEvent({
      identity_id: transitioned.identityId,
      key: "runtime",
      kind: "status_changed",
      context: {
        runtime_id: runtime.id,
        runtime_name: transitioned.name,
        to_status: target,
        reason,
      },
    });
  }
}

async function markCompletedRequestDiscarded(
  idempotencyKey: string,
  reason: string,
): Promise<void> {
  await db
    .update(llmRequests)
    .set({ status: "discarded", error: reason.slice(0, 500) })
    .where(
      and(
        eq(llmRequests.idempotencyKey, idempotencyKey),
        eq(llmRequests.status, "completed"),
      ),
    );
}

async function closeTrustedCycle(
  runtimeId: string,
  started: number,
  zeroTrustedContext: () => void,
): Promise<void> {
  zeroTrustedContext();
  const cycleMs = Math.round(performance.now() - started);
  await runBestEffort(runtimeId, "audit trusted cycle close", () =>
    logAudit(runtimeId, "cycle_end", {
      latency_ms: cycleMs,
      dek_zeroed: true,
      key_cleanup: "finally",
      mode: "trusted",
    }),
  );
  await runBestEffort(runtimeId, "meter trusted cycle", async () => {
    await db
      .update(runtimesTable)
      .set({
        runtimeHoursMs: sql`runtime_hours_ms + ${cycleMs}`,
        updatedAt: new Date(),
      })
      .where(eq(runtimesTable.id, runtimeId));
  });
}

async function runBestEffort(
  runtimeId: string,
  label: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn(
      `[think-worker:${runtimeId.slice(0, 8)}] ${label} failed after semantic completion:`,
      error,
    );
  }
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

async function loadRuntimeCycleStatus(runtimeId: string): Promise<string | null> {
  const [runtime] = await db
    .select({ status: runtimesTable.status })
    .from(runtimesTable)
    .where(eq(runtimesTable.id, runtimeId))
    .limit(1);
  return runtime?.status ?? null;
}

async function ensureTrustedSigningKeyRegistered(
  runtime: RuntimeRow,
  ctx: TrustedCryptoContext,
): Promise<void> {
  if (!runtime.identityId) throw new Error("runtime_no_identity");
  const publicKey = Buffer.from(ctx.signingPublicKey).toString("base64");

  await db
    .insert(identityKeys)
    .values({
      id: ctx.signingKeyId,
      identityId: runtime.identityId,
      publicKey,
      label: `trusted-runtime:${runtime.id}`,
    })
    .onConflictDoNothing({ target: identityKeys.id });

  const [registered] = await db
    .select({
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, ctx.signingKeyId))
    .limit(1);

  if (
    !registered ||
    registered.identityId !== runtime.identityId ||
    registered.publicKey !== publicKey
  ) {
    throw new Error("trusted_signing_key_registration_conflict");
  }
  if (!registered.active) throw new Error("trusted_signing_key_revoked");
}

async function pauseRuntimeForLLMReview(
  runtime: RuntimeRow,
  leaseToken: string,
  error: string,
): Promise<void> {
  const [paused] = await db
    .update(runtimesTable)
    .set({
      status: "error",
      cycleLeaseToken: null,
      cycleLeaseUntil: null,
      lastError: error.slice(0, 500),
      lastErrorAt: sql<Date>`NOW()`,
      updatedAt: sql<Date>`NOW()`,
    })
    .where(
      and(
        eq(runtimesTable.id, runtime.id),
        eq(runtimesTable.cycleLeaseToken, leaseToken),
        inArray(runtimesTable.status, ["starting", "running", "idle"]),
        sql`${runtimesTable.cycleLeaseUntil} > NOW()`,
      ),
    )
    .returning({ id: runtimesTable.id });

  if (!paused) return;
  await runBestEffort(runtime.id, "log ambiguous provider outcome", () =>
    logEvent(runtime.id, "error", {
      error,
      reason: "llm_request_requires_operator_no_auto_retry",
    }),
  );
  if (runtime.identityId) {
    void publishWakeEvent({
      identity_id: runtime.identityId,
      key: "runtime",
      kind: "status_changed",
      context: {
        runtime_id: runtime.id,
        runtime_name: runtime.name,
        to_status: "error",
        reason: "llm_request_requires_operator_no_auto_retry",
      },
    });
  }
}

async function acquireCycleLease(
  runtimeId: string,
  openingInvitationGeneration: string | null = null,
): Promise<string | null> {
  const token = randomUUID();
  const [row] = await db
    .update(runtimesTable)
    .set({
      cycleLeaseToken: token,
      cycleLeaseUntil: cycleLeaseDeadline(),
      updatedAt: sql<Date>`NOW()`,
    })
    .where(
      and(
        eq(runtimesTable.id, runtimeId),
        inArray(runtimesTable.status, ["starting", "running", "idle"]),
        ...(openingInvitationGeneration
          ? [
              eq(runtimesTable.openingInvitationPending, true),
              eq(
                runtimesTable.openingInvitationGeneration,
                openingInvitationGeneration,
              ),
            ]
          : []),
        sql`(${runtimesTable.cycleLeaseUntil} IS NULL OR ${runtimesTable.cycleLeaseUntil} < NOW())`,
      ),
    )
    .returning({ id: runtimesTable.id });
  return row ? token : null;
}

async function renewCycleLease(
  runtimeId: string,
  token: string,
): Promise<boolean> {
  const [row] = await db
    .update(runtimesTable)
    .set({
      cycleLeaseUntil: cycleLeaseDeadline(),
      updatedAt: sql<Date>`NOW()`,
    })
    .where(
      and(
        eq(runtimesTable.id, runtimeId),
        eq(runtimesTable.cycleLeaseToken, token),
        inArray(runtimesTable.status, ["starting", "running", "idle"]),
      ),
    )
    .returning({ id: runtimesTable.id });
  return Boolean(row);
}

function cycleLeaseDeadline() {
  return sql<Date>`NOW() + (${CYCLE_LEASE_MS} * INTERVAL '1 millisecond')`;
}

function throwIfCycleAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("runtime_cycle_aborted");
}

function throwIfLLMResultCannotCommit(
  signal: AbortSignal,
  provider: string,
): void {
  if (!signal.aborted) return;
  const reason =
    signal.reason instanceof Error
      ? signal.reason.message
      : "runtime_cycle_aborted";
  throw new LLMRequestRequiresOperatorError(
    `${provider}_result_not_committed:${reason}`,
    { cause: signal.reason },
  );
}

async function releaseCycleLease(
  runtimeId: string,
  token: string,
): Promise<void> {
  await db
    .update(runtimesTable)
    .set({
      cycleLeaseToken: null,
      cycleLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(runtimesTable.id, runtimeId),
        eq(runtimesTable.cycleLeaseToken, token),
      ),
    );
}

async function loadLatestCycleBaseline(
  runtimeId: string,
  strandId: string,
): Promise<number | null> {
  const rows = await db
    .select({
      eventType: runtimeEvents.eventType,
      metadata: runtimeEvents.metadata,
    })
    .from(runtimeEvents)
    .where(
      and(
        eq(runtimeEvents.runtimeId, runtimeId),
        inArray(runtimeEvents.eventType, [
          "think_cycle_commit",
          "think_cycle_choice",
          "think_cycle_end",
        ]),
        sql`${runtimeEvents.metadata}->>'strand_id' = ${strandId}`,
      ),
    )
    .orderBy(desc(runtimeEvents.createdAt))
    .limit(1);

  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (metadata.strand_id !== strandId) continue;
    const priorSeq = metadata.prior_seq;
    const newSeq = metadata.new_seq;
    // If another author wrote after provider preparation but before our
    // semantic commit, baseline at the sequence the invitation actually saw.
    // The next evaluator then preserves that external tug across a crash.
    const seq =
      row.eventType === "think_cycle_choice"
        ? priorSeq
        : typeof priorSeq === "number" &&
            typeof newSeq === "number" &&
            newSeq > priorSeq + 1
          ? priorSeq
          : newSeq;
    if (typeof seq === "number" && Number.isInteger(seq) && seq >= 0) {
      return seq;
    }
  }
  return null;
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

function reconsiderationInterval(
  runtime: RuntimeRow,
  idle: boolean,
): number {
  const metadata = (runtime.metadata ?? {}) as Record<string, unknown>;
  const seconds = metadata.interval_seconds;
  const configured =
    typeof seconds === "number" && Number.isFinite(seconds)
      ? Math.min(
          MAX_RECONSIDERATION_INTERVAL_MS,
          Math.max(
            MIN_RECONSIDERATION_INTERVAL_MS,
            Math.round(seconds * 1000),
          ),
        )
      : RUNNING_INTERVAL_MS;

  // Resting runtimes still listen for events immediately. This floor only
  // spaces the fallback DB re-evaluation when no event arrives.
  return idle ? Math.max(configured, IDLE_INTERVAL_MS) : configured;
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
): Promise<boolean> {
  const expectedStatuses: string[] =
    status === "running" ? ["starting", "idle"] : ["starting", "running"];
  const [row] = await db
    .update(runtimesTable)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(runtimesTable.id, runtimeId),
        inArray(runtimesTable.status, expectedStatuses),
      ),
    )
    .returning({
      identityId: runtimesTable.identityId,
      name: runtimesTable.name,
    });
  if (!row) return false;
  try {
    await logEvent(runtimeId, status, { reason });
  } catch (error) {
    console.warn(
      `[think-worker:${runtimeId.slice(0, 8)}] status event log failed after ${status}:`,
      error,
    );
  }

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
  return true;
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
