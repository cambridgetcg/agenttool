import { rmSync } from 'node:fs'
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
