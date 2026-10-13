/** The wave 2 deletion migrations agree with the TypeScript that writes and
 *  replays their rows, and their published rule windows are pinned.
 *
 *  The real-PostgreSQL proofs of these files (integration/deletion-*-
 *  postgres.test.ts) are opt-in and no CI job runs them yet, so this source
 *  pin is what the ordinary test tier catches: a CHECK list drifting from
 *  the writer's list (for example 'withdraw' dropped from the action CHECK),
 *  a rule cutoff edited away from its published window (24 hours, 30 days,
 *  15 days), the expired-memory rule losing its working-type filter, or the
 *  compaction function losing its hard 15-day guard.
 *
 *  Doctrine: docs/DELETION-REPLAY.md · docs/RETENTION.md. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  AUTHORITY_MODES,
  LEDGER_ACTIONS,
  LEDGER_SCOPES,
  MONEY_STORES,
} from "../src/services/deletion/ledger";

const read = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const LEDGER = read("20261012T161958_deletion_ledger.sql");
const RULES = read("20261012T161958_retention_rules.sql");

/** The quoted words of the first `<column> ... CHECK (<column> IN (...))`. */
function checkList(sql: string, column: string): string[] {
  const match = new RegExp(`\\n\\s*${column}\\s+TEXT NOT NULL CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(sql);
  if (!match) throw new Error(`no CHECK list for ${column}`);
  return [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((word) => word[1]!);
}

/** The body of one CREATE OR REPLACE FUNCTION, up to its closing $$. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(open + 2, close);
}

describe("deletion.ledger CHECK lists match the writer", () => {
  test("scope, action and authority_mode", () => {
    expect(checkList(LEDGER, "scope").sort()).toEqual([...LEDGER_SCOPES].sort());
    expect(checkList(LEDGER, "action").sort()).toEqual([...LEDGER_ACTIONS].sort());
    expect(checkList(LEDGER, "authority_mode").sort()).toEqual([...AUTHORITY_MODES].sort());
  });

  test("deletion.is_money_store names exactly MONEY_STORES", () => {
    const body = functionBody(LEDGER, "deletion.is_money_store");
    const stores = [...body.matchAll(/'([a-z0-9_]+\.[a-z0-9_]+)'/g)].map((word) => word[1]!);
    expect(stores.sort()).toEqual([...MONEY_STORES].sort());
  });
});

describe("retention rules keep their published windows", () => {
  test("expired working memory: 24 hours after expiry, working memories only, both branches", () => {
    expect(functionBody(RULES, "deletion.run_expired_working_memory_rule"))
      .toContain("v_cutoff  TIMESTAMPTZ := now() - interval '24 hours';");
    const apply = functionBody(RULES, "deletion.apply_expired_working_memory");
    const working = apply.match(/WHERE m\.type = 'working' AND m\.expires_at < p_cutoff AND m\.content_purged_at IS NULL/g) ?? [];
    expect(working).toHaveLength(2);
  });

  test("vault audit addresses: 30 days", () => {
    expect(functionBody(RULES, "deletion.run_vault_audit_ip_rule"))
      .toContain("v_cutoff  TIMESTAMPTZ := now() - interval '30 days';");
    expect(functionBody(RULES, "deletion.apply_vault_audit_ip_rule")).toContain("WHERE created_at < p_cutoff AND ip_address IS NOT NULL");
  });

  test("ledger compaction: 15 days, with a hard guard whatever cutoff replay passes", () => {
    expect(functionBody(RULES, "deletion.run_ledger_compaction_rule"))
      .toContain("v_cutoff    TIMESTAMPTZ := now() - interval '15 days';");
    const apply = functionBody(RULES, "deletion.apply_ledger_compaction");
    expect(apply).toContain("AND occurred_at < p_cutoff");
    expect(apply).toContain("AND occurred_at < now() - interval '15 days'");
  });

  test("every rule refuses while a restore is replayed", () => {
    for (const name of ["deletion.run_expired_working_memory_rule", "deletion.run_vault_audit_ip_rule", "deletion.run_ledger_compaction_rule"]) {
      expect({ name, guarded: functionBody(RULES, name).includes("PERFORM deletion.assert_rules_may_run();") })
        .toEqual({ name, guarded: true });
    }
  });
});
