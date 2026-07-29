import assert from "node:assert/strict";

import * as walletZerone from "../dist/index.js";

assert.equal(walletZerone.PACKAGE_NAME, "@agenttool/wallet-zerone");
assert.equal(walletZerone.PACKAGE_VERSION, "0.1.1");
assert.equal(
  walletZerone.ZERONE_CORE_COMMIT,
  "35284a22192df8fc6273135f14e8549c804778b6",
);
assert.equal(walletZerone.AGENTTOOL_ADAPTER_ID, "agenttool-invocation-v1");
assert.equal(walletZerone.AGENTTOOL_WORK_CLASS_ID, "agenttool.invocation");
walletZerone.assertZeroneProfileIdentifiers(
  walletZerone.ZERONE_CHAIN_PROFILES.testnet,
);

const forbidden = /mnemonic|private.?key|secret|seed|signAndSend/iu;
assert.deepEqual(
  Object.keys(walletZerone).filter((name) => forbidden.test(name)),
  [],
);

const required = [
  "createAgentToolInvocationWitnessLink",
  "createZeroneDirectSignPlan",
  "createZeroneSimulationBinding",
  "createZeroneSigningRequest",
  "verifyZeroneSignedPayload",
  "createZeroneAdapterClient",
];
for (const name of required) {
  assert.equal(typeof walletZerone[name], "function", `${name} export`);
}

console.log("@agenttool/wallet-zerone Node ESM smoke passed");
