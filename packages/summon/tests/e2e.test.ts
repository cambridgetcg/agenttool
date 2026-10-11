import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, type CliDeps } from '../src/cli.ts'
import { verifyLedger } from '../src/ledger.ts'
import { summonPaths } from '../src/paths.ts'
import { runOnce } from '../src/runner.ts'
import { sshCall } from '../src/ssh.ts'
import { cleanupTmps, makeFakeClaude, targetHome, trackTmp } from './helpers.ts'

afterEach(cleanupTmps)

const GATE = join(import.meta.dir, '..', 'src', 'gatekeeper-main.ts')

/**
 * One whole Phase 0 world on this Mac. The Air side is the real CLI; `ssh` is a script that turns the remote verb into
 * SSH_ORIGINAL_COMMAND, as sshd would, and runs the real gatekeeper entry point against a temp "Nuance" home.
 * The fake ssh also keeps the last stdin it was given, so a test can replay exactly what the CLI sent.
 */
function world() {
  const fake = makeFakeClaude()
  fake.setMode('ok')
  const nuance = targetHome()
  const air = trackTmp(mkdtempSync(join(tmpdir(), 'summon-air-')))
  const ssh = join(air, 'ssh')
  const sent = join(air, 'sent.json')
  // argv: -F <config> summon-nuance <verb...>
  writeFileSync(ssh, `#!/bin/bash
shift 2; shift
export SSH_ORIGINAL_COMMAND="$*"
export HOME='${nuance}' SUMMON_HOME_OVERRIDE='${nuance}' SUMMON_TEST_GUI=1 SUMMON_TEST_RUNNER=1 SUMMON_CLAUDE_BIN='${fake.bin}'
cat > '${sent}'
exec '${process.execPath}' '${GATE}' < '${sent}'
`)
  chmodSync(ssh, 0o755)
  writeFileSync(join(air, 'task.md'), 'Summarise the README.')
  const deps: CliDeps = { sshBin: ssh, sshConfig: join(air, 'config'), ledgerPath: join(air, 'ledger.jsonl'), device: 'air',
    nowMs: () => Date.now(), readFile: (p) => readFileSync(p, 'utf8'), readStdin: () => '' }
  const runner = () => runOnce({ paths: summonPaths(nuance), home: nuance, user: 'yu', nowMs: () => Date.now(),
    claudeBin: () => fake.bin, collectInventory: async () => ({ macos: 'e2e' }), heartbeatMs: 50, pollMs: 25, killGraceMs: 200,
    processStartTime: () => null })
  const start = (cwd = '~/Projects/x') => runCli(['nuance', 'claude', '--model', 'sonnet', '--cwd', cwd, '--review', '--prompt-file', join(air, 'task.md')], deps)
  return { fake, nuance, air, deps, sent, runner, start }
}

/** The parsed entries of a hash-chained ledger, oldest first. */
const entriesOf = (path: string): any[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

describe('Phase 0 end to end (spec §5.3)', () => {
  test('a job summon returns its result; both ledgers verify', async () => {
    const w = world()
    const r = w.start()
    expect(r.out.status).toBe('admitted')
    await w.runner()
    const res = runCli(['result', String(r.out.handle)], w.deps)
    expect(res.out).toMatchObject({ status: 'completed', result_text: 'echo: Summarise the README.' })
    // verifyLedger passes a missing file, so each ledger must also have the entries this run should have written.
    const air = w.deps.ledgerPath
    const nuance = summonPaths(w.nuance).ledger
    expect(verifyLedger(air)).toEqual({ ok: true, entries: 2 })
    expect(verifyLedger(nuance)).toEqual({ ok: true, entries: 3 })
    expect(entriesOf(air).map((e) => e.event)).toEqual(['sent', 'answer'])
    expect(entriesOf(nuance).map((e) => [e.event, e.status])).toEqual([['admitted', undefined], ['job_start', 'running'], ['job_end', 'completed']])
    // The prompt travelled on stdin only: not on claude's argv, not in either ledger.
    expect(readFileSync(w.fake.argvOut, 'utf8')).not.toContain('Summarise')
    expect(readFileSync(air, 'utf8')).not.toContain('Summarise')
    expect(readFileSync(nuance, 'utf8')).not.toContain('Summarise')
  })

  test('the same request sent twice: the second is refused(replayed)', () => {
    const w = world()
    const first = w.start()
    expect(first.out.status).toBe('admitted')
    // The exact bytes the CLI put on ssh's stdin, sent again through the same ssh layer.
    const again = sshCall(w.deps, 'nuance', 'start', readFileSync(w.sent, 'utf8'))
    expect(again).toMatchObject({ status: 'refused', reason: 'replayed' })
    const ledger = summonPaths(w.nuance).ledger
    expect(verifyLedger(ledger)).toEqual({ ok: true, entries: 2 })
    expect(entriesOf(ledger).map((e) => [e.event, e.reason])).toEqual([['admitted', undefined], ['refused', 'replayed']])
  })

  test('a non-allowlisted folder is refused with the line to add', () => {
    const w = world()
    // The folder exists on Nuance but is not allowlisted, so this is the allowlist's refusal and not the missing-folder one.
    mkdirSync(join(w.nuance, 'Elsewhere'))
    const r = w.start('~/Elsewhere')
    expect(r.out).toMatchObject({ status: 'refused', reason: 'outside_allowlist' })
    expect(String(r.out.hint)).toContain('folders:')
    expect(String(r.out.hint)).toContain('path: ~/Elsewhere')
  })

  test('a shell request is refused', () => {
    const w = world()
    const p = Bun.spawnSync([w.deps.sshBin, '-F', 'x', 'summon-nuance', 'ls', '-la'])
    expect(p.exitCode).toBe(2)
    expect(JSON.parse(p.stdout.toString())).toMatchObject({ status: 'refused', reason: 'malformed' })
  })
})
