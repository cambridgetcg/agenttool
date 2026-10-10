// LaunchAgent dev.summon.runner on Nuance: runs in Yu's GUI session (where his
// Claude login is readable), started by launchd whenever the spool is non-empty.
// It must always finish and exit: a runner that crashes or hangs on a stray file would be relaunched forever.
import { userInfo } from 'node:os'
import { findClaude } from './harness.ts'
import { collectInventory } from './inventory.ts'
import { summonPaths } from './paths.ts'
import { pruneSeen } from './replay.ts'
import { markOrphans, reapStranded, runOnce, sweepJobs } from './runner.ts'

const paths = summonPaths()
const user = userInfo().username
const tag = (e: any) => (typeof e?.code === 'string' ? e.code : 'error')

// Housekeeping must never keep the queue from running, so each step stands alone.
const now = Date.now()
for (const [what, step] of [
  ['markOrphans', () => markOrphans(paths, now)],
  ['reapStranded', () => reapStranded(paths, now)],
  ['sweepJobs', () => sweepJobs(paths, now)],
  ['pruneSeen', () => pruneSeen(paths.seen, now)],
] as const) {
  try { step() } catch (e) { console.error(`summon-runner: ${what} failed: ${tag(e)}`) }
}

let exitCode = 0
try {
  await runOnce({ paths, home: paths.home, user, nowMs: () => Date.now(), claudeBin: () => findClaude(paths.home),
    collectInventory: async () => collectInventory(paths.home, user), heartbeatMs: 10_000, pollMs: 2_000, killGraceMs: 5_000 })
} catch (e) {
  console.error(`summon-runner: runOnce failed: ${tag(e)}`)
  exitCode = 1
}
process.exit(exitCode)
