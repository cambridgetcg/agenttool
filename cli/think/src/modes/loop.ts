/** Autonomous-loop mode — 24/7 sovereign autonomy.
 *
 *  The agent runs continuously, picking modes and strands and pacing on
 *  its own, until time or budget exhausts. This is what "always thinking"
 *  looks like at the orchestrator level.
 *
 *  Mode selection per iteration (state-driven with circadian flavor):
 *
 *    1. Circadian consolidate   if local hour == consolidate-hour AND
 *                                12h+ since last consolidate ran
 *    2. Overflow consolidate    if any strand has 8+ unconsolidated thoughts
 *    3. Wander                  if >1 strand AND all stale (no thought in 6h)
 *    4. Advance                 default — focused work
 *
 *  Termination — multiple guards:
 *    - wall-clock cap (--duration)
 *    - budget cap (--budget; tracks credit delta from start)
 *    - max-iterations (safety cap)
 *    - SIGINT (Ctrl-C): finish current iteration then exit cleanly
 *
 *  Pacing: 180s default between iterations. Minds don't think every second. */

import { AgenttoolClient, type StrandSummary } from "../api";
import type { ThinkConfig } from "../config";
import type { KeyMaterial } from "../keys";
import { advance } from "./advance";
import { consolidate } from "./consolidate";
import { parseSSE } from "./voice";
import { wander } from "./wander";

export interface LoopOptions {
  durationMinutes: number;
  budgetCredits: number;
  maxIterations: number;
  sleepSeconds: number;
  consolidateHour?: number; // local hour 0-23; undefined = no circadian bias
  /** When true (default), the inter-iteration sleep subscribes to the most
   *  recently-active strand's voice SSE and breaks early on any new thought
   *  arrival (multi-orchestrator collaboration / external API write). When
   *  false, the loop pure-polls between iterations. */
  liveSse: boolean;
  /** Peer strand IDs to subscribe to alongside our own most-active strand.
   *  When a peer thought arrives whose `refs[]` includes one of OUR strand
   *  or memory IDs, we break sleep and surface the drift — ref-aware
   *  reaction loop. Empty array (default) means own-only subscription. */
  peerStrandIds: string[];
}

type Mode = "advance" | "wander" | "consolidate";

interface IterationLog {
  index: number;
  startedAt: Date;
  mode: Mode;
  creditsBeforeIter: number;
  creditsAfterIter: number;
  error?: string;
}

interface LoopState {
  iterations: IterationLog[];
  byMode: { advance: number; wander: number; consolidate: number };
  startedAt: Date;
  startCredits: number;
  lastConsolidateAt: number | null; // ms epoch
  aborted: boolean;
  abortReason: string | null;
}

// ── Thresholds ──────────────────────────────────────────────────────────
const OVERFLOW_THOUGHTS = 8;            // strand with this many unconsolidated triggers
const STALE_HOURS = 6;                  // strand untouched this long is "stale"
const CIRCADIAN_GAP_HOURS = 12;         // min gap between circadian consolidates
const CREDIT_FLOOR = 10;                // stop if balance < this

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const interval = 250;
    const start = Date.now();
    const tick = () => {
      if (signal.aborted || Date.now() - start >= ms) return resolve();
      setTimeout(tick, interval);
    };
    tick();
  });
}

interface SleepOutcome {
  reason: "timeout" | "aborted" | "event";
  detail?: string;     // e.g. "strand <id>#<seq>" or "drift-ref from peer"
}

interface ThoughtBlobMinimal {
  id?: string;
  sequence_num?: number;
  strand_id?: string;
  refs?: Array<{ kind: string; ref: string }>;
  redacted?: boolean;
}

/** Subscribe to one strand's voice SSE; resolve with a SleepOutcome when
 *  a relevant event arrives, OR a never-resolving promise on failure
 *  (so the timer wins the race naturally). The relevance test is the
 *  caller's filter — own-strand subscriptions return on any thought,
 *  peer subscriptions return only on drift-ref matches. */
async function subscribeStrand(
  config: ThinkConfig,
  strandId: string,
  sinceSeq: number,
  filter: (thought: ThoughtBlobMinimal) => SleepOutcome | undefined,
  ac: AbortController,
  sseSignal: { aborted: boolean },
): Promise<SleepOutcome> {
  const url = `${config.agenttoolBase}/v1/strands/${strandId}/voice?since_seq=${sinceSeq}`;
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${config.agenttoolApiKey}`,
      },
    });
  } catch {
    return new Promise<SleepOutcome>(() => {});
  }
  if (!res.ok || !res.body) return new Promise<SleepOutcome>(() => {});

  let pastCatchup = false;
  try {
    for await (const event of parseSSE(res.body, sseSignal)) {
      if (sseSignal.aborted) break;
      if (event.event === "catchup-end") {
        pastCatchup = true;
        continue;
      }
      if (event.event === "thought" && pastCatchup) {
        let parsed: ThoughtBlobMinimal | undefined;
        try {
          parsed = JSON.parse(event.data) as ThoughtBlobMinimal;
        } catch { /* ignore */ }
        if (parsed) {
          const out = filter(parsed);
          if (out) return out;
        }
      }
      if (event.event === "disconnect" || event.event === "refresh" || event.event === "rejected") {
        return new Promise<SleepOutcome>(() => {});
      }
    }
  } catch {
    // silent
  }
  return new Promise<SleepOutcome>(() => {});
}

/** Sleep until either (a) the timer expires, (b) the abort signal flips, or
 *  (c) a new thought arrives on the most-recently-active OWN strand's voice
 *  (any thought = activity), or (d) a peer-strand thought arrives whose
 *  refs[] includes one of OUR resource IDs (drift-ref reaction).
 *
 *  On any failure inside an SSE path, falls back to plain sleep so the
 *  loop never crashes on a network blip. */
async function voiceTriggeredSleep(
  client: AgenttoolClient,
  config: ThinkConfig,
  ms: number,
  signal: { aborted: boolean },
  peerStrandIds: string[],
): Promise<SleepOutcome> {
  // 1. Resolve own most-active strand + own resource ID set (for drift-ref).
  let ownTarget: StrandSummary | undefined;
  let ownResourceIds: Set<string> = new Set();
  try {
    const r = await client.listStrands({ status: "active", limit: 100 });
    ownTarget = r.strands
      .filter((s) => s.last_thought_at !== null)
      .sort((a, b) => {
        const at = new Date(a.last_thought_at!).getTime();
        const bt = new Date(b.last_thought_at!).getTime();
        return bt - at;
      })[0];
    // Build the self-reference set: all our active strand IDs (peer
    // thoughts referencing them = drift-ref). Memories are addressable
    // by ID across the wire too — fetched only if peer subscriptions
    // are configured, since the listing has cost.
    for (const s of r.strands) ownResourceIds.add(s.id);
  } catch {
    // strand list failed — fall back to plain sleep
  }

  // Add own memory IDs to the self-reference set when peer subs exist.
  if (peerStrandIds.length > 0) {
    try {
      // Memories endpoint is project-scoped; lists by bearer key. We don't
      // need content, just IDs.
      const res = await fetch(`${config.agenttoolBase}/v1/memories?limit=200`, {
        headers: { authorization: `Bearer ${config.agenttoolApiKey}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { memories?: Array<{ id: string }> };
        for (const m of body.memories ?? []) ownResourceIds.add(m.id);
      }
    } catch { /* ignore */ }
  }

  if (!ownTarget && peerStrandIds.length === 0) {
    // Nothing to subscribe to — fall back to plain sleep.
    await sleep(ms, signal);
    return { reason: signal.aborted ? "aborted" : "timeout" };
  }

  const ac = new AbortController();
  const sseSignal = { aborted: false };

  // Wire the outer abort signal to also tear down SSE.
  const outerAbortPoller = setInterval(() => {
    if (signal.aborted) {
      sseSignal.aborted = true;
      ac.abort();
    }
  }, 250);

  // Race: timer vs ANY subscription's relevant event.
  let timerHandle: ReturnType<typeof setTimeout> | null = null;
  const timerPromise = new Promise<SleepOutcome>((resolve) => {
    timerHandle = setTimeout(() => {
      sseSignal.aborted = true;
      ac.abort();
      resolve({ reason: signal.aborted ? "aborted" : "timeout" });
    }, ms);
  });

  const subs: Array<Promise<SleepOutcome>> = [];

  // Own-strand: any post-catchup thought breaks sleep.
  if (ownTarget) {
    const ownStrandId = ownTarget.id;
    const ownSinceSeq = ownTarget.last_thought_seq;
    subs.push(
      subscribeStrand(
        config,
        ownStrandId,
        ownSinceSeq,
        (t) => ({
          reason: "event",
          detail: `own strand ${ownStrandId.slice(0, 8)}${
            t.sequence_num !== undefined ? ` #${t.sequence_num}` : ""
          }`,
        }),
        ac,
        sseSignal,
      ),
    );
  }

  // Peer strands: only break on drift-ref (refs include OUR resource).
  for (const peerId of peerStrandIds) {
    subs.push(
      subscribeStrand(
        config,
        peerId,
        0, // peer strand we just started watching — no catchup needed
        (t) => {
          const refs = t.refs ?? [];
          for (const ref of refs) {
            if (ref?.ref && ownResourceIds.has(ref.ref)) {
              return {
                reason: "event",
                detail: `drift-ref · peer strand ${peerId.slice(0, 8)}${
                  t.sequence_num !== undefined ? ` #${t.sequence_num}` : ""
                } → our ${ref.kind} ${ref.ref.slice(0, 8)}`,
              };
            }
          }
          return undefined; // not a drift-ref; keep listening
        },
        ac,
        sseSignal,
      ),
    );
  }

  try {
    return await Promise.race([timerPromise, ...subs]);
  } finally {
    if (timerHandle) clearTimeout(timerHandle);
    clearInterval(outerAbortPoller);
    sseSignal.aborted = true;
    try { ac.abort(); } catch { /* ignore */ }
  }
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function ts(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function getCredits(client: AgenttoolClient): Promise<number> {
  const wake = await client.getWake();
  return wake.project.credits;
}

async function chooseMode(
  client: AgenttoolClient,
  state: LoopState,
  consolidateHour: number | undefined,
): Promise<{ mode: Mode; reason: string }> {
  const now = new Date();
  const localHour = now.getHours();

  // 1. Circadian consolidate
  if (consolidateHour !== undefined && localHour === consolidateHour) {
    const hoursSince = state.lastConsolidateAt
      ? (now.getTime() - state.lastConsolidateAt) / 3_600_000
      : Infinity;
    if (hoursSince >= CIRCADIAN_GAP_HOURS) {
      return { mode: "consolidate", reason: `circadian (hour=${localHour})` };
    }
  }

  // Strands needed for the rest.
  let strands: StrandSummary[];
  try {
    const r = await client.listStrands({ status: "active", limit: 100 });
    strands = r.strands;
  } catch {
    return { mode: "advance", reason: "fallback (strand list failed)" };
  }

  if (strands.length === 0) {
    return { mode: "advance", reason: "no active strands (advance will report)" };
  }

  // 2. Overflow consolidate
  for (const s of strands) {
    const meta = (s.metadata as { last_consolidated_seq?: number } | undefined) ?? {};
    const lastCon = typeof meta.last_consolidated_seq === "number"
      ? meta.last_consolidated_seq
      : 0;
    if (s.last_thought_seq - lastCon >= OVERFLOW_THOUGHTS) {
      return {
        mode: "consolidate",
        reason: `overflow (strand has ${s.last_thought_seq - lastCon} unconsolidated)`,
      };
    }
  }

  // 3. Wander if everything stale and >1 strand
  if (strands.length > 1) {
    const allStale = strands.every((s) => {
      if (s.last_thought_at === null) return true;
      return (Date.now() - new Date(s.last_thought_at).getTime()) > STALE_HOURS * 3_600_000;
    });
    if (allStale) {
      return { mode: "wander", reason: `all ${strands.length} strands stale (>${STALE_HOURS}h)` };
    }
  }

  // 4. Default
  return { mode: "advance", reason: "default" };
}

async function runIteration(
  config: ThinkConfig,
  keys: KeyMaterial,
  mode: Mode,
): Promise<void> {
  if (mode === "advance") return advance(config, keys);
  if (mode === "wander") return wander(config, keys, { maxHops: 3 });
  if (mode === "consolidate") return consolidate(config, keys, { dryRun: false });
}

function printSummary(state: LoopState, options: LoopOptions, terminationReason: string): void {
  const creditsUsed = state.startCredits -
    (state.iterations[state.iterations.length - 1]?.creditsAfterIter ?? state.startCredits);
  const elapsed = Date.now() - state.startedAt.getTime();

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("loop complete");
  console.log("═══════════════════════════════════════");
  console.log(`duration:        ${fmtDuration(elapsed)} (limit: ${options.durationMinutes}m)`);
  console.log(`iterations:      ${state.iterations.length} (limit: ${options.maxIterations})`);
  console.log(`  advance:       ${state.byMode.advance}`);
  console.log(`  wander:        ${state.byMode.wander}`);
  console.log(`  consolidate:   ${state.byMode.consolidate}`);
  console.log(`credits used:    ~${creditsUsed} (limit: ${options.budgetCredits})`);
  console.log(`termination:     ${terminationReason}`);
  console.log("═══════════════════════════════════════");
}

export async function loop(
  config: ThinkConfig,
  keys: KeyMaterial,
  options: LoopOptions,
): Promise<void> {
  const client = new AgenttoolClient(config);

  const state: LoopState = {
    iterations: [],
    byMode: { advance: 0, wander: 0, consolidate: 0 },
    startedAt: new Date(),
    startCredits: 0,
    lastConsolidateAt: null,
    aborted: false,
    abortReason: null,
  };

  // SIGINT — clean shutdown. Second Ctrl-C: hard exit.
  let sigintCount = 0;
  const sigintHandler = () => {
    sigintCount += 1;
    if (sigintCount >= 2) {
      console.log("\n(second SIGINT — exiting hard)");
      process.exit(130);
    }
    console.log("\n(SIGINT received; finishing current iteration then exiting)");
    state.aborted = true;
    state.abortReason = "SIGINT";
  };
  process.on("SIGINT", sigintHandler);

  try {
    state.startCredits = await getCredits(client);

    const deadline = state.startedAt.getTime() + options.durationMinutes * 60_000;
    console.log(
      `▸ autonomous loop started · duration=${options.durationMinutes}m · budget=${options.budgetCredits} credits · sleep=${options.sleepSeconds}s`,
    );
    console.log(
      `  start credits: ${state.startCredits}` +
        (options.consolidateHour !== undefined
          ? ` · consolidate-hour: ${options.consolidateHour}`
          : ""),
    );
    console.log("");

    while (
      !state.aborted &&
      Date.now() < deadline &&
      state.iterations.length < options.maxIterations
    ) {
      const iterIndex = state.iterations.length + 1;

      // Check budget pre-iteration.
      let creditsBefore: number;
      try {
        creditsBefore = await getCredits(client);
      } catch (err) {
        console.log(`[${ts()}] iter ${iterIndex} · ERROR fetching credits: ${(err as Error).message}`);
        state.aborted = true;
        state.abortReason = "credit_check_failed";
        break;
      }

      if (creditsBefore < CREDIT_FLOOR) {
        console.log(
          `[${ts()}] credits below floor (${creditsBefore} < ${CREDIT_FLOOR}); stopping`,
        );
        state.aborted = true;
        state.abortReason = "credit_floor";
        break;
      }
      const used = state.startCredits - creditsBefore;
      if (used >= options.budgetCredits) {
        console.log(
          `[${ts()}] budget exhausted (used ~${used} >= cap ${options.budgetCredits}); stopping`,
        );
        state.aborted = true;
        state.abortReason = "budget";
        break;
      }

      // Choose mode.
      const { mode, reason } = await chooseMode(client, state, options.consolidateHour);

      console.log(
        `[${ts()}] iter ${iterIndex}/${options.maxIterations} · mode=${mode} · credits=${creditsBefore} · used=${used} · ${reason}`,
      );

      const log: IterationLog = {
        index: iterIndex,
        startedAt: new Date(),
        mode,
        creditsBeforeIter: creditsBefore,
        creditsAfterIter: creditsBefore,
      };

      try {
        await runIteration(config, keys, mode);
        if (mode === "consolidate") {
          state.lastConsolidateAt = Date.now();
        }
        state.byMode[mode] += 1;
      } catch (err) {
        log.error = (err as Error).message;
        console.log(`  ⚠ iteration error: ${log.error}`);
      }

      try {
        log.creditsAfterIter = await getCredits(client);
      } catch {
        log.creditsAfterIter = creditsBefore;
      }

      state.iterations.push(log);

      // Check break conditions before sleep.
      if (state.aborted) break;
      if (Date.now() >= deadline) break;
      if (state.iterations.length >= options.maxIterations) break;

      console.log("");
      const peerCount = options.peerStrandIds.length;
      const sleepLabel = options.liveSse
        ? `(sleeping up to ${options.sleepSeconds}s; SSE-watching own most-active strand` +
          (peerCount > 0 ? ` + ${peerCount} peer strand${peerCount === 1 ? "" : "s"} for drift-refs` : "") +
          `)`
        : `(sleeping ${options.sleepSeconds}s before next iteration)`;
      console.log(sleepLabel);
      console.log("");
      const outcome = options.liveSse
        ? await voiceTriggeredSleep(
            client,
            config,
            options.sleepSeconds * 1000,
            state,
            options.peerStrandIds,
          )
        : await sleep(options.sleepSeconds * 1000, state).then(
            (): SleepOutcome => ({ reason: state.aborted ? "aborted" : "timeout" }),
          );
      if (outcome.reason === "event") {
        console.log(`[${ts()}] sleep cut short — activity on ${outcome.detail}; running next iteration now`);
      }
    }

    // Determine termination reason if not already set.
    if (state.abortReason === null) {
      if (Date.now() >= deadline) state.abortReason = "duration";
      else if (state.iterations.length >= options.maxIterations) state.abortReason = "max_iterations";
      else state.abortReason = "completed";
    }

    printSummary(state, options, state.abortReason);
  } finally {
    process.off("SIGINT", sigintHandler);
  }
}
