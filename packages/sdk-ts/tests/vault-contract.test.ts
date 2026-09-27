/** Canonical Vault wire shapes and the same exact-read vector as sdk-py. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { AgentTool } from "../src/index.js";

const ID = "22222222-2222-4222-8222-222222222222";
const proof = { did: `did:at:${ID}`, signing_key: new Uint8Array(32).fill(7), current_sequence: 0, timestamp: "2026-09-27T20:00:00.000Z" };
// Independently generated with Node crypto, seed 0x07 × 32, empty GET body.
const SIGNATURE = "i++BcEaHXgCJtmGgNeSi7D+Bv4wisOBLvWZFwrtfBwfYRskuP+rv72td+1NAthueOYUEByIuFVCr+zWTxPLxCg==";
const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }>;
let response: unknown;
let at: AgentTool;
beforeEach(() => {
  calls = [];
  response = {};
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  at = new AgentTool({ apiKey: "test-key", baseUrl: "https://vault.invalid/prefix" });
});
afterEach(() => { globalThis.fetch = originalFetch; });

test("restricted GET binds encoded name, base path, version query, and zero current sequence", async () => {
  response = { value: "test-value", agent_encrypted: false };
  await at.vault.get("a/b #雨", { version: 2, read_authority: proof });
  const call = calls[0]!;
  expect(call.url).toBe("https://vault.invalid/prefix/v1/vault/a%2Fb%20%23%E9%9B%A8?version=2");
  expect(call.init.method).toBe("GET");
  expect(call.init.body).toBeUndefined();
  const headers = new Headers(call.init.headers);
  expect(headers.get("X-Agent-Id")).toBe(ID);
  expect(headers.get("X-Agenttool-Authority-Sequence")).toBe("0");
  expect(headers.get("X-Agenttool-Authority-Signature")).toBe(SIGNATURE);
  await at.vault.get_decrypted("a/b #雨", { k_vault: new Uint8Array(32), version: 2, read_authority: proof });
  expect(new Headers(calls[1]!.init.headers).get("X-Agenttool-Authority-Signature")).toBe(SIGNATURE);
});

test("different selected identity and unsupported read operation fail before transport", async () => {
  await expect(at.vault.get("key", { agent_id: "33333333-3333-4333-8333-333333333333", read_authority: proof })).rejects.toMatchObject({ code: "vault_identity_conflict" });
  await expect(at.vault.bulk(["key"])).rejects.toMatchObject({ code: "vault_bulk_read_unavailable" });
  expect(calls).toHaveLength(0);
});

test("omitted, null, empty and aliased policies have exact distinct wire meanings", async () => {
  await at.vault.put("key", "value");
  await at.vault.put("key", "value", { agent_ids: null });
  await at.vault.set_policy("key", { agent_ids: [] });
  await at.vault.set_policy("key", { allowed_agents: [ID] });
  expect(calls.map((c) => JSON.parse(String(c.init.body)))).toEqual([
    { value: "value" }, { value: "value", agent_ids: null }, { agent_ids: [] }, { agent_ids: [ID] },
  ]);
  const before = calls.length;
  await expect(at.vault.set_policy("key", { agent_ids: [], read_only: false })).rejects.toMatchObject({ code: "vault_policy_option_unsupported" });
  await expect(at.vault.set_policy("key", { require_agent_id: true })).rejects.toMatchObject({ code: "vault_policy_option_unsupported" });
  await expect(at.vault.set_policy("key", {})).rejects.toMatchObject({ code: "vault_policy_invalid" });
  await expect(at.vault.set_policy("key", { agent_ids: null, allowed_agents: [] })).rejects.toMatchObject({ code: "vault_policy_invalid" });
  expect(calls).toHaveLength(before);
});

test("bulk_put writes secrets while check and audit decode actual API envelopes", async () => {
  const secrets = [{ name: "key", value: "fixture", agent_ids: [] }];
  await at.vault.bulk_put(secrets);
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ secrets });
  expect(calls[0]!.url).toEndWith("/v1/vault/bulk");
  response = { results: [{ name: "key", exists: true }, { name: "missing", exists: false }] };
  expect(await at.vault.check(["key", "missing"])).toEqual({ key: true, missing: false });
  response = { entries: [{ action: "runtime_read", agent_id: ID }] };
  expect(await at.vault.audit()).toEqual([{ action: "runtime_read", agent_id: ID }]);
});
