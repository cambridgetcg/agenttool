import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import * as wallet from "../src/index.js";

const ROOT = join(import.meta.dir, "..");

describe("public custody boundary", () => {
  test("exports no key-egress or combined sign-and-send convenience", () => {
    const exported = Object.keys(wallet);
    for (const forbidden of [
      /private.?key/iu,
      /mnemonic/iu,
      /seed.?phrase/iu,
      /export.?key/iu,
      /sign.?and.?send/iu,
      /send.?transaction/iu,
    ]) {
      expect(exported.filter((name) => forbidden.test(name))).toEqual([]);
    }
  });

  test("keeps secret-bearing fields out of every public record schema", async () => {
    const schema = await readFile(
      join(ROOT, "schema", "agent-wallet-v0.1.schema.json"),
      "utf8",
    );
    for (const forbidden of [
      "private_key",
      "secret_key",
      "seed_phrase",
      "mnemonic",
      "recovery_share",
    ]) {
      expect(schema).not.toContain(`\"${forbidden}\"`);
    }
  });

  test("does not reach into AgentTool custody, vault, RPC, or marketplace code", async () => {
    const sourceDirectory = join(ROOT, "src");
    const sourceNames = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
    const source = (await Promise.all(
      sourceNames.map((name) => readFile(join(sourceDirectory, name), "utf8")),
    )).join("\n");

    expect(source).not.toMatch(/api\/src\/services\/(?:identity|vault|marketplace)/u);
    expect(source).not.toMatch(/(?:^|["'])https?:\/\//mu);
    expect(source).not.toContain("AGENTTOOL_API_KEY");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("RPC_URL");
  });
});
