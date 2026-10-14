#!/usr/bin/env -S bun --no-env-file --config=/dev/null
// The Air's collab-bridge (C14): argv → runAirCli(defaultAirDeps()) → exit. Built into the pinned
// ~/.local/share/collab-bridge/air/<sha>/hub.js, which ~/.local/bin/collab-bridge and the LaunchAgent run with
// bun --no-env-file --config=/dev/null from cwd / (R39). Exit codes: 0 done; 1 refused or failed; 2 a usage error.
import { basename } from 'node:path'
import { defaultHubDeps, embeddedBuild, runHub } from '../src/air/hub.ts'
import { liveUnpairDeps, unpairDevice } from '../src/air/unpair.ts'
import { runAirCli, ttyAsk, type AirCliDeps } from '../src/cli.ts'
import { getuid } from '../src/native.ts'
import { airPaths, collabDist, homeOf } from '../src/paths.ts'
import { readPs } from '../src/proc.ts'
import { systemBin } from '../src/sysbin.ts'

const SHA_DIR_RE = /^[0-9a-f]{64}$/
const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const

/** The live wiring. hubSha is the pinned bundle's own directory name, so a source run (tests, Task 62) has none. */
export function defaultAirDeps(): AirCliDeps {
  const env = process.env
  const paths = airPaths(homeOf(env))
  const dir = basename(import.meta.dir)
  const bun = systemBin('bun', env)
  const dist = collabDist(env)
  const out = (line: string) => { process.stdout.write(`${line}\n`) }
  return {
    paths,
    env,
    selfPid: process.pid,
    uid: getuid,
    table: () => readPs(systemBin('ps', env)),
    ask: ttyAsk(env),
    launchctl: systemBin('launchctl', env),
    codesign: systemBin('codesign', env),
    bun,
    hubSha: SHA_DIR_RE.test(dir) ? dir : null,
    build: embeddedBuild(),
    collabDist: dist,
    // `run` and `hub run` only, installed before the hub starts: SIGTERM (`hub off`'s bootout, which the launcher
    // forwards; logout under launchd), SIGINT (Ctrl-C) and SIGHUP (the fallback's Terminal window closing, or logout)
    // reach runHub's clean stop, so the run is recorded clean and hub_stop is ledgered (P58). `once`: a second signal
    // takes its default action. The bin's unref'd exit timer ends a process that a child handle would keep alive.
    runHub: () => {
      const ac = new AbortController()
      const stop = () => ac.abort()
      for (const s of STOP_SIGNALS) process.once(s, stop)
      return runHub({ ...defaultHubDeps(env), signal: ac.signal }).finally(() => {
        for (const s of STOP_SIGNALS) process.off(s, stop)
      })
    },
    out,
    err: (line) => { process.stderr.write(`${line}\n`) },
    now: () => new Date(),
    unpair: (device) => unpairDevice(device, liveUnpairDeps({ paths, bun, dist, out })),
  }
}

if (import.meta.main) {
  let code: number
  try {
    code = await runAirCli(process.argv.slice(2), defaultAirDeps())
  } catch (e) {
    process.stderr.write(`✗ collab-bridge: ${String((e as Error)?.message ?? e).split('\n')[0]}\n`)
    code = 1
  }
  // Exit once stdout drains; the unref'd timer only ends a process that something else would keep alive.
  process.exitCode = code
  setTimeout(() => process.exit(code), 2000).unref()
}
