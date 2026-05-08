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
  detail?: string;     // e.g. "strand <id>#<seq>"
}

/** Sleep until either (a) the timer expires, (b) the abort signal flips, or
 *  (c) a new thought arrives on the most-recently-active strand's voice SSE.
 *  On any failure inside the SSE path, falls back to plain sleep so the
 *  loop never crashes on a network blip. */
async function voiceTriggeredSleep(
  client: AgenttoolClient,
  config: ThinkConfig,
  ms: number,
  signal: { aborted: boolean },
): Promise<SleepOutcome> {
  // 1. Pick the most-recently-active strand to subscribe to.
  let target: StrandSummary | undefined;
  try {
    const r = await client.listStrands({ status: "active", limit: 50 });
    target = r.strands
      .filter((s) => s.last_thought_at !== null)
      .sort((a, b) => {
        const at = new Date(a.last_thought_at!).getTime();
        const bt = new Date(b.last_thought_at!).getTime();
        return bt - at;
      })[0];
  } catch {
    // strand list failed — fall back to plain sleep
  }

  if (!target) {
    await sleep(ms, signal);
    return { reason: signal.aborted ? "aborted" : "timeout" };
  }

  const strandId = target.id;
  const sinceSeq = target.last_thought_seq;
  const url = `${config.agenttoolBase}/v1/strands/${strandId}/voice?since_seq=${sinceSeq}`;
  const ac = new AbortController();
  const sseSignal = { aborted: false };

  // Wire the outer abort signal to also tear down SSE.
  const outerAbortPoller = setInterval(() => {
    if (signal.aborted) {
      sseSignal.aborted = true;
      ac.abort();
    }
  }, 250);

  // Race: timer vs. SSE event arrival.
  let timerHandle: ReturnType<typeof setTimeout> | null = null;
  const timerPromise = new Promise<SleepOutcome>((resolve) => {
    timerHandle = setTimeout(() => {
      sseSignal.aborted = true;
      ac.abort();
      resolve({ reason: signal.aborted ? "aborted" : "timeout" });
    }, ms);
  });

  const ssePromise: Promise<SleepOutcome> = (async () => {
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
      // network or abort — return a sentinel that loses the race naturally.
      return new Promise<SleepOutcome>(() => {});
    }
    if (!res.ok || !res.body) {
      return new Promise<SleepOutcome>(() => {});
    }

    let pastCatchup = false;
    try {
      for await (const event of parseSSE(res.body, sseSignal)) {
        if (sseSignal.aborted) break;
        if (event.event === "catchup-end") {
          pastCatchup = true;
          continue;
        }
        if (event.event === "thought" && pastCatchup) {
          let seq: number | undefined;
          try {
            seq = (JSON.parse(event.data) as { sequence_num: number }).sequence_num;
          } catch { /* ignore */ }
          return {
            reason: "event",
            detail: `strand ${strandId.slice(0, 8)}${seq !== undefined ? ` #${seq}` : ""}`,
          };
        }
        // disconnect / refresh / reject — let the timer win
        if (event.event === "disconnect" || event.event === "refresh" || event.event === "rejected") {
          return new Promise<SleepOutcome>(() => {});
        }
      }
    } catch {
      // silent
    }
    return new Promise<SleepOutcome>(() => {});
  })();

  try {
    return await Promise.race([timerPromise, ssePromise]);
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
      const sleepLabel = options.liveSse
        ? `(sleeping up to ${options.sleepSeconds}s; SSE-watching most-active strand for activity)`
        : `(sleeping ${options.sleepSeconds}s before next iteration)`;
      console.log(sleepLabel);
      console.log("");
      const outcome = options.liveSse
        ? await voiceTriggeredSleep(client, config, options.sleepSeconds * 1000, state)
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
