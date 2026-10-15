// What a Collab child that died before initialize means (spec §9.6 item 4). The bin prints only `✖ <message>` and exits 1,
// so the error code is lost (K64); the hub matches that one line exactly against strings pinned from the installed build
// (collab.md §7.1). A hermetic test greps each one out of the tracked dist, so a Collab change that rewords a message
// shows up there, and the hub's dist check (§10.4) catches an installed build that drifted. Anything else is
// child_start_failed. No class is ever respawned automatically, so a broken journal is never re-verified in a loop.
export type StartClass = 'seat_recovery_required' | 'journal_invalid' | 'seat_session_ended' | 'child_start_failed'

/** Collab's own verdict on the session (store.resumeSession), as opposed to a fault of the credential file. */
const CREDENTIALS_INVALID = 'Session credentials are invalid'

export const PINNED_START_MESSAGES: ReadonlyArray<{ message: string; class: StartClass }> = Object.freeze([
  // store.resumeSession: the persisted or host cursor needs an audited reset (cursor_reset_required).
  { message: 'The host and persisted session cursors require an explicit audited reset', class: 'seat_recovery_required' },
  // store open: validateAllJournals (database_journal_invalid).
  { message: 'A workspace event journal failed hash-chain verification', class: 'journal_invalid' },
  // store.resumeSession: unknown session, wrong token or a session that is no longer active (session_auth_failed).
  { message: CREDENTIALS_INVALID, class: 'seat_session_ended' },
  // session-file.ts, read before resuming and rewritten after it.
  { message: 'Session credential path must be a private regular file owned by this user', class: 'seat_session_ended' },
  { message: 'Session credential file must not be accessible by group or other users', class: 'seat_session_ended' },
  { message: 'Session credential file has an unsupported or malformed format', class: 'seat_session_ended' },
  { message: 'Could not read the local session credential file', class: 'seat_session_ended' },
  { message: 'Session credential directory must be a private non-symlink directory owned by this user', class: 'seat_session_ended' },
  { message: 'Replacement requires a private regular credential file owned by this user', class: 'seat_session_ended' },
  { message: 'Could not atomically write the local session credential file', class: 'seat_session_ended' },
])

const BY_LINE: ReadonlyMap<string, StartClass> = new Map(PINNED_START_MESSAGES.map((m) => [`✖ ${m.message}`, m.class]))

/** The whole line must be `✖ ` and a pinned message, byte for byte: a line that merely contains one is not a match. */
export function classifyStart(lastErrLine: string | null): StartClass {
  if (lastErrLine === null) return 'child_start_failed'
  return BY_LINE.get(lastErrLine) ?? 'child_start_failed'
}

/**
 * Whether a child that died with this line left a session that may still be active in the journal: a seat_session_ended whose
 * line is a fault of the credential file (it could not be read, trusted or rewritten) and not Collab's verdict on the session
 * itself. The hub ends the lineage either way (§9.6 item 4), but a file fault says nothing about the session, which nothing in
 * the hub will end any more, so it is flagged for Ai as orphan_session (§9.2).
 */
export function sessionMayStillBeActive(lastErrLine: string | null): boolean {
  return classifyStart(lastErrLine) === 'seat_session_ended' && lastErrLine !== `✖ ${CREDENTIALS_INVALID}`
}

/**
 * The `operation` detail of Collab's own errors that collab_session_start can raise AFTER store.startSession has committed the
 * session row (K23): the file-mode tightening that follows the commit (store.ts tightenFileModes), then the credential
 * directory check and write (session-file.ts). Collab ends the session itself when the credential write fails, but that end
 * can fail too (a full disk fails both), and a tightening failure ends nothing. A hermetic test greps each one out of the
 * tracked dist, so a Collab change that renames one shows up there.
 */
export const POST_COMMIT_OPERATIONS: ReadonlySet<string> = new Set([
  'tighten_database_file_mode', 'validate_session_credential_directory', 'write_session_credential_file',
])

/**
 * Whether a collab_session_start isError result may have come after the session was committed, so "nothing was created" is
 * not known: an error carrying one of POST_COMMIT_OPERATIONS, or Collab's `internal_error` (a fault that is not one of its
 * own codes can be thrown from anywhere, the commit's aftermath included). An SDK input-validation result has no
 * structuredContent, and every other Collab code is raised by validation before the commit.
 */
export function startMayHaveCommitted(structured: unknown): boolean {
  if (typeof structured !== 'object' || structured === null || Array.isArray(structured)) return false
  const r = structured as Record<string, unknown>
  return r.error === 'internal_error' || (typeof r.operation === 'string' && POST_COMMIT_OPERATIONS.has(r.operation))
}
