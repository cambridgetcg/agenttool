// What a Collab child that died before initialize means (spec §9.6 item 4). The bin prints only `✖ <message>` and exits 1,
// so the error code is lost (K64); the hub matches that one line exactly against strings pinned from the installed build
// (collab.md §7.1). A hermetic test greps each one out of the tracked dist, so a Collab change that rewords a message
// shows up there, and the hub's dist check (§10.4) catches an installed build that drifted. Anything else is
// child_start_failed. No class is ever respawned automatically, so a broken journal is never re-verified in a loop.
export type StartClass = 'seat_recovery_required' | 'journal_invalid' | 'seat_session_ended' | 'child_start_failed'

export const PINNED_START_MESSAGES: ReadonlyArray<{ message: string; class: StartClass }> = Object.freeze([
  // store.resumeSession: the persisted or host cursor needs an audited reset (cursor_reset_required).
  { message: 'The host and persisted session cursors require an explicit audited reset', class: 'seat_recovery_required' },
  // store open: validateAllJournals (database_journal_invalid).
  { message: 'A workspace event journal failed hash-chain verification', class: 'journal_invalid' },
  // store.resumeSession: unknown session, wrong token or a session that is no longer active (session_auth_failed).
  { message: 'Session credentials are invalid', class: 'seat_session_ended' },
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
