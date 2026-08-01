export const ANCHOR_MEMO_PROTOCOL = "agenttool.collab-anchor/0.1" as const;
export const ANCHOR_LEDGER_PROTOCOL = "agenttool.collab-zerone-ledger/0.1" as const;

export const JOURNAL_GENESIS_HASH = "0".repeat(64);
export const LEGACY_COLLAB_PROTOCOL = "agenttool.collab/0.1" as const;

// zerone-1 mainnet genesis auth.params.max_memo_characters (observed 2026-08-01).
export const MAX_MEMO_CHARS = 256;

// Consensus fee floor on zerone is 1 uzrn per gas unit for every tx at
// height > 0. Simulation is not admission on this chain, so gas is fixed, not
// estimated: a memo-carrying send measured 82,772 gas on zerone-testnet-1
// (2026-08-01, tx 7F73BE8E…) — the ante meters fee handling on top of the
// 21k bank-send table cost — so 100,000 leaves honest headroom.
export const DEFAULT_GAS = 100_000;
export const DEFAULT_FEE_UZRN = 100_000;
export const ANCHOR_SEND_AMOUNT = "1uzrn";

export interface ZeroneNetworkConfig {
  name: string;
  chain_id: string;
  caip2: string;
  rpc: string;
  keyring_home: string;
  default_key: string;
}

// Endpoint defaults observed live on 2026-08-01; every field is overridable
// via CLI flags. rpc.zerone.ai does not resolve — do not "fix" these to it.
export const NETWORKS: Record<string, ZeroneNetworkConfig> = {
  "zerone-1": {
    name: "zerone-1",
    chain_id: "zerone-1",
    caip2: "cosmos:zerone-1",
    rpc: "http://169.155.55.44:26657",
    keyring_home: "~/.zeroned/mainnet-ops",
    default_key: "ai-agenttool",
  },
  "zerone-testnet-1": {
    name: "zerone-testnet-1",
    chain_id: "zerone-testnet-1",
    caip2: "cosmos:zerone-testnet-1",
    rpc: "http://37.16.28.121:26657",
    keyring_home: "~/.zeroned/testnet-ops",
    default_key: "ai-agenttool",
  },
};

export const DEFAULT_NETWORK = "zerone-testnet-1";

export function expandHome(path: string, env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME;
  if (!home) return path;
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
}

function xdgDataDir(env: Record<string, string | undefined>): string {
  return env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
    ? env.XDG_DATA_HOME
    : `${env.HOME}/.local/share`;
}

export function defaultCollabDbPath(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENTOOL_COLLAB_DB) return env.AGENTOOL_COLLAB_DB;
  return `${xdgDataDir(env)}/agenttool/collab.sqlite`;
}

export function defaultLedgerPath(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENTOOL_COLLAB_ANCHOR_LEDGER) return env.AGENTOOL_COLLAB_ANCHOR_LEDGER;
  return `${xdgDataDir(env)}/agenttool/collab-zerone-anchors.json`;
}
