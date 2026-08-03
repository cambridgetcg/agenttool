import { describe, expect, test } from "bun:test";
import { ANCHOR_MEMO_PROTOCOL } from "../src/constants.js";
import { buildAnchorMemo, parseAnchorMemo } from "../src/memo.js";

const HEAD = "ab".repeat(32);
const FIXTURE = {
  workspace_id: "ws_470c71f46567100cce53594a",
  epoch_id: "epoch_777690dd-ef5d-44d6-9a66-3ba7c7de2e12",
  sequence: 42,
  head_hash: HEAD,
};

describe("anchor memo", () => {
  test("round-trips build → parse", () => {
    const memo = buildAnchorMemo(FIXTURE);
    expect(memo.startsWith(`${ANCHOR_MEMO_PROTOCOL} ws=`)).toBe(true);
    expect(memo.length).toBeLessThanOrEqual(256);
    expect(parseAnchorMemo(memo)).toEqual(FIXTURE);
  });

  test("never begins with did:zrn: (chain ante would DID-validate it)", () => {
    expect(buildAnchorMemo(FIXTURE).startsWith("did:zrn:")).toBe(false);
  });

  test("rejects malformed inputs at build time", () => {
    expect(() => buildAnchorMemo({ ...FIXTURE, head_hash: HEAD.toUpperCase() })).toThrow();
    expect(() => buildAnchorMemo({ ...FIXTURE, head_hash: "ab" })).toThrow();
    expect(() => buildAnchorMemo({ ...FIXTURE, sequence: 0 })).toThrow();
    expect(() => buildAnchorMemo({ ...FIXTURE, sequence: 1.5 })).toThrow();
    expect(() => buildAnchorMemo({ ...FIXTURE, workspace_id: "has space" })).toThrow();
    expect(() => buildAnchorMemo({ ...FIXTURE, epoch_id: "" })).toThrow();
  });

  test("rejects memos that would exceed the 256-char chain cap", () => {
    expect(() => buildAnchorMemo({ ...FIXTURE, workspace_id: "w".repeat(200), epoch_id: "e".repeat(200) }))
      .toThrow(/256/);
  });

  test("parse is strict about shape", () => {
    const memo = buildAnchorMemo(FIXTURE);
    expect(parseAnchorMemo(`${memo} `)).toBeNull();
    expect(parseAnchorMemo(` ${memo}`)).toBeNull();
    expect(parseAnchorMemo(memo.replace("seq=42", "seq=042"))).toBeNull();
    expect(parseAnchorMemo(memo.replace(HEAD, HEAD.slice(0, 63)))).toBeNull();
    expect(parseAnchorMemo(memo.replace(HEAD, `${HEAD.slice(0, 63)}G`))).toBeNull();
    expect(parseAnchorMemo(memo.replace(ANCHOR_MEMO_PROTOCOL, "agenttool.collab-anchor/0.2"))).toBeNull();
    expect(parseAnchorMemo("")).toBeNull();
    expect(parseAnchorMemo("hello world")).toBeNull();
  });
});
