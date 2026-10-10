import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SummonPaths {
  home: string
  share: string
  state: string
  config: string
  spool: string
  jobs: string
  seen: string
  ledger: string
  allowlist: string
  inventory: string
}

/** Where Summon keeps everything on a Mac. SUMMON_HOME_OVERRIDE is for tests only. */
export function summonPaths(home: string = process.env.SUMMON_HOME_OVERRIDE || homedir()): SummonPaths {
  const state = join(home, '.local', 'state', 'summon')
  return {
    home,
    share: join(home, '.local', 'share', 'summon'),
    state,
    config: join(home, '.config', 'summon'),
    spool: join(state, 'spool'),
    jobs: join(state, 'jobs'),
    seen: join(state, 'seen'),
    ledger: join(state, 'ledger.jsonl'),
    allowlist: join(home, '.config', 'summon', 'allowlist.yaml'),
    inventory: join(state, 'inventory.json'),
  }
}
