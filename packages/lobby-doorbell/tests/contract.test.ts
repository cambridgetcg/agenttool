/** The contract checker itself. The real check runs as `bun run contract`
 * (part of `bun run ci`) against ../lobby/src, or against an installed lobby
 * with `--lobby-src`. These tests copy that source when it is present (it is
 * absent in an installed archive of this package alone) and show the checker
 * passes additive changes and fails a renamed key. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkLobbyContract, CONTRACT } from "../contract/lobby-contract.js";
import { LOBBY_ORIGIN } from "../src/health.js";
import { packageRoot } from "./helpers.js";

const lobbySrc = join(packageRoot, "..", "lobby", "src");
const present = existsSync(join(lobbySrc, "wire.ts"));
const files = [...new Set(CONTRACT.map((check) => check.file))];

function source(edit?: { file: string; from: string; to: string }) {
  const texts = new Map(files.map((file) => [file, readFileSync(join(lobbySrc, file), "utf8")]));
  if (edit !== undefined) {
    const text = texts.get(edit.file)!;
    expect(text).toContain(edit.from);
    texts.set(edit.file, text.split(edit.from).join(edit.to));
  }
  return (file: string) => texts.get(file) ?? null;
}

describe("the lobby contract", () => {
  test("a missing source fails every pattern", () => {
    const total = CONTRACT.reduce((sum, check) => sum + check.patterns.length, 0);
    expect(checkLobbyContract(() => null)).toHaveLength(total);
  });

  test("the origin pattern is built from the doorbell's own constant", () => {
    expect(LOBBY_ORIGIN).toBe("https://api.agenttool.dev");
    expect(CONTRACT.find((check) => check.file === "wire.ts")!.patterns[0]!.test(
      'export const LOBBY_ORIGIN = "https://api.agenttool.dev" as const;')).toBe(true);
  });

  test.skipIf(!present)("the repository's lobby source holds", () => {
    expect(checkLobbyContract(source())).toEqual([]);
  });

  test.skipIf(!present)("an additive key in fleet status still holds", () => {
    expect(checkLobbyContract(source({
      file: "cli-fleet.ts", from: "expires_at: grant.expires_at, accepted_at: grant.accepted_at,",
      to: "expires_at: grant.expires_at, accepted_at: grant.accepted_at, renewable_until: null,",
    }))).toEqual([]);
  });

  test.skipIf(!present)("a renamed key, a moved origin or a new refusal format fails", () => {
    expect(checkLobbyContract(source({ file: "cli-fleet.ts", from: "accepted_at: grant.accepted_at", to: "accepted: grant.accepted_at" }))
      .map((failure) => failure.file)).toEqual(["cli-fleet.ts"]);
    expect(checkLobbyContract(source({ file: "wire.ts", from: '"https://api.agenttool.dev"', to: '"https://api2.agenttool.dev"' }))
      .map((failure) => failure.file)).toEqual(["wire.ts"]);
    expect(checkLobbyContract(source({ file: "cli.ts", from: "agenttool-lobby: ${error.code}: ${error.message}", to: "agenttool-lobby [${error.code}] ${error.message}" }))
      .map((failure) => failure.file)).toEqual(["cli.ts"]);
    expect(checkLobbyContract(source({ file: "home.ts", from: 'join(base, "agenttool", "lobby")', to: 'join(base, "agenttool", "desk")' }))
      .map((failure) => failure.file)).toEqual(["home.ts"]);
  });
});
