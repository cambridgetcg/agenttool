/** What the doorbell relies on in the lobby, pinned as patterns and key names
 * (never line numbers), so additive lobby changes pass and a changed shape
 * fails loudly. Run against the repository's packages/lobby/src by
 * `bun run contract`, or against an installed lobby with
 * `bun run contract -- --lobby-src <dir>`.
 */
import { LOBBY_ORIGIN } from "../src/health.js";
import { DATABASE_FILE } from "../src/home.js";

export interface ContractCheck {
  file: string;
  why: string;
  /** Every pattern must match the file's text. */
  patterns: RegExp[];
}

const literal = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

export const CONTRACT: readonly ContractCheck[] = [
  {
    file: "wire.ts",
    why: "the pinned origin equals the doorbell's constant",
    patterns: [literal(`export const LOBBY_ORIGIN = "${LOBBY_ORIGIN}" as const;`)],
  },
  {
    file: "home.ts",
    why: "the lobby home resolves as src/home.ts resolves it",
    patterns: [
      literal('export const LOBBY_HOME_ENV = "AGENTTOOL_LOBBY_HOME";'),
      literal("const stateHome = env.XDG_STATE_HOME;"),
      literal("stateHome && isAbsolute(stateHome) ? stateHome : join(homedir(), \".local\", \"state\")"),
      literal('return join(base, "agenttool", "lobby");'),
      literal('throw new LobbyError("lobby_home_not_absolute"'),
    ],
  },
  {
    file: "home.ts",
    why: "preparePrivateHome creates the database file only when it is missing, so netcheck starts the CLI only when that file exists",
    patterns: [
      literal(`export const DATABASE_FILE = "${DATABASE_FILE}";`),
      /const database = join\(home, DATABASE_FILE\);\s*if \(!existsSync\(database\)\) \{/,
    ],
  },
  {
    file: "store.ts",
    why: "every CLI command opens the store through preparePrivateHome, so netcheck must not start it on a home without a database",
    patterns: [/static open\(home: string\): LobbyStore \{\s*const path = preparePrivateHome\(home\);/],
  },
  {
    file: "cli.ts",
    why: "refusals are `agenttool-lobby: <code>: <message>` with exit 1, usage errors exit 2",
    patterns: [
      literal("io.stderr(`agenttool-lobby: ${error.code}: ${error.message}\\n`);"),
      literal("export const EXIT_REFUSED = 1;"),
      literal("export const EXIT_USAGE = 2;"),
    ],
  },
  {
    file: "hosted.ts",
    why: "a refused hosted read carries `HTTP <status> <code>` (the fetcher keeps only the status)",
    patterns: [literal("`the service refused the request: HTTP ${response.status} ${code}`")],
  },
  {
    file: "cli-fleet.ts",
    why: "fleet status --json keys",
    patterns: [
      literal('positionals(extra, 0, "fleet status [--json]");'),
      literal("grant_id: grant.grant_id, mission_id: grant.mission_id,"),
      literal("purpose: grant.purpose, room_id: grant.room_id,"),
      literal("expires_at: grant.expires_at, accepted_at: grant.accepted_at,"),
      literal("const status = desk === null ? { desk: null } : {"),
      literal("origin: desk.origin,"),
      literal("directory_mission_id: desk.directory_mission_id,"),
      /\n\s+grants,\n\s+\};/,
    ],
  },
  {
    file: "cli-fleet.ts",
    why: "fleet card --json prints wrapFleetCard; hub show --json carries directory.expires_at",
    patterns: [
      literal('positionals(extra, 1, "fleet card <room_id> [--json]");'),
      literal("const wrapped = wrapFleetCard(card);"),
      literal('throw new LobbyError("card_not_found"'),
      literal("directory: { mission_id: hub.directory_mission_id, mission_digest: hub.directory_digest, expires_at: hub.directory_expires_at,"),
    ],
  },
  {
    file: "hub.ts",
    why: "a member desk refuses hub show with hub_not_initialised",
    patterns: [literal('throw new LobbyError("hub_not_initialised"')],
  },
  {
    file: "view.ts",
    why: "card fields carry status and season as { value } entries",
    patterns: [
      /const FLEET_CARD_FIELDS = \[[^\]]*"status"[^\]]*"season"[^\]]*\]/,
      literal("fields[key] = { value: structuredClone(document.envelope.body[key]),"),
    ],
  },
  {
    file: "signed.ts",
    why: "a season reference has mission_id and expires_at",
    patterns: [/export interface SeasonRef \{[^}]*\bmission_id: string;[^}]*\bexpires_at: string;[^}]*\}/],
  },
  {
    file: "room.ts",
    why: "room statuses are the closed set netcheck accepts",
    patterns: [literal('export const ROOM_STATUSES = ["recruiting", "in_play", "resting", "closed"] as const;')],
  },
  {
    file: "table.ts",
    why: "table read fields, and the BigInt cursor compare behind the --after trick",
    patterns: [
      literal("to_me: boolean;"),
      literal("from_me: boolean;"),
      literal("next_cursor: string;"),
      literal("has_more: boolean;"),
      literal("synced_at: context.synced_at,"),
      literal("room_id: context.room_id,"),
      literal("messages: read.messages,"),
      literal("const after = BigInt(assertCursor(input.after));"),
      literal("BigInt(event.received_seq) > after"),
    ],
  },
  {
    file: "cli-table.ts",
    why: "room read flags and cursorFlag's 19-digit grammar",
    patterns: [
      literal("if (!/^(0|[1-9][0-9]{0,18})$/.test(value))"),
      literal("cached: { type: \"boolean\" }, json: { type: \"boolean\" }"),
      literal("sync: values.cached !== true,"),
      literal("options: { after: { type: \"string\" }, limit: { type: \"string\" },"),
    ],
  },
  {
    file: "table.ts",
    why: "the fetcher reads pages of at most 50 items: cursors, from_me/to_me and the unverified list, and pages on has_more",
    patterns: [
      literal("export const READ_LIMIT_MAX = 50;"),
      literal("unverified: read.unverified,"),
      literal("next_cursor: read.next_cursor,"),
      literal("has_more: read.has_more,"),
      /export interface TableMessage \{[^}]*\bcursor: string;[^}]*\bto_me: boolean;/,
      /export interface TableUnverified \{[^}]*\bcursor: string;/,
    ],
  },
  {
    file: "talk.ts",
    why: "a non-cached read syncs first, and a desk with no live grant is refused with no_seat before any request",
    patterns: [
      literal("if (input.sync) await roomSync(ctx, input.room_id);"),
      /const seat = liveSeat\(ctx, scope\.mission_id, "mission\.read"\);\s*if \(seat === null\) \{[\s\S]{0,300}throw new LobbyError\("no_seat"/,
    ],
  },
  {
    file: "ops.ts",
    why: "the fetcher's refusal table: not_seated, sync_page_limit",
    patterns: [literal('throw new LobbyError("not_seated"'), literal('throw new LobbyError("sync_page_limit"')],
  },
  {
    file: "hosted.ts",
    why: "the fetcher's refusal table: an uncertain transport and an invalid response",
    patterns: [literal('new LobbyError("hosted_uncertain"'), literal('throw new LobbyError("hosted_invalid_response"')],
  },
  {
    file: "talk.ts",
    why: "a cached read reports synced_at and needs no live grant",
    patterns: [literal("return { scope, conversation, read, synced_at: ctx.store.fleet.lastSynced(scope.mission_id) };")],
  },
];

export interface ContractFailure {
  file: string;
  why: string;
  pattern: string;
}

/** Runs every check; `read` returns a file's text or null when it is missing. */
export function checkLobbyContract(read: (file: string) => string | null): ContractFailure[] {
  const failures: ContractFailure[] = [];
  for (const check of CONTRACT) {
    const text = read(check.file);
    for (const pattern of check.patterns) {
      if (text === null || !pattern.test(text)) failures.push({ file: check.file, why: check.why, pattern: String(pattern) });
    }
  }
  return failures;
}
