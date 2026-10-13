/** Every kind of ledger entry a writer can emit has a replay applier.
 *
 *  Source scan (deletion spec §18, "the replay applier registry covers
 *  every (store, action) the writers can emit"): API writers name a kind in
 *  recordErasure({ kind }) and operator writers in LEDGER_KINDS[...]; pg_cron
 *  rules call deletion.append_ledger_entry(...) with literal scope, action,
 *  store and rule in the wave 2 migrations. Each must be a listed kind, and
 *  each listed kind must have exactly one applier. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { APPLIERS, applierFor } from "../src/services/deletion/appliers";
import { LEDGER_KINDS, kindApplierKey, type LedgerKind } from "../src/services/deletion/kinds";

const API_ROOT = join(import.meta.dir, "..");

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const kinds = Object.entries(LEDGER_KINDS) as Array<[string, LedgerKind]>;

describe("replay applier registry", () => {
  test("every listed kind has an applier, and every applier serves a listed kind", () => {
    for (const [name, kind] of kinds) {
      expect(applierFor({ store: kind.store, action: kind.action, ruleId: kind.rule ?? null }), name).not.toBeNull();
    }
    const kindKeys = new Set(kinds.map(([, kind]) => kindApplierKey(kind)));
    for (const key of Object.keys(APPLIERS)) expect(kindKeys.has(key), key).toBe(true);
  });

  test("API code names only listed kinds when it records an erasure", () => {
    const used = new Set<string>();
    for (const path of sources(join(API_ROOT, "src"))) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/recordErasure\([^,]+,\s*\{\s*kind:\s*"([a-z_.]+)"/g)) used.add(match[1]!);
      for (const match of text.matchAll(/LEDGER_KINDS\["([a-z_.]+)"\]/g)) used.add(match[1]!);
      for (const match of text.matchAll(/\{ kind: "(backfill\.[a-z_]+)"/g)) used.add(match[1]!);
      // Gesture withdrawals name their kind in withdrawals.ts WITHDRAWABLE.
      for (const match of text.matchAll(/\{ kind: "([a-z_]+\.withdraw)"/g)) used.add(match[1]!);
    }
    for (const name of [
      "inbox.purge", "vault.purge", "identity_backup.purge", "memory.delete", "memory.erase_in_place",
      "blessing.withdraw", "unconditional.withdraw", "guild_recognition.withdraw", "margin.withdraw",
      "attestation.withdraw", "trust.withdraw", "trace.delete", "org.delete", "org_member.delete",
    ]) {
      expect(used.has(name), name).toBe(true);
    }
    for (const name of used) expect(Object.keys(LEDGER_KINDS), name).toContain(name);
  });

  test("every pg_cron append in the migrations is a listed pg_cron kind", () => {
    const migrations = readdirSync(join(API_ROOT, "migrations")).filter((name) => name.endsWith(".sql"));
    const calls: Array<{ scope: string; action: string; store: string; rule: string }> = [];
    for (const name of migrations) {
      const text = readFileSync(join(API_ROOT, "migrations", name), "utf8");
      const pattern = /PERFORM deletion\.append_ledger_entry\(\s*'([a-z]+)',\s*'([a-z_]+)',\s*'([a-z_.]+)',[\s\S]*?'([a-z0-9_]+)',\s*v_cutoff/g;
      for (const match of text.matchAll(pattern)) {
        calls.push({ scope: match[1]!, action: match[2]!, store: match[3]!, rule: match[4]! });
      }
    }
    expect(calls.length).toBe(4);
    for (const call of calls) {
      const kind = kinds.find(([, candidate]) => candidate.writer === "pg_cron" && candidate.scope === call.scope
        && candidate.action === call.action && candidate.store === call.store && candidate.rule === call.rule);
      expect(kind, JSON.stringify(call)).toBeDefined();
    }
    expect(kinds.filter(([, kind]) => kind.writer === "pg_cron")).toHaveLength(calls.length);
  });
});
