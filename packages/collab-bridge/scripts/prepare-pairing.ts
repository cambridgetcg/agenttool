// On the Air: prepare a device's pairing bundle (C6, spec §10.2 step 1). This part is the installer's renderer and the
// pattern of every value it puts into nuance/install.sh.tmpl; Task 60 adds the bundle around it (the collab key, the
// build, tools.json, the trial repo and its git bundle, MANIFEST.txt and the device file).
import { TRAILER_RE } from '../src/nuance/install-steps.ts'
import { sharePathProblem } from '../src/share-path.ts'

export interface InstallerValues { device: string; user: string; pubkey: string; expiry: string; preparedAt: string; build: string;
  shaBinary: string; shaManifest: string; shaTools: string; shaTrialBundle: string; trailer: string; shares: string[] }

type Scalar = Exclude<keyof InstallerValues, 'shares'>

/** Every scalar value's pattern. Each one lands inside bash single quotes, so none may hold a ' (the trailer's class skips it). */
export const INSTALLER_VALUE_RES: Readonly<Record<Scalar, RegExp>> = {
  device: /^[a-z][a-z0-9-]{0,31}$/,
  user: /^[a-z_][a-z0-9._-]{0,31}$/,
  pubkey: /^ssh-ed25519 [A-Za-z0-9+/=]+ collab-air$/,
  expiry: /^\d{8}$/,
  preparedAt: /^\d{14}$/,
  build: /^[0-9a-f]{8}$/,
  shaBinary: /^[0-9a-f]{64}$/,
  shaManifest: /^[0-9a-f]{64}$/,
  shaTools: /^[0-9a-f]{64}$/,
  shaTrialBundle: /^[0-9a-f]{64}$/,
  trailer: TRAILER_RE,
}

const PLACEHOLDERS: Readonly<Record<keyof InstallerValues, string>> = {
  device: '__DEVICE__', user: '__USER__', pubkey: '__PUBKEY__', expiry: '__EXPIRY__', preparedAt: '__PREPARED_AT__', build: '__BUILD__',
  shaBinary: '__SHA_BINARY__', shaManifest: '__SHA_MANIFEST__', shaTools: '__SHA_TOOLS__', shaTrialBundle: '__SHA_TRIAL_BUNDLE__',
  trailer: '__TRAILER__', shares: '__SHARES__',
}

/**
 * Fills the template after checking every value against its pattern, and every share path against the gate's rule
 * (sharePathProblem: absolute and normalised, at most 1019 bytes, no ', !, \ or control character; bash's single quotes
 * carry any such path as it is, and share paths never go into the key line). The template must use every placeholder
 * and no other `__NAME__` word, which is checked on the template alone before any value goes in. The values are then put
 * in by ONE pass over the template (never over the output as it grows), so a value that looks like a placeholder, such as
 * the trailer `X __SHARES__`, is inserted as it is and never filled again. A replacer function inserts them, so `$&` or
 * `$1` in a trailer stays literal.
 */
export function renderInstaller(tmpl: string, v: InstallerValues): string {
  for (const k of Object.keys(INSTALLER_VALUE_RES) as Scalar[]) {
    if (typeof v[k] !== 'string' || !INSTALLER_VALUE_RES[k].test(v[k])) throw new Error(`renderInstaller: ${k} does not match its pattern`)
  }
  if (!Array.isArray(v.shares) || v.shares.length === 0) throw new Error('renderInstaller: no share')
  for (const s of v.shares) {
    const problem = sharePathProblem(s)
    if (problem) throw new Error(`renderInstaller: share ${JSON.stringify(s)} ${problem}`)
  }
  const known = new Set(Object.values(PLACEHOLDERS))
  const used = new Set(tmpl.match(/__[A-Z][A-Z_]*__/g) ?? [])
  for (const word of used) if (!known.has(word)) throw new Error(`renderInstaller: unknown placeholder ${word}`)
  for (const ph of known) if (!used.has(ph)) throw new Error(`renderInstaller: the template has no ${ph}`)
  const valueFor: Record<string, string> = {}
  for (const [k, ph] of Object.entries(PLACEHOLDERS) as Array<[keyof InstallerValues, string]>) {
    valueFor[ph] = k === 'shares' ? v.shares.map((s) => `'${s}'`).join(' ') : v[k] as string
  }
  return tmpl.replace(/__[A-Z][A-Z_]*__/g, (w) => valueFor[w]!)
}
