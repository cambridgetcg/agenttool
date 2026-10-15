// The one resolver for every system binary the bridge runs (spec §12.1 "Knobs"). Production uses absolute paths only.
// Tests point each binary at a knob, and only under COLLAB_BRIDGE_HOME_OVERRIDE === HOME; under the override a missing
// knob throws instead of falling back to the real binary, and NODE_ENV=test without the override refuses outright
// (unlike Summon's ungated SUMMON_SSH_BIN, K39).
import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'

/** An environment as the bridge reads it: process.env, or one a caller built. */
export type Env = Record<string, string | undefined>

export type SystemBinName = 'ssh' | 'ssh-keygen' | 'git' | 'launchctl' | 'ps' | 'zsh' | 'bun' | 'codesign' | 'xcrun' | 'plutil' | 'id'

export const PRODUCTION_BINS: Readonly<Record<SystemBinName, string>> = Object.freeze({
  ssh: '/usr/bin/ssh',
  'ssh-keygen': '/usr/bin/ssh-keygen',
  git: '/opt/homebrew/bin/git', // the Air's git, first on every PATH the bridge builds (spec §7.1)
  launchctl: '/bin/launchctl',
  ps: '/bin/ps',
  zsh: '/bin/zsh',
  bun: '/Users/yuai/.bun/bin/bun',
  codesign: '/usr/bin/codesign',
  xcrun: '/usr/bin/xcrun',
  plutil: '/usr/bin/plutil',
  id: '/usr/bin/id',
})

/** Knobs that may never name the real binary, even under the override: ssh reaches other Macs and launchctl reaches launchd (P42). Nor another real one: see neverRealProblem. */
export const NEVER_REAL: ReadonlySet<SystemBinName> = new Set<SystemBinName>(['ssh', 'launchctl'])

export function knobName(name: SystemBinName): string {
  return `COLLAB_BRIDGE_BIN_${name.toUpperCase().replace(/-/g, '_')}`
}

/** The test override counts only when it is set and equals HOME, so a stray variable in a real session does nothing. */
export function overrideActive(env: Env = process.env): boolean {
  const o = env.COLLAB_BRIDGE_HOME_OVERRIDE
  return typeof o === 'string' && o !== '' && o === env.HOME
}

/** A non-negative integer knob (such as COLLAB_BRIDGE_DROPIN_OWNER_UID, P60), read only under the override; else null. */
export function knobInt(name: string, env: Env = process.env): number | null {
  if (!overrideActive(env)) return null
  const v = env[name]
  if (v === undefined || !/^(0|[1-9][0-9]{0,9})$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : null
}

/** Same file by path, by symlink target or by hard link. */
function sameFile(a: string, b: string): boolean {
  if (a === b) return true
  try {
    const sa = statSync(a)
    const sb = statSync(b)
    return sa.dev === sb.dev && sa.ino === sb.ino
  } catch {
    return false
  }
}

/** `p` and its realpath when that exists, else just `p` (a root that is not there holds nothing). */
function realOr(p: string): string {
  try { return realpathSync(p) } catch { return p }
}

const within = (p: string, root: string) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`)

/**
 * What a NEVER_REAL knob must be beyond "not the production file" (P42, spec §12.1: no real ssh or launchctl in a test):
 * wherever it really lives, it is inside the override home or a temp root, and it is a `#!` script. A copy of the real
 * binary, or Homebrew's ssh, has another inode and passes the same-file test; a copy fails the script test and any other
 * installed binary fails the root test (Task 63 conformance-9-2). A path where nothing exists runs nothing, so it passes.
 */
function neverRealProblem(name: SystemBinName, path: string, env: Env): string | null {
  let real: string
  try { real = realpathSync(path) } catch { return null }
  // $TMPDIR may be missing in a scrubbed child env (tmpdir() is then /tmp), so this Mac's per-user temp root is named too.
  const roots = [env.HOME, tmpdir(), '/tmp', '/var/folders'].filter((r): r is string => typeof r === 'string' && r.startsWith('/')).map(realOr)
  if (!roots.some((r) => within(real, r))) return `systemBin: ${name} knob lies outside the test roots`
  let head = ''
  try {
    const fd = openSync(real, 'r')
    try {
      const buf = Buffer.alloc(2)
      head = buf.subarray(0, readSync(fd, buf, 0, 2, 0)).toString('latin1')
    } finally {
      closeSync(fd)
    }
  } catch { return `systemBin: ${name} knob is not a script stub` }
  return head === '#!' ? null : `systemBin: ${name} knob is not a script stub`
}

export function systemBin(name: SystemBinName, env: Env = process.env): string {
  const real = PRODUCTION_BINS[name]
  if (overrideActive(env)) {
    const knob = knobName(name)
    const path = env[knob]
    if (!path) throw new Error(`systemBin: ${knob} is not set under the test override`)
    if (!path.startsWith('/')) throw new Error(`systemBin: ${knob} must be an absolute path`)
    if (NEVER_REAL.has(name)) {
      if (sameFile(path, real)) throw new Error(`systemBin: ${name} knob names the real binary`)
      const problem = neverRealProblem(name, path, env)
      if (problem) throw new Error(problem)
    }
    return path
  }
  if (env.NODE_ENV === 'test') throw new Error(`systemBin: ${name} refused under NODE_ENV=test without the override`)
  return real
}
