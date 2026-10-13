// Every deadline and backoff constant (R19, spec §5.3–§5.5, §8, §9.4, §9.6, §10.4) in one place, and the test time scale (P33).
import { overrideActive, type Env } from './sysbin.ts'

export const TIMING = {
  pingMs: 15_000, // the hub's PING on stream 0 (§5.3)
  staleMs: 20_000, // a link with no PING for this long takes no new call (§9.4)
  relayExitMs: 45_000, // the relay exits after this long with no PING (§5.3)
  inodeCheckMs: 5_000, // the relay checks that hub.sock is still its own (§5.3)
  preambleMs: 30_000, // from spawning ssh to the preamble (§5.4)
  handshakeStepMs: 5_000, // each of attach, challenge, prove (§5.4)
  callDefaultMs: 60_000, // a pipe call (§9.4)
  callLongMs: 150_000, // claim and complete (§9.4)
  childRequestMs: 600_000, // hub → Collab child, always finite (§9.3 item 4, K65)
  claudeEntryTimeoutMs: 300_000, // the Claude entry's timeout, above every pipe deadline (§6.2)
  knocksMaxMs: 2_000, // a knocks request's timeout_ms (§5.4)
  knocksMinRemainingMs: 1_000, // the hub starts the knock read only with this much left (§8 item 3)
  callMinRemainingMs: 1_000, // the hub writes a call to a child only while this much of its timeout_ms remains (§5.4, as for knocks); scaled (P33)
  tapBudgetMs: 3_000, // the whole hook (§8)
  tapAskMs: 2_000, // what the pipe gives the hub for one tap (Task 31)
  reattachMs: 2_000, // a detached pipe redials this often, ±20% (P40)
  childDetachedMs: 600_000, // a detached child lives this long (§9.6 item 3)
  lineageRetireMs: 604_800_000, // 7 days detached, then retired (§6.2)
  lineageSweepMs: 604_800_000, // pipe lineage files of a gone host are swept after 7 days (§6.2)
  leaseMinRemainingMs: 150_000, // complete needs this much lease left (§7.2)
  fetchMs: 60_000, // the mirror fetch, then SIGTERM (§7.3 step 4)
  checkoutMs: 30_000, // the mirror checkout (§7.3 step 8)
  gitCallMs: 5_000, // any other git call (§9.4)
  pongDropMs: 45_000, // the hub drops a link with no PONG for this long (P47)
} as const

export const BACKOFF = {
  stepsMs: [5_000, 10_000, 20_000, 40_000, 60_000], // §5.5
  jitter: 0.2,
  resetAfterUpMs: 60_000,
  redialOncePerMs: 600_000, // one immediate redial after a drop, at most once per 10 minutes
  awayAfterMs: 600_000,
  awayCapMs: 900_000,
  hostKeyWindowMs: 1_800_000,
  hostKeyEscalateAt: 3,
  preambleHintAfter: 3, // silent dials in a row before the zshenv hint (§5.4)
  relayContestedWindowMs: 600_000, // §5.3, T5
  relayContestedAbove: 3,
  unexpectedExitsWindowMs: 600_000, // §10.4, P58
  unexpectedExitsMax: 5,
} as const

/** 1, or COLLAB_BRIDGE_TEST_TIME_SCALE clamped to [0.001, 1], and only under the override (P33). */
export function timeScale(env: Env = process.env): number {
  if (!overrideActive(env)) return 1
  const v = env.COLLAB_BRIDGE_TEST_TIME_SCALE
  if (v === undefined || v.trim() === '') return 1
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.min(1, Math.max(0.001, n))
}

export function scaled(ms: number, env: Env = process.env): number {
  return Math.max(1, Math.round(ms * timeScale(env)))
}
