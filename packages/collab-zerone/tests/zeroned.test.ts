import { describe, expect, test } from "bun:test";
import { NETWORKS } from "../src/constants.js";
import {
  bankSendAnchorArgs,
  broadcastAnchor,
  keyAddressArgs,
  lookupTx,
  resolveKeyAddress,
  type ZeronedRunner,
  type ZeronedRunResult,
} from "../src/zeroned.js";

const NET = NETWORKS["zerone-testnet-1"]!;
const ADDRESS = "zrn1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusq5ekN".toLowerCase();

function fakeRunner(result: ZeronedRunResult): ZeronedRunner {
  return { run: () => result };
}

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
