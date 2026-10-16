import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnchorSaltError,
  aliasBindingProblem,
  anchorSaltPath,
  assertSaltReproducesLedger,
  ensureAnchorSalt,
  epochAlias,
  peekAnchorSalt,
  readAnchorSalt,
  requireAnchorSalt,
  workspaceAlias,
} from "../src/alias.js";
import { ANCHOR_MEMO_PROTOCOL } from "../src/constants.js";
import { emptyLedger, newAnchorEntry, type AnchorEntry, type AnchorLedger } from "../src/ledger.js";
import { buildAliasedAnchorMemo, buildLegacyAnchorMemo } from "../src/memo.js";

const WS = "ws_470c71f46567100cce53594a";
const EPOCH = "epoch_777690dd-ef5d-44d6-9a66-3ba7c7de2e12";
const HEAD = "cd".repeat(32);
const KAT_SALT = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");

function tempLedgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "collab-zerone-alias-")), "nested", "anchors.json");
}

function expectSaltError(fn: () => unknown, problem: AnchorSaltError["problem"], message?: RegExp): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AnchorSaltError);
  expect((caught as AnchorSaltError).problem).toBe(problem);
  if (message) expect((caught as AnchorSaltError).message).toMatch(message);
}

function aliasedEntry(salt: Uint8Array, fields: Partial<AnchorEntry> = {}): AnchorEntry {
  const workspace_alias = workspaceAlias(salt, WS);
  const epoch_alias = epochAlias(salt, EPOCH);
  return {
    ...newAnchorEntry({
      workspace_id: WS,
      epoch_id: EPOCH,
      sequence: 7,
      head_hash: HEAD,
      network: "zerone-testnet-1",
      caip2: "cosmos:zerone-testnet-1",
      account: "zrn1fixture",
      memo: buildAliasedAnchorMemo({ workspace_alias, epoch_alias, sequence: 7, head_hash: HEAD }),
      memo_protocol: ANCHOR_MEMO_PROTOCOL,
      workspace_alias,
      epoch_alias,
    }),
    ...fields,
  };
}

function ledgerWith(...anchors: AnchorEntry[]): AnchorLedger {
  return { ...emptyLedger(), anchors };
}

async function webCryptoAlias(salt: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Buffer.from(mac).toString("hex").slice(0, 32);
}

describe("alias derivation", () => {
  test("matches the spec: first 32 hex of HMAC-SHA256(salt, id); epoch under an 'epoch ' label", async () => {
    // Known answers computed independently with `openssl dgst -sha256 -mac HMAC`.
    expect(workspaceAlias(KAT_SALT, WS)).toBe("85eff4eb56be703955a836fef1f6cf50");
    expect(epochAlias(KAT_SALT, EPOCH)).toBe("7dcb76f93c245fcbf7d6e60c2d634a42");
    expect(workspaceAlias(KAT_SALT, WS)).toBe(await webCryptoAlias(KAT_SALT, WS));
    expect(epochAlias(KAT_SALT, EPOCH)).toBe(await webCryptoAlias(KAT_SALT, `epoch ${EPOCH}`));
  });

  test("aliases depend on the salt and keep the two domains apart", () => {
    const other = Buffer.alloc(32, 7);
    expect(workspaceAlias(other, WS)).not.toBe(workspaceAlias(KAT_SALT, WS));
    expect(workspaceAlias(KAT_SALT, WS)).toBe(workspaceAlias(Buffer.from(KAT_SALT), WS));
    expect(epochAlias(KAT_SALT, WS)).not.toBe(workspaceAlias(KAT_SALT, WS));
  });

  test("a 0.2 memo built from aliases never contains the workspace or epoch id", () => {
    const memo = aliasedEntry(KAT_SALT).memo;
    expect(memo).not.toContain(WS);
    expect(memo).not.toContain(WS.slice(3));
    expect(memo).not.toContain(EPOCH);
    expect(memo).not.toContain(EPOCH.slice(6));
    expect(memo).not.toContain("ws_");
  });
});

describe("alias salt file", () => {
  test("is created on first use beside the ledger as 32 hex-encoded bytes, mode 0600, then reused", () => {
    const ledgerPath = tempLedgerPath();
    const saltPath = anchorSaltPath(ledgerPath);
    expect(saltPath).toBe(`${ledgerPath}.salt`);
    expect(peekAnchorSalt(saltPath, emptyLedger())).toBeNull();
    expect(existsSync(saltPath)).toBe(false);

    const first = ensureAnchorSalt(saltPath, emptyLedger());
    expect(first.created).toBe(true);
    expect(first.salt).toHaveLength(32);
    expect(statSync(saltPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(saltPath, "utf8")).toBe(`${first.salt.toString("hex")}\n`);

    const second = ensureAnchorSalt(saltPath, emptyLedger());
    expect(second.created).toBe(false);
    expect(second.salt.equals(first.salt)).toBe(true);
    expect(readAnchorSalt(saltPath).equals(first.salt)).toBe(true);
  });

  test("first use never replaces a salt that already exists", () => {
    const ledgerPath = tempLedgerPath();
    mkdirSync(join(ledgerPath, ".."), { recursive: true });
    const saltPath = anchorSaltPath(ledgerPath);
    writeFileSync(saltPath, KAT_SALT.toString("hex"), { mode: 0o600 });
    const loaded = ensureAnchorSalt(saltPath, emptyLedger());
    expect(loaded.created).toBe(false);
    expect(loaded.salt.equals(KAT_SALT)).toBe(true);
    expect(readFileSync(saltPath, "utf8")).toBe(KAT_SALT.toString("hex"));
  });

  test("a lost salt fails closed when the ledger already records 0.2 aliases, and is not recreated", () => {
    const saltPath = anchorSaltPath(tempLedgerPath());
    const ledger = ledgerWith(aliasedEntry(KAT_SALT), aliasedEntry(KAT_SALT, { sequence: 8 }));
    expectSaltError(() => ensureAnchorSalt(saltPath, ledger), "missing", /records 2 agenttool\.collab-anchor\/0\.2 anchor\(s\).*cannot be re-derived/);
    expectSaltError(() => peekAnchorSalt(saltPath, ledger), "missing", /never created over existing aliases/);
    expectSaltError(() => requireAnchorSalt(saltPath, ledger.anchors), "missing", /cannot be re-derived/);
    expect(existsSync(saltPath)).toBe(false);
  });

  test("legacy entries alone do not depend on a salt, so first use may create one", () => {
    const saltPath = anchorSaltPath(tempLedgerPath());
    const legacy = newAnchorEntry({
      workspace_id: WS, epoch_id: EPOCH, sequence: 3, head_hash: HEAD, network: "zerone-testnet-1",
      caip2: "cosmos:zerone-testnet-1", account: "zrn1fixture",
      memo: buildLegacyAnchorMemo({ workspace_id: WS, epoch_id: EPOCH, sequence: 3, head_hash: HEAD }),
    });
    expect(ensureAnchorSalt(saltPath, ledgerWith(legacy)).created).toBe(true);
  });

  test("refuses a salt readable by others, a malformed salt, or a non-file", () => {
    const ledgerPath = tempLedgerPath();
    mkdirSync(join(ledgerPath, ".."), { recursive: true });
    const saltPath = anchorSaltPath(ledgerPath);
    writeFileSync(saltPath, `${KAT_SALT.toString("hex")}\n`, { mode: 0o600 });
    chmodSync(saltPath, 0o644);
    expectSaltError(() => readAnchorSalt(saltPath), "permissions", /chmod 600/);
    expectSaltError(() => ensureAnchorSalt(saltPath, emptyLedger()), "permissions");
    for (const body of ["", KAT_SALT.toString("hex").slice(2), KAT_SALT.toString("hex").toUpperCase(), `${KAT_SALT.toString("hex")}\n\n`]) {
      writeFileSync(saltPath, body, { mode: 0o600 });
      chmodSync(saltPath, 0o600);
      expectSaltError(() => readAnchorSalt(saltPath), "malformed");
      // A broken salt is never silently replaced on first use either.
      expectSaltError(() => ensureAnchorSalt(saltPath, emptyLedger()), "malformed");
    }
    const dirPath = anchorSaltPath(join(mkdtempSync(join(tmpdir(), "collab-zerone-alias-dir-")), "x.json"));
    mkdirSync(dirPath);
    expectSaltError(() => readAnchorSalt(dirPath), "malformed");
  });
});

describe("alias binding of recorded entries", () => {
  test("a consistent 0.2 entry is bound; legacy entries are not 0.2 entries", () => {
    expect(aliasBindingProblem(aliasedEntry(KAT_SALT), KAT_SALT)).toBeNull();
    const legacy = { ...aliasedEntry(KAT_SALT), memo_protocol: undefined };
    expect(aliasBindingProblem(legacy, KAT_SALT)).toContain("not an agenttool.collab-anchor/0.2 entry");
  });

  test("a missing or different salt, edited aliases, or an edited memo all fail", () => {
    const entry = aliasedEntry(KAT_SALT);
    expect(aliasBindingProblem(entry, null)).toContain("salt unavailable");
    expect(aliasBindingProblem(entry, Buffer.alloc(32, 9))).toContain("do not re-derive");
    expect(aliasBindingProblem({ ...entry, workspace_id: "ws_other" }, KAT_SALT)).toContain("do not re-derive");
    expect(aliasBindingProblem({ ...entry, epoch_id: "epoch_other" }, KAT_SALT)).toContain("do not re-derive");
    expect(aliasBindingProblem({ ...entry, workspace_alias: "0".repeat(32) }, KAT_SALT)).toContain("do not re-derive");
    expect(aliasBindingProblem({ ...entry, sequence: 8 }, KAT_SALT)).toContain("recorded memo");
    expect(aliasBindingProblem({ ...entry, head_hash: "ee".repeat(32) }, KAT_SALT)).toContain("recorded memo");
    expect(aliasBindingProblem({ ...entry, memo: `${entry.memo} ` }, KAT_SALT)).toContain("recorded memo");
  });

  test("assertSaltReproducesLedger accepts the original salt and refuses a replaced one", () => {
    const ledger = ledgerWith(aliasedEntry(KAT_SALT), aliasedEntry(KAT_SALT, { sequence: 9, memo: "edited" }));
    expectSaltError(() => assertSaltReproducesLedger("/fixture/anchors.json.salt", KAT_SALT, ledger), "mismatch", /1 agenttool\.collab-anchor\/0\.2 ledger entry/);
    const clean = ledgerWith(aliasedEntry(KAT_SALT));
    expect(() => assertSaltReproducesLedger("/fixture/anchors.json.salt", KAT_SALT, clean)).not.toThrow();
    expectSaltError(() => assertSaltReproducesLedger("/fixture/anchors.json.salt", Buffer.alloc(32, 1), clean), "mismatch", /replaced/);
  });
});
