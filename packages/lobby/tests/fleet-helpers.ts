/** A hub desk and fleet device desks around one FakeHosted service, each with
 * its own temporary AGENTTOOL_LOBBY_HOME, a scripted terminal, a shared test
 * clock and (for the hub) an owner-only file-backed Keychain stand-in. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import { runCli } from "../src/cli.js";
import { FileSecretStore } from "../src/keychain.js";
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
          now: () => new Date(clock.now),
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

/** Enroll one desk through the hub: enroll-device → hub relay → fleet join. */
export async function enrollThroughHub(hub: Desk, device: Desk, doorFingerprint: string | null = null): Promise<{ packet: any; join: any }> {
  const enrolled = await ok(device.run("enroll-device", "--project", FAKE_PROJECT));
  const packet = JSON.parse(enrolled.stdout);
  const relayed = await ok(hub.yes("hub", "relay", "--packet-file", device.file(`packet-${crypto.randomUUID()}.json`, enrolled.stdout)));
  const join = JSON.parse(relayed.stdout);
  await ok(device.yes("fleet", "join", "--packet-file", device.file(`join-${crypto.randomUUID()}.json`, relayed.stdout),
    "--door-fingerprint", doorFingerprint ?? join.door.fingerprint));
  return { packet, join };
}

/** Hub with the bearer in its Keychain, hub init, its own desk enrolled and
 * joined, one fleet room with an open season and a published card, and one
 * device desk enrolled, joined and synced. */
export async function bootstrapFleet(options: { roomArgs?: string[] } = {}): Promise<Fleet> {
  const w = world();
  const hub = w.desk("hub");
  await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, FAKE_BEARER);
  const init = await ok(hub.yes("hub", "init", "--project", FAKE_PROJECT));
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

async function enrollHub(hub: Desk, doorFingerprint: string): Promise<void> {
  const enrolled = await ok(hub.run("enroll-device", "--project", FAKE_PROJECT));
  const relayed = await ok(hub.yes("hub", "relay", "--packet-file", hub.file("hub-packet.json", enrolled.stdout)));
  await ok(hub.yes("fleet", "join", "--packet-file", hub.file("hub-join.json", relayed.stdout), "--door-fingerprint", doorFingerprint));
}

export function expectNoSecretIn(text: string): void {
  expect(text).not.toMatch(/atcm_[A-Za-z0-9_-]{8,}/);
  expect(text).not.toContain(FAKE_BEARER);
  expect(text).not.toMatch(/-----BEGIN/);
}
