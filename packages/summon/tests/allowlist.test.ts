import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAdmission, parseAllowlist, parseDurationS, type Admission, type Allowlist } from '../src/allowlist.ts'
import { cleanupTmps, sampleRequest, trackTmp } from './helpers.ts'

// Mirrors the planned gate: narrows on !adm.ok, then reads adm.hint. Must type-check under tsc --strict.
function refusalHint(adm: Admission): string | undefined {
  if (!adm.ok) return adm.hint
  return undefined
}

function home(): string {
  const h = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-al-'))))
  for (const d of ['Projects/x', 'Projects/y', 'Documents/secret', 'Desktop']) mkdirSync(join(h, d), { recursive: true })
  return h
}
afterEach(() => cleanupTmps())

const YAML = `version: 1
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
const al = (): Allowlist => {
  const r = parseAllowlist(YAML)
  if (!r.ok) throw new Error(r.detail)
  return r.allowlist
}

describe('parseAllowlist', () => {
  test('parses the installer default', () => {
    expect(al()).toMatchObject({ device: 'nuance', peers: ['air'], limits: { job_timeout_max_s: 1800 } })
  })
  test('rejects bad shapes', () => {
    expect(parseAllowlist('version: 2').ok).toBe(false)
    expect(parseAllowlist(YAML.replace('id: claude', 'id: bash')).ok).toBe(false)
    expect(parseAllowlist(YAML.replace('access: review', 'access: root')).ok).toBe(false)
    expect(parseAllowlist(': : :').ok).toBe(false)
  })
  test('durations', () => {
    expect(parseDurationS('30m')).toBe(1800)
    expect(parseDurationS('2h')).toBe(7200)
    expect(parseDurationS(45)).toBe(45)
    expect(parseDurationS('1d')).toBeNull()
    expect(parseDurationS('0m')).toBeNull()
  })
  test('refuses a zero job_timeout_max', () => {
    expect(parseAllowlist(YAML.replace('job_timeout_max: 30m', 'job_timeout_max: 0m')).ok).toBe(false)
  })
})

describe('checkAdmission', () => {
  test('admits claude/sonnet review inside ~/Projects', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/x' }), al(), h)).toEqual({ ok: true, cwdReal: join(h, 'Projects/x') })
  })
  test('refuses edit in a review folder, with a hint', () => {
    const r = checkAdmission(sampleRequest({ access: 'edit' }), al(), home())
    expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect((r as { hint?: string }).hint).toContain('access: edit')
  })
  test('refuses an unknown peer, runtime or model', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ from_device: 'phone' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ runtime: 'codex' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ model: 'opus' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ model: 'sonnet', effort: 'high' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
  test('every outside_allowlist refusal carries a hint', () => {
    const h = home()
    const refused = [
      sampleRequest({ from_device: 'phone' }),
      sampleRequest({ runtime: 'codex' }),
      sampleRequest({ model: 'opus' }),
      sampleRequest({ model: 'sonnet', effort: 'high' }),
      sampleRequest({ cwd: '~/Projects/nope' }),
      sampleRequest({ cwd: '/' }),
      sampleRequest({ access: 'edit' }),
    ]
    for (const req of refused) {
      const r = checkAdmission(req, al(), h)
      expect(r).toMatchObject({ ok: false, reason: 'outside_allowlist' })
      expect(typeof (r as { hint?: string }).hint).toBe('string')
    }
  })
  test('codex needs reads_anywhere; hermes is review-only', () => {
    const h = home()
    const r = parseAllowlist(YAML
      .replace('folders:', '  - id: codex\n    models: [{ model: gpt-6-astra }]\n  - id: hermes\n    models: [{ model: gpt-6-astra }]\n    reads_anywhere: true\nfolders:')
      .replace('access: review', 'access: edit'))
    if (!r.ok) throw new Error(r.detail)
    // codex without reads_anywhere is refused
    expect(checkAdmission(sampleRequest({ runtime: 'codex', model: 'gpt-6-astra' }), r.allowlist, h))
      .toMatchObject({ ok: false, reason: 'outside_allowlist', hint: expect.stringContaining('reads_anywhere') })
    // hermes with reads_anywhere: review is admitted
    expect(checkAdmission(sampleRequest({ runtime: 'hermes', model: 'gpt-6-astra', access: 'review' }), r.allowlist, h))
      .toMatchObject({ ok: true })
    // hermes edit is refused by the hermes check, not by the folder (which grants edit)
    expect(checkAdmission(sampleRequest({ runtime: 'hermes', model: 'gpt-6-astra', access: 'edit' }), r.allowlist, h))
      .toMatchObject({ ok: false, reason: 'outside_allowlist', detail: 'hermes is review-only' })
  })
  test('refuses a folder that does not exist or is outside the allowlist', () => {
    const h = home()
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/nope' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
    expect(checkAdmission(sampleRequest({ cwd: '/' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
  test('a consumer can read hint after narrowing on !ok, for both refusal reasons', () => {
    const h = home()
    const outside = checkAdmission(sampleRequest({ cwd: '/' }), al(), h)
    const tcc = checkAdmission(sampleRequest({ cwd: '~/Desktop' }), al(), h)
    expect(tcc).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
    expect(refusalHint(outside)).toEqual(expect.any(String))
    expect(refusalHint(tcc)).toBeUndefined()
  })
  test('refuses TCC-protected folders even when allowlisted', () => {
    const h = home()
    const docs = parseAllowlist(YAML.replace('path: ~/Projects', 'path: ~/Documents'))
    if (!docs.ok) throw new Error(docs.detail)
    expect(checkAdmission(sampleRequest({ cwd: '~/Documents/secret' }), docs.allowlist, h)).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
  })
  test('a symlink from an allowlisted folder into ~/Documents is refused by its target, not its spelling', () => {
    const h = home()
    symlinkSync(join(h, 'Documents/secret'), join(h, 'Projects/x/escape'))
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/x/escape' }), al(), h)).toMatchObject({ ok: false, reason: 'tcc_protected_folder' })
  })
  test('a symlink out of the allowlist is refused', () => {
    const h = home()
    mkdirSync(join(h, 'elsewhere'))
    symlinkSync(join(h, 'elsewhere'), join(h, 'Projects/y/out'))
    expect(checkAdmission(sampleRequest({ cwd: '~/Projects/y/out' }), al(), h)).toMatchObject({ ok: false, reason: 'outside_allowlist' })
  })
})
