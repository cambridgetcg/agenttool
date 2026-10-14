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
import { HaltSignal, markOrphans, processStartTime, recoverOrphans, runOnce, sweepJobs } from './runner.ts'

const paths = summonPaths()
const user = userInfo().username
const tag = (e: any) => (typeof e?.code === 'string' ? e.code : 'error')

// launchd stops a runner with SIGTERM (bootout, logout) and allows about 20 s. Claude runs in a session of its own, so it would
// outlive the runner: a job that is running is stopped and closed (swept, checked, cleaned up) before the process exits.
const halt = new HaltSignal(() => process.exit(0))
process.on('SIGTERM', () => halt.request())

// Before anything else: a job whose runner died (SIGKILL, a crash) may have left claude running and its git files changed. Sweep it,
// put the files back and clean up, so markOrphans settles it from what was found and no new job starts beside it.
try { await recoverOrphans({ paths, nowMs: () => Date.now(), processStartTime, user }) } catch (e) { console.error(`summon-runner: recoverOrphans failed: ${tag(e)}`) }

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
    collectInventory: async () => collectInventory(paths.home, user), heartbeatMs: 10_000, pollMs: 2_000, killGraceMs: 5_000, processStartTime, halt })
} catch (e) {
  console.error(`summon-runner: runOnce failed: ${tag(e)}`)
  exitCode = 1
}
process.exit(exitCode)
