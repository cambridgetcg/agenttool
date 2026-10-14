import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blockedHint, blockFolder, blockMarkerPath, displayPath } from '../src/blocked.ts'
import { cleanupTmps, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)
const stateOf = () => { const s = trackTmp(realpathSync(mkdtempSync(join(tmpdir(), 'summon-blk-')))); return join(s, '.local/state/summon') }
const INFO = { job: 'smn_' + 'a'.repeat(32), at: '2026-10-14T00:00:00.000Z', why: 'tampered' as const }

describe('blockMarkerPath: one marker per folder, whatever the spelling', () => {
  test('it is under <state>/blocked, named by a sha256, and differs from folder to folder', () => {
    const a = blockMarkerPath('/s', '/h/Projects/x'); const b = blockMarkerPath('/s', '/h/Projects/y')
    expect(a).toMatch(/^\/s\/blocked\/[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
  test('case and a trailing slash do not change it (the volume ignores case)', () => {
    expect(blockMarkerPath('/s', '/h/Projects/X/')).toBe(blockMarkerPath('/s', '/h/projects/x'))
  })
})

describe('displayPath and blockedHint: the marker as Yu would type it', () => {
  test('a path in the home folder is shown with ~, any other as it is', () => {
    expect(displayPath('/Users/yu/.local/state/summon/blocked/ab', '/Users/yu')).toBe('~/.local/state/summon/blocked/ab')
    expect(displayPath('/elsewhere/x', '/Users/yu')).toBe('/elsewhere/x')
    expect(displayPath('/Users/yuri/x', '/Users/yu')).toBe('/Users/yuri/x')
  })
  test('the hint says to check the git files and then to remove the marker', () => {
    expect(blockedHint('/Users/yu/.local/state/summon/blocked/ab', '/Users/yu')).toBe("check the folder's git files, then remove ~/.local/state/summon/blocked/ab")
  })
})

describe('blockFolder: the runner writes the marker, never the job', () => {
  test('writes a 0600 file in a 0700 directory, holding the folder, the job, the time and a fixed word, and nothing a job wrote', () => {
    const state = stateOf(); const folder = '/h/Projects/x'
    expect(blockFolder(state, folder, INFO)).toBe(true)
    const marker = blockMarkerPath(state, folder)
    expect(statSync(marker).mode & 0o777).toBe(0o600)
    expect(statSync(join(state, 'blocked')).mode & 0o777).toBe(0o700)
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({ v: 1, folder, job: INFO.job, at: INFO.at, why: 'tampered' })
    expect(readdirSync(join(state, 'blocked'))).toEqual([marker.split('/').pop()!]) // no temp file left
  })
  test('a folder that is already blocked keeps its first marker', () => {
    const state = stateOf()
    expect(blockFolder(state, '/h/x', INFO)).toBe(true)
    expect(blockFolder(state, '/h/x', { ...INFO, job: 'smn_' + 'b'.repeat(32), why: 'recovery error' })).toBe(true)
    expect(JSON.parse(readFileSync(blockMarkerPath(state, '/h/x'), 'utf8'))).toMatchObject({ job: INFO.job, why: 'tampered' })
  })
  test('false, not a throw, when the marker cannot be written (the state directory is a file)', () => {
    const state = stateOf(); mkdirSync(join(state, '..'), { recursive: true }); writeFileSync(state, 'not a directory')
    expect(blockFolder(state, '/h/x', INFO)).toBe(false)
  })
})
