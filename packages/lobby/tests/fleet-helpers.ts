/** A hub desk and fleet device desks around one FakeHosted service, each with
 * its own temporary AGENTTOOL_LOBBY_HOME, a scripted terminal, a shared test
 * clock and (for the hub) an owner-only file-backed Keychain stand-in. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import { runCli } from "../src/cli.js";
import { DIRECTORY_GATE_ROOM, ParticipantClient, prepareObservation } from "../src/hosted.js";
import { FileSecretStore } from "../src/keychain.js";
import { DeskSecrets } from "../src/secrets.js";
import { LobbyStore } from "../src/store.js";
import { confirmOnTty, showOnTty } from "../src/tty.js";
import { FAKE_BEARER, FAKE_PROJECT, FakeHosted, type Clock } from "./fake-hosted.js";
import { fakeTerminal, tempHome, type FakeTerminal } from "./helpers.js";

export const DEVICE_TERMS = ["example-lab-desk"];
export const T0 = "2026-10-16T12:00:00.000Z";

export interface Desk {
  name: string;
  home: string;
  parent: string;
  answers: Array<string | null>;
  terminal: FakeTerminal;
  keychain: FileSecretStore;
  run: (...argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Run a consequential command, answering yes on the terminal. */
  yes: (...argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  file: (name: string, text: string) => string;
}

export interface World {
  clock: Clock;
  hosted: FakeHosted;
  /** A desk; `of` reuses another desk's home and Keychain (same device, another runner). */
  desk: (name: string, options?: { noTerminal?: boolean; noNetwork?: boolean; of?: Desk }) => Desk;
  advance: (ms: number) => void;
}

export function world(): World {
  const clock: Clock = { now: new Date(T0) };
  const hosted = new FakeHosted(clock);
  return {
    clock,
    hosted,
    advance: (ms) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    desk: (name, options = {}) => {
      const { parent, home } = options.of ?? tempHome();
      const keychain = options.of?.keychain ?? new FileSecretStore(join(parent, "keychain"));
      const answers: Array<string | null> = [];
      const terminal = fakeTerminal(answers);
      const openTty = options.noTerminal ? () => null : terminal.open;
      const run = async (...argv: string[]) => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runCli(argv, {
          stdout: (text) => out.push(text),
          stderr: (text) => err.push(text),
          env: { AGENTTOOL_LOBBY_HOME: home },
          confirm: (request) => confirmOnTty(request, { openTty, now: () => clock.now.getTime() }),
          showOnTty: (text) => showOnTty(text, { openTty }),
          // A probe that does not count as opening the scripted terminal.
          hasTerminal: () => !options.noTerminal,
          now: () => new Date(clock.now),
          // A bounded wait's pause moves the shared test clock instead of sleeping.
          sleep: async (ms) => {
            clock.now = new Date(clock.now.getTime() + ms);
          },
          ...(options.noNetwork ? {} : { fetchImpl: hosted.fetch }),
          keychain,
          deviceTerms: DEVICE_TERMS,
        });
        return { code, stdout: out.join(""), stderr: err.join("") };
      };
      const desk: Desk = {
        name,
        home,
        parent,
        answers,
        terminal,
        keychain,
        run,
        yes: async (...argv) => {
          answers.push("yes");
          return run(...argv);
        },
        file: (fileName, text) => {
          const path = join(parent, fileName);
          writeFileSync(path, text, { mode: 0o600 });
          return path;
        },
      };
      return desk;
    },
  };
}

export async function ok(result: Promise<{ code: number; stdout: string; stderr: string }>): Promise<{ stdout: string; stderr: string }> {
  const value = await result;
  if (value.code !== 0) throw new Error(`expected exit 0, got ${value.code}: ${value.stderr}`);
  return value;
}

/** The exact bytes most recently confirmed on a desk's terminal. */
export function shownBytes(desk: Desk): string {
  const lines = desk.terminal.written.join("").split("\n");
  let header = -1;
  lines.forEach((line, index) => {
    if (line.startsWith("exact bytes (")) header = index;
  });
  return lines[header + 1]!;
}

export interface Fleet {
  world: World;
  hub: Desk;
  device: Desk;
  doorFingerprint: string;
  directoryId: string;
  roomId: string;
  seasonId: string;
  seasonDigest: string;
}

/** The device code enroll-device showed on the device's stderr, as a person
 * reads it off that screen to type at the hub. */
export function deviceCodeShown(stderr: string): string {
  const match = /device code ([0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3})\n/.exec(stderr);
  if (match === null) throw new Error(`enroll-device showed no device code: ${stderr}`);
  return match[1]!;
}

/** hub relay of a packet enroll-device just printed on `device`, typing the
 * device code it showed there. */
export function relayArgs(device: Desk, enrolled: { stdout: string; stderr: string }, name = `packet-${crypto.randomUUID()}.json`): string[] {
  return ["hub", "relay", "--packet-file", device.file(name, enrolled.stdout), "--device-fingerprint", deviceCodeShown(enrolled.stderr)];
}

/** Enroll one desk through the hub: enroll-device → hub relay → fleet join. */
export async function enrollThroughHub(hub: Desk, device: Desk, doorFingerprint: string | null = null): Promise<{ packet: any; join: any }> {
  const enrolled = await ok(device.run("enroll-device", "--project", FAKE_PROJECT));
  const packet = JSON.parse(enrolled.stdout);
  const relayed = await ok(hub.yes(...relayArgs(device, enrolled)));
  const join = JSON.parse(relayed.stdout);
  await ok(device.yes("fleet", "join", "--packet-file", device.file(`join-${crypto.randomUUID()}.json`, relayed.stdout),
    "--door-fingerprint", doorFingerprint ?? join.door.fingerprint));
  return { packet, join };
}

/** Hub with the bearer in its Keychain, hub init, its own desk enrolled and
 * joined, one fleet room with an open season and a published card, and one
 * device desk enrolled, joined and synced. */
export async function bootstrapFleet(options: { roomArgs?: string[]; initArgs?: string[] } = {}): Promise<Fleet> {
  const w = world();
  const hub = w.desk("hub");
  await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, FAKE_BEARER);
  const init = await ok(hub.yes("hub", "init", "--project", FAKE_PROJECT, ...(options.initArgs ?? [])));
  const doorFingerprint = /door fingerprint ([0-9a-f]{16})/.exec(init.stdout)![1]!;
  const directoryId = /directory ([0-9a-f-]{36})/.exec(init.stdout)![1]!;
  await enrollHub(hub, doorFingerprint);
  const added = await ok(hub.run("room", "add", "--title", "Zerone season 1", "--purpose", "hello, reply and read_ack",
    "--tag", "zerone", "--door", "knock", "--slot", "reviewer:player:1", "--slot", "watcher:spectator:2", "--json", ...(options.roomArgs ?? [])));
  const roomId = JSON.parse(added.stdout).card.room_id as string;
  await ok(hub.yes("room", "promote", roomId, "--residency", "fleet", "--hostable", "true"));
  const season = await ok(hub.yes("hub", "season", "open", roomId));
  const [, seasonId, seasonDigest] = /season ([0-9a-f-]{36}) digest (sha256:[0-9a-f]{64})/.exec(season.stdout)!;
  await ok(hub.yes("room", "publish", roomId));
  const device = w.desk("device");
  await enrollThroughHub(hub, device, doorFingerprint);
  await ok(device.run("fleet", "sync"));
  return { world: w, hub, device, doorFingerprint, directoryId, roomId, seasonId: seasonId!, seasonDigest: seasonDigest! };
}

/** bootstrapFleet, then the device knocks, the hub admits and the device gets
 * ready: the device holds an accepted season grant at the given tier. */
export async function seatedFleet(options: { tier?: "player" | "spectator"; termDays?: number } = {}): Promise<Fleet & { knockId: string }> {
  const fleet = await bootstrapFleet();
  const tier = options.tier ?? "player";
  const knocked = await ok(fleet.device.yes("knock", fleet.roomId, "--tier", tier));
  const knockId = /knock ([0-9a-f-]{36})/.exec(knocked.stdout)![1]!;
  await ok(fleet.hub.yes("hub", "admit", knockId, ...(options.termDays === undefined ? [] : ["--term-days", String(options.termDays)])));
  await ok(fleet.device.yes("ready", knockId));
  return { ...fleet, knockId };
}

/** A desk's own identity row, read through a short-lived writable handle. */
export function deskOf(desk: Desk): { identity_id: string; signing_key_id: string; public_key: string; fingerprint: string } {
  const store = LobbyStore.open(desk.home);
  try {
    const row = store.fleet.desk()!;
    return { identity_id: row.identity_id, signing_key_id: row.signing_key_id, public_key: row.public_key, fingerprint: row.fingerprint };
  } finally {
    store.close();
  }
}

/** Run a command and parse its JSON stdout (exit 0 required). */
export async function json(result: Promise<{ code: number; stdout: string; stderr: string }>): Promise<any> {
  return JSON.parse((await ok(result)).stdout);
}

async function enrollHub(hub: Desk, doorFingerprint: string): Promise<void> {
  const enrolled = await ok(hub.run("enroll-device", "--project", FAKE_PROJECT));
  const relayed = await ok(hub.yes(...relayArgs(hub, enrolled, "hub-packet.json")));
  await ok(hub.yes("fleet", "join", "--packet-file", hub.file("hub-join.json", relayed.stdout), "--door-fingerprint", doorFingerprint));
}

/** Run a consequential command on `desk` whose /dev/tty prompt, while open,
 * lets `during` run first (another terminal on the same device), then
 * answers yes on its own scripted terminal. */
export async function runWhilePromptOpen(w: World, desk: Desk, argv: string[], during: () => Promise<void>)
  : Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const terminal = fakeTerminal(["yes"]);
  const code = await runCli(argv, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: { AGENTTOOL_LOBBY_HOME: desk.home },
    confirm: async (request) => {
      await during();
      return confirmOnTty(request, { openTty: terminal.open, now: () => w.clock.now.getTime() });
    },
    showOnTty: (text) => showOnTty(text, { openTty: terminal.open }),
    hasTerminal: () => true,
    now: () => new Date(w.clock.now),
    sleep: async (ms) => {
      w.clock.now = new Date(w.clock.now.getTime() + ms);
    },
    fetchImpl: w.hosted.fetch,
    keychain: desk.keychain,
    deviceTerms: DEVICE_TERMS,
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** Post an observation summary (for example a hand-signed document) with a
 * desk's own live seat in a mission, as that desk: a valid exact-request
 * proof under its own identity and key. */
export async function postAs(w: World, desk: Desk, missionId: string, summary: string): Promise<void> {
  const store = LobbyStore.open(desk.home);
  let seat;
  try {
    const row = store.fleet.desk()!;
    const grant = store.fleet.currentDeskGrant(missionId, w.clock.now)!;
    seat = { mission_id: missionId, grant_id: grant.grant_id, identity_id: row.identity_id, signing_key_id: row.signing_key_id, token_sha256: grant.token_sha256 };
  } finally {
    store.close();
  }
  const client = new ParticipantClient(DeskSecrets.open(desk.home), { fetchImpl: w.hosted.fetch, now: () => w.clock.now, deviceTerms: DEVICE_TERMS });
  await client.observe(seat, prepareObservation(summary, DIRECTORY_GATE_ROOM, DEVICE_TERMS).raw_body, DIRECTORY_GATE_ROOM);
}

export function expectNoSecretIn(text: string): void {
  expect(text).not.toMatch(/atcm_[A-Za-z0-9_-]{8,}/);
  expect(text).not.toContain(FAKE_BEARER);
  expect(text).not.toMatch(/-----BEGIN/);
}
