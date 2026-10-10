import { accessSync, constants, statSync } from 'node:fs'
import { join } from 'node:path'

export function isExecutable(p: string): boolean {
  try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false }
}

/** Where Claude Code lives on a Mac. SUMMON_CLAUDE_BIN is a test override (only with SUMMON_HOME_OVERRIDE). */
export function findClaude(home: string): string | null {
  const override = process.env.SUMMON_HOME_OVERRIDE ? process.env.SUMMON_CLAUDE_BIN : undefined
  for (const p of [override, join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (p && isExecutable(p)) return p
  }
  return null
}
