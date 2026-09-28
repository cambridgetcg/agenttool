/** Public CLI boundaries only: private synthetic state, no service or native harness. */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as client from "../agenttool-mission.mjs";
import { bind, openReceiver, status } from "../mission-wake-receiver.mjs";
import { watch } from "../agenttool-mission-wake.mjs";

const CLI = resolve(import.meta.dir, "../agenttool-mission-wake.mjs");
const NODE = Bun.which("node")!;
const M = "11111111-1111-4111-8111-111111111111", G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333", K = "44444444-4444-4444-8444-444444444444";
const ROUTE = "55555555-5555-4555-8555-555555555555", THREAD = "66666666-6666-4666-8666-666666666666";
const ORIGIN = "https://wake-cli-fixture.invalid", TOKEN = `atcm_${Buffer.alloc(32, 29).toString("base64url")}`;
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const response = (value: unknown) => new Response(JSON.stringify(value));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wake CLI's fixture-")));
  chmodSync(root, 0o700); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state"), guard = join(root, "deny-effects.cjs");
  // Instrument the child only. A forbidden attempt is visible even if the CLI sanitizes its error.
  writeFileSync(guard, `const deny = () => { process.stderr.write('CLI_FORBIDDEN_EFFECT\\n'); throw new Error('forbidden fixture effect'); };
globalThis.fetch = deny;
for (const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) require('node:child_process')[name] = deny;
for (const name of ['connect','createConnection']) require('node:net')[name] = deny;
for (const module of ['node:http','node:https']) for (const name of ['request','get']) require(module)[name] = deny;
require('node:module').syncBuiltinESMExports();
`, { mode: 0o600 });
  return { root, state, guard };
}
function run(f: ReturnType<typeof fixture>, args: string[]) {
  return spawnSync(NODE, ["--require", f.guard, CLI, ...args], {
    cwd: f.root, env: { PATH: "/no-programs-in-fixture", HOME: f.root, TMPDIR: f.root },
    encoding: "utf8", timeout: 2500, maxBuffer: 64 * 1024,
  });
}
function participant() {
  const f = fixture(), enrollment = client.init(f.state, ORIGIN);
  const profile = { format: "agenttool-mission-invitation/v1", origin: ORIGIN, mission_id: M, grant_id: G,
    identity_id: I, signing_key_id: K, public_key: enrollment.public_key,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), token: TOKEN };
  const invitation = join(f.root, "invitation.json");
  writeFileSync(invitation, JSON.stringify(profile), { mode: 0o600 }); client.importInvitation(f.state, invitation);
  return { ...f, profile };
}
async function bound() {
  const f = participant(), keys = generateKeyPairSync("ed25519");
  const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Selected CLI fixture", resources: [], acceptance_criteria: ["Read selected CLI message"], principalities: [] };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(descriptor).sort(([a], [b]) => a.localeCompare(b))));
  const missionDigest = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
  await bind(f.state, { mission_digest: missionDigest, peer: { identity_id: randomUUID(), signing_key_id: randomUUID(), grant_id: randomUUID(),
    public_key: Buffer.from(keys.publicKey.export({ format: "jwk" }).x!, "base64url").toString("base64") },
    target: { kind: "codex", thread_id: THREAD, cwd: f.root }, after: "0", expires_at: new Date(Date.now() + 1_800_000).toISOString(),
  }, { fetchImpl: async (url: string) => {
    if (url.endsWith("/invitation")) return response({ mission: { mission_id: M, descriptor, mission_digest: missionDigest }, grant: {
      mission_id: M, grant_id: G, identity_id: I, signing_key_id: K, origin: ORIGIN,
      actions: ["mission.read", "mission.observe"], accepted_at: new Date().toISOString(), expires_at: f.profile.expires_at,
    } });
    if (url.endsWith("/context")) return response({ mission: { mission_id: M, mission_digest: missionDigest } });
    throw new Error("Unexpected fixture request");
  } });
  return f;
}
function stalledPoll(watchSignal: () => AbortSignal) {
  const original = globalThis.fetch, started = deferred(); let calls = 0, aborted = false;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    calls++; expect(String(url)).toBe(`${ORIGIN}/v1/collaboration/missions/${M}/events?after=0&limit=20`);
    started.resolve();
    return await new Promise<Response>((_resolve, reject) => {
      const abort = () => { aborted = true; reject(new Error("Synthetic abort")); };
      expect(options.signal).toBeInstanceOf(AbortSignal);
      // Exercise the overall watch deadline, independently of its shorter per-request timer.
      const signal = watchSignal();
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;
  cleanups.push(() => { globalThis.fetch = original; });
  return { started: started.promise, get calls() { return calls; }, get aborted() { return aborted; } };
}

describe.skipIf(process.platform === "win32")("mission wake public CLI boundary", () => {
  test("help runs with absolute Node and an empty tool path without opening state", () => {
    const f = fixture();
    for (const args of [[], ["help"], ["--help"]]) {
      const result = run(f, args);
      expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
      expect(result.stdout).toContain("prepare-codex"); expect(result.stdout).toContain("900 seconds");
      expect(existsSync(f.state)).toBe(false);
    }
  });

  test("invalid commands, duplicate flags, missing values and path flags cause no side effects", () => {
    const f = fixture(), before = readdirSync(f.root).sort();
    const attempts = [
      ["unknown"], ["__proto__"], ["watch"], ["poll", "--state", "relative"],
      ["prepare-codex", "--cwd", "."], ["prepare-codex", "--cwd", f.root, "--state", f.state],
      ["prepare-codex", "--cwd", f.root, "--name"],
      ["watch", "--state", f.state, "--state", f.state], ["poll", "--state", f.state, "--seconds", "60"],
      ["send", "--state", f.state, "--to", ROUTE, "--text-file"], ["watch", "--state", f.state, "unparsed"],
      ...["0", "21", "-1", "0.5"].map(limit => ["watch", "--state", f.state, "--max-deliveries", limit]),
    ];
    for (const args of attempts) {
      const result = run(f, args);
      expect(result.error).toBeUndefined(); expect(result.status).toBe(1); expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("CLI_FORBIDDEN_EFFECT");
      expect(readdirSync(f.root).sort()).toEqual(before);
    }
  });

  test("noncanonical and out-of-range durations reject before touching state or adapters", () => {
    const f = fixture();
    for (const command of ["watch", "channel"]) for (const duration of ["0", "-1", "901", "1.5", "1e2", "01", "NaN"]) {
      const result = run(f, [command, "--state", f.state, "--seconds", duration]);
      expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
      expect(result.stderr).toContain("1–900 seconds"); expect(result.stderr).not.toContain("CLI_FORBIDDEN_EFFECT");
      expect(existsSync(f.state)).toBe(false);
    }
  });

  test("private summary FIFOs and symlinks fail fast without outbox writes or fetch", () => {
    const f = participant(), selected = join(f.root, "selected.txt"), link = join(f.root, "linked.txt"), fifo = join(f.root, "input.fifo");
    writeFileSync(selected, "Private selected message", { mode: 0o600 }); symlinkSync(selected, link);
    const made = spawnSync("/usr/bin/mkfifo", [fifo], { encoding: "utf8", timeout: 2000 });
    expect(made.status).toBe(0); chmodSync(fifo, 0o600);
    for (const input of [fifo, link]) {
      const result = run(f, ["send", "--state", f.state, "--to", ROUTE, "--text-file", input]);
      expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
      expect(result.stderr).not.toContain("CLI_FORBIDDEN_EFFECT"); expect(result.stderr).not.toContain(TOKEN);
      expect(result.stdout).toBe(""); expect(readdirSync(join(f.state, "outbox"))).toEqual([]);
    }
    expect(readFileSync(selected, "utf8")).toBe("Private selected message");
  });

  test("malformed UTF-8 is rejected instead of signing replacement text", () => {
    const f = participant(), selected = join(f.root, "selected.txt");
    for (const bytes of [Buffer.from([0x61, 0xc3, 0x28]), Buffer.from([0xf0, 0x9f])]) {
      writeFileSync(selected, bytes, { mode: 0o600 });
      const result = run(f, ["send", "--state", f.state, "--to", ROUTE, "--text-file", selected]);
      expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
      expect(result.stderr).not.toContain("CLI_FORBIDDEN_EFFECT"); expect(result.stdout).toBe("");
      expect(readdirSync(join(f.state, "outbox"))).toEqual([]);
      expect(readFileSync(selected)).toEqual(bytes);
    }
  });

  test("aborted watch retains receiver ownership until adapter shutdown is confirmed", async () => {
    const f = await bound(), closing = deferred(), release = deferred();
    let signal!: AbortSignal; const poll = stalledPoll(() => signal);
    let alive = true, deliveries = 0, closes = 0;
    const running = watch(f.state, 1, { createAdapter: options => { signal = options.signal; return {
      deliver: async () => { deliveries++; throw new Error("No fixture message should dispatch"); },
      close: async () => { closes++; closing.resolve(); await release.promise; alive = false; },
    }; } });
    cleanups.push(() => { release.resolve(); return running.catch(() => {}); });
    await poll.started; expect(status(f.state).locked).toBe(true);
    await closing.promise;
    expect(poll.aborted).toBe(true); expect(alive).toBe(true); expect(status(f.state).locked).toBe(true);
    expect(() => openReceiver(f.state)).toThrow();
    release.resolve(); const result = await running;
    expect(alive).toBe(false); expect(result.locked).toBe(false); expect(closes).toBe(1);
    expect(deliveries).toBe(0); expect(poll.calls).toBe(1);
  });

  test("unconfirmed child shutdown leaves the lock held and never reports clean stop", async () => {
    const f = await bound(); let closes = 0, signal!: AbortSignal;
    const poll = stalledPoll(() => signal);
    const running = watch(f.state, 1, { createAdapter: options => { signal = options.signal; return {
      deliver: async () => { throw new Error("Unexpected fixture delivery"); },
      close: async () => { closes++; throw new Error("SHUTDOWN_UNCONFIRMED"); },
    }; } });
    await expect(running).rejects.toThrow("SHUTDOWN_UNCONFIRMED");
    expect(poll.aborted).toBe(true); expect(poll.calls).toBe(1); expect(closes).toBe(1);
    expect(status(f.state).locked).toBe(true); expect(() => openReceiver(f.state)).toThrow();
  });
});
