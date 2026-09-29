/** Real Node CLI processes with all fetches replaced by an offline refusal barrier. */
import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as client from "../agenttool-mission.mjs";

const CLI = resolve(import.meta.dir, "../agenttool-mission.mjs"), NODE = Bun.which("node")!;
const TOKEN = `atcm_${Buffer.alloc(32, 31).toString("base64url")}`;
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mission chat cli's fixture-"))); chmodSync(root, 0o700);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state"), enrollment = client.init(state, "https://offline-chat-fixture.invalid");
  const profile = { format: "agenttool-mission-invitation/v1", origin: enrollment.origin, mission_id: randomUUID(),
    grant_id: randomUUID(), identity_id: randomUUID(), signing_key_id: randomUUID(), public_key: enrollment.public_key,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), token: TOKEN };
  const invitationFile = join(root, "private-invitation.json");
  writeFileSync(invitationFile, JSON.stringify(profile), { mode: 0o600 }); client.importInvitation(state, invitationFile);
  const publicKey = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" });
  const config = { format: "agenttool-mission-chat-config/v1", mission_digest: `sha256:${"7".repeat(64)}`, conversation: "cli-fixture",
    peer: { identity_id: randomUUID(), signing_key_id: randomUUID(), grant_id: randomUUID(), public_key: Buffer.from(publicKey.x!, "base64url").toString("base64") },
    expires_at: new Date(Date.now() + 1_800_000).toISOString() };
  const configFile = join(root, "config.json"), textFile = join(root, "selected-text.txt"), receiptFile = join(root, "receipt.json");
  for (const [path, value] of [[configFile, JSON.stringify(config)], [textFile, "Selected text 雨夜 🌞"], [receiptFile, "{}"]])
    writeFileSync(path, value, { mode: 0o600 });
  const marker = join(root, "offline-fetch-attempts.txt"), barrier = join(root, "fetch-barrier.mjs");
  writeFileSync(barrier, `import {appendFileSync} from 'node:fs';\nglobalThis.fetch = async () => { appendFileSync(${JSON.stringify(marker)}, 'attempt\\n'); throw new Error('offline fixture'); };\n`, { mode: 0o600 });
  return { root, state, configFile, textFile, receiptFile, marker, barrier };
}
type Fixture = ReturnType<typeof fixture>;
function run(f: Fixture, args: string[]) {
  return spawnSync(NODE, ["--import", f.barrier, CLI, ...args], { cwd: f.root,
    env: { PATH: process.env.PATH ?? "", HOME: f.root, TMPDIR: tmpdir() }, encoding: "utf8", timeout: 4000, maxBuffer: 128 * 1024 });
}
function options(f: Fixture) { return ["--state", f.state, "--config-file", f.configFile]; }
function failedWithoutRequest(f: Fixture, args: string[]) {
  const result = run(f, args);
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
  expect(result.stdout).toBe(""); expect(result.stderr).not.toContain(TOKEN);
  expect(existsSync(f.marker)).toBe(false); expect(readdirSync(join(f.state, "outbox"))).toEqual([]);
  return result;
}

describe.skipIf(process.platform === "win32")("mission chat Node CLI", () => {
  test("standalone help documents finite reads, private references and separate ACK meaning without state or network", () => {
    const f = fixture();
    for (const args of [["chat"], ["chat", "--help"], ["chat", "help"]]) {
      const result = run(f, args);
      expect(result.status).toBe(0); expect(result.stderr).toBe("");
      expect(result.stdout).toContain("--config-file"); expect(result.stdout).toContain("--receipt-file");
      expect(result.stdout).toContain("300"); expect(result.stdout).toContain("read_ack");
      expect(result.stdout).toContain("does not wake"); expect(result.stdout).not.toContain(TOKEN);
    }
    expect(existsSync(f.marker)).toBe(false);
  });

  test("unknown, repeated, missing and command-inappropriate flags fail before any request", () => {
    const f = fixture(), common = options(f);
    for (const args of [
      ["chat", "unknown", ...common], ["chat", "constructor", ...common],
      ["chat", "read", ...common, "--after", "0", "--after", "1"],
      ["chat", "read", ...common, "--seconds"], ["chat", "read", ...common, "--summary-file", f.textFile],
      ["chat", "send", ...common], ["chat", "reply", ...common, "--text-file", f.textFile, "--receipt-file", f.receiptFile],
      ["chat", "reply", ...common, "--text-file", f.textFile, "--in-reply-to", randomUUID()],
      ["chat", "reply", ...common, "--text-file", f.textFile, "--receipt-file", f.receiptFile, "--in-reply-to", randomUUID(), "--kind", "processed"],
      ["chat", "inspect", ...common, "--text-file", f.textFile],
    ]) failedWithoutRequest(f, args);
  });

  test("noncanonical cursors and out-of-range read bounds are rejected by the actual Node entry point", () => {
    const f = fixture();
    for (const flags of [["--after", "01"], ["--after", "-1"], ["--after", "9223372036854775808"],
      ["--seconds", "0"], ["--seconds", "301"], ["--seconds", "1.5"], ["--seconds", "not-a-number"],
      ["--max-messages", "0"], ["--max-messages", "21"], ["--max-messages", "1.5"]]) {
      failedWithoutRequest(f, ["chat", "read", ...options(f), ...flags]);
    }
  });

  test("private input protections cover permissions, symlinks, FIFOs, UTF-8 and selected absolute paths", () => {
    const f = fixture(), savedConfig = readFileSync(f.configFile);
    chmodSync(f.configFile, 0o644);
    failedWithoutRequest(f, ["chat", "inspect", ...options(f)]);
    chmodSync(f.configFile, 0o600);
    const link = join(f.root, "config-link.json"); symlinkSync(f.configFile, link);
    failedWithoutRequest(f, ["chat", "inspect", "--state", f.state, "--config-file", link]);
    failedWithoutRequest(f, ["chat", "send", ...options(f), "--text-file", "relative.txt"]);
    const fifo = join(f.root, "receipt-fifo");
    expect(spawnSync("mkfifo", [fifo], { timeout: 2000 }).status).toBe(0); chmodSync(fifo, 0o600);
    failedWithoutRequest(f, ["chat", "reply", ...options(f), "--text-file", f.textFile, "--receipt-file", fifo, "--in-reply-to", randomUUID()]);
    writeFileSync(f.textFile, Buffer.from([0xff, 0xfe]));
    failedWithoutRequest(f, ["chat", "send", ...options(f), "--text-file", f.textFile]);
    expect(readFileSync(f.configFile)).toEqual(savedConfig);
  });

  test("malformed config bytes are redacted and bounded transport failure is structured without credentials", () => {
    const f = fixture(), saved = readFileSync(f.configFile);
    writeFileSync(f.configFile, `{ malformed ${TOKEN}`);
    failedWithoutRequest(f, ["chat", "inspect", ...options(f)]);
    writeFileSync(f.configFile, saved);
    const result = run(f, ["chat", "read", ...options(f), "--seconds", "1", "--after", "9007199254740993"]);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(1); expect(result.stderr).toBe("");
    const value = JSON.parse(result.stdout);
    expect(value.stop_reason).toBe("transport_error"); expect(value.next_cursor).toBe("9007199254740993"); expect(value.messages).toEqual([]);
    expect(result.stdout).not.toContain(TOKEN); expect(readFileSync(f.marker, "utf8")).toBe("attempt\n");
    expect(readdirSync(join(f.state, "outbox"))).toEqual([]);
  });

  test("a rejected selected message returns a structured safe failure before transport", () => {
    const f = fixture(); writeFileSync(f.textFile, "🌞".repeat(1000));
    const result = failedWithoutRequest(f, ["chat", "send", ...options(f), "--text-file", f.textFile]);
    const value = JSON.parse(result.stderr);
    expect(value.stop_reason).toBe("verification_failed"); expect(typeof value.error).toBe("string");
    expect(value).not.toHaveProperty("event_id"); expect(value).not.toHaveProperty("token");
  });

  test("SIGTERM cancels an in-flight read and produces its structured cursor without a second request", async () => {
    const f = fixture();
    writeFileSync(f.barrier, `import {appendFileSync} from 'node:fs';\nglobalThis.fetch = async (_url, options) => {\n` +
      `  const keepAlive = setInterval(() => {}, 500);\n` +
      `  appendFileSync(${JSON.stringify(f.marker)}, 'attempt\\n');\n` +
      `  return await new Promise((_resolve, reject) => {\n` +
      `    const abort = () => { clearInterval(keepAlive); reject(options.signal.reason); };\n` +
      `    if (options.signal.aborted) { abort(); return; }\n` +
      `    options.signal.addEventListener('abort', abort, {once:true});\n` +
      `  });\n};\n`);
    const child = spawn(NODE, ["--import", f.barrier, CLI, "chat", "read", ...options(f), "--after", "9007199254740993"], {
      cwd: f.root, env: { PATH: process.env.PATH ?? "", HOME: f.root, TMPDIR: tmpdir() }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); }); child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    const closed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 2500);
    try {
      const start = performance.now();
      while (!existsSync(f.marker) && performance.now() - start < 1500) await new Promise(resolve => setTimeout(resolve, 10));
      expect(existsSync(f.marker)).toBe(true); expect(child.kill("SIGTERM")).toBe(true);
      const ended = await closed;
      expect(ended).toEqual({ code: 1, signal: null }); expect(stderr).toBe("");
      const result = JSON.parse(stdout);
      expect(result.stop_reason).toBe("cancelled"); expect(result.next_cursor).toBe("9007199254740993"); expect(result.messages).toEqual([]);
      expect(readFileSync(f.marker, "utf8")).toBe("attempt\n"); expect(stdout).not.toContain(TOKEN);
      expect(readdirSync(join(f.state, "outbox"))).toEqual([]);
    } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; }
  });
});
