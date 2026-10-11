// LaunchAgent dev.summon.runner on Nuance: runs in Yu's GUI session (where his
// Claude login is readable), started by launchd whenever the spool is non-empty.
// It must always finish and exit: a runner that crashes or hangs on a stray file would be relaunched forever.
import { mkdirSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { findClaude } from './harness.ts'
import { collectInventory } from './inventory.ts'
import { settleNeverReached } from './jobs.ts'
import { withLock } from './ledger.ts'
import { summonPaths } from './paths.ts'
import { pruneSeen } from './replay.ts'
import { markOrphans, processStartTime, runOnce, sweepJobs } from './runner.ts'

const paths = summonPaths()
const user = userInfo().username
const tag = (e: any) => (typeof e?.code === 'string' ? e.code : 'error')

// Housekeeping must never keep the queue from running, so each step stands alone.
const now = Date.now()
for (const [what, step] of [
  ['markOrphans', () => markOrphans(paths, now)],
  // Under the gate's admission lock, before the spool is read: a job past expiry + grace is settled once (never twice with a
  // gate start), and its marker goes even if its job dir cannot be written, so a failing claim cannot relaunch us forever.
  ['settleNeverReached', () => {
    mkdirSync(paths.state, { recursive: true, mode: 0o700 })
    return withLock(join(paths.state, 'admission'), () => settleNeverReached(paths, now))
  }],
  ['sweepJobs', () => sweepJobs(paths, now)],
  ['pruneSeen', () => pruneSeen(paths.seen, now)],
] as const) {
  try { step() } catch (e) { console.error(`summon-runner: ${what} failed: ${tag(e)}`) }
}

let exitCode = 0
try {
  await runOnce({ paths, home: paths.home, user, nowMs: () => Date.now(), claudeBin: () => findClaude(paths.home),
    collectInventory: async () => collectInventory(paths.home, user), heartbeatMs: 10_000, pollMs: 2_000, killGraceMs: 5_000, processStartTime })
} catch (e) {
  console.error(`summon-runner: runOnce failed: ${tag(e)}`)
  exitCode = 1
}
process.exit(exitCode)
