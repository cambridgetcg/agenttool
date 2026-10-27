/** agenttool-lobby: the operator's desk CLI for the local hall.
 *
 * Ordinary acts (room add, set-status, link) write directly. Consequential
 * acts (promote, pin add, pin remove) show their exact bytes on /dev/tty,
 * proceed only on "yes" typed there, and are recorded in the audit log.
 * A ledger target is shown only on /dev/tty, never on stdout, so an agent that
 * runs this CLI through a shell tool does not receive it.
 * Contract: packages/lobby/README.md#cli.
 */
import { parseArgs } from "node:util";
import { LobbyError } from "./errors.js";
import { resolveLobbyHome } from "./home.js";
import { formatPinLine } from "./pins.js";
import {
  DOORS,
  RESIDENCIES,
  ROOM_STATUSES,
  SLOT_TIERS,
  VISIBILITIES,
  type Door,
  type PromotionChange,
  type Residency,
  type RoomCard,
  type RoomSlot,
  type RoomStatus,
  type SlotTier,
  type Visibility,
} from "./room.js";
import { LobbyStore, type ActPreview, type PinSelector, type RoomFilter } from "./store.js";
import type { ConfirmRequest } from "./tty.js";
import {
  enrollDeviceCommand,
  fleetCommand,
  FleetUsageError,
  hubCommand,
  knockCommand,
  outboxCommand,
  readyCommand,
  roomPublishCommand,
} from "./cli-fleet.js";
import { HUB_ACCESS_COMMANDS, hubAccessCommand, ROOM_TABLE_COMMANDS, roomTableCommand } from "./cli-table.js";
import type { FetchLike } from "./hosted.js";
import type { SecretStore } from "./keychain.js";
import type { FleetContext } from "./ops.js";

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_CONFIRMED = 3;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  /** confirmOnTty in production; injected only by tests. */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** showOnTty in production: writes to the controlling terminal only and
   * throws `tty_unavailable` without one. Injected only by tests. */
  showOnTty: (text: string) => void;
  now?: () => Date;
  /** Network for fleet acts. bin/agenttool-lobby.ts passes the runtime's
   * fetch; tests pass fakes. Without it every network act refuses. */
  fetchImpl?: FetchLike;
  /** Hub custody. bin/agenttool-lobby.ts passes the macOS login Keychain;
   * tests pass an owner-only file-backed store. Without it hub acts refuse. */
  keychain?: SecretStore;
  /** This machine's own names for the egress gate; defaults to the hostname. */
  deviceTerms?: readonly string[];
  /** terminalAvailable in production: true when a controlling terminal can
   * be opened (nothing is shown or read). Without it no fleet act that needs
   * confirmation plans, so nothing is read from the Keychain, signed or sent
   * by a headless caller. Injected only by tests. */
  hasTerminal?: () => boolean;
  /** Pause between polls of `room wait`; a timer unless a test injects one. */
  sleep?: (ms: number) => Promise<void>;
}

export const USAGE = `agenttool-lobby — lobby desk: the local hall, and the fleet hall on https://api.agenttool.dev

Local hall (this device only; no network)
  room add --title T [--purpose P] [--tag t]... [--status S] [--door D]
           [--slot label:tier:count]... [--house-rules R] [--json]
  room list [--tag t] [--status S] [--door D] [--tier T] [--json]
  room show <room_id> [--json]
  room set-status <room_id> <recruiting|in_play|resting|closed>
  room link <room_id> [<ws_ id | absolute path | none>]
           (without a target, shows the ledger entry on /dev/tty only)
  room promote <room_id> [--residency device|fleet|open]
               [--visibility private|unlisted|public] [--hostable true|false]
  pin add --did D --kid K --public-key BASE64 --petname P --how H
  pin list [--json]
  pin remove <fingerprint> | --did D --kid K
  audit list [--json]
  audit verify

Fleet hall, every device (one desk identity per device)
  enroll-device [--project UUID] [--display-name NAME]
           (prints one public packet, valid 5 minutes; renews the directory grant once joined)
  fleet join --packet-file FILE --door-fingerprint FP
  fleet sync
  fleet browse [--tag t] [--status S] [--door D] [--tier T] [--json]
  fleet card <room_id> [--json]
  fleet knocks [--json]
  fleet status [--json]
  knock <room_id> --tier player|spectator [--note TEXT] [--hours 1-72]
  ready <knock_id>
  outbox list [--json]
  outbox retry <event_id>

Inside a room (table talk, renewal, leave)
  room sync <room_id>
  room read <room_id> [--after N] [--limit 1-50] [--conversation C] [--cached] [--json]
  room wait <room_id> [--after N] [--seconds 1-45] [--limit 1-50] [--conversation C] [--json]
  room roster <room_id> [--cached] [--json] [--chat-config [--conversation C]]
  room say <room_id> (--text T | --text-file FILE) [--to UUID]
           [--in-reply-to EVENT [--kind message|read_ack]] [--conversation C]
  room renew request <room_id>
  room renew accept <room_id>
  room leave <room_id>

Fleet hall, hub only (bearer and door key in the login Keychain)
  hub init --project UUID [--days 1-30] [--adopt-directory UUID --directory-digest sha256:...]
           [--keychain-account A] [--bearer-service S] [--door-service S]
  hub show [--json]
  hub relay --packet-file FILE --device-fingerprint CODE
  hub season open <room_id> [--days 1-30]
  hub season adopt <room_id> --mission UUID --digest sha256:...
  hub seat directory|<room_id>
  room publish <room_id>
  hub knocks [--json]
  hub admit <knock_id> [--tier spectator] [--term-days 1-30]
  hub deny <knock_id> [--reason TEXT]
  hub renew-sweep [--room ROOM_ID [--hashes-file FILE]]
  hub members <room_id> [--json]
  hub member add <room_id> --identity UUID --tier T [--key-id UUID --public-key BASE64]
                 [--term-days N] [--grant-id UUID]...
  hub member pause|resume <room_id> <identity_id>
  hub roster post <room_id>
  hub kick <room_id> <identity_id> [--grant-id UUID]...
  hub block <room_id> <identity_id> [--grant-id UUID]...
  hub unblock <room_id> <identity_id>
  hub stop [--include-adopted]
           (emergency stop; prints the manual API-key rotation step, never rotates)
  hub digest [--days 1-31] [--out FILE]
           (weekly access digest: a local report; posts nothing)

New rooms are residency=device, visibility=private, hostable=false. Only
residency=fleet, hostable rooms reach the fleet hall; device rooms never leave.
Consequential acts (promote, pin add/remove, hub init/relay/season/seat, room
publish, hub admit/deny, fleet join, knock, ready, outbox retry, room say,
room renew, room leave, hub renew-sweep/member/roster post/kick/block/unblock/stop)
show the exact bytes on the controlling terminal (/dev/tty), need "yes" typed
there (never stdin), fail closed without a terminal, and are recorded in the
audit log.
State: $AGENTTOOL_LOBBY_HOME, else \${XDG_STATE_HOME:-~/.local/state}/agenttool/lobby
(directory 0700, files 0600; wider modes are refused).
Exit codes: 0 ok, 1 refused, 2 usage, 3 not confirmed.
`;

const GROUPS = ["room", "pin", "audit", "hub", "fleet", "enroll-device", "knock", "ready", "outbox"];

class UsageError extends Error {}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UsageError(`${flag} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseSlot(text: string): RoomSlot {
  const parts = text.split(":");
  if (parts.length < 3) throw new UsageError("--slot is label:tier:count, for example reviewer:player:1");
  const countText = parts.pop()!;
  const tier = oneOf(parts.pop(), SLOT_TIERS, "slot tier") as SlotTier;
  const label = parts.join(":");
  if (!/^\d{1,3}$/.test(countText)) throw new UsageError("slot count must be a whole number");
  return { label, tier, count: Number.parseInt(countText, 10) };
}

function parseBoolean(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new UsageError(`${flag} must be true or false`);
}

function single(positionals: string[], count: number, usage: string): string[] {
  if (positionals.length !== count) throw new UsageError(usage);
  return positionals;
}

function roomLine(card: RoomCard): string {
  const hosting = card.hostable ? " hostable" : "";
  return `${card.room_id}  ${card.status}  ${card.residency}/${card.visibility}${hosting}  ` +
    `door=${card.door}  ${JSON.stringify(card.title)}`;
}

function roomDetail(card: RoomCard, pinned: boolean, linkedKind: string | null): string {
  const slots = card.slots.length === 0
    ? "(none)"
    : card.slots.map((slot) => `${JSON.stringify(slot.label)} ${slot.tier} x${slot.count}`).join(", ");
  return [
    `room_id:      ${card.room_id}`,
    `title:        ${JSON.stringify(card.title)}`,
    `purpose:      ${JSON.stringify(card.purpose)}`,
    `tags:         ${card.tags.length === 0 ? "(none)" : card.tags.join(", ")}`,
    `status:       ${card.status}`,
    `door:         ${card.door}`,
    `residency:    ${card.residency}${pinned ? " (pinned to this device; can never be promoted)" : ""}`,
    `visibility:   ${card.visibility}`,
    `hostable:     ${card.hostable}`,
    `slots:        ${slots} (labels are descriptive only)`,
    `house_rules:  ${JSON.stringify(card.house_rules)}`,
    `created_at:   ${card.created_at}`,
    `updated_at:   ${card.updated_at}`,
    `ledger:       ${linkedKind === null ? "not linked" : `linked (${linkedKind}); see room link`}`,
  ].join("\n");
}

async function consequential<T>(
  io: CliIo,
  plan: ActPreview,
  apply: () => T,
): Promise<{ confirmed: true; value: T } | { confirmed: false; code: number }> {
  let confirmed: boolean;
  try {
    confirmed = await io.confirm(plan);
  } catch (error) {
    if (error instanceof LobbyError && (error.code === "tty_unavailable" || error.code === "unsafe_preview")) {
      io.stderr(`agenttool-lobby: ${error.code}: ${error.message}\n`);
      return { confirmed: false, code: EXIT_NOT_CONFIRMED };
    }
    throw error;
  }
  if (!confirmed) {
    io.stderr("agenttool-lobby: not confirmed; nothing was written\n");
    return { confirmed: false, code: EXIT_NOT_CONFIRMED };
  }
  return { confirmed: true, value: apply() };
}

async function roomCommand(store: LobbyStore, args: string[], io: CliIo, now: () => Date): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "add": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          title: { type: "string" },
          purpose: { type: "string" },
          tag: { type: "string", multiple: true },
          status: { type: "string" },
          door: { type: "string" },
          slot: { type: "string", multiple: true },
          "house-rules": { type: "string" },
          json: { type: "boolean" },
        },
      });
      single(positionals, 0, "room add takes no positional arguments");
      if (values.title === undefined) throw new UsageError("room add needs --title");
      const status = oneOf(values.status, ROOM_STATUSES, "--status") as RoomStatus | undefined;
      const door = oneOf(values.door, DOORS, "--door") as Door | undefined;
      const card = store.addRoom({
        title: values.title,
        ...(values.purpose === undefined ? {} : { purpose: values.purpose }),
        ...(values.tag === undefined ? {} : { tags: values.tag }),
        ...(status === undefined ? {} : { status }),
        ...(door === undefined ? {} : { door }),
        ...(values.slot === undefined ? {} : { slots: values.slot.map(parseSlot) }),
        ...(values["house-rules"] === undefined ? {} : { house_rules: values["house-rules"] }),
      }, now());
      const pinned = store.isDevicePinned(card.room_id);
      if (values.json) io.stdout(`${JSON.stringify({ card, device_pinned: pinned }, null, 2)}\n`);
      else {
        io.stdout(`${roomLine(card)}\n`);
        if (pinned) io.stdout("pinned to this device: it names device-only work and can never be promoted\n");
      }
      return EXIT_OK;
    }
    case "list": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          tag: { type: "string" },
          status: { type: "string" },
          door: { type: "string" },
          tier: { type: "string" },
          json: { type: "boolean" },
        },
      });
      single(positionals, 0, "room list takes no positional arguments");
      const status = oneOf(values.status, ROOM_STATUSES, "--status");
      const door = oneOf(values.door, DOORS, "--door");
      const tier = oneOf(values.tier, SLOT_TIERS, "--tier");
      const filter: RoomFilter = {
        ...(values.tag === undefined ? {} : { tag: values.tag }),
        ...(status === undefined ? {} : { status }),
        ...(door === undefined ? {} : { door }),
        ...(tier === undefined ? {} : { tier }),
      };
      const rooms = store.listRooms(filter);
      if (values.json) io.stdout(`${JSON.stringify({ rooms }, null, 2)}\n`);
      else io.stdout(rooms.length === 0 ? "(no rooms)\n" : `${rooms.map(roomLine).join("\n")}\n`);
      return EXIT_OK;
    }
    case "show": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: { json: { type: "boolean" } },
      });
      const [roomId] = single(positionals, 1, "room show <room_id>");
      const card = store.getRoom(roomId!);
      if (card === null) throw new LobbyError("room_not_found", "no such room in the local hall");
      const pinned = store.isDevicePinned(card.room_id);
      const link = store.getLink(card.room_id);
      if (values.json) {
        io.stdout(`${JSON.stringify({ card, device_pinned: pinned, ledger: link === null ? "not linked" : "linked" }, null, 2)}\n`);
      } else {
        io.stdout(`${roomDetail(card, pinned, link?.target_kind ?? null)}\n`);
      }
      return EXIT_OK;
    }
    case "set-status": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} });
      const [roomId, statusText] = single(positionals, 2, "room set-status <room_id> <status>");
      const status = oneOf(statusText, ROOM_STATUSES, "status") as RoomStatus;
      const card = store.setStatus(roomId!, status, now());
      io.stdout(`${roomLine(card)}\n`);
      return EXIT_OK;
    }
    case "link": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} });
      if (positionals.length !== 1 && positionals.length !== 2) {
        throw new UsageError("room link <room_id> [<ws_ id | absolute path | none>]");
      }
      const [roomId, target] = positionals;
      if (target === undefined) {
        const link = store.getLink(roomId!);
        if (link === null) {
          io.stdout("not linked\n");
          return EXIT_OK;
        }
        // The target goes to the controlling terminal only; stdout gets its kind.
        io.showOnTty(`${link.target_kind}  ${link.target}  linked ${link.linked_at}  (private ledger; this device only)\n`);
        io.stdout(`linked (${link.target_kind}); the entry was shown on the controlling terminal only\n`);
        return EXIT_OK;
      }
      const entry = store.link(roomId!, target, now());
      io.stdout(`linked ${entry.room_id} to a ${entry.target_kind} in the private ledger (this device only)\n`);
      return EXIT_OK;
    }
    case "promote": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          residency: { type: "string" },
          visibility: { type: "string" },
          hostable: { type: "string" },
        },
      });
      const [roomId] = single(positionals, 1, "room promote <room_id> [--residency R] [--visibility V] [--hostable B]");
      const residency = oneOf(values.residency, RESIDENCIES, "--residency") as Residency | undefined;
      const visibility = oneOf(values.visibility, VISIBILITIES, "--visibility") as Visibility | undefined;
      const hostable = parseBoolean(values.hostable, "--hostable");
      const change: PromotionChange = {
        ...(residency === undefined ? {} : { residency }),
        ...(visibility === undefined ? {} : { visibility }),
        ...(hostable === undefined ? {} : { hostable }),
      };
      const plan = store.planPromotion(roomId!, change, now());
      const outcome = await consequential(io, plan, () => store.applyPromotion(plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`${roomLine(outcome.value)}\naudit: recorded room.promote sha256 ${plan.sha256}\n`);
      return EXIT_OK;
    }
    default:
      throw new UsageError(`unknown room command: ${sub ?? "(none)"}`);
  }
}

async function pinCommand(store: LobbyStore, args: string[], io: CliIo, now: () => Date): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "add": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          did: { type: "string" },
          kid: { type: "string" },
          "public-key": { type: "string" },
          petname: { type: "string" },
          how: { type: "string" },
        },
      });
      single(positionals, 0, "pin add takes no positional arguments");
      const { did, kid, petname, how } = values;
      const publicKey = values["public-key"];
      if (!did || !kid || !publicKey || !petname || !how) {
        throw new UsageError("pin add needs --did, --kid, --public-key, --petname and --how");
      }
      const plan = store.planPinAdd({ did, kid, public_key: publicKey, petname, how_obtained: how }, now());
      const outcome = await consequential(io, plan, () => store.applyPinAdd(plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`${formatPinLine(outcome.value)}\naudit: recorded pin.add sha256 ${plan.sha256}\n`);
      return EXIT_OK;
    }
    case "list": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: { json: { type: "boolean" } },
      });
      single(positionals, 0, "pin list takes no positional arguments");
      const pins = store.listPins();
      if (values.json) io.stdout(`${JSON.stringify({ pins }, null, 2)}\n`);
      else io.stdout(pins.length === 0 ? "(no pins)\n" : `${pins.map(formatPinLine).join("\n")}\n`);
      return EXIT_OK;
    }
    case "remove": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: { did: { type: "string" }, kid: { type: "string" } },
      });
      let selector: PinSelector;
      if (positionals.length === 1 && values.did === undefined && values.kid === undefined) {
        selector = { fingerprint: positionals[0]! };
      } else if (positionals.length === 0 && values.did !== undefined && values.kid !== undefined) {
        selector = { did: values.did, kid: values.kid };
      } else {
        throw new UsageError("pin remove <fingerprint> | --did D --kid K");
      }
      const plan = store.planPinRemove(selector, now());
      const outcome = await consequential(io, plan, () => store.applyPinRemove(plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`removed pin ${plan.pin.fingerprint}\naudit: recorded pin.remove sha256 ${plan.sha256}\n`);
      return EXIT_OK;
    }
    default:
      throw new UsageError(`unknown pin command: ${sub ?? "(none)"}`);
  }
}

function auditCommand(store: LobbyStore, args: string[], io: CliIo): number {
  const [sub, ...rest] = args;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" } },
  });
  single(positionals, 0, "audit list|verify");
  if (sub === "list") {
    const entries = store.listAudit();
    if (values.json) io.stdout(`${JSON.stringify({ entries }, null, 2)}\n`);
    else {
      io.stdout(entries.length === 0
        ? "(no consequential acts recorded)\n"
        : `${entries.map((entry) => `${entry.seq}  ${entry.at}  ${entry.act}  ${entry.subject}  sha256 ${entry.bytes_sha256}`).join("\n")}\n`);
    }
    return EXIT_OK;
  }
  if (sub === "verify") {
    const result = store.verifyAudit();
    io.stdout(result.ok
      ? `audit chain intact (${result.entries} entries)\n`
      : `audit chain broken at seq ${result.first_bad_seq}\n`);
    return result.ok ? EXIT_OK : EXIT_REFUSED;
  }
  throw new UsageError(`unknown audit command: ${sub ?? "(none)"}`);
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [group, ...rest] = argv;
  if (group === undefined || group === "help" || group === "--help" || group === "-h") {
    io.stdout(USAGE);
    return group === undefined ? EXIT_USAGE : EXIT_OK;
  }
  const now = io.now ?? (() => new Date());
  let store: LobbyStore | null = null;
  try {
    if (!GROUPS.includes(group)) throw new UsageError(`unknown command: ${group}`);
    const home = resolveLobbyHome(io.env);
    store = LobbyStore.open(home);
    const ctx: FleetContext = {
      store,
      home,
      now,
      hosted: io.fetchImpl === undefined ? null : {
        fetchImpl: io.fetchImpl,
        now,
        ...(io.deviceTerms === undefined ? {} : { deviceTerms: io.deviceTerms }),
      },
      keychain: io.keychain ?? null,
      hasTerminal: io.hasTerminal ?? (() => false),
      sleep: io.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    };
    const fleetIo = { stdout: io.stdout, stderr: io.stderr, confirm: io.confirm };
    if (group === "room" && rest[0] === "publish") return await roomPublishCommand(ctx, rest.slice(1), fleetIo);
    if (group === "room" && (ROOM_TABLE_COMMANDS as readonly string[]).includes(rest[0] ?? "")) return await roomTableCommand(ctx, rest, fleetIo);
    if (group === "hub" && (HUB_ACCESS_COMMANDS as readonly string[]).includes(rest[0] ?? "")) return await hubAccessCommand(ctx, rest, fleetIo);
    if (group === "room") return await roomCommand(store, rest, io, now);
    if (group === "pin") return await pinCommand(store, rest, io, now);
    if (group === "audit") return auditCommand(store, rest, io);
    if (group === "enroll-device") return enrollDeviceCommand(ctx, rest, fleetIo);
    if (group === "fleet") return await fleetCommand(ctx, rest, fleetIo);
    if (group === "knock") return await knockCommand(ctx, rest, fleetIo);
    if (group === "ready") return await readyCommand(ctx, rest, fleetIo);
    if (group === "outbox") return await outboxCommand(ctx, rest, fleetIo);
    return await hubCommand(ctx, rest, fleetIo);
  } catch (error) {
    if (error instanceof UsageError || error instanceof FleetUsageError
      || (error as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      io.stderr(`agenttool-lobby: ${(error as Error).message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof LobbyError) {
      io.stderr(`agenttool-lobby: ${error.code}: ${error.message}\n`);
      return EXIT_REFUSED;
    }
    const detail = error instanceof Error ? error.message : String(error);
    io.stderr(`agenttool-lobby: internal_error: ${detail}\n`);
    return EXIT_REFUSED;
  } finally {
    store?.close();
  }
}
