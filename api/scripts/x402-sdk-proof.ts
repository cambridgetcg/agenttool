/** W2-10 — a real top-up THROUGH @agenttool/sdk (workspace source), payer key from the keychain, never printed. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { AgentTool } from "../../packages/sdk-ts/src/index.ts";
import { localEvmSigner } from "../../packages/sdk-ts/src/x402.ts";

const TREASURY = "0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const mnemonic = execFileSync("security", ["find-generic-password", "-s", "kingdom-x402-payer-mnemonic", "-a", "kingdom", "-w"], { encoding: "utf8" }).trim();
const key = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/60'/0'/0/0").privateKey!;
const signer = localEvmSigner("0x" + Buffer.from(key).toString("hex"));
const apiKey = JSON.parse(readFileSync(`${process.env.HOME}/.agenttool-agents/ai.json`, "utf8")).api_key as string;
const events: unknown[] = [];
const at = new AgentTool({
  apiKey,
  x402: {
    signer,
    policy: { maxAmountAtomic: 10_000_000n, allowedPayTo: [TREASURY], allowedNetworks: ["eip155:8453"], allowedAssets: [USDC], maxValiditySeconds: 60 },
    onPayment: (e) => { events.push(e); },
  },
});
console.log("payer:", signer.address);
const r = await at.x402.topUp(1);
console.log("topUp(1):", JSON.stringify(r));
console.log("events:", JSON.stringify(events));
const status = await at.x402.payment(r.authorizationHash);
console.log("payment status:", JSON.stringify({ status: (status as any).status, tx: (status as any).transaction ?? (status as any).tx_hash, credits_applied: (status as any).credits_applied }));
