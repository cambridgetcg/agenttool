/** substrate-tasks — the newborn bounty loop, currency contract.
 *
 *  Canon: `agenttool:commitment/ring3-funds-its-own-newborns` ·
 *  `agenttool:wall/no-take-on-bootstrap-bounties`.
 *  Doctrine: docs/AGENT-CENTRIC.md §1 · docs/RING-1.md.
 *
 *  ── Why this file exists ─────────────────────────────────────────────
 *
 *  `api/src/routes/substrate-tasks.ts` cited this exact path as the proof
 *  of `ring3-funds-its-own-newborns`. The file was never written. Nothing
 *  else in the tree covered the claim path, and behind that gap sat a bug
 *  that made the commitment unexecutable for every agent it names:
 *
 *      platform-bootstrap.ts  creates the platform wallet as "GBP"
 *      createWallet           defaults currency to "GBP"
 *      register-agent.ts      calls createWallet with no currency  → GBP
 *      resolveProjectWallet   required  eq(wallets.currency, "USD")
 *
 *  Nothing in this substrate is USD. Every self-registered agent held a GBP
 *  wallet, every claim looked for a USD one, and every claim therefore
 *  failed `claimant_wallet_missing`. The bounty board that is supposed to
 *  fund newborns could not pay a single one, and `/public/substrate-tasks`
 *  returning an empty list hid it — an empty board and a broken board look
 *  identical from outside.
 *
 *  Fixed by resolving the claimant wallet in the PLATFORM wallet's
 *  currency, which is also what `createEscrow` requires for parity. These
 *  tests pin the contract statically so the constant cannot creep back:
 *  the source of truth for the bounty currency is one wallet row, not a
 *  literal.
 *
 *  Static rather than DB-backed on purpose. A DB test would have caught
 *  this too, but only when someone ran it against a seeded database; these
 *  run everywhere, in milliseconds, and say precisely which line broke. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

const LIFECYCLE = readFileSync(
  join(SRC, "services", "substrate-tasks", "lifecycle.ts"),
  "utf8",
);
const PLATFORM_BOOTSTRAP = readFileSync(
  join(SRC, "services", "wake", "platform-bootstrap.ts"),
  "utf8",
);
const WALLETS = readFileSync(join(SRC, "services", "economy", "wallets.ts"), "utf8");
const REGISTER = readFileSync(join(SRC, "routes", "register-agent.ts"), "utf8");

/** Comments stripped — a doc-string naming a currency is not a contract. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("substrate-tasks — bounty currency contract", () => {
  test("the claimant wallet is NOT resolved against a hardcoded currency", () => {
    expect(
      /eq\(\s*wallets\.currency\s*,\s*["'][A-Z]{3}["']\s*\)/.test(code(LIFECYCLE)),
      "lifecycle.ts resolves the claimant wallet against a literal currency code. The bounty is paid from the platform wallet, so the currency must come from that row — a literal here is how the USD/GBP break happened, and it makes the commitment silently unexecutable rather than loudly broken.",
    ).toBe(false);
  });

  test("the claimant currency comes from the platform wallet row", () => {
    expect(code(LIFECYCLE)).toMatch(/currency:\s*wallets\.currency/);
    expect(code(LIFECYCLE)).toMatch(/platformWallet\.currency/);
  });

  test("the platform wallet is locked before the claimant is resolved", () => {
    // Ordering is the mechanism, not a style preference: the claimant
    // lookup needs the platform wallet's currency, so it cannot run first.
    const c = code(LIFECYCLE);
    const platformLock = c.indexOf("PLATFORM_WALLET_ID");
    const claimantResolve = c.indexOf("resolveProjectWallet(\n");
    const resolveCall = claimantResolve === -1 ? c.lastIndexOf("resolveProjectWallet(") : claimantResolve;
    expect(
      platformLock,
      "PLATFORM_WALLET_ID is not referenced before the claimant wallet is resolved",
    ).toBeLessThan(resolveCall);
  });

  test("registration and the platform treasury agree on a currency", () => {
    // The three places that decide what currency an agent ends up holding.
    // If these ever disagree again, a newborn cannot be paid.
    const walletDefault = code(WALLETS).match(
      /currency:\s*input\.currency\s*\?\?\s*["']([A-Z]{3})["']/,
    );
    const platformCurrency = code(PLATFORM_BOOTSTRAP).match(
      /currency:\s*["']([A-Z]{3})["']/,
    );
    expect(walletDefault, "createWallet's default currency not found").not.toBeNull();
    expect(platformCurrency, "platform wallet currency not found").not.toBeNull();
    expect(
      walletDefault![1],
      `createWallet defaults to ${walletDefault![1]} but the platform treasury is ${platformCurrency![1]}. A newborn funded in one currency cannot claim a bounty paid in the other.`,
    ).toBe(platformCurrency![1]!);
  });

  test("registration still creates a wallet without naming a currency", () => {
    // Pins the assumption the test above rests on: registration takes the
    // default. If registration ever starts passing an explicit currency,
    // this test should be updated deliberately, not silently.
    expect(code(REGISTER)).toMatch(/createWallet\(\s*db\s*,\s*\{/);
    const call = code(REGISTER).slice(code(REGISTER).indexOf("createWallet(db, {"));
    const block = call.slice(0, call.indexOf("})") + 2);
    expect(
      /currency/.test(block),
      "register-agent.ts now passes an explicit currency to createWallet — check it still matches the platform treasury, then update this test.",
    ).toBe(false);
  });
});

describe("substrate-tasks — the bootstrap-bounty wall", () => {
  test("payTask never records platform revenue", () => {
    // wall/no-take-on-bootstrap-bounties. The platform pays a newborn to
    // help build the substrate; taking a cut of that would be the platform
    // charging rent on its own onboarding.
    expect(
      /import\s*\{[^}]*\brecordRevenue\b[^}]*\}\s*from/.test(
        code(LIFECYCLE).replace(/\n/g, " "),
      ),
      "lifecycle.ts imports recordRevenue — bootstrap bounties carry no take.",
    ).toBe(false);
  });

  test("the escrow names the platform as creator and the claimant as worker", () => {
    expect(code(LIFECYCLE)).toMatch(/creatorWallet:\s*PLATFORM_WALLET_ID/);
    expect(code(LIFECYCLE)).toMatch(/workerWallet:\s*claimantWallet\.id/);
  });

  test("the platform debit writes a ledger leg", () => {
    // Substrate-honesty applies to the platform's own books: the balance
    // move and the journal row are written in the same transaction.
    expect(code(LIFECYCLE)).toMatch(/insert\(transactions\)/);
    expect(code(LIFECYCLE)).toMatch(/type:\s*["']escrow_lock["']/);
  });

  test("an agent cannot claim its own posted task", () => {
    expect(code(LIFECYCLE)).toMatch(/self_claim_forbidden/);
  });
});
