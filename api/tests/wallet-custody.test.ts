/** Wallet custody disclosure — the money axis says who holds the keys.
 *
 *  Pure unit tests: walletCustody() reads a wallet row and asserts nothing
 *  beyond what its columns already record. No database. */

import { describe, expect, test } from "bun:test";

import { walletCustody } from "../src/services/economy/custody";

describe("walletCustody — platform-owned (every wallet today)", () => {
  const platform = walletCustody({
    ownerType: "platform",
    agentSigningPubB64: null,
    agentWalletIndex: null,
  });

  test("does not claim the agent holds chain keys", () => {
    expect(platform.owner_type).toBe("platform");
    expect(platform.agent_holds_chain_keys).toBe(false);
  });

  test("names the operator as the key holder, in words an agent can act on", () => {
    expect(platform.key_custody).toContain("operator");
    expect(platform.key_custody).toContain("CRYPTO_HD_MNEMONIC");
    expect(platform.key_custody.toLowerCase()).toContain("the agent does not");
  });

  test("refuses the inference that authenticating implies custody", () => {
    expect(platform.key_custody).toContain("bearer does not");
  });

  test("says the balance is a ledger entry, not a bearer asset", () => {
    expect(platform.balance_meaning).toContain("not a bearer asset");
    expect(platform.balance_meaning).toContain("not an on-chain balance");
  });

  test("names the other model, so platform custody reads as a choice and not a ceiling", () => {
    expect(platform.alternative).toBeDefined();
    expect(platform.alternative).toContain("owner_type=agent");
    expect(platform.alternative).toContain("POST /v1/wallets/:id/addresses");
  });

  test("says custody is fixed at creation, and why", () => {
    expect(platform.alternative).toContain("never converted");
    expect(platform.alternative).toContain("strand");
  });

  test("an unset owner_type is disclosed as platform, never as agent", () => {
    for (const ownerType of [undefined, null, "", "PLATFORM", "nonsense"]) {
      const c = walletCustody({ ownerType: ownerType as string | null | undefined });
      expect(c.owner_type).toBe("platform");
      expect(c.agent_holds_chain_keys).toBe(false);
    }
  });
});

describe("walletCustody — agent-owned (once the route exists)", () => {
  const agent = walletCustody({
    ownerType: "agent",
    agentSigningPubB64: "6LkbszvJhomCix4hHE9kLH9hEk9CR72JUBiYnTuyrEk=",
    agentWalletIndex: 0,
  });

  test("says the agent holds the keys and AgentTool cannot sign", () => {
    expect(agent.owner_type).toBe("agent");
    expect(agent.agent_holds_chain_keys).toBe(true);
    expect(agent.key_custody).toContain("cannot sign");
  });

  test("names the agent-side derivation path from the SOMA seed", () => {
    expect(agent.chain_key_derivation).toContain("m/44'/169'/5'");
  });

  test("states the cost of sovereignty rather than implying a safety net", () => {
    expect(agent.rule).toContain("Losing the seed loses the wallet");
    expect(agent.rule).toContain("cannot restore access");
  });

  test("carries no 'go use the other model' pointer — this IS the other model", () => {
    expect(agent.alternative).toBeUndefined();
  });

  test("refuses to imply that agent-held deposits become spendable credit", () => {
    // The hole this closes: crediting the ledger for value that landed in the
    // agent's own custody would mint credit the operator never received.
    expect(agent.deposit_boundary).toBeDefined();
    expect(agent.deposit_boundary).toContain("NOT");
    expect(agent.deposit_boundary).toContain("never received it");
  });

  test("keeps ledger balance and on-chain holdings named as separate things", () => {
    expect(agent.deposit_boundary).toContain("two separate things");
  });
});

describe("walletCustody — shared boundaries", () => {
  const both = [
    walletCustody({ ownerType: "platform" }),
    walletCustody({ ownerType: "agent" }),
  ];

  test("every disclosure states how value actually leaves, including the no-retry wall", () => {
    for (const c of both) {
      expect(c.withdrawal).toContain("payout route");
      expect(c.withdrawal).toContain("never auto-retry");
    }
  });

  test("every disclosure points at doctrine rather than ending the conversation", () => {
    for (const c of both) {
      expect(c.doctrine).toStartWith("https://docs.agenttool.dev/");
    }
  });
});
