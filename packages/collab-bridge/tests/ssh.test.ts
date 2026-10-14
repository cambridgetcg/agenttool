import { describe, expect, test } from 'bun:test'
import { classifySshFailure, targetOfConfig, type SshContext } from '../src/air/ssh.ts'

// The dialer's own entry as pin-device writes it (spec §5.6), and the paths ssh names in its lines. Pure strings: the
// classifier reads no file.
const CFG = '/Users/yuai/.ssh/collab-bridge/config'
const KEY = '/Users/yuai/.ssh/collab-bridge/collab_nuance_ed25519'
const CTX: SshContext = { host: 'nuance.local', user: 'macair', identityFile: KEY, config: CFG }
const map = (stderr: string, ctx: Partial<SshContext> = {}) => classifySshFailure(stderr, { ...CTX, ...ctx })
/** Text as ssh itself prints it: every line ends \r\n (log.c, the client loop's quit_message). */
const crlf = (s: string) => s.replaceAll('\n', '\r\n') + '\r\n'
const FIXED = 'ssh exited 255 without a line it is known to print'
const FINGERPRINT = 'SHA256:C/JQOifBld6TAkrNhJn6UfvfParPv6E5xha7zm1I9/A'
/** OpenSSH 9.9p2's changed-key block (Summon's C-review capture, with this config's known_hosts path). */
const CHANGED_KEY = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
  'Someone could be eavesdropping on you right now (man-in-the-middle attack)!',
  'It is also possible that a host key has just been changed.',
  'The fingerprint for the ED25519 key sent by the remote host is',
  `${FINGERPRINT}.`,
  'Please contact your system administrator.',
  'Add correct host key in /Users/yuai/.ssh/collab-bridge/known_hosts to get rid of this message.',
  'Offending ED25519 key in /Users/yuai/.ssh/collab-bridge/known_hosts:1',
  'Host key for summon-nuance has changed and you have requested strict checking.',
  'Host key verification failed.',
].join('\r\n').replace('sent by the remote host is\r\n', 'sent by the remote host is\n') + '\r\n' // one message over two lines

describe('targetOfConfig', () => {
  test('reads HostName, User and IdentityFile of the alias only, first value wins', () => {
    const text = [
      'Host collab-other', '  HostName other.local', '  User someone',
      'Host collab-nuance', '  HostName nuance.local', '  AddressFamily inet', '  User macair', `  IdentityFile ${KEY}`,
      '  HostName second.local', 'Host collab-later', '  User later',
    ].join('\n')
    expect(targetOfConfig(text, 'collab-nuance')).toEqual({ host: 'nuance.local', user: 'macair', identityFile: KEY })
    expect(targetOfConfig(text, 'collab-missing')).toBeNull()
    expect(targetOfConfig('Host collab-nuance-2\n  HostName x\n', 'collab-nuance')).toBeNull()
  })
})

describe('classifySshFailure', () => {
  test('no route and could not resolve are unreachable no_route', () => {
    for (const s of [
      'ssh: connect to host nuance.local port 22: No route to host',
      'ssh: connect to host nuance.local port 22: Network is unreachable',
      'ssh: connect to host nuance.local port 22: Network is down',
      'ssh: Could not resolve hostname nuance.local: nodename nor servname provided, or not known',
    ]) expect([s, map(crlf(s))]).toEqual([s, { status: 'unreachable', reason: 'no_route', detail: s }])
  })

  test('a connect refused by this Mac (Operation not permitted) is unreachable no_route, the Local Network case', () => {
    const s = 'ssh: connect to host nuance.local port 22: Operation not permitted'
    expect(map(crlf(s))).toEqual({ status: 'unreachable', reason: 'no_route', detail: s })
  })

  test('timed out, host down, refused and the banner timeout are unreachable timeout', () => {
    for (const s of [
      'ssh: connect to host nuance.local port 22: Operation timed out',
      'ssh: connect to host nuance.local port 22: Host is down',
      'ssh: connect to host nuance.local port 22: Connection refused',
      'Connection timed out during banner exchange',
    ]) expect([s, map(crlf(s))]).toEqual([s, { status: 'unreachable', reason: 'timeout', detail: s }])
  })

  test('the kex reset pair is a timeout', () => {
    const pair = 'kex_exchange_identification: read: Connection reset by peer\r\nConnection reset by 192.168.50.65 port 22\r\n'
    expect(map(pair)).toEqual({ status: 'unreachable', reason: 'timeout', detail: 'kex_exchange_identification: read: Connection reset by peer' })
    // The second line alone is a peer drop, which may follow a session: unknown.
    expect(map('Connection reset by 192.168.50.65 port 22\r\n')).toEqual({ status: 'unknown', detail: 'Connection reset by 192.168.50.65 port 22' })
  })

  test('Permission denied (publickey) is auth_refused', () => {
    expect(map(crlf('macair@nuance.local: Permission denied (publickey).'))).toEqual({ status: 'auth_refused', detail: 'macair@nuance.local: Permission denied (publickey).' })
    // Another user at the same host is not this entry's line.
    expect(map(crlf('someone@nuance.local: Permission denied (publickey).'))).toEqual({ status: 'unknown', detail: FIXED })
  })

  test('a missing identity file is auth_refused', () => {
    const s = `no such identity: ${KEY}: No such file or directory\r\nmacair@nuance.local: Permission denied (publickey).\r\n`
    expect(map(s)).toEqual({ status: 'auth_refused', detail: `no such identity: ${KEY}: No such file or directory` })
  })

  test('the changed-key block is host_key_mismatch with the presented fingerprint', () => {
    expect(map(CHANGED_KEY)).toEqual({
      status: 'host_key_mismatch', detail: `Host key verification failed. Presented ED25519 key: ${FINGERPRINT}`, fingerprint: FINGERPRINT,
    })
    // An unknown host (no block) still fails verification, with no fingerprint to show.
    const unknownHost = 'No ED25519 host key is known for summon-nuance and you have requested strict checking.\r\nHost key verification failed.\r\n'
    expect(map(unknownHost)).toEqual({ status: 'host_key_mismatch', detail: 'Host key verification failed.', fingerprint: null })
  })

  test("Can't open user config file is config", () => {
    for (const errno of ['No such file or directory', 'Permission denied', 'Operation not permitted']) {
      const s = `Can't open user config file ${CFG}: ${errno}`
      expect([errno, map(crlf(s))]).toEqual([errno, { status: 'config', detail: s }])
    }
    // Only the config this dial was given: another file's line is not ours.
    expect(map(crlf("Can't open user config file /tmp/other: No such file or directory"))).toEqual({ status: 'unknown', detail: FIXED })
  })

  test('Bad configuration option is config', () => {
    const s = `${CFG}: line 4: Bad configuration option: bogusoption`
    expect(map(`${s}\r\n${CFG}: terminating, 1 bad configuration options\r\n`)).toEqual({ status: 'config', detail: s })
  })

  test('a lost connection anywhere wins and is unknown', () => {
    const loss = 'client_loop: send disconnect: Broken pipe'
    for (const pre of [
      'ssh: connect to host nuance.local port 22: Operation timed out',
      'macair@nuance.local: Permission denied (publickey).',
      `Can't open user config file ${CFG}: No such file or directory`,
      'Host key verification failed.',
    ]) {
      expect([pre, map(crlf(pre)).status]).not.toEqual([pre, 'unknown']) // alone it classifies
      expect([pre, map(`${crlf(pre)}${loss}\r\n`)]).toEqual([pre, { status: 'unknown', detail: loss }])
      // Remote text left without a newline joins the head of ssh's line: the loss is still found inside it, and still
      // wins over the line before it (a loss matched only at a line's start would let that line decide).
      expect([pre, map(`${crlf(pre)}remote junkConnection to nuance.local closed by remote host.\r\n`)]).toEqual([pre, { status: 'unknown', detail: FIXED }])
    }
    expect(map(crlf('Timeout, server nuance.local not responding.'))).toEqual({ status: 'unknown', detail: 'Timeout, server nuance.local not responding.' })
  })

  test('a remote stderr line ending in a bare \\n never decides', () => {
    for (const s of [
      'macair@nuance.local: Permission denied (publickey).',
      'ssh: connect to host nuance.local port 22: No route to host',
      `Can't open user config file ${CFG}: No such file or directory`,
      'Host key verification failed.',
    ]) expect([s, map(`${s}\n`)]).toEqual([s, { status: 'unknown', detail: FIXED }])
  })

  test('an unrecognised line is unknown with fixed text', () => {
    expect(map('ssh: something we have not seen\r\n')).toEqual({ status: 'unknown', detail: FIXED })
    expect(map('')).toEqual({ status: 'unknown', detail: FIXED })
    // A known whole ssh line is shown as itself.
    expect(map('Connection to 192.168.50.65 port 22 timed out\r\n')).toEqual({ status: 'unknown', detail: 'Connection to 192.168.50.65 port 22 timed out' })
  })

  test('a detail is one clipped line of printable ASCII', () => {
    const r = map(crlf(`${'u'.repeat(300)}@nuance.local: Permission denied (publickey).`), { user: 'u'.repeat(300) })
    expect(r.status).toBe('auth_refused')
    expect(r.detail.length).toBeLessThanOrEqual(200)
    expect(r.detail).not.toMatch(/[^\x20-\x7e]/)
  })
})
