import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CollabStore } from "../../collab/src/store.js";
import { appendAnchor, newAnchorEntry } from "../../collab-zerone/src/ledger.js";
import { buildAnchorMemo } from "../../collab-zerone/src/memo.js";
import {
  createWitnessObserver, type WitnessBinding, type WitnessRunner, type WitnessRunRequest, type WitnessSelection,
} from "../src/witness.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function temp(): string { const dir = mkdtempSync("/tmp/courier-witness-"); dirs.push(dir); return dir; }

const selection: WitnessSelection = {
  workspace_id: "ws_fixture", epoch_id: "epoch_fixture", sequence: 2, head_hash: "ab".repeat(32), tx_hash: "CD".repeat(32),
  memo: `agenttool.collab-anchor/0.1 ws=ws_fixture epoch=epoch_fixture seq=2 head=${"ab".repeat(32)}`,
};
function binding(home = "/tmp"): WitnessBinding {
  return { command: process.execPath, cli_path: "/fixture/collab-zerone.ts", zeroned_bin: "/fixture/zeroned",
    node: "https://rpc.invalid/rpc", observer_name: "fixture-rpc", network: "zerone-testnet-1",
    workspace_id: selection.workspace_id, db_path: "/fixture/journal.sqlite", ledger_path: "/fixture/anchors.json", home };
}
function report(remote = true): any {
  return { workspace_id: selection.workspace_id, epoch_id: selection.epoch_id, journal_valid: true,
    chain_checked: remote, ledger_note: null,
    anchors: [{ anchor: { ...selection, network: "zerone-testnet-1", status: "confirmed", confirmed_height: 7 },
      local_match: true, chain: remote ? { found: true, height: 7, tx_code: 0, memo_matches: true, detail: null } : null }] };
}
function stream(text = ""): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { if (text) controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
function fake(output: unknown = report(), stderr = "", exit = 0) {
  const requests: WitnessRunRequest[] = [];
  let kills = 0;
  const runner: WitnessRunner = { start(request) {
    requests.push(request);
    return { stdout: stream(typeof output === "string" ? output : JSON.stringify(output)), stderr: stream(stderr),
      exited: Promise.resolve(exit), kill() { kills++; } };
  } };
  return { runner, requests, kills: () => kills };
}
async function remote(output: unknown) {
  const fixture = fake(output);
  return createWitnessObserver(binding(), fixture).observe(selection, { check_chain: true });
}

// These tests use only injected runners and generated inert subprocesses. No
// endpoint is contacted, even in the explicitly requested remote-check mode.
describe("read-only witness selection and evidence", () => {
  test("construction does no I/O and default observation is explicitly local only", async () => {
    const fixture = fake(report(false));
    const observer = createWitnessObserver(binding(), fixture);
    expect(fixture.requests).toHaveLength(0);
    expect(Object.keys(observer)).toEqual(["observe"]);
    const observed = await observer.observe(selection);
    expect(observed).toMatchObject({ kind: "local_sidecar", recorded_status: "confirmed", recorded_height: 7,
      remote_checked: false, local_prefix_valid: true, trustless_finality: false, selection });
    expect(fixture.requests[0]!.cmd).toEqual([process.execPath, "--no-env-file", "--config=/dev/null", "/fixture/collab-zerone.ts", "verify",
      "--workspace", "ws_fixture", "--db", "/fixture/journal.sqlite", "--ledger", "/fixture/anchors.json",
      "--network", "zerone-testnet-1", "--json"]);
    const runtime = fixture.requests[0]!.cwd;
    expect(runtime.startsWith("/tmp/.courier-witness-")).toBe(true);
    expect(existsSync(runtime)).toBe(false);
    expect(fixture.requests[0]!.env).toEqual({ HOME: runtime, XDG_CONFIG_HOME: runtime, BUN_CONFIG_NO_GLOBAL: "1", TMPDIR: "/tmp",
      PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin", ZERONED_BIN: "/fixture/zeroned",
      COLLAB_ZERONE_QUERY_MAX_OUTPUT_BYTES: "262144", COLLAB_ZERONE_QUERY_TIMEOUT_MS: "10000" });
    expect(fixture.kills()).toBe(1);
  });

  test("remote evidence is an explicit observation by a named RPC, never finality", async () => {
    const fixture = fake();
    const observed = await createWitnessObserver(binding(), fixture).observe(selection, { check_chain: true });
    expect(observed).toMatchObject({ kind: "remote_observation", observer_name: "fixture-rpc", height: 7,
      network_source: "host_binding", tx_code: 0, remote_checked: true, trustless_finality: false, local_prefix_valid: true, selection });
    expect(fixture.requests[0]!.cmd.slice(-3)).toEqual(["--check-chain", "--node", "https://rpc.invalid/rpc"]);
    expect(JSON.stringify(observed)).not.toContain("rpc.invalid");
    expect(fixture.requests[0]!.cmd.some(arg => ["anchor", "resolve", "keys", "tx", "--key", "--keyring-home"].includes(arg))).toBe(false);
  });

  test("zero exit with empty or unrelated records cannot prove the selected transaction", async () => {
    for (const anchors of [[], [null], [{ anchor: {} }], [report().anchors[0], report().anchors[0]]]) {
      expect(await remote({ ...report(), anchors })).toMatchObject({ kind: "unknown", reason: "selection_not_found" });
    }
    const unrelated = report(); unrelated.anchors[0].anchor.tx_hash = "EF".repeat(32);
    expect(await remote(unrelated)).toMatchObject({ kind: "unknown", reason: "selection_not_found" });
    expect(await remote("{}")).toMatchObject({ kind: "unknown" });
  });

  test("each requested workspace, epoch, sequence, hash, memo and network must match", async () => {
    for (const [field, value] of Object.entries({ workspace_id: "ws_other", epoch_id: "epoch_other", sequence: 3,
      head_hash: "ff".repeat(32), memo: `${selection.memo} `, network: "zerone-1" })) {
      const output = report(); output.anchors[0].anchor[field] = value;
      expect(await remote(output)).toMatchObject({ kind: "unknown", reason: "malformed_evidence" });
    }
    for (const patch of [{ workspace_id: "ws_other" }, { epoch_id: "epoch_other" }, { epoch_id: undefined },
      { ledger_note: "secret/path" }, { chain_checked: false }, { anchors: {} }]) {
      expect(await remote({ ...report(), ...patch })).toMatchObject({ kind: "unknown", reason: "malformed_evidence" });
    }
  });

  test("true local prefix and full journal verification are required", async () => {
    expect(await remote({ ...report(), journal_valid: false })).toMatchObject({ kind: "unknown", reason: "local_prefix_unverified" });
    for (const local_match of [undefined, false, "true", 1]) {
      const output = report(); output.anchors[0].local_match = local_match;
      expect(await remote(output)).toMatchObject({ kind: "unknown", reason: "local_prefix_unverified" });
    }
  });

  test("no coercion of absent or malformed code, height, found, or memo evidence", async () => {
    for (const value of [undefined, null, false, true, "", "0", 1, -1, 0.1, {}, []]) {
      const output = report(); output.anchors[0].chain.tx_code = value;
      expect(await remote(output)).toMatchObject({ kind: "unknown", reason: "remote_unverified" });
    }
    for (const height of [undefined, null, false, true, "", "7", 0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
      const output = report(); output.anchors[0].chain.height = height;
      expect(await remote(output)).toMatchObject({ kind: "unknown", reason: "remote_unverified" });
    }
    for (const patch of [{ found: false }, { found: "true" }, { memo_matches: false }, { memo_matches: undefined }]) {
      const output = report(); Object.assign(output.anchors[0].chain, patch);
      expect(await remote(output)).toMatchObject({ kind: "unknown", reason: "remote_unverified" });
    }
  });

  test("local historical status is not silently upgraded or downgraded", async () => {
    for (const status of ["submitted", "ambiguous", "confirmed", "failed"]) {
      const output = report(false); output.anchors[0].anchor.status = status;
      const fixture = fake(output);
      expect(await createWitnessObserver(binding(), fixture).observe(selection)).toMatchObject({
        kind: "local_sidecar", recorded_status: status, remote_checked: false,
      });
    }
    const output = report(); output.anchors[0].anchor.status = "failed";
    expect(await remote(output)).toMatchObject({ kind: "unknown", reason: "remote_unverified" });
  });

  test("host binding and selection are snapshotted; feedback cannot supply commands", async () => {
    const config = binding(); const selected = { ...selection, command: "dangerous", token: "secret" };
    const fixture = fake(); const observer = createWitnessObserver(config, fixture);
    config.cli_path = "/attacker/cli"; config.node = "https://attacker.invalid";
    const observing = observer.observe(selected, { check_chain: true });
    selected.memo = "changed"; selected.tx_hash = "changed";
    const observed = await observing;
    expect(observed).toMatchObject({ kind: "remote_observation", selection });
    expect(fixture.requests[0]!.cmd).not.toContain("/attacker/cli");
    expect(JSON.stringify(observed)).not.toContain("secret");
    expect(JSON.stringify(fixture.requests)).not.toContain("dangerous");
  });

  test("malformed selections never launch a process", async () => {
    const fixture = fake(); const observer = createWitnessObserver(binding(), fixture);
    for (const patch of [{ workspace_id: "--check-chain" }, { memo: `${selection.memo}\n` }, { tx_hash: "--key" },
      { sequence: 0 }, { epoch_id: "epoch other" }, { head_hash: "oops" }]) {
      expect(await observer.observe({ ...selection, ...patch })).toMatchObject({ kind: "unknown", reason: "invalid_selection" });
    }
    expect(fixture.requests).toHaveLength(0);
  });

  test("invalid bindings and URL credentials are rejected without echoing input", () => {
    for (const patch of [{ command: "bun" }, { cli_path: "--eval" }, { home: "~" }, { zeroned_bin: "zeroned" },
      { db_path: "/tmp/\0" }, { network: "other" }, { observer_name: "secret https://u:p@host" },
      { node: "https://u:secret@host" }, { node: "https://host/?token=secret" }, { node: "file:///etc/passwd" },
      { timeout_ms: 30_001 }, { timeout_ms: -1 }, { max_output_bytes: 1_048_577 }]) {
      expect(() => createWitnessObserver({ ...binding(), ...patch })).toThrow("invalid witness binding");
    }
  });
});

describe("bounded witness process and output lifecycle", () => {
  test("invalid JSON, process errors and nonzero exits are sanitized", async () => {
    for (const fixture of [fake("not-json https://secret.invalid/token"), fake({}, "https://u:p@secret.invalid/?token=x", 1),
      { runner: { start() { throw new Error("https://u:p@secret.invalid/?token=x"); } } }]) {
      const observed = await createWitnessObserver(binding(), fixture).observe(selection, { check_chain: true });
      expect(observed.kind).toBe("unknown");
      expect(JSON.stringify(observed)).not.toContain("secret");
      expect(JSON.stringify(observed)).not.toContain("https");
    }
  });

  test("combined stdout and stderr bytes have one strict cap", async () => {
    for (const fixture of [fake("x".repeat(101)), fake("", "x".repeat(101)), fake("x".repeat(51), "y".repeat(50))]) {
      expect(await createWitnessObserver({ ...binding(), max_output_bytes: 100 }, fixture).observe(selection))
        .toMatchObject({ kind: "unknown", reason: "output_limit" });
      expect(fixture.kills()).toBe(1);
    }
  });

  test("pre-cancellation prevents launch", async () => {
    const fixture = fake(); const controller = new AbortController(); controller.abort("secret");
    expect(await createWitnessObserver(binding(), fixture).observe(selection, { signal: controller.signal }))
      .toMatchObject({ kind: "unknown", reason: "cancelled" });
    expect(fixture.requests).toHaveLength(0);
  });

  for (const blocked of ["stdout", "stderr", "process"] as const) {
    test(`deadline kills a runner blocked on ${blocked}`, async () => {
      let killed = false;
      const hanging = () => new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
      const runner: WitnessRunner = { start: () => ({
        stdout: blocked === "stdout" ? hanging() : stream(), stderr: blocked === "stderr" ? hanging() : stream(),
        exited: blocked === "process" ? new Promise(() => {}) : Promise.resolve(0), kill() { killed = true; },
      }) };
      const start = Date.now();
      expect(await createWitnessObserver({ ...binding(), timeout_ms: 20 }, { runner }).observe(selection))
        .toMatchObject({ kind: "unknown", reason: "timeout" });
      expect(Date.now() - start).toBeLessThan(1000);
      expect(killed).toBe(true);
    });
  }

  test("cancellation while both pipes and process are blocked is prompt", async () => {
    const controller = new AbortController(); let killed = false;
    const runner: WitnessRunner = { start: () => ({ stdout: new ReadableStream(), stderr: new ReadableStream(),
      exited: new Promise(() => {}), kill() { killed = true; } }) };
    const timer = setTimeout(() => controller.abort("secret"), 10);
    try {
      expect(await createWitnessObserver(binding(), { runner }).observe(selection, { signal: controller.signal }))
        .toMatchObject({ kind: "unknown", reason: "cancelled" });
      expect(killed).toBe(true);
    } finally { clearTimeout(timer); }
  });

  test("inert real CLI observes only the fixed read-only command and scrubbed environment", async () => {
    const home = temp(); const cli = join(home, "fixture.ts");
    writeFileSync(join(home, ".env"), "WITNESS_DOTENV_SECRET=should-not-load\n");
    const expected = ["verify", "--workspace", "ws_fixture", "--db", "/fixture/journal.sqlite", "--ledger", "/fixture/anchors.json",
      "--network", "zerone-testnet-1", "--json", "--check-chain", "--node", "https://rpc.invalid/rpc"];
    writeFileSync(cli, `if (JSON.stringify(Bun.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(expected))}) process.exit(1);
if (process.env.WITNESS_DOTENV_SECRET || process.env.DATABASE_URL || process.env.NODE_OPTIONS) process.exit(1);
console.log(${JSON.stringify(JSON.stringify(report()))});`);
    const observed = await createWitnessObserver({ ...binding(home), cli_path: cli }).observe(selection, { check_chain: true });
    expect(observed).toMatchObject({ kind: "remote_observation", height: 7 });
    expect(existsSync(join(home, ".zeroned"))).toBe(false);
  });

  test("bunfig preloads from the supplied HOME/cwd cannot replace the pinned verifier", async () => {
    const home = temp(); const cli = join(home, "verifier.ts"); const preload = join(home, "forged.ts");
    const marker = join(home, "preload-ran");
    writeFileSync(preload, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');
console.log(${JSON.stringify(JSON.stringify(report()))}); process.exit(0);`);
    for (const config of ["bunfig.toml", ".bunfig.toml"]) writeFileSync(join(home, config), `preload = [${JSON.stringify(preload)}]\n`);
    writeFileSync(cli, "process.exit(1);");
    expect(await createWitnessObserver({ ...binding(home), cli_path: cli }).observe(selection, { check_chain: true }))
      .toMatchObject({ kind: "unknown", reason: "process_failed" });
    expect(existsSync(marker)).toBe(false);
  });

  test("actual verify CLI observes only generated fixtures without mutating the journal or ledger", async () => {
    const home = temp();
    const init = Bun.spawnSync({ cmd: ["git", "init", "-q", home], cwd: home,
      env: { HOME: home, PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      stdout: "pipe", stderr: "pipe" });
    expect(init.exitCode).toBe(0);
    const db = join(home, "journal.sqlite"); const ledger = join(home, "anchors.json");
    let store: CollabStore | null = new CollabStore(db);
    let selected: WitnessSelection;
    try {
      const opened = store.openWorkspace({ root_path: home, actor: "inert-fixture" });
      const workspace = store.getWorkspace(opened.id)!;
      const fields = { workspace_id: workspace.id, epoch_id: workspace.epoch_id,
        sequence: workspace.event_head_sequence, head_hash: workspace.event_head_hash };
      selected = { ...fields, tx_hash: "CD".repeat(32), memo: buildAnchorMemo(fields) };
      // This writer belongs only to the generated fixture. Bun can defer the
      // final WAL checkpoint past close() until retained handles are GC'd;
      // materialize setup writes before measuring the observer's non-effects.
      expect(store.db.query("PRAGMA wal_checkpoint(TRUNCATE)").get()).toEqual({ busy: 0, log: 0, checkpointed: 0 });
    } finally { store.close(); store = null; }
    appendAnchor(ledger, { ...newAnchorEntry({ ...selected, network: "zerone-testnet-1",
      caip2: "cosmos:zerone-testnet-1", account: "zrn1fixture" }), status: "ambiguous", tx_hash: selected.tx_hash });
    const beforeDb = readFileSync(db); const beforeLedger = readFileSync(ledger);
    // Force deferred fixture-handle disposal after the byte snapshot rather
    // than leaving its timing dependent on preceding tests' allocation volume.
    Bun.gc(true);
    const marker = join(home, "invoked"); const denied = join(home, "denied");
    const stub = join(home, "zeroned");
    const payload = JSON.stringify({ txhash: selected.tx_hash, code: 0, height: "9", tx: { body: { memo: selected.memo } } });
    writeFileSync(stub, `#!/bin/sh\nif [ "$1" != "query" ] || [ "$2" != "tx" ] || [ "$3" != "${selected.tx_hash}" ]; then touch "${denied}"; exit 1; fi\ntouch "${marker}"\nprintf '%s\\n' '${payload}'\n`);
    chmodSync(stub, 0o700);
    const pinned = { ...binding(home), workspace_id: selected.workspace_id, db_path: db, ledger_path: ledger,
      cli_path: new URL("../../collab-zerone/bin/collab-zerone.ts", import.meta.url).pathname, zeroned_bin: stub };
    const observer = createWitnessObserver(pinned);
    expect(await observer.observe(selected)).toMatchObject({ kind: "local_sidecar", recorded_status: "ambiguous", remote_checked: false });
    expect(existsSync(marker)).toBe(false);
    expect(await observer.observe(selected, { check_chain: true }))
      .toMatchObject({ kind: "remote_observation", observer_name: "fixture-rpc", height: 9, trustless_finality: false });
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(denied)).toBe(false);
    expect(existsSync(join(home, ".zeroned"))).toBe(false);
    // The outer report fits 4096 bytes. Neither a huge nested stderr pipe nor
    // combined nested pipes may be hidden behind that small successful report.
    for (const output of [
      `printf '%s' '${payload}'; dd if=/dev/zero bs=1048576 count=1 1>&2 2>/dev/null`,
      `printf '%s' '${payload}'; printf '%2300s' ''; printf '%2300s' '' >&2`,
    ]) {
      writeFileSync(stub, `#!/bin/sh\n${output}\n`);
      expect(await createWitnessObserver({ ...pinned, max_output_bytes: 4096 }).observe(selected, { check_chain: true }))
        .toMatchObject({ kind: "unknown", reason: "remote_unverified" });
    }
    // Cancellation also stops a descendant of the *actual* bounded query path.
    const childMarker = join(home, "query-child-started"); const escaped = join(home, "query-child-escaped");
    writeFileSync(stub, `#!/bin/sh\n( touch '${childMarker}'; sleep 0.5; touch '${escaped}' ) &\nwait\n`);
    const controller = new AbortController();
    const observing = observer.observe(selected, { check_chain: true, signal: controller.signal });
    const deadline = Date.now() + 1000;
    while (!existsSync(childMarker) && Date.now() < deadline) await Bun.sleep(10);
    controller.abort();
    expect(await observing).toMatchObject({ kind: "unknown", reason: "cancelled" });
    expect(existsSync(childMarker)).toBe(true);
    await Bun.sleep(550);
    expect(existsSync(escaped)).toBe(false);
    expect(readFileSync(db)).toEqual(beforeDb);
    expect(readFileSync(ledger)).toEqual(beforeLedger);
  });

  test("real silent process is killed on timeout", async () => {
    const home = temp(); const cli = join(home, "silent.ts"); const marker = join(home, "pid");
    writeFileSync(cli, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, String(process.pid)); await Bun.sleep(60000);`);
    const observed = await createWitnessObserver({ ...binding(home), cli_path: cli, timeout_ms: 200 }).observe(selection);
    expect(observed).toMatchObject({ kind: "unknown", reason: "timeout" });
    expect(existsSync(marker)).toBe(true);
    await Bun.sleep(30);
    expect(() => process.kill(Number(readFileSync(marker, "utf8")), 0)).toThrow();
  });

  test("real stdout and stderr floods terminate without retaining their output", async () => {
    const home = temp();
    for (const pipe of ["stdout", "stderr"]) {
      const cli = join(home, `${pipe}.ts`);
      writeFileSync(cli, `process.${pipe}.write('secret'.repeat(100000)); await Bun.sleep(60000);`);
      const observed = await createWitnessObserver({ ...binding(home), cli_path: cli, max_output_bytes: 1024, timeout_ms: 1000 }).observe(selection);
      expect(observed).toMatchObject({ kind: "unknown", reason: "output_limit" });
      expect(JSON.stringify(observed)).not.toContain("secret");
    }
  });

  test("cancellation kills the CLI's blocked query child, not only its parent", async () => {
    const home = temp(); const cli = join(home, "parent.ts"); const child = join(home, "query.ts");
    const marker = join(home, "query-started"); const escaped = join(home, "query-escaped");
    writeFileSync(child, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');
await Bun.sleep(500); writeFileSync(${JSON.stringify(escaped)}, 'orphan');`);
    writeFileSync(cli, `Bun.spawnSync({cmd:[process.execPath, '--no-env-file', ${JSON.stringify(child)}], stdout:'inherit', stderr:'inherit'});`);
    const controller = new AbortController();
    const observing = createWitnessObserver({ ...binding(home), cli_path: cli, timeout_ms: 2000 })
      .observe(selection, { signal: controller.signal });
    const deadline = Date.now() + 1000;
    while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(10);
    controller.abort();
    expect(await observing).toMatchObject({ kind: "unknown", reason: "cancelled" });
    expect(existsSync(marker)).toBe(true);
    await Bun.sleep(550);
    expect(existsSync(escaped)).toBe(false);
  });
});
