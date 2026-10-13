// Every bun:ffi binding of the bridge lives here (P13), against the one libSystem both Macs have. Each exists because
// Bun has no equivalent: node:fs has no flock (F11); Bun's os.userInfo() reads $USER and $HOME instead of the passwd
// database (F3); fs.fsyncSync is a plain fsync that leaves data in the drive's cache (F12); and performance.now() and
// Bun.nanoseconds() count from process start with unknown behaviour across sleep, while CLOCK_MONOTONIC is system-wide
// and counts sleep (F13, Review Focus 4). The library opens on first use, so importing this module costs nothing.
import { CString, dlopen, FFIType, read, type Pointer } from 'bun:ffi'
import { randomBytes } from 'node:crypto'
import { closeSync, fchmodSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const LIBSYSTEM = '/usr/lib/libSystem.B.dylib'
const LOCK_EX = 0x02 // sys/fcntl.h
const LOCK_NB = 0x04
const LOCK_UN = 0x08
const EWOULDBLOCK = 35 // sys/errno.h: EWOULDBLOCK = EAGAIN = 35
const F_FULLFSYNC = 51 // sys/fcntl.h: fsync and ask the drive to flush to the media
const CLOCK_MONOTONIC = 6 // time.h: counts while the Mac sleeps (CLOCK_UPTIME_RAW, 8, does not)
// struct passwd on arm64 macOS (pwd.h): pw_name @0, pw_passwd @8, pw_uid (u32) @16, pw_gid @20, pw_change @24,
// pw_class @32, pw_gecos @40, pw_dir @48, pw_shell @56.
const PW_NAME = 0
const PW_UID = 16
const PW_DIR = 48

function openLibSystem() {
  return dlopen(LIBSYSTEM, {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    // fcntl is variadic; binding it with two fixed arguments is safe only for commands that ignore the third, such as
    // F_FULLFSYNC (on Apple arm64 variadic arguments go on the stack).
    fcntl: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    getuid: { args: [], returns: FFIType.u32 },
    getpwuid: { args: [FFIType.u32], returns: FFIType.ptr },
    clock_gettime_nsec_np: { args: [FFIType.u32], returns: FFIType.u64 },
    __error: { args: [], returns: FFIType.ptr },
  })
}
let lib: ReturnType<typeof openLibSystem> | null = null
const libc = () => (lib ??= openLibSystem()).symbols

/** errno, read right after the failing call (nothing runs in between on this thread). */
function errno(): number {
  const p = libc().__error()
  return p === null ? -1 : read.i32(p, 0)
}
function failed(call: string, e: number): Error {
  return Object.assign(new Error(`${call} failed: errno ${e}`), { errno: e })
}

/** Takes an exclusive, non-blocking flock on `fd`: 'busy' when another open file holds it; any other failure throws. */
export function tryFlock(fd: number): 'locked' | 'busy' {
  if (libc().flock(fd, LOCK_EX | LOCK_NB) === 0) return 'locked'
  const e = errno()
  if (e === EWOULDBLOCK) return 'busy'
  throw failed('flock', e)
}

export function unlockFlock(fd: number): void {
  if (libc().flock(fd, LOCK_UN) !== 0) throw failed('flock(LOCK_UN)', errno())
}

export function getuid(): number {
  return libc().getuid()
}

/** This process's passwd entry by its real uid: the user name and home that launchd's env (HOME, PATH, no USER) cannot fake. */
export function passwdOfSelf(): { uid: number; name: string; dir: string } {
  const uid = getuid()
  const p = libc().getpwuid(uid)
  if (p === null) throw new Error(`getpwuid(${uid}) found no passwd entry`)
  const str = (offset: number): string => {
    const s = read.ptr(p, offset)
    if (s === 0) throw new Error(`getpwuid(${uid}) returned a null field at offset ${offset}`)
    return new CString(s as Pointer).toString()
  }
  return { uid: read.u32(p, PW_UID), name: str(PW_NAME), dir: str(PW_DIR) }
}

/** fsync that also asks the drive to flush its cache, so a record survives power loss. */
export function fullFsync(fd: number): void {
  if (libc().fcntl(fd, F_FULLFSYNC) === -1) throw failed('fcntl(F_FULLFSYNC)', errno())
}

/** CLOCK_MONOTONIC in ms: system-wide (the same in every process) and counting sleep, for every in-memory age. */
export function monoNowMs(): number {
  return Number(libc().clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1e6
}

/**
 * Replaces `path` whole or not at all: a fresh temp file in the same dir (O_EXCL, `mode`, default 0600, set whatever the
 * umask), every byte written, F_FULLFSYNC, rename over `path`, then an fsync of the dir so the rename itself lasts.
 * A failure before the rename removes the temp file and leaves `path` as it was.
 */
export function writeFileDurable(path: string, data: string | Uint8Array, mode: number = 0o600): void {
  const dir = dirname(path)
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  const fd = openSync(tmp, 'wx', mode)
  let closing = false
  try {
    fchmodSync(fd, mode)
    for (let off = 0; off < bytes.length;) off += writeSync(fd, bytes, off, bytes.length - off)
    fullFsync(fd)
    closing = true // never close twice: the number may already belong to another open file
    closeSync(fd)
  } catch (e) {
    if (!closing) try { closeSync(fd) } catch { /* nothing more to do */ }
    try { unlinkSync(tmp) } catch { /* gone */ }
    throw e
  }
  try { renameSync(tmp, path) } catch (e) {
    try { unlinkSync(tmp) } catch { /* gone */ }
    throw e
  }
  const d = openSync(dir, 'r')
  try { fsyncSync(d) } finally { closeSync(d) }
}
