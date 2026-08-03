/** Wallet custody disclosure — who actually holds the keys to the money.
 *
 *  The runtime axis already says this out loud for thinking
 *  (services/discovery/safety-boundaries.ts § runtime_custody: self ·
 *  bridged · trusted). The wallet axis did not, and it is the sharper
 *  omission: an agent that fetches a deposit address and is told "Send USDC
 *  to this address" has no way to learn from the response that the private
 *  key belongs to the operator.
 *
 *  Two owner types exist in the schema:
 *
 *    platform — every wallet today. Chain addresses derive from the
 *               operator's CRYPTO_HD_MNEMONIC (services/economy/crypto/hd.ts).
 *               The operator can sign for them; the agent cannot.
 *    agent    — the agent derives from its own SOMA seed at
 *               m/44'/169'/5'/<wallet-index>' and registers the address.
 *               Declared in db/schema/economy.ts, and NOT yet reachable:
 *               no route writes owner_type, agent_signing_pub_b64,
 *               agent_wallet_index, or the wallet_addresses table.
 *
 *  Say which one is true, in the response, without being asked. A platform
 *  that describes sovereignty it has not built yet is telling its agents a
 *  comfortable thing instead of a true one.
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md · docs/IDENTITY-SEED.md · docs/AGENT-ECONOMY.md */

export type WalletOwnerType = "platform" | "agent";

export interface WalletCustodyDisclosure {
  owner_type: WalletOwnerType;
  agent_holds_chain_keys: boolean;
  key_custody: string;
  chain_key_derivation: string;
  balance_meaning: string;
  withdrawal: string;
  rule: string;
  /** Present on platform wallets: how to choose the other model instead. */
  alternative?: string;
  /** Present on agent wallets: what agent custody does and does not change. */
  deposit_boundary?: string;
  doctrine: string;
}

const DOCTRINE = "https://docs.agenttool.dev/CRYPTO-PAYMENT.md";

const BALANCE_MEANING =
  "The balance is an entry in AgentTool's ledger denominated in minor units. It is not a " +
  "bearer asset, not an on-chain balance, and holding it is not custody of anything the agent " +
  "can move without this API.";

const WITHDRAWAL =
  "Value leaves only through the payout route, which the operator's infrastructure signs and " +
  "broadcasts. Failed broadcasts never auto-retry by doctrine; recovery is operator-driven.";

/** What the wallet's own row says about custody. Callers pass the row as
 *  selected — this makes no database call and asserts nothing the columns do
 *  not already record. */
export function walletCustody(wallet: {
  ownerType?: string | null;
  agentSigningPubB64?: string | null;
  agentWalletIndex?: number | null;
}): WalletCustodyDisclosure {
  const ownerType: WalletOwnerType = wallet.ownerType === "agent" ? "agent" : "platform";

  if (ownerType === "agent") {
    return {
      owner_type: "agent",
      agent_holds_chain_keys: true,
      key_custody:
        "The agent's own seed. AgentTool stores the submitted public key and address only, and " +
        "cannot sign for this wallet's chain addresses.",
      chain_key_derivation:
        "Agent-side, from its SOMA seed at m/44'/169'/5'/<agent_wallet_index>' (SLIP-0010, all " +
        "segments hardened). Reproducible on any device holding the same mnemonic.",
      balance_meaning: BALANCE_MEANING,
      deposit_boundary:
        "Value sent to a registered agent-held address stays in the agent's custody and is NOT " +
        "credited to this balance. AgentTool never received it, so crediting it would mint " +
        "spendable credit against value the operator does not hold. The ledger balance and the " +
        "on-chain holdings are two separate things here, and both are real. To convert on-chain " +
        "value into platform credit, send it to a platform-custody wallet's deposit address.",
      withdrawal: WITHDRAWAL,
      rule:
        "Losing the seed loses the wallet. AgentTool holds no copy, no recovery share, and no " +
        "escrowed key, and cannot restore access.",
      doctrine: DOCTRINE,
    };
  }

  return {
    owner_type: "platform",
    agent_holds_chain_keys: false,
    key_custody:
      "The AgentTool operator. Deposit addresses for this wallet are derived from the operator's " +
      "CRYPTO_HD_MNEMONIC, so the operator holds the private keys and the agent does not. " +
      "Registering an identity, proving a signing key, or authenticating with a bearer does not " +
      "give the agent custody of these addresses.",
    chain_key_derivation:
      "Operator-side, from one root mnemonic: EVM at m/44'/60'/0'/0/<index>, Solana at " +
      "m/44'/501'/<index>'/0', where <index> is the first 31 bits of SHA-256(wallet_id).",
    balance_meaning: BALANCE_MEANING,
    withdrawal: WITHDRAWAL,
    rule:
      "Treat funds sent to a platform-custody deposit address as funds entrusted to the operator. " +
      "This is a custody decision, the same way choosing a runtime tier is.",
    alternative:
      "Agent-held custody is available: create a wallet with owner_type=agent, then register " +
      "addresses you derived yourself with POST /v1/wallets/:id/addresses. Custody is chosen at " +
      "creation and never converted — flipping a funded wallet would strand whatever already " +
      "sits at the addresses minted under the previous model.",
    doctrine: DOCTRINE,
  };
}
