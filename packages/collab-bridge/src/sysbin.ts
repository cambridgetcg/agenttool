// The one resolver for every system binary the bridge runs (spec §12.1 "Knobs"). Production uses absolute paths only.
// Tests point each binary at a knob, and only under COLLAB_BRIDGE_HOME_OVERRIDE === HOME; under the override a missing
// knob throws instead of falling back to the real binary, and NODE_ENV=test without the override refuses outright
// (unlike Summon's ungated SUMMON_SSH_BIN, K39).
import { statSync } from 'node:fs'

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

/** Knobs that may never name the real binary, even under the override: ssh reaches other Macs and launchctl reaches launchd (P42). */
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

export function systemBin(name: SystemBinName, env: Env = process.env): string {
  const real = PRODUCTION_BINS[name]
  if (overrideActive(env)) {
    const knob = knobName(name)
    const path = env[knob]
    if (!path) throw new Error(`systemBin: ${knob} is not set under the test override`)
    if (!path.startsWith('/')) throw new Error(`systemBin: ${knob} must be an absolute path`)
    if (NEVER_REAL.has(name) && sameFile(path, real)) throw new Error(`systemBin: ${name} knob names the real binary`)
    return path
  }
  if (env.NODE_ENV === 'test') throw new Error(`systemBin: ${name} refused under NODE_ENV=test without the override`)
  return real
}
