/** Ledger conservation — every wallet mutation must leave a journal leg.
 *
 *  Doctrine: docs/BUSINESS-MODEL.md · docs/PAYOUT-BROADCAST-PLAN.md ·
 *  `api/src/services/economy/earned.ts` (the drawable wall).
 *
 *  The invariant this file defends, stated once:
 *
 *      economy.wallets.balance == SUM(economy.transactions.amount)
 *                                 for that wallet, always.
 *
 *  There is no `CHECK` for it, no reconciler, and — until 2026-07-24 — no
 *  test. `economy.transactions` is single-entry (one signed-amount row per
 *  wallet, no contra leg, no balancing constraint), and `wallets.balance`
 *  is mutated from a dozen files with no shared primitive. That is fine
 *  right up until two readers disagree, and two readers DO disagree: the
 *  payout gate computes what a wallet may withdraw from the JOURNAL (via
 *  `earned.ts`), while the debit that pays it out reads the BALANCE. A
 *  write that moves one and not the other silently moves the two apart,
 *  and the direction is not neutral — a refund that credits balance
 *  without a leg permanently shrinks what the wallet can ever draw.
 *
 *  ── What this test can and cannot see ────────────────────────────────
 *
 *  This is a STATIC, file-level check: a file that mutates `wallets.balance`
 *  must also insert into `transactions`. It catches a whole file with no
 *  journal at all. It does NOT catch a single leg-less path inside a file
 *  that journals elsewhere — `services/economy/crypto/index.ts` credits a
 *  deposit with no leg while journaling other paths, and passes here.
 *  Runtime reconciliation is the only thing that catches that class; run
 *  `bin/reconcile-wallets.ts` against a real database for it. Saying so
 *  out loud is the point: a green run here means "no file is entirely
 *  unjournalled", not "the books balance".
 *
 *  Accepted exceptions live in `ledger-conservation.exceptions.json` and
 *  may only SHRINK, same ratchet as the canon↔code manifest. */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "src");
const REPO_ROOT = join(__dirname, "..", "..", "..");

const EXCEPTIONS = JSON.parse(
  readFileSync(join(__dirname, "ledger-conservation.exceptions.json"), "utf8"),
) as { unjournalled_balance_writers: Array<{ file: string; why: string }> };

const acceptedFiles = new Set(
  EXCEPTIONS.unjournalled_balance_writers.map((e) => e.file),
);

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (["node_modules", "dist", ".bun"].includes(name)) continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Files that mutate `wallets.balance`, i.e. move money. */
function balanceWriters(): string[] {
  const out: string[] = [];
  for (const file of walkTs(SRC)) {
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // `.update(wallets)` … `.set({ balance: … })` — the only shape that
    // moves a wallet in this codebase.
    if (!/\.update\(\s*wallets\s*\)/.test(src)) continue;
    if (!/balance\s*:/.test(src)) continue;
    out.push(file.replace(REPO_ROOT + "/", ""));
  }
  return out.sort();
}

/** Does the file write a journal leg at all? */
function journalsSomewhere(relFile: string): boolean {
  const src = readFileSync(join(REPO_ROOT, relFile), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  return /\.insert\(\s*transactions\s*\)/.test(src);
}

const writers = balanceWriters();
const unjournalled = writers.filter((f) => !journalsSomewhere(f));

describe("ledger conservation — wallet mutations leave journal legs", () => {
  test("the scan finds the money-moving files at all", () => {
    // If this drops to zero the detector has silently stopped working —
    // e.g. someone renamed the table binding and every check below turned
    // vacuously green.
    expect(
      writers.length,
      "No files mutating wallets.balance were found. The scan pattern has probably gone stale — check that `.update(wallets)` is still the shape money moves in.",
    ).toBeGreaterThan(5);
  });

  test("no NEW file mutates wallets.balance without journalling", () => {
    const unaccepted = unjournalled.filter((f) => !acceptedFiles.has(f)).sort();
    expect(
      unaccepted,
      `These file(s) move wallet balance but never insert into economy.transactions, so balance and SUM(transactions) diverge every time they run:\n${unaccepted
        .map((f) => `  ${f}`)
        .join(
          "\n",
        )}\n\nWrite the compensating leg. If the divergence is genuinely intended, say so in ledger-conservation.exceptions.json with a reason — the file is read by humans, so the reason has to hold up.`,
    ).toEqual([]);
  });

  test("the exceptions list has not gone stale (ratchet only shrinks)", () => {
    const fixed = [...acceptedFiles].filter((f) => !unjournalled.includes(f)).sort();
    expect(
      fixed,
      `These files are listed as accepted leg-less writers but now journal correctly. Someone fixed them — shrink the list so the number stays honest:\n${fixed
        .map((f) => `  ${f}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("earned.ts counts only counterparty inflows", () => {
    // The drawable wall is what makes a free-funded balance non-cashable.
    // If a self-servable type ever joins this list, minting becomes
    // withdrawing. `escrow_release` is only safe because createEscrow
    // refuses creator === worker; that guard and this list hold each
    // other up.
    const earned = readFileSync(join(SRC, "services", "economy", "earned.ts"), "utf8");
    const match = earned.match(/EARNED_INFLOW_TYPES\s*=\s*\[([^\]]*)\]/);
    expect(match, "EARNED_INFLOW_TYPES not found in earned.ts").not.toBeNull();
    const types = (match![1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/["']/g, ""))
      .filter(Boolean);
    expect(types.sort()).toEqual(["escrow_release", "gallery_sale"]);
  });

  test("createEscrow refuses a self-escrow", () => {
    // Without this, a wallet escrows to itself, releases, and books an
    // `escrow_release` leg — an earned inflow with no counterparty, which
    // converts free-funded balance into drawable balance. The guard is the
    // load-bearing half of the earned wall.
    const escrow = readFileSync(
      join(SRC, "services", "economy", "escrow.ts"),
      "utf8",
    );
    expect(escrow).toMatch(
      /input\.workerWalletId\s*===\s*input\.creatorWalletId/,
    );
  });

  test("the outstanding divergence is reported, not hidden", () => {
    const lines = [
      `[ledger] ${writers.length} file(s) mutate wallets.balance · ${unjournalled.length} of them never journal`,
    ];
    for (const f of writers) {
      lines.push(`  ${journalsSomewhere(f) ? "✓" : "✗"} ${f}`);
    }
    for (const e of EXCEPTIONS.unjournalled_balance_writers) {
      lines.push(`  accepted: ${e.file} — ${e.why}`);
    }
    lines.push(
      "  file-level only; run bin/reconcile-wallets.ts against a database to catch per-path divergence",
    );
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
