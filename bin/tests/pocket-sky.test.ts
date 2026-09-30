/** Choices change a local board only; synthetic subprocesses never need a service or harness. */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COLUMNS, MAX_LIGHTS, ROWS, createPocketSky } from '../pocket-sky.mjs';

const CLI = resolve(import.meta.dir, '../agenttool-pocket-sky.mjs');
const NODE = Bun.which('node')!;
const EMPTY_ROW = '☆ ☆ ☆ ☆ ☆';
const EMPTY = Array.from({ length: 5 }, () => EMPTY_ROW);
const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });

function view(sky: ReturnType<typeof createPocketSky>) { return sky.act({ type: 'view' }); }
function toggle(sky: ReturnType<typeof createPocketSky>, row: number, column: number) { return sky.act({ type: 'toggle', row, column }); }

describe('Pocket Sky choices', () => {
  test('retains the existing browser bounds with an empty complete starting board', () => {
    const rules = JSON.parse(readFileSync(resolve(import.meta.dir, '../../apps/web/sky.json'), 'utf8'));
    expect([ROWS, COLUMNS, MAX_LIGHTS]).toEqual([rules.board.rows, rules.board.columns, rules.board.maximum_lights]);
    expect(rules.board.minimum_lights).toBe(0); expect(rules.board.starts_empty).toBe(true);
    const sky = createPocketSky();
    expect(view(sky)).toEqual({ outcome: 'view', mode: 'open', light_count: 0, board: EMPTY });
    expect(view(sky)).toEqual(view(sky));
  });

  test('a chosen cell changes and can be removed, with row and column meaning preserved', () => {
    const sky = createPocketSky();
    const added = toggle(sky, 2, 4);
    expect(added.board).toEqual([EMPTY_ROW, '☆ ☆ ☆ ★ ☆', EMPTY_ROW, EMPTY_ROW, EMPTY_ROW]);
    expect(added.light_count).toBe(1);
    expect(toggle(sky, 2, 4).board).toEqual(EMPTY);
  });

  test('an eighth light changes nothing; removal makes room without a reward or reset', () => {
    const sky = createPocketSky();
    for (let i = 0; i < 7; i++) toggle(sky, Math.floor(i / 5) + 1, i % 5 + 1);
    const before = view(sky);
    expect(toggle(sky, 5, 5)).toEqual({ ...before, outcome: 'light_limit' });
    expect(view(sky)).toEqual(before);
    expect(toggle(sky, 1, 1).light_count).toBe(6);
    expect(toggle(sky, 5, 5).light_count).toBe(7);
  });

  test('rest freezes toggles; explicit reopen retains the pattern', () => {
    const sky = createPocketSky(); toggle(sky, 3, 3);
    const frozen = sky.act({ type: 'rest' });
    expect(frozen.mode).toBe('resting');
    expect(toggle(sky, 3, 3)).toEqual({ ...frozen, outcome: 'resting' });
    expect(toggle(sky, 1, 1)).toEqual({ ...frozen, outcome: 'resting' });
    expect(sky.act({ type: 'rest' }).outcome).toBe('unchanged');
    expect(sky.act({ type: 'reopen' }).board).toEqual(frozen.board);
    expect(toggle(sky, 3, 3).board).toEqual(EMPTY);
  });

  test('clear actually removes all lights and does not reopen a resting board', () => {
    const sky = createPocketSky(); toggle(sky, 1, 1); toggle(sky, 5, 5); sky.act({ type: 'rest' });
    expect(sky.act({ type: 'clear' })).toEqual({ outcome: 'cleared', mode: 'resting', light_count: 0, board: EMPTY });
    expect(sky.act({ type: 'clear' }).outcome).toBe('unchanged');
  });

  test('leave drops the board and refuses further actions; a separate instance is independent', () => {
    const sky = createPocketSky(), another = createPocketSky(); toggle(sky, 1, 1);
    expect(view(another).board).toEqual(EMPTY);
    expect(sky.act({ type: 'leave' })).toEqual({ outcome: 'left', mode: 'left', light_count: 0, board: EMPTY });
    expect(() => toggle(sky, 1, 1)).toThrow('sky_closed');
    expect(view(sky).board).toEqual(EMPTY);
    expect(toggle(another, 1, 1).light_count).toBe(1);
  });

  test('invalid actions cannot change the existing pattern', () => {
    const sky = createPocketSky(); toggle(sky, 4, 2); const before = view(sky);
    for (const action of [null, [], {}, { type: 'unknown' }, { type: 'clear', unexpected: true },
      ...[0, 6, -1, 1.5, NaN, Infinity, '1'].flatMap(value => [
        { type: 'toggle', row: value, column: 1 }, { type: 'toggle', row: 1, column: value },
      ])]) {
      expect(() => sky.act(action)).toThrow(); expect(view(sky)).toEqual(before);
    }
  });

  test('returned snapshots cannot mutate the round', () => {
    const sky = createPocketSky(); const first = toggle(sky, 5, 5);
    first.board[4] = EMPTY_ROW; first.light_count = 0; first.mode = 'resting';
    expect(view(sky)).toEqual({ outcome: 'view', mode: 'open', light_count: 1,
      board: [EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, EMPTY_ROW, '☆ ☆ ☆ ☆ ★'] });
  });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pocket sky fixture-'))); cleanup.push(root);
  const guard = join(root, 'deny-effects.cjs');
  writeFileSync(guard, `const deny = () => { process.stderr.write('FORBIDDEN_PLAY_EFFECT\\n'); throw new Error('forbidden'); };
globalThis.fetch = deny;
for (const module of ['node:http','node:https']) for (const name of ['request','get']) require(module)[name] = deny;
for (const name of ['connect','createConnection']) require('node:net')[name] = deny;
for (const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) require('node:child_process')[name] = deny;
const fs = require('node:fs');
for (const name of ['writeFile','appendFile','mkdir','mkdtemp','rename','unlink','rm','rmdir','copyFile','symlink','link','chmod','chown','utimes','truncate']) {
  fs[name] = deny; fs[name + 'Sync'] = deny; if (name in fs.promises) fs.promises[name] = deny;
}
const open = fs.openSync;
fs.openSync = (path, flags, ...args) => {
  if (typeof flags === 'string' ? flags !== 'r' : Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT))) deny();
  return open(path, flags, ...args);
};
require('node:module').syncBuiltinESMExports();
`, { mode: 0o600 });
  const before = readdirSync(root).sort();
  function run(input: string | Buffer, args: string[] = []) {
    const result = spawnSync(NODE, ['--require', guard, CLI, ...args], {
      cwd: root, env: { PATH: '/no-tools', HOME: root, TMPDIR: root }, input,
      encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).not.toContain('FORBIDDEN_PLAY_EFFECT');
    expect(readdirSync(root).sort()).toEqual(before);
    return result;
  }
  return { run };
}
function snapshots(stdout: string) { return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

describe('offline text CLI', () => {
  test('help, empty EOF and blank input perform no play or external effects', () => {
    const f = fixture();
    for (const args of [['--help'], ['-h'], ['help']]) {
      const result = f.run('', args); expect(result.status).toBe(0); expect(result.stderr).toBe('');
      expect(result.stdout).toContain('toggle ROW COLUMN');
    }
    for (const input of ['', '\n \t\r\n']) {
      const result = f.run(input); expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('');
    }
  });

  test('explicit commands operate on the same in-process board and leave ends it', () => {
    const { run } = fixture();
    const result = run('toggle 2 4\nrest\ntoggle 2 4\nview\nreopen\ntoggle 2 4\nleave\ntoggle 1 1\n');
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    const states = snapshots(result.stdout); expect(states).toHaveLength(7);
    expect(states.map(state => state.light_count)).toEqual([1, 1, 1, 1, 1, 0, 0]);
    expect(states.map(state => state.mode)).toEqual(['open', 'resting', 'resting', 'resting', 'open', 'open', 'left']);
    expect(states[0].board[1]).toBe('☆ ☆ ☆ ★ ☆');
  });

  test('EOF accepts the final chosen command and a new process cannot restore it', () => {
    const { run } = fixture();
    const first = run('toggle 5 5'); expect(first.status).toBe(0);
    expect(snapshots(first.stdout)[0].light_count).toBe(1);
    const returned = run('view\n'); expect(returned.status).toBe(0);
    expect(snapshots(returned.stdout)).toEqual([{ outcome: 'view', mode: 'open', light_count: 0, board: EMPTY }]);
  });

  test('invalid commands and flags return a bounded error without echoing input', () => {
    const { run } = fixture(); const marker = 'PRIVATE_TEST_INPUT';
    for (const input of [marker, 'toggle 0 1\n', 'toggle 1 6\n', 'toggle 01 1\n', 'clear extra\n', '\0view\n']) {
      const result = run(input); expect(result.status).toBe(0); expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Pocket Sky: invalid_command.\n'); expect(result.stderr).not.toContain(marker);
    }
    const flags = run('', ['--state', marker]); expect(flags.status).toBe(1); expect(flags.stdout).toBe('');
    expect(flags.stderr).toBe('Pocket Sky: invalid_arguments.\n');
  });

  test('a typo preserves the chosen pattern and accepts view and leave afterward', () => {
    const { run } = fixture();
    const result = run('toggle 2 4\nrest\nreopne\nview\nleave\n');
    expect(result.status).toBe(0); expect(result.stderr).toBe('Pocket Sky: invalid_command.\n');
    const states = snapshots(result.stdout); expect(states).toHaveLength(4);
    expect(states[2]).toEqual({ ...states[1], outcome: 'view' });
    expect(states[2].mode).toBe('resting'); expect(states[2].board[1]).toBe('☆ ☆ ☆ ★ ☆');
    expect(states[3]).toEqual({ outcome: 'left', mode: 'left', light_count: 0, board: EMPTY });
  });

  test('malformed UTF-8 terminates without interpreting a later command', () => {
    const { run } = fixture();
    const result = run(Buffer.concat([Buffer.from([0xc3, 0x28, 0x0a]), Buffer.from('view\n')]));
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toBe('Pocket Sky: invalid_encoding.\n');
  });

  test('oversized lines stop before a command is accepted and do not echo the contents', () => {
    const { run } = fixture(); const result = run('x'.repeat(257) + '\nview\n');
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toBe('Pocket Sky: input_too_long.\n');
  });
});
