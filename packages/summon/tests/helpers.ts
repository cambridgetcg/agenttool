import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newRequestId, type SummonRequest } from '../src/request.ts'

export function sampleRequest(over: Partial<SummonRequest> = {}): SummonRequest {
  const now = Date.now()
  return {
    v: 1, id: newRequestId(now), from_device: 'air', to_device: 'nuance',
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + 15 * 60_000).toISOString(),
    runtime: 'claude', mode: 'job', model: 'sonnet', cwd: '~/Projects/x', access: 'review',
    timeout_s: 900, prompt: 'Read the README and summarise it.', ...over,
  }
}

const tmps: string[] = []

/** Records a temp dir so cleanupTmps() can remove it; returns the dir unchanged. */
export function trackTmp(dir: string): string {
  tmps.push(dir)
  return dir
}

export function cleanupTmps(): void {
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
  tmps.length = 0
}

export const DEFAULT_ALLOWLIST = `version: 1
device: nuance
peers: [air]
runtimes:
  - id: claude
    models: [{ model: sonnet }, { model: haiku }]
folders:
  - path: ~/Projects
    access: review
limits:
  max_concurrent: 1
  starts_per_hour: 6
  job_timeout_max: 30m
`

/** A fresh fake target home with ~/Projects/x and an allowlist; registered for cleanupTmps(). */
export function targetHome(allowlist: string = DEFAULT_ALLOWLIST): string {
  const h = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-gate-'))))
  mkdirSync(join(h, 'Projects/x'), { recursive: true })
  mkdirSync(join(h, '.config/summon'), { recursive: true })
  writeFileSync(join(h, '.config/summon/allowlist.yaml'), allowlist)
  return h
}
