/** The deletion ledger's recipe, without a database.
 *
 *  Pins: the agenttool-deletion-ledger/v1 canonical bytes (a golden vector
 *  shared with the real-PostgreSQL parity test), the MAC, row-id digests,
 *  salted HMACs for non-UUID keys, the field rules every writer and the
 *  mirror parser share, and that the writer refuses (and so aborts the
 *  erase) when the key is missing or a replay is running.
 *  Spec: docs/superpowers/specs/2026-10-12-deletion-scopes-design.md §13.2. */
import { describe, expect, test } from "bun:test";

import {
  DeletionLedgerUnavailableError,
  appendLedgerEntry,
  assertLedgerFields,
  canonicalPredicate,
  canonicalTimestamp,
  fixedLedgerKeyProvider,
  hashRowKey,
  ledgerEntryCanonicalBytes,
  ledgerEntryHash,
  ledgerEntryMac,
  prepareRowIds,
  rowIdsDigest,
  verifyLedgerEntryMac,
  type LedgerEntryFields,
} from "../src/services/deletion/ledger";

const KEY = "test-ledger-key-0123456789abcdef-not-for-production";
const GOLDEN: LedgerEntryFields = {
  seq: 7,
  entryId: "c0000000-0000-4000-8000-000000000007",
  occurredAt: "2026-10-12T16:20:01.000001Z",
  scope: "record",
  action: "purge_content",
  store: "inbox.messages",
  predicate: { b: "2", a: "1" },
  rowIdsSha256: rowIdsDigest(["d0000000-0000-4000-8000-000000000001"]),
  rowCount: 1,
  rowKeySalt: null,
  ruleId: null,
  ruleCutoff: null,
  subjectIdentityId: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  requestId: null,
  authorityMode: "legacy_bearer",
  authoritySequence: null,
  prevHash: "f".repeat(64),
};

describe("canonical bytes", () => {
  test("the golden vector (also checked against SQL in tests/integration/deletion-ledger-postgres.test.ts)", () => {
    expect(GOLDEN.rowIdsSha256).toBe("9a114cf85d2d1f2e797a759ee9411b470f6c87973a4d8a71ad9af64225a5e1ab");
    expect(ledgerEntryHash(GOLDEN)).toBe("87133dca1af2ca566792dff352717c9cc8314c80e602c6da647207e8319d7b60");
    expect(ledgerEntryMac(ledgerEntryHash(GOLDEN), KEY))
      .toBe("18553eff80c9af562fbed2f14970ddecf75959790871297130fd228550cb3d43");
  });

  test("recipe 1: domain tag, NUL-separated fields, NULL as the empty string, no trailing separator", () => {
    const fields = ledgerEntryCanonicalBytes(GOLDEN).toString("utf8").split("\u0000");
    expect(fields).toEqual([
      "agenttool-deletion-ledger/v1", "7", GOLDEN.entryId, "2026-10-12T16:20:01.000001Z", "record", "purge_content",
      "inbox.messages", '{"a":"1","b":"2"}', GOLDEN.rowIdsSha256, "1", "", "", "", GOLDEN.subjectIdentityId!,
      GOLDEN.projectId!, "", "legacy_bearer", "", "f".repeat(64),
    ]);
  });

  test("every covered field changes the hash", () => {
    const base = ledgerEntryHash(GOLDEN);
    const variants: Array<Partial<LedgerEntryFields>> = [
      { seq: 8 }, { occurredAt: "2026-10-12T16:20:01.000002Z" }, { action: "delete" }, { store: "memory.memories" },
      { predicate: { a: "1" } }, { rowCount: 2 }, { authorityMode: "agent_root" }, { authoritySequence: 1 },
      { projectId: null }, { prevHash: "e".repeat(64) },
    ];
    for (const variant of variants) expect(ledgerEntryHash({ ...GOLDEN, ...variant })).not.toBe(base);
  });

  test("timestamps and predicates have one spelling", () => {
    expect(canonicalTimestamp(new Date("2026-10-12T16:20:01.123Z"))).toBe("2026-10-12T16:20:01.123000Z");
    expect(() => canonicalTimestamp("2026-10-12T16:20:01.123Z")).toThrow();
    expect(canonicalPredicate({ z: "1", a: 'q"\\' })).toBe('{"a":"q\\"\\\\","z":"1"}');
    expect(canonicalPredicate(null)).toBe("");
    expect(() => canonicalPredicate({ Upper: "x" })).toThrow();
    expect(() => canonicalPredicate({ a: 1 as unknown as string })).toThrow();
  });
});

describe("row ids and MAC", () => {
  test("digests sort bytewise and join with NUL", () => {
    expect(rowIdsDigest(["b", "a"])).toBe(rowIdsDigest(["a", "b"]));
    expect(rowIdsDigest([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("UUID keys stay; any other key is stored only as a salted HMAC", () => {
    expect(prepareRowIds(["A0000000-0000-4000-8000-000000000001"])).toEqual({
      rowIds: ["a0000000-0000-4000-8000-000000000001"], rowKeySalt: null,
    });
    const prepared = prepareRowIds(["summarise-50-papers-v1", "a0000000-0000-4000-8000-000000000001"]);
    expect(prepared.rowKeySalt).toMatch(/^[0-9a-f]{32}$/);
    expect(prepared.rowIds).toContain(hashRowKey(prepared.rowKeySalt!, "summarise-50-papers-v1"));
    expect(JSON.stringify(prepared)).not.toContain("summarise");
  });

  test("the MAC verifies only under the right key", () => {
    const hash = ledgerEntryHash(GOLDEN);
    const mac = ledgerEntryMac(hash, KEY);
    expect(verifyLedgerEntryMac(hash, mac, KEY)).toBe(true);
    expect(verifyLedgerEntryMac(hash, mac, `${KEY}x`)).toBe(false);
    expect(verifyLedgerEntryMac(hash, "0".repeat(64), KEY)).toBe(false);
  });

  test("field rules: rule entries and money stores carry no row ids; lifecycle uses its store", () => {
    expect(() => assertLedgerFields(GOLDEN, ["d0000000-0000-4000-8000-000000000001"])).not.toThrow();
    expect(() => assertLedgerFields({ ...GOLDEN, store: "economy.wallets" }, ["d0000000-0000-4000-8000-000000000001"])).toThrow();
    expect(() => assertLedgerFields({ ...GOLDEN, scope: "retention", ruleId: "r", ruleCutoff: GOLDEN.occurredAt },
      ["d0000000-0000-4000-8000-000000000001"])).toThrow();
    expect(() => assertLedgerFields({ ...GOLDEN, action: "void" }, [])).toThrow();
    expect(() => assertLedgerFields({ ...GOLDEN, seq: 1 }, [])).toThrow(/prev_hash/);
    expect(() => assertLedgerFields(GOLDEN, ["not-a-key"])).toThrow();
  });
});

describe("the writer refuses rather than erase unrecorded", () => {
  function executor(replayRequired: boolean) {
    const statements: string[] = [];
    return {
      statements,
      async execute(query: { queryChunks?: unknown[] }) {
        const text = JSON.stringify(query);
        statements.push(text);
        if (text.includes("replay_required FROM deletion.settings")) return [{ replay_required: replayRequired }];
        if (text.includes("clock_timestamp()")) return [{ occurred_at: "2026-10-12T16:20:01.000001Z", entry_id: GOLDEN.entryId }];
        return [];
      },
    };
  }

  test("a replay in progress refuses before anything is written", async () => {
    const tx = executor(true);
    const append = appendLedgerEntry(tx as never, {
      scope: "record", action: "purge_content", store: "inbox.messages",
      rowKeys: ["d0000000-0000-4000-8000-000000000001"], authorityMode: "legacy_bearer",
    }, { keyProvider: fixedLedgerKeyProvider(KEY) });
    await expect(append).rejects.toBeInstanceOf(DeletionLedgerUnavailableError);
    await expect(append).rejects.toMatchObject({ status: 503, reason: "deletion_ledger_replay_required" });
    expect(tx.statements.some((text) => text.includes("INSERT INTO deletion.ledger"))).toBe(false);
  });

  test("a missing key refuses before the insert", async () => {
    const tx = executor(false);
    const append = appendLedgerEntry(tx as never, {
      scope: "record", action: "purge_content", store: "inbox.messages",
      rowKeys: ["d0000000-0000-4000-8000-000000000001"], authorityMode: "legacy_bearer",
    }, { keyProvider: async () => { throw new Error("deletion_ledger_key_unavailable"); } });
    await expect(append).rejects.toMatchObject({ status: 503, reason: "deletion_ledger_key_unavailable" });
    expect(tx.statements.some((text) => text.includes("INSERT INTO deletion.ledger"))).toBe(false);
  });

  test("the guided body says nothing was deleted", () => {
    const error = new DeletionLedgerUnavailableError("deletion_ledger_key_unavailable");
    expect(error.status).toBe(503);
    expect((error.cause as { error: string; message: string }).error).toBe("deletion_ledger_unavailable");
    expect((error.cause as { message: string }).message).toMatch(/^Nothing was deleted/);
  });
});
