import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkEgress, EGRESS_REASONS, MAX_EGRESS_CHARS, type EgressRoom } from "../src/egress.js";
import * as lobby from "../src/index.js";

interface EgressCase {
  name: string;
  text: string;
  room: EgressRoom | null;
  reasons?: string[];
}

const fixtures = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "egress-cases.json"), "utf8")) as {
  refused: EgressCase[];
  allowed: EgressCase[];
};

describe("egress gate fixtures", () => {
  for (const fixture of fixtures.refused) {
    test(`refuses: ${fixture.name}`, () => {
      const result = checkEgress(fixture.text, { room: fixture.room as EgressRoom });
      expect(result.ok).toBe(false);
      expect(result.reasons).toEqual(fixture.reasons as never);
    });
  }

  for (const fixture of fixtures.allowed) {
    test(`allows: ${fixture.name}`, () => {
      expect(checkEgress(fixture.text, { room: fixture.room as EgressRoom })).toEqual({ ok: true, reasons: [] });
    });
  }

  test("covers every content and room refusal reason", () => {
    const covered = new Set(fixtures.refused.flatMap((fixture) => fixture.reasons ?? []));
    for (const reason of EGRESS_REASONS) {
      if (reason === "text_not_string" || reason === "text_too_large") continue;
      expect(covered.has(reason)).toBe(true);
    }
  });
});

describe("egress gate behaviour", () => {
  test("a device room can never send anything, and content reasons still report", () => {
    for (const fixture of fixtures.allowed) {
      expect(checkEgress(fixture.text, { room: { residency: "device" } }).reasons).toEqual(["room_residency_device"]);
    }
    expect(checkEgress("connect to 10.0.0.1", { room: { residency: "device" } }).reasons)
      .toEqual(["room_residency_device", "private_ipv4"]);
  });

  test("reports every reason once in a fixed order and never echoes the text", () => {
    const text = "Betfair at 192.168.0.10 in /Users/example and ws_0000000000000000deadbeef";
    const result = checkEgress(text, { room: { residency: "fleet" } });
    expect(result.reasons).toEqual(["device_only_term", "private_ipv4", "home_path", "collab_workspace_id"]);
    expect(JSON.stringify(result)).not.toContain("192.168");
    expect(JSON.stringify(result)).not.toContain("example");
  });

  test("refuses non-string and oversized text", () => {
    expect(checkEgress(42 as unknown as string, { room: { residency: "fleet" } }).reasons).toEqual(["text_not_string"]);
    expect(checkEgress("a".repeat(MAX_EGRESS_CHARS + 1), { room: { residency: "fleet" } }).reasons)
      .toEqual(["text_too_large"]);
    expect(checkEgress("a".repeat(MAX_EGRESS_CHARS), { room: { residency: "fleet" } }).ok).toBe(true);
  });

  test("fails closed without options", () => {
    expect(checkEgress("hello", undefined as never).reasons).toEqual(["room_context_missing"]);
  });

  test("stays fast on adversarial dotted input", () => {
    const started = performance.now();
    checkEgress("a.".repeat(30_000), { room: { residency: "fleet" } });
    checkEgress("1.".repeat(30_000), { room: { residency: "fleet" } });
    checkEgress(`${"9".repeat(500)}.`.repeat(120), { room: { residency: "fleet" } });
    checkEgress("a1.".repeat(20_000), { room: { residency: "fleet" } });
    checkEgress(`bet${" ".repeat(60_000)}`, { room: { residency: "fleet" } });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("is exported from the package entry and alone from the egress subpath", async () => {
    expect(lobby.checkEgress).toBe(checkEgress);
    const subpath = await import("@agenttool/lobby/egress");
    expect(subpath.checkEgress).toBe(checkEgress);
  });

  test("ignores every default-ignorable and format character when matching", () => {
    // Each renders as nothing, so "Bet<x>fair" displays as the device-only term.
    for (const invisible of ["\u00ad", "\u034f", "\u115f", "\u17b4", "\u180e", "\u200b", "\u200c", "\u200d", "\u2060",
      "\u2064", "\u3164", "\ufe00", "\ufe0f", "\ufeff", "\uffa0", "\ufff9", "\u{1d173}", "\u{e0001}", "\u{e0020}",
      "\u{e007f}", "\u{e0100}"]) {
      expect(checkEgress(`Bet${invisible}fair`, { room: { residency: "fleet" } }).reasons).toEqual(["device_only_term"]);
      expect(checkEgress(`10.${invisible}0.0.7`, { room: { residency: "fleet" } }).reasons).toEqual(["private_ipv4"]);
    }
  });
});
