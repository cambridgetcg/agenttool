import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORKS } from "../src/constants.js";
import {
  bankSendAnchorArgs,
  broadcastAnchor,
  keyAddressArgs,
  lookupTx,
  resolveKeyAddress,
  createReadOnlyTxLookup,
  type ZeronedRunner,
  type ZeronedRunResult,
} from "../src/zeroned.js";

const NET = NETWORKS["zerone-testnet-1"]!;
const ADDRESS = "zrn1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusq5ekN".toLowerCase();

function fakeRunner(result: ZeronedRunResult): ZeronedRunner {
  return { run: () => result };
}

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function queryStub(script: string): { bin: string; marker: string } {
  const dir = mkdtempSync("/tmp/collab-query-bounds-"); dirs.push(dir);
  const bin = join(dir, "zeroned"); const marker = join(dir, "escaped");
  writeFileSync(bin, `#!/bin/sh\n${script.replaceAll("MARKER", marker)}\n`); chmodSync(bin, 0o700);
  return { bin, marker };
}

describe("bounded real read-only query subprocesses", () => {
  for (const pipe of ["stdout", "stderr"]) {
    test(`${pipe} is bounded before nested query output can be retained`, async () => {
      const { bin, marker } = queryStub(`dd if=/dev/zero bs=1048576 count=2 ${pipe === "stderr" ? "1>&2" : ""} 2>/dev/null\nsleep 0.2\ntouch "MARKER"`);
      const result = await createReadOnlyTxLookup(bin, { max_output_bytes: 4096, timeout_ms: 1000 })(NET, "HASH");
      expect(result.found).toBe(false);
      expect(JSON.stringify(result).length).toBeLessThan(100);
      await Bun.sleep(250);
      expect(existsSync(marker)).toBe(false);
    });
  }

  test("combined nested stdout/stderr and successive queries share one budget", async () => {
    const payload = JSON.stringify({ height: 1, code: 0, txhash: "HASH", tx: { body: { memo: "m" } } });
    const bytes = Buffer.byteLength(payload) + 5;
    const { bin } = queryStub(`printf '%s' '${payload}'; printf '12345' >&2`);
    const small = createReadOnlyTxLookup(bin, { max_output_bytes: bytes - 1, timeout_ms: 1000 });
    expect((await small(NET, "HASH")).found).toBe(false);
    const shared = createReadOnlyTxLookup(bin, { max_output_bytes: bytes * 2 - 1, timeout_ms: 1000 });
    expect((await shared(NET, "HASH")).found).toBe(true);
    expect((await shared(NET, "HASH")).found).toBe(false);
  });

  test("a silent query is killed at its own deadline", async () => {
    const { bin, marker } = queryStub('sleep 0.4\ntouch "MARKER"');
    const start = Date.now();
    expect((await createReadOnlyTxLookup(bin, { max_output_bytes: 4096, timeout_ms: 30 })(NET, "HASH")).found).toBe(false);
    expect(Date.now() - start).toBeLessThan(250);
    await Bun.sleep(450);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("zeroned argument builders", () => {
  test("bank send anchors are send-to-self with the fee floor and sync broadcast", () => {
    const args = bankSendAnchorArgs(NET, ADDRESS, "the-memo");
    expect(args.slice(0, 6)).toEqual(["tx", "bank", "send", ADDRESS, ADDRESS, "1uzrn"]);
    const flag = (name: string): string | undefined => args[args.indexOf(name) + 1];
    expect(flag("--note")).toBe("the-memo");
    expect(flag("--chain-id")).toBe("zerone-testnet-1");
    expect(flag("--node")).toBe(NET.rpc);
    expect(flag("--keyring-backend")).toBe("test");
    expect(flag("--gas")).toBe("100000");
    expect(flag("--fees")).toBe("100000uzrn");
    expect(flag("--broadcast-mode")).toBe("sync");
    expect(args).toContain("--yes");
    expect(flag("--output")).toBe("json");
  });

  test("gas/fee overrides flow through", () => {
    const args = bankSendAnchorArgs(NET, ADDRESS, "m", { gas: 30000, fee_uzrn: 30000 });
    expect(args[args.indexOf("--gas") + 1]).toBe("30000");
    expect(args[args.indexOf("--fees") + 1]).toBe("30000uzrn");
  });

  test("key address args target the test keyring in the network home", () => {
    const args = keyAddressArgs(NET, "ai-agenttool");
    expect(args.slice(0, 4)).toEqual(["keys", "show", "ai-agenttool", "-a"]);
    expect(args[args.indexOf("--keyring-backend") + 1]).toBe("test");
  });
});

describe("broadcast outcome discipline", () => {
  test("CheckTx code 0 → accepted with tx hash", () => {
    const result = broadcastAnchor(
      fakeRunner({ exit_code: 0, stdout: '{"height":"0","txhash":"CAFE01","code":0,"raw_log":""}', stderr: "" }),
      [],
    );
    expect(result).toMatchObject({ outcome: "accepted", tx_hash: "CAFE01", code: 0 });
  });

  test("gas estimate noise before the JSON body still parses", () => {
    const result = broadcastAnchor(
      fakeRunner({ exit_code: 0, stdout: 'gas estimate: 12345\n{"txhash":"BEEF02","code":0}', stderr: "" }),
      [],
    );
    expect(result.outcome).toBe("accepted");
    expect(result.tx_hash).toBe("BEEF02");
  });

  test("CheckTx rejection → rejected, hash preserved", () => {
    const result = broadcastAnchor(
      fakeRunner({ exit_code: 0, stdout: '{"txhash":"DEAD03","code":13,"raw_log":"insufficient fee"}', stderr: "" }),
      [],
    );
    expect(result).toMatchObject({ outcome: "rejected", tx_hash: "DEAD03", code: 13 });
    expect(result.detail).toContain("insufficient fee");
  });

  test("recognisably pre-broadcast failure → rejected", () => {
    const result = broadcastAnchor(
      fakeRunner({ exit_code: 1, stdout: "", stderr: "Error: nosuchkey.info: key not found" }),
      [],
    );
    expect(result.outcome).toBe("rejected");
  });

  test("unrecognisable failure after invocation → ambiguous, never assumed unsent", () => {
    const result = broadcastAnchor(
      fakeRunner({ exit_code: 1, stdout: "", stderr: "post failed: Post \"http://…\": context deadline exceeded" }),
      [],
    );
    expect(result.outcome).toBe("ambiguous");
  });

  test("missing or malformed CheckTx code stays ambiguous and preserves the hash", () => {
    for (const code of [undefined, null, false, "", " ", "0x0", "no", -1, 0.5, {}, [], 1e20]) {
      const result = broadcastAnchor(fakeRunner({ exit_code: 0,
        stdout: JSON.stringify({ txhash: "CAFE01", code }), stderr: "" }), []);
      expect(result).toMatchObject({ outcome: "ambiguous", tx_hash: "CAFE01" });
    }
  });

  test("runner throwing → ambiguous", () => {
    const runner: ZeronedRunner = { run: () => { throw new Error("spawn ENOENT"); } };
    const result = broadcastAnchor(runner, []);
    expect(result.outcome).toBe("ambiguous");
    expect(result.detail).toContain("ENOENT");
  });
});

describe("tx lookup and key resolution", () => {
  test("lookupTx extracts height, code, and memo", () => {
    const stdout = JSON.stringify({
      height: "848900",
      code: 0,
      txhash: "HASH",
      tx: { body: { memo: "agenttool.collab-anchor/0.1 ws=a epoch=b seq=1 head=x" } },
    });
    const lookup = lookupTx(fakeRunner({ exit_code: 0, stdout, stderr: "" }), NET, "HASH");
    expect(lookup).toMatchObject({ found: true, height: 848900, code: 0 });
    expect(lookup.memo).toContain("collab-anchor");
  });

  test("lookupTx reports not-found without inventing state", () => {
    const lookup = lookupTx(
      fakeRunner({ exit_code: 1, stdout: "", stderr: "tx (HASH) not found" }),
      NET,
      "HASH",
    );
    expect(lookup.found).toBe(false);
    expect(lookup.detail).toContain("not found");
  });

  test("explicit decimal string code and numeric height remain valid", () => {
    const stdout = JSON.stringify({ height: 5, code: "0", txhash: "hash", tx: { body: { memo: "memo" } } });
    expect(lookupTx(fakeRunner({ exit_code: 0, stdout, stderr: "" }), NET, "HASH"))
      .toEqual({ found: true, height: 5, code: 0, memo: "memo" });
  });

  test("missing or malformed code and height cannot become successful evidence", () => {
    const invalid = [undefined, null, "", " ", false, true, [], {}, -1, 0.1, "1e3", "0x0", "-0", "NaN", "Infinity", "01", Number.MAX_SAFE_INTEGER + 1];
    for (const field of ["code", "height"]) {
      for (const value of [...invalid, ...(field === "height" ? [0, "0"] : [])]) {
        const stdout = JSON.stringify({ height: "8", code: 0, txhash: "HASH", tx: { body: { memo: "memo" } }, [field]: value });
        const lookup = lookupTx(fakeRunner({ exit_code: 0, stdout, stderr: "" }), NET, "HASH");
        expect(lookup.found).toBe(false);
        expect(lookup.code).toBeUndefined();
        expect(lookup.height).toBeUndefined();
      }
    }
  });

  test("missing memo, malformed envelopes and unrelated returned hashes stay unknown", () => {
    for (const payload of [{}, { height: 1, code: 0 }, { height: 1, code: 0, tx: null },
      { height: 1, code: 0, tx: { body: { memo: 0 } } },
      { height: 1, code: 0, txhash: "OTHER", tx: { body: { memo: "memo" } } }]) {
      const result = lookupTx(fakeRunner({ exit_code: 0, stdout: JSON.stringify(payload), stderr: "" }), NET, "HASH");
      expect(result.found).toBe(false);
    }
    expect(lookupTx({ run: () => { throw new Error("https://secret.invalid/token"); } }, NET, "HASH"))
      .toEqual({ found: false, detail: "query tx invocation failed" });
  });

  test("failed query output is not returned as diagnostic secrets", () => {
    const result = lookupTx(fakeRunner({ exit_code: 1, stdout: "secret", stderr: "https://u:p@host/?token=secret" }), NET, "HASH");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("only explicit safe integer code and positive height are transaction evidence", () => {
    const query = (fields: Record<string, unknown>) => lookupTx(fakeRunner({ exit_code: 0,
      stdout: JSON.stringify({ height: "42", code: 0, txhash: "HASH", tx: { body: { memo: "memo" } }, ...fields }), stderr: "" }), NET, "HASH");
    for (const value of [undefined, null, false, true, "", " ", "0x0", "1e2", "no", -1, 0.5, {}, [], 1e20]) {
      expect(query({ code: value }).found).toBe(false);
      expect(query({ height: value }).found).toBe(false);
    }
    expect(query({ height: 0 }).found).toBe(false);
    expect(query({ height: "0" }).found).toBe(false);
    for (const tx of [undefined, null, [], {}, { body: null }, { body: {} }, { body: { memo: false } }]) {
      expect(query({ tx }).found).toBe(false);
    }
    expect(query({ height: 42, code: "0" })).toMatchObject({ found: true, height: 42, code: 0 });
    expect(query({ height: "42", code: "13" })).toMatchObject({ found: true, height: 42, code: 13 });
    for (const txhash of [undefined, null, false, "", "WRONG", {}]) expect(query({ txhash }).found).toBe(false);
    expect(query({ txhash: "hash" }).found).toBe(true);
  });

  test("query errors are unknown and never disclose raw URL or output secrets", () => {
    const secret = "https://user:password@example.invalid/?token=secret";
    const thrown = lookupTx({ run: () => { throw new Error(secret); } }, NET, "HASH");
    const failed = lookupTx(fakeRunner({ exit_code: 1, stdout: secret, stderr: secret }), NET, "HASH");
    for (const result of [thrown, failed]) {
      expect(result.found).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    for (const stdout of ["", "garbage", "null", "[]", "{}", '{"tx":null}', '{"code":0,"height":10}']) {
      expect(lookupTx(fakeRunner({ exit_code: 0, stdout, stderr: "" }), NET, "HASH").found).toBe(false);
    }
  });

  test("resolveKeyAddress validates the bech32 shape", () => {
    const good = resolveKeyAddress(
      fakeRunner({ exit_code: 0, stdout: "zrn1abcdefghjklmnpqrstuvwxyz023456\n", stderr: "" }),
      NET,
      "ai-agenttool",
    );
    expect(good.startsWith("zrn1")).toBe(true);
    expect(() => resolveKeyAddress(
      fakeRunner({ exit_code: 0, stdout: "Error: no key\n", stderr: "" }),
      NET,
      "ai-agenttool",
    )).toThrow(/could not resolve/);
    expect(() => resolveKeyAddress(
      fakeRunner({ exit_code: 1, stdout: "", stderr: "key not found" }),
      NET,
      "missing",
    )).toThrow(/key not found/);
  });
});
