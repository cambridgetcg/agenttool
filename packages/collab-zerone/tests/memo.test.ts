import { describe, expect, test } from "bun:test";
import { ANCHOR_MEMO_PROTOCOL, LEGACY_ANCHOR_MEMO_PROTOCOL, MAX_MEMO_CHARS } from "../src/constants.js";
import {
  buildAliasedAnchorMemo,
  buildAnchorMemo,
  buildLegacyAnchorMemo,
  parseAliasedAnchorMemo,
  parseAnchorMemo,
  parseLegacyAnchorMemo,
} from "../src/memo.js";

const HEAD = "ab".repeat(32);
const LEGACY = {
  workspace_id: "ws_470c71f46567100cce53594a",
  epoch_id: "epoch_777690dd-ef5d-44d6-9a66-3ba7c7de2e12",
  sequence: 42,
  head_hash: HEAD,
};
const ALIASED = {
  workspace_alias: "85eff4eb56be703955a836fef1f6cf50",
  epoch_alias: "7dcb76f93c245fcbf7d6e60c2d634a42",
  sequence: 42,
  head_hash: HEAD,
};

describe("legacy agenttool.collab-anchor/0.1 memo", () => {
  test("round-trips build → parse and is labelled 0.1", () => {
    const memo = buildLegacyAnchorMemo(LEGACY);
    expect(memo.startsWith(`${LEGACY_ANCHOR_MEMO_PROTOCOL} ws=`)).toBe(true);
    expect(memo.length).toBeLessThanOrEqual(MAX_MEMO_CHARS);
    expect(parseLegacyAnchorMemo(memo)).toEqual(LEGACY);
    expect(parseAnchorMemo(memo)).toEqual({ protocol: LEGACY_ANCHOR_MEMO_PROTOCOL, ...LEGACY });
  });

  test("the deprecated buildAnchorMemo name still builds exactly the legacy bytes", () => {
    expect(buildAnchorMemo(LEGACY)).toBe(buildLegacyAnchorMemo(LEGACY));
    expect(buildAnchorMemo(LEGACY)).toBe(
      `agenttool.collab-anchor/0.1 ws=${LEGACY.workspace_id} epoch=${LEGACY.epoch_id} seq=42 head=${HEAD}`,
    );
  });

  test("never begins with did:zrn: (chain ante would DID-validate it)", () => {
    expect(buildLegacyAnchorMemo(LEGACY).startsWith("did:zrn:")).toBe(false);
  });

  test("rejects malformed inputs at build time", () => {
    expect(() => buildLegacyAnchorMemo({ ...LEGACY, head_hash: HEAD.toUpperCase() })).toThrow();
    expect(() => buildLegacyAnchorMemo({ ...LEGACY, head_hash: "ab" })).toThrow();
    expect(() => buildLegacyAnchorMemo({ ...LEGACY, sequence: 0 })).toThrow();
    expect(() => buildLegacyAnchorMemo({ ...LEGACY, sequence: 1.5 })).toThrow();
    expect(() => buildLegacyAnchorMemo({ ...LEGACY, workspace_id: "has space" })).toThrow();
    expect(() => buildLegacyAnchorMemo({ ...LEGACY, epoch_id: "" })).toThrow();
  });

  test("rejects memos that would exceed the 256-char chain cap", () => {
    expect(() => buildLegacyAnchorMemo({ ...LEGACY, workspace_id: "w".repeat(200), epoch_id: "e".repeat(200) }))
      .toThrow(/256/);
  });

  test("parse is strict about shape", () => {
    const memo = buildLegacyAnchorMemo(LEGACY);
    expect(parseLegacyAnchorMemo(`${memo} `)).toBeNull();
    expect(parseLegacyAnchorMemo(` ${memo}`)).toBeNull();
    expect(parseLegacyAnchorMemo(memo.replace("seq=42", "seq=042"))).toBeNull();
    expect(parseLegacyAnchorMemo(memo.replace(HEAD, HEAD.slice(0, 63)))).toBeNull();
    expect(parseLegacyAnchorMemo(memo.replace(HEAD, `${HEAD.slice(0, 63)}G`))).toBeNull();
    // A 0.1 body under the 0.2 prefix is neither protocol.
    expect(parseAnchorMemo(memo.replace(LEGACY_ANCHOR_MEMO_PROTOCOL, ANCHOR_MEMO_PROTOCOL))).toBeNull();
    expect(parseLegacyAnchorMemo("")).toBeNull();
    expect(parseLegacyAnchorMemo("hello world")).toBeNull();
  });
});

describe("agenttool.collab-anchor/0.2 memo (salted aliases)", () => {
  test("has the exact documented shape and round-trips, labelled 0.2", () => {
    const memo = buildAliasedAnchorMemo(ALIASED);
    expect(memo).toBe(
      `agenttool.collab-anchor/0.2 alias=${ALIASED.workspace_alias} epoch=${ALIASED.epoch_alias} seq=42 head=${HEAD}`,
    );
    expect(parseAliasedAnchorMemo(memo)).toEqual(ALIASED);
    expect(parseAnchorMemo(memo)).toEqual({ protocol: ANCHOR_MEMO_PROTOCOL, ...ALIASED });
    expect(parseLegacyAnchorMemo(memo)).toBeNull();
    expect(memo.startsWith("did:zrn:")).toBe(false);
  });

  test("the longest possible memo stays well inside the 256-char chain cap", () => {
    const memo = buildAliasedAnchorMemo({ ...ALIASED, sequence: Number.MAX_SAFE_INTEGER });
    expect(memo.length).toBe(196);
    expect(memo.length).toBeLessThanOrEqual(MAX_MEMO_CHARS);
    expect(parseAnchorMemo(memo)?.sequence).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("refuses anything but 32 lowercase hex aliases, so a raw id can never be published", () => {
    for (const bad of [
      LEGACY.workspace_id,
      ALIASED.workspace_alias.toUpperCase(),
      ALIASED.workspace_alias.slice(0, 31),
      `${ALIASED.workspace_alias}0`,
      `${ALIASED.workspace_alias.slice(0, 31)}g`,
      "",
    ]) {
      expect(() => buildAliasedAnchorMemo({ ...ALIASED, workspace_alias: bad })).toThrow(/workspace_alias/);
      expect(() => buildAliasedAnchorMemo({ ...ALIASED, epoch_alias: bad })).toThrow(/epoch_alias/);
    }
    expect(() => buildAliasedAnchorMemo({ ...ALIASED, epoch_alias: LEGACY.epoch_id })).toThrow(/epoch_alias/);
    expect(() => buildAliasedAnchorMemo({ ...ALIASED, sequence: 0 })).toThrow();
    expect(() => buildAliasedAnchorMemo({ ...ALIASED, head_hash: HEAD.slice(1) })).toThrow();
  });

  test("parse is strict about shape", () => {
    const memo = buildAliasedAnchorMemo(ALIASED);
    expect(parseAnchorMemo(`${memo} `)).toBeNull();
    expect(parseAnchorMemo(` ${memo}`)).toBeNull();
    expect(parseAnchorMemo(`${memo}\n`)).toBeNull();
    expect(parseAnchorMemo(memo.replace("seq=42", "seq=042"))).toBeNull();
    expect(parseAnchorMemo(memo.replace(ALIASED.workspace_alias, ALIASED.workspace_alias.toUpperCase()))).toBeNull();
    expect(parseAnchorMemo(memo.replace(ALIASED.epoch_alias, LEGACY.epoch_id))).toBeNull();
    expect(parseAnchorMemo(memo.replace(`alias=${ALIASED.workspace_alias}`, `ws=${LEGACY.workspace_id}`))).toBeNull();
    // A 0.2 body under the legacy prefix, or an unknown future version, is rejected.
    expect(parseAnchorMemo(memo.replace(ANCHOR_MEMO_PROTOCOL, LEGACY_ANCHOR_MEMO_PROTOCOL))).toBeNull();
    expect(parseAnchorMemo(memo.replace(ANCHOR_MEMO_PROTOCOL, "agenttool.collab-anchor/0.3"))).toBeNull();
  });
});
