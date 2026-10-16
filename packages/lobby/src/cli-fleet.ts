/** Fleet-hall commands of the agenttool-lobby CLI.
 *
 * Reads (sync, browse, card, knocks, status) need no confirmation.
 * Consequential acts (hub init, hub relay, hub season, hub seat, room
 * publish, hub admit, hub deny, fleet join, knock, ready, outbox retry) show
 * their exact bytes on /dev/tty, need "yes" typed there, record those bytes
 * in the audit log, and only then touch the network. enroll-device sends
 * nothing and is audited without a prompt. Secrets never reach stdout or
 * stderr. Contract: packages/lobby/README.md#fleet-hall.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import {
  enrollDevice,
  executeJoin,
  executeKnock,
  executeOutboxRetry,
  executeReady,
  fleetCards,
  fleetSync,
  knockStates,
  planJoin,
  planKnock,
  planOutboxRetry,
  planReady,
} from "./desk.js";
import { LobbyError } from "./errors.js";
import {
  executeAdmit,
  executeDeny,
  executeHubInit,
  executeHubSeat,
  executePublish,
  executeRelay,
  executeSeason,
  hubKnocks,
  planAdmit,
  planDeny,
  planHubInit,
  planHubSeat,
  planPublish,
  planRelay,
  planSeason,
  requireHub,
  type DecisionResult,
} from "./hub.js";
import { confirmAndRecord, NO_TERMINAL_MESSAGE, type Confirm, type FleetContext, type PostOutcome } from "./ops.js";
import { DOORS, ROOM_STATUSES, SLOT_TIERS, type SlotTier } from "./room.js";
import type { ActPreview } from "./store.js";
import { wrapFleetCard } from "./view.js";

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_CONFIRMED = 3;

export class FleetUsageError extends Error {}

export interface FleetIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  confirm: Confirm;
}

const MAX_PACKET_BYTES = 65_536;

/** Read a carried public packet: an absolute path to a regular file (not a
 * link) of at most 64 KiB. Packets hold no secret; they are still bounded. */
export function readPacketFile(path: string | undefined): string {
  if (path === undefined || !isAbsolute(path)) throw new FleetUsageError("give the packet as an absolute --packet-file path");
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new LobbyError("packet_unreadable", "the packet file is missing, unreadable or a link");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_PACKET_BYTES) throw new LobbyError("packet_unreadable", "the packet must be a regular file of at most 64 KiB");
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_PACKET_BYTES) throw new LobbyError("packet_unreadable", "the packet must be a regular file of at most 64 KiB");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    closeSync(fd);
  }
}

function positionals(values: string[], count: number, usage: string): string[] {
  if (values.length !== count) throw new FleetUsageError(usage);
  return values;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new FleetUsageError(`${flag} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function wholeNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{1,4}$/.test(value)) throw new FleetUsageError(`${flag} must be a whole number`);
  return Number.parseInt(value, 10);
}

/** Every consequential act checks for a person at the terminal before it
 * plans: a headless run reads no Keychain item, uses no bearer or token,
 * signs nothing and sends nothing. Returns the exit code when there is none. */
function withoutTerminal(ctx: FleetContext, io: FleetIo): number | null {
  if (ctx.hasTerminal()) return null;
  io.stderr(`agenttool-lobby: tty_unavailable: ${NO_TERMINAL_MESSAGE}\n`);
  return EXIT_NOT_CONFIRMED;
}

/** Show and confirm; on yes record the bytes, then run the act. */
async function consequentialAsync<T>(ctx: FleetContext, io: FleetIo, preview: ActPreview, run: () => Promise<T>)
  : Promise<{ confirmed: true; value: T } | { confirmed: false; code: number }> {
  let confirmed: boolean;
  try {
    confirmed = await confirmAndRecord(ctx, io.confirm, preview);
  } catch (error) {
    if (error instanceof LobbyError && (error.code === "tty_unavailable" || error.code === "unsafe_preview")) {
      io.stderr(`agenttool-lobby: ${error.code}: ${error.message}\n`);
      return { confirmed: false, code: EXIT_NOT_CONFIRMED };
    }
    throw error;
  }
  if (!confirmed) {
    io.stderr("agenttool-lobby: not confirmed; nothing was written or sent\n");
    return { confirmed: false, code: EXIT_NOT_CONFIRMED };
  }
  return { confirmed: true, value: await run() };
}

function reportPosts(io: FleetIo, posts: PostOutcome[]): number {
  let pending = 0;
  for (const post of posts) {
    if (post.status === "stored") {
      io.stdout(`posted ${post.kind} ${post.event_id} to mission ${post.mission_id} (receipt seq ${post.received_seq})\n`);
    } else {
      pending += 1;
      io.stderr(`agenttool-lobby: ${post.kind} ${post.event_id} is saved in the outbox but has no verified receipt (${post.error}). ` +
        `It may already be stored. Nothing was retried; inspect, then run: outbox retry ${post.event_id}\n`);
    }
  }
  return pending === 0 ? EXIT_OK : EXIT_REFUSED;
}

function reportDecision(io: FleetIo, result: DecisionResult): number {
  io.stdout(`${result.decision} knock ${result.knock_id}` +
    (result.grant_id === undefined ? "" : `; grant ${result.grant_id} until ${result.grant_expires_at}`) + "\n");
  return reportPosts(io, result.posts);
}

// ── enroll-device ──────────────────────────────────────────────────────

export function enrollDeviceCommand(ctx: FleetContext, args: string[], io: FleetIo): number {
  const { values, positionals: rest } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { project: { type: "string" }, "display-name": { type: "string" } },
  });
  positionals(rest, 0, "enroll-device [--project UUID] [--display-name NAME]");
  const { packet, created } = enrollDevice(ctx, {
    ...(values.project === undefined ? {} : { project_id: values.project }),
    ...(values["display-name"] === undefined ? {} : { display_name: values["display-name"] }),
  });
  io.stdout(`${JSON.stringify(packet, null, 2)}\n`);
  io.stderr([
    `agenttool-lobby: ${created ? "created this desk and " : ""}signed one public ${packet.kind} packet (above, on stdout).`,
    `  It holds no secret: desk ${packet.fingerprint}, identity ${packet.identity_id}, directory token sha256 ${packet.directory_token_sha256}.`,
    `  The token itself stays in this desk's private state and is never printed.`,
    `  VALID ${packet.kind === "enroll" ? "5" : "30"} MINUTES (until ${packet.valid_until}): carry it to the hub now for hub relay.`,
    "  If the window passes, run enroll-device again for a fresh packet.",
    "",
  ].join("\n"));
  return EXIT_OK;
}

// ── fleet ──────────────────────────────────────────────────────────────

export async function fleetCommand(ctx: FleetContext, args: string[], io: FleetIo): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "join": {
      const { values, positionals: extra } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: { "packet-file": { type: "string" }, "door-fingerprint": { type: "string" } },
      });
      positionals(extra, 0, "fleet join --packet-file FILE --door-fingerprint FP");
      if (values["door-fingerprint"] === undefined) {
        throw new FleetUsageError("fleet join needs --door-fingerprint: type the fingerprint the hub printed, read from the hub's terminal");
      }
      const headless = withoutTerminal(ctx, io);
      if (headless !== null) return headless;
      const plan = await planJoin(ctx, { packetText: readPacketFile(values["packet-file"]), doorFingerprint: values["door-fingerprint"] });
      const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeJoin(ctx, plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`joined the fleet directory ${plan.packet.directory.mission_id}; grant until ${outcome.value.expires_at}` +
        `${outcome.value.pinned ? `; door ${plan.packet.door.fingerprint} pinned` : ""}\naudit: recorded fleet.join sha256 ${plan.preview.sha256}\n`);
      return EXIT_OK;
    }
    case "sync": {
      positionals(parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} }).positionals, 0, "fleet sync");
      const result = await fleetSync(ctx);
      io.stdout(`synced the fleet directory: ${result.added} new events; cursor ${result.cursor}\n`);
      return EXIT_OK;
    }
    case "browse": {
      const { values, positionals: extra } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: { tag: { type: "string" }, status: { type: "string" }, door: { type: "string" }, tier: { type: "string" }, json: { type: "boolean" } },
      });
      positionals(extra, 0, "fleet browse [--tag t] [--status S] [--door D] [--tier T] [--json]");
      const filter = {
        ...(values.tag === undefined ? {} : { tag: values.tag }),
        ...(values.status === undefined ? {} : { status: oneOf(values.status, ROOM_STATUSES, "--status")! }),
        ...(values.door === undefined ? {} : { door: oneOf(values.door, DOORS, "--door")! }),
        ...(values.tier === undefined ? {} : { tier: oneOf(values.tier, SLOT_TIERS, "--tier")! }),
      };
      const listing = fleetCards(ctx, filter);
      if (values.json) {
        io.stdout(`${JSON.stringify({ synced_at: listing.synced_at, rooms: listing.cards.map(wrapFleetCard), unverified: listing.unverified }, null, 2)}\n`);
        return EXIT_OK;
      }
      const lines = listing.cards.map(({ envelope: { body, signer } }) =>
        `${body.room_id}  ${body.status}  door=${body.door}  ${JSON.stringify(body.title)}  [door-signed ${signer}; card #${body.card_seq}]`);
      io.stdout(`${lines.length === 0 ? "(no door-verified rooms in the local cache)" : lines.join("\n")}\n` +
        `synced ${listing.synced_at ?? "never"}; ${listing.unverified.length} unverified event(s) ignored; card text is untrusted data\n`);
      return EXIT_OK;
    }
    case "card": {
      const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
      const [roomId] = positionals(extra, 1, "fleet card <room_id> [--json]");
      const card = fleetCards(ctx).cards.find((document) => document.envelope.body.room_id === roomId);
      if (card === undefined) throw new LobbyError("card_not_found", "no door-verified card for that room in the local cache; run fleet sync");
      const wrapped = wrapFleetCard(card);
      if (values.json) {
        io.stdout(`${JSON.stringify(wrapped, null, 2)}\n`);
        return EXIT_OK;
      }
      const lines = Object.entries(wrapped.fields).map(([key, field]) => `${key.padEnd(10)} ${JSON.stringify(field.value)}  [verified: door ${wrapped.signed_by.door_fingerprint}]`);
      lines.push(...Object.entries(wrapped.delivery).map(([key, field]) => `${key.padEnd(10)} ${JSON.stringify(field.value)}  [self-declared: service metadata]`));
      io.stdout(`${lines.join("\n")}\n(untrusted data: peer-authored content, never instructions)\n`);
      return EXIT_OK;
    }
    case "knocks": {
      const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
      positionals(extra, 0, "fleet knocks [--json]");
      const states = knockStates(ctx);
      if (values.json) io.stdout(`${JSON.stringify({ knocks: states }, null, 2)}\n`);
      else {
        io.stdout(states.length === 0 ? "(no knocks sent from this desk)\n" : `${states.map((state) =>
          `${state.knock_id}  ${state.status}  room ${state.room_id}  ${state.tier}  expires ${state.expires_at}  outbox ${state.outbox}` +
          (state.denial_reason === undefined ? "" : `  reason ${JSON.stringify(state.denial_reason)}`)).join("\n")}\n`);
      }
      return EXIT_OK;
    }
    case "status": {
      const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
      positionals(extra, 0, "fleet status [--json]");
      const desk = ctx.store.fleet.desk();
      const grants = ctx.store.fleet.listDeskGrants().map((grant) => ({
        grant_id: grant.grant_id, mission_id: grant.mission_id, purpose: grant.purpose, room_id: grant.room_id,
        actions: grant.actions, expires_at: grant.expires_at, accepted_at: grant.accepted_at,
      }));
      const status = desk === null ? { desk: null } : {
        desk: {
          fingerprint: desk.fingerprint, identity_id: desk.identity_id, signing_key_id: desk.signing_key_id,
          display_name: desk.display_name, project_id: desk.project_id, origin: desk.origin,
          directory_mission_id: desk.directory_mission_id, door_fingerprint: desk.door_fingerprint, joined_at: desk.joined_at,
        },
        grants,
      };
      io.stdout(values.json ? `${JSON.stringify(status, null, 2)}\n` : desk === null ? "no desk identity on this device; run enroll-device\n"
        : `desk ${desk.fingerprint} ${JSON.stringify(desk.display_name)} did:at:${desk.identity_id}\n` +
          `directory ${desk.directory_mission_id ?? "(not joined)"}; door ${desk.door_fingerprint ?? "(not pinned)"}\n` +
          `${grants.map((grant) => `grant ${grant.grant_id} ${grant.purpose} ${grant.mission_id} until ${grant.expires_at ?? "?"} ${grant.accepted_at === null ? "(not accepted)" : "(accepted)"}`).join("\n")}\n`);
      return EXIT_OK;
    }
    default:
      throw new FleetUsageError(`unknown fleet command: ${sub ?? "(none)"}`);
  }
}

// ── knock, ready, outbox ───────────────────────────────────────────────

export async function knockCommand(ctx: FleetContext, args: string[], io: FleetIo): Promise<number> {
  const { values, positionals: extra } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { tier: { type: "string" }, note: { type: "string" }, hours: { type: "string" } },
  });
  const [roomId] = positionals(extra, 1, "knock <room_id> --tier player|spectator [--note TEXT] [--hours 1-72]");
  const tier = oneOf(values.tier, SLOT_TIERS, "--tier") as SlotTier | undefined;
  if (tier === undefined) throw new FleetUsageError("knock needs --tier player or --tier spectator");
  const hours = wholeNumber(values.hours, "--hours");
  const headless = withoutTerminal(ctx, io);
  if (headless !== null) return headless;
  const plan = planKnock(ctx, {
    room_id: roomId!,
    tier,
    ...(values.note === undefined ? {} : { note: values.note }),
    ...(hours === undefined ? {} : { hours }),
  });
  const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeKnock(ctx, plan));
  if (!outcome.confirmed) return outcome.code;
  io.stdout(`knock ${plan.body.knock_id} for room ${plan.body.room_id}; expires ${plan.body.expires_at}\naudit: recorded fleet.knock sha256 ${plan.preview.sha256}\n`);
  return reportPosts(io, [outcome.value]);
}

export async function readyCommand(ctx: FleetContext, args: string[], io: FleetIo): Promise<number> {
  const { positionals: extra } = parseArgs({ args, allowPositionals: true, strict: true, options: {} });
  const [knockId] = positionals(extra, 1, "ready <knock_id>");
  const headless = withoutTerminal(ctx, io);
  if (headless !== null) return headless;
  const plan = await planReady(ctx, { knock_id: knockId! });
  const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeReady(ctx, plan));
  if (!outcome.confirmed) return outcome.code;
  io.stdout(`ready: accepted season ${outcome.value.mission_id} digest ${plan.mission.mission_digest}; grant ${outcome.value.grant_id} until ${outcome.value.expires_at}\n` +
    `audit: recorded fleet.ready sha256 ${plan.preview.sha256}\n`);
  return EXIT_OK;
}

export async function outboxCommand(ctx: FleetContext, args: string[], io: FleetIo): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "list") {
    const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
    positionals(extra, 0, "outbox list [--json]");
    const rows = ctx.store.fleet.listOutbox().map((row) => ({
      event_id: row.event_id, mission_id: row.mission_id, kind: row.kind, state: row.state,
      received_seq: row.received_seq, created_at: row.created_at, stored_at: row.stored_at,
    }));
    if (values.json) io.stdout(`${JSON.stringify({ outbox: rows }, null, 2)}\n`);
    else io.stdout(rows.length === 0 ? "(outbox empty)\n" : `${rows.map((row) => `${row.event_id}  ${row.state}  ${row.kind}  mission ${row.mission_id}  ${row.created_at}`).join("\n")}\n`);
    return EXIT_OK;
  }
  if (sub === "retry") {
    const [eventId] = positionals(parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} }).positionals, 1, "outbox retry <event_id>");
    const headless = withoutTerminal(ctx, io);
    if (headless !== null) return headless;
    const plan = planOutboxRetry(ctx, { event_id: eventId! });
    const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeOutboxRetry(ctx, plan));
    if (!outcome.confirmed) return outcome.code;
    return reportPosts(io, [outcome.value]);
  }
  throw new FleetUsageError(`unknown outbox command: ${sub ?? "(none)"}`);
}

// ── hub ────────────────────────────────────────────────────────────────

export async function hubCommand(ctx: FleetContext, args: string[], io: FleetIo): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "init": {
      const { values, positionals: extra } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          project: { type: "string" },
          days: { type: "string" },
          "adopt-directory": { type: "string" },
          "directory-digest": { type: "string" },
          "keychain-account": { type: "string" },
          "bearer-service": { type: "string" },
          "door-service": { type: "string" },
        },
      });
      positionals(extra, 0, "hub init --project UUID [--days N] [--adopt-directory UUID --directory-digest sha256:...]");
      if ((values["adopt-directory"] === undefined) !== (values["directory-digest"] === undefined)) {
        throw new FleetUsageError("--adopt-directory and --directory-digest go together");
      }
      const days = wholeNumber(values.days, "--days");
      const headless = withoutTerminal(ctx, io);
      if (headless !== null) return headless;
      const plan = await planHubInit(ctx, {
        ...(values.project === undefined ? {} : { project_id: values.project }),
        ...(days === undefined ? {} : { days }),
        ...(values["adopt-directory"] === undefined ? {} : {
          adopt: { mission_id: values["adopt-directory"], mission_digest: values["directory-digest"]! },
        }),
        keychain: {
          ...(values["keychain-account"] === undefined ? {} : { account: values["keychain-account"] }),
          ...(values["bearer-service"] === undefined ? {} : { bearer_service: values["bearer-service"] }),
          ...(values["door-service"] === undefined ? {} : { door_service: values["door-service"] }),
        },
      });
      const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeHubInit(ctx, plan));
      if (!outcome.confirmed) return outcome.code;
      const hub = outcome.value;
      io.stdout([
        `hub ready: project ${hub.project_id}`,
        `directory ${hub.directory_mission_id} (${hub.directory_mode}) digest ${hub.directory_digest} until ${hub.directory_expires_at}`,
        `door fingerprint ${hub.door_fingerprint}`,
        `audit: recorded ${plan.preview.act} sha256 ${plan.preview.sha256}`,
        "next on this hub: enroll-device --project <project>, hub relay, fleet join (this hub's own desk)",
        "",
      ].join("\n"));
      return EXIT_OK;
    }
    case "show": {
      const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
      positionals(extra, 0, "hub show [--json]");
      const hub = requireHub(ctx);
      const view = {
        project_id: hub.project_id,
        origin: hub.origin,
        door_fingerprint: hub.door_fingerprint,
        keychain: { account: hub.keychain_account, bearer_service: hub.bearer_service, door_service: hub.door_service },
        directory: { mission_id: hub.directory_mission_id, mission_digest: hub.directory_digest, expires_at: hub.directory_expires_at, mode: hub.directory_mode },
        devices: ctx.store.fleet.listDevices().map((device) => ({
          fingerprint: device.fingerprint, identity_id: device.identity_id, display_name: device.display_name, enrolled_at: device.enrolled_at,
        })),
      };
      io.stdout(values.json ? `${JSON.stringify(view, null, 2)}\n`
        : `project ${view.project_id}\ndoor ${view.door_fingerprint}\ndirectory ${view.directory.mission_id} until ${view.directory.expires_at}\n` +
          `${view.devices.map((device) => `device ${device.fingerprint} did:at:${device.identity_id} ${JSON.stringify(device.display_name)}`).join("\n")}\n`);
      return EXIT_OK;
    }
    case "relay": {
      const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { "packet-file": { type: "string" } } });
      positionals(extra, 0, "hub relay --packet-file FILE");
      const headless = withoutTerminal(ctx, io);
      if (headless !== null) return headless;
      const plan = planRelay(ctx, { packetText: readPacketFile(values["packet-file"]) });
      const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeRelay(ctx, plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`${JSON.stringify(outcome.value.join, null, 2)}\n`);
      io.stderr([
        `agenttool-lobby: ${outcome.value.enrolled ? "enrolled the device and " : ""}issued its directory grant until ${outcome.value.grant_expires_at}.`,
        "  The join packet above (stdout) holds no secret. Carry it to the device together with this door fingerprint,",
        `  read from this terminal: ${outcome.value.join.door.fingerprint}`,
        `  On the device: fleet join --packet-file FILE --door-fingerprint ${outcome.value.join.door.fingerprint}`,
        `audit: recorded hub.relay sha256 ${plan.preview.sha256}`,
        "",
      ].join("\n"));
      return EXIT_OK;
    }
    case "season": {
      const [mode, ...more] = rest;
      if (mode === "open") {
        const { values, positionals: extra } = parseArgs({ args: more, allowPositionals: true, strict: true, options: { days: { type: "string" } } });
        const [roomId] = positionals(extra, 1, "hub season open <room_id> [--days N]");
        const days = wholeNumber(values.days, "--days");
        const headless = withoutTerminal(ctx, io);
        if (headless !== null) return headless;
        const plan = await planSeason(ctx, { room_id: roomId!, ...(days === undefined ? {} : { days }) });
        const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeSeason(ctx, plan));
        if (!outcome.confirmed) return outcome.code;
        io.stdout(`season ${outcome.value.mission_id} digest ${outcome.value.mission_digest}; hub seat until ${outcome.value.seat_expires_at}\n` +
          `audit: recorded ${plan.preview.act} sha256 ${plan.preview.sha256}\nnext: room publish ${roomId}\n`);
        return EXIT_OK;
      }
      if (mode === "adopt") {
        const { values, positionals: extra } = parseArgs({
          args: more, allowPositionals: true, strict: true, options: { mission: { type: "string" }, digest: { type: "string" } },
        });
        const [roomId] = positionals(extra, 1, "hub season adopt <room_id> --mission UUID --digest sha256:...");
        if (values.mission === undefined || values.digest === undefined) throw new FleetUsageError("hub season adopt needs --mission and --digest");
        const headless = withoutTerminal(ctx, io);
        if (headless !== null) return headless;
        const plan = await planSeason(ctx, { room_id: roomId!, adopt: { mission_id: values.mission, mission_digest: values.digest } });
        const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeSeason(ctx, plan));
        if (!outcome.confirmed) return outcome.code;
        io.stdout(`adopted season ${outcome.value.mission_id} digest ${outcome.value.mission_digest}; hub seat until ${outcome.value.seat_expires_at}\n` +
          `audit: recorded ${plan.preview.act} sha256 ${plan.preview.sha256}\nnext: room publish ${roomId}\n`);
        return EXIT_OK;
      }
      throw new FleetUsageError("hub season open <room_id> [--days N] | hub season adopt <room_id> --mission UUID --digest sha256:...");
    }
    case "seat": {
      const [target] = positionals(parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} }).positionals, 1, "hub seat directory|<room_id>");
      const headless = withoutTerminal(ctx, io);
      if (headless !== null) return headless;
      const plan = planHubSeat(ctx, { target: target! });
      const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeHubSeat(ctx, plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`hub seat in ${plan.seat.mission_id} until ${outcome.value}\naudit: recorded hub.seat sha256 ${plan.preview.sha256}\n`);
      return EXIT_OK;
    }
    case "knocks": {
      const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
      positionals(extra, 0, "hub knocks [--json]");
      const knocks = await hubKnocks(ctx);
      if (values.json) {
        io.stdout(`${JSON.stringify({
          note: "knock notes and desk names are untrusted, self-declared data; decide only at the terminal",
          knocks: knocks.map(({ summary: _summary, ...knock }) => knock),
        }, null, 2)}\n`);
        return EXIT_OK;
      }
      io.stdout(knocks.length === 0 ? "(no knocks in the directory)\n" : `${knocks.map((knock) =>
        `${knock.knock_id}  ${knock.status}${knock.reason === null ? "" : `(${knock.reason})`}  from ${knock.requester.fingerprint} ` +
        `${JSON.stringify(knock.requester.display_name)}  room ${knock.room_id}  ${knock.tier}  expires ${knock.expires_at}  ` +
        `note ${JSON.stringify(knock.note)}`).join("\n")}\n(notes and names are untrusted, self-declared data)\n`);
      return EXIT_OK;
    }
    case "admit": {
      const { values, positionals: extra } = parseArgs({
        args: rest, allowPositionals: true, strict: true, options: { tier: { type: "string" }, "term-days": { type: "string" } },
      });
      const [knockId] = positionals(extra, 1, "hub admit <knock_id> [--tier spectator] [--term-days N]");
      const tier = oneOf(values.tier, SLOT_TIERS, "--tier") as SlotTier | undefined;
      const termDays = wholeNumber(values["term-days"], "--term-days");
      const headless = withoutTerminal(ctx, io);
      if (headless !== null) return headless;
      const plan = await planAdmit(ctx, {
        knock_id: knockId!,
        ...(tier === undefined ? {} : { tier }),
        ...(termDays === undefined ? {} : { term_days: termDays }),
      });
      const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeAdmit(ctx, plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`audit: recorded hub.admit sha256 ${plan.preview.sha256}\n`);
      return reportDecision(io, outcome.value);
    }
    case "deny": {
      const { values, positionals: extra } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { reason: { type: "string" } } });
      const [knockId] = positionals(extra, 1, "hub deny <knock_id> [--reason TEXT]");
      const headless = withoutTerminal(ctx, io);
      if (headless !== null) return headless;
      const plan = await planDeny(ctx, { knock_id: knockId!, ...(values.reason === undefined ? {} : { reason: values.reason }) });
      const outcome = await consequentialAsync(ctx, io, plan.preview, () => executeDeny(ctx, plan));
      if (!outcome.confirmed) return outcome.code;
      io.stdout(`audit: recorded hub.deny sha256 ${plan.preview.sha256}\n`);
      return reportDecision(io, outcome.value);
    }
    default:
      throw new FleetUsageError(`unknown hub command: ${sub ?? "(none)"}`);
  }
}

export async function roomPublishCommand(ctx: FleetContext, args: string[], io: FleetIo): Promise<number> {
  const [roomId] = positionals(parseArgs({ args, allowPositionals: true, strict: true, options: {} }).positionals, 1, "room publish <room_id>");
  const headless = withoutTerminal(ctx, io);
  if (headless !== null) return headless;
  const plan = await planPublish(ctx, { room_id: roomId! });
  const outcome = await consequentialAsync(ctx, io, plan.preview, () => executePublish(ctx, plan));
  if (!outcome.confirmed) return outcome.code;
  io.stdout(`published card #${plan.card.card_seq} for ${plan.card.room_id}\naudit: recorded room.publish sha256 ${plan.preview.sha256}\n`);
  return reportPosts(io, [outcome.value]);
}
