// `collab-bridge status` on Nuance (C14): whether the relay is up, stale since when, or not there; how old its last PING
// is; how many pipes are attached, and any refusal a pipe holds (P29). Read-only: it connects to nothing, so it answers
// with the hub away and cannot disturb a live link. Ages compare CLOCK_MONOTONIC readings, which are system-wide (F13).
import { monoNowMs } from '../native.ts'
import type { NuancePaths } from '../paths.ts'
import { pidAlive } from '../proc.ts'
import { TIMING } from '../timing.ts'
import { readPipeRecords } from './pipe-record.ts'
import { readRelayStatus } from './relay.ts'

export interface NuanceStatus { relay: 'up' | 'stale' | 'none'; stale_since_mono: number | null; last_ping_age_s: number | null; pipes: number; refused: string[] }

export function nuanceStatus(paths: NuancePaths, mono: () => number, o: { staleMs?: number; alive?: (pid: number) => boolean } = {}): NuanceStatus {
  const staleMs = o.staleMs ?? TIMING.staleMs
  const alive = o.alive ?? pidAlive
  const records = readPipeRecords(paths, alive)
  const pipes = records.filter((r) => r.state === 'ready').length
  const refused = [...new Set(records.flatMap((r) => (r.refused === null ? [] : [r.refused])))].sort()
  const now = mono()
  const relay = readRelayStatus(paths)
  if (!relay || !alive(relay.pid)) return { relay: 'none', stale_since_mono: null, last_ping_age_s: null, pipes, refused }
  const lastPingAge = relay.last_ping_mono === null ? null : Math.max(0, Math.round((now - relay.last_ping_mono) / 1000))
  const heard = relay.last_ping_mono ?? relay.started_mono   // the relay's own rule: until the first PING, its start counts (§5.3)
  if (now - heard <= staleMs) return { relay: 'up', stale_since_mono: null, last_ping_age_s: lastPingAge, pipes, refused }
  return { relay: 'stale', stale_since_mono: heard + staleMs, last_ping_age_s: lastPingAge, pipes, refused }
}

export function renderNuanceStatus(s: NuanceStatus, nowMono: number = monoNowMs()): string[] {
  const relay = s.relay === 'stale' && s.stale_since_mono !== null
    ? `relay: stale since ${Math.max(0, Math.round((nowMono - s.stale_since_mono) / 1000))}s`
    : `relay: ${s.relay}`
  const out = [relay, s.last_ping_age_s === null ? 'last PING: none' : `last PING: ${s.last_ping_age_s} s ago`, `pipes attached: ${s.pipes}`]
  if (s.refused.length > 0) out.push(`refused: ${s.refused.join(', ')}`)
  return out
}
