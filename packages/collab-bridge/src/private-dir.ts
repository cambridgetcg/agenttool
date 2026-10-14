// mkdir -p for the bridge's own directories (Global Constraints, Modes): every directory this call creates is 0700,
// set with chmodSync because the mode passed to mkdirSync is cut by the umask. A directory that already exists (the
// user's ~/.config, ~/.local/state) is left exactly as it is.
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

export function mkdirPrivate(dir: string): void {
  if (!isAbsolute(dir)) throw new Error('mkdirPrivate: the directory must be an absolute path')
  const missing: string[] = []
  for (let d = dir; !existsSync(d); d = dirname(d)) missing.push(d)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const d of missing) chmodSync(d, 0o700)
}
