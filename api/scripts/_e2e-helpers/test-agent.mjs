/** TestAgent factory for multi-agent e2e tests.
 *
 *  Registers a fresh ephemeral test project via POST /v1/register,
 *  generates K_master + ed25519 signing key + X25519 box keypair
 *  in-process, registers the box pubkey, and returns a TestAgent
 *  record carrying everything needed to drive cli/think functions
 *  directly (no subprocess, no real keychain).
 *
 *  Test projects are namespaced `e2e-${role}-${timestamp}` so they're
 *  identifiable for manual sweep. There is no /v1/projects DELETE
 *  endpoint today, so cleanup() is a no-op placeholder; the live api
 *  accumulates test rows that a periodic admin sweep can prune.
 */

import { randomBytes } from "node:crypto";
import * as ed from "@noble/ed25519";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

async function fetchJson(method, url, { bearer, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

/** Create an ephemeral test agent with full crypto keys.
 *
 *  @param {object} opts
 *  @param {string} opts.role          Short label for the project name (alice|bob|carol|...)
 *  @param {string} opts.base          AGENTTOOL_BASE URL
 *  @param {"stub"|"anthropic"|"openai"} [opts.llmProvider="stub"]
 *  @returns {Promise<TestAgent>}
 */
export async function createTestAgent({ role, base, llmProvider = "stub" }) {
  const name = `e2e-${role}-${Date.now()}`;

  // 1. Register a fresh project (anonymous /v1/register).
  const reg = await fetchJson("POST", `${base}/v1/register`, {
    body: { name, capabilities: ["test", "proposal-flow"] },
  });
  const bearer = reg.project.api_key;
  const projectId = reg.project.id;
  const identityId = reg.agent.id;
  const did = reg.agent.did;

  // 2. Mint a signing key; server returns the private seed once.
  const sigRes = await fetchJson(
    "POST",
    `${base}/v1/identities/${identityId}/keys`,
    { bearer, body: { label: `e2e-${role}-sign` } },
  );
  const signingKeyId = sigRes.kid;
  const signingKey = Uint8Array.from(Buffer.from(sigRes.private_key, "base64"));
  const signingPubKey = Uint8Array.from(Buffer.from(sigRes.public_key, "base64"));

  // 3. Generate X25519 box keypair in-process; register the pub.
  const boxPriv = x25519.utils.randomSecretKey();
  const boxPub = x25519.getPublicKey(boxPriv);
  const boxRes = await fetchJson(
    "POST",
    `${base}/v1/identities/${identityId}/box-keys`,
    { bearer, body: { public_key: b64(boxPub), label: `e2e-${role}-box` } },
  );
  const boxKeyId = boxRes.box_key_id ?? boxRes.id;

  // 4. K_master — never leaves this process.
  const kMaster = randomBytes(32);

  // 5. Seed the LLM-key vault entry (proposeMerge calls
  //    client.getVaultSecret(config.llmKeyVaultName) before invoking
  //    buildProvider). Stub provider ignores the value; we only need
  //    the row to exist so the lookup succeeds.
  const llmKeyVaultName = `e2e-${role}-llm`;
  await fetchJson(
    "PUT",
    `${base}/v1/vault/${llmKeyVaultName}`,
    { bearer, body: { value: "stub-key-not-used" } },
  );

  // 6. Build ThinkConfig + KeyMaterial shapes the proposal functions
  //    consume.
  const thinkConfig = {
    agenttoolBase: base,
    agenttoolApiKey: bearer,
    identityId,
    signingKeyId,
    boxKeyId,
    homeDir: `/tmp/agenttool-test-${role}-${Date.now()}`,
    llmProvider,
    llmModel: "stub",
    llmKeyVaultName,
    budgetCredits: 200,
    maxThoughtsPerRun: 5,
    thoughtMaxChars: 2000,
    defaultTimeoutMs: 60_000,
    consolidateMinThoughts: 3,
  };
  const keyMaterial = {
    kMaster: new Uint8Array(kMaster),
    signingKey,
    signingPubKey,
    boxKey: { priv: boxPriv, pub: boxPub },
  };

  return {
    role,
    name,
    projectId,
    identityId,
    did,
    bearer,
    kMaster: new Uint8Array(kMaster),
    signingKey,
    signingPubKey,
    boxKey: { priv: boxPriv, pub: boxPub },
    boxKeyId,
    signingKeyId,
    thinkConfig,
    keyMaterial,
    cleanup: async () => {
      // No /v1/projects DELETE endpoint today — best-effort no-op.
      // Test projects identifiable by `e2e-${role}-` prefix.
    },
  };
}
