import { canonicalJson, sha256Id, verifyWalletCapability, verifyWalletDescriptor, verifyTransactionIntent, type Ed25519PublicKey } from "@agenttool/wallet";
import { createSeedProfile, createSeedPolicy } from "../../packages/wallet-zerone/src/bootstrap/v1.js";
import type { SeedProfile, SeedPolicy, SeedNodeConfig, SeedKeyringHandle } from "../../packages/wallet-zerone/src/bootstrap/types.js";
import { absolute, b64, check, closed, digest, freeze, hash, parse, publicKey, readBounded, readJson, same, timestamp, uint, verifyAttestation, window } from "./validation.js";

import type { ActivationConfig } from "./activation.js";

export interface Executable { path: string; sha256: `sha256:${string}` }
export interface ProviderConfig { executable: Executable; key_file: string; authority: Ed25519PublicKey }
export interface SeedConfig {
  protocol: "zerone-seed-runtime.config/0.1";
  host_id: string; ledger_id: string; ledger_path: string; signed_tx_path: string;
  profile: SeedProfile; policy: SeedPolicy; node: SeedNodeConfig;
  helper: Executable; helper_trust_file: string; helper_trust_sha256: `sha256:${string}`;
  disposable_test: boolean; activation_gate: ActivationConfig; keyring: SeedKeyringHandle;
  keyring_unlock_terminal: string | null;
  signer_public_key_b64u: string;
  descriptor_file: string; capability_file: string; intent_file: string;
  currentness_file: string; currentness_authority: Ed25519PublicKey;
  sponsor_budget_file: string; sponsor_budget_authority: Ed25519PublicKey;
  simulation_provider: ProviderConfig;
  fee_amount_uzrn: string; gas_limit: string; timeout_ms: number;
}
export interface Currentness {
  protocol: "zerone-seed-runtime.currentness/0.1";
  host_id: string; ledger_id: string; profile_id: string; policy_hash: string;
  node_config_hash: string; descriptor_id: string; capability_record_id: string; intent_record_id: string;
  owner_identity_id: string; wallet_authority: Ed25519PublicKey; signer_key_id: string;
  root_revoked: boolean; capability_revoked: boolean; revocation_nonce: number;
  issued_at: string; valid_until: string;
}
export interface SponsorBudget {
  protocol: "zerone-seed-runtime.sponsor-budget/0.1";
  host_id: string; ledger_id: string; profile_id: string; sponsor_account: string;
  total_exposure_uzrn: string; outside_journal_exposure_uzrn: string; issued_at: string; valid_until: string;
}
export function executable(e: unknown): asserts e is Executable { closed(e, "path sha256"); absolute(e.path); hash(e.sha256); }
export function validateConfig(value: unknown): Readonly<SeedConfig> {
  closed(value, "protocol host_id ledger_id ledger_path signed_tx_path profile policy node helper helper_trust_file helper_trust_sha256 disposable_test activation_gate keyring keyring_unlock_terminal signer_public_key_b64u descriptor_file capability_file intent_file currentness_file currentness_authority sponsor_budget_file sponsor_budget_authority simulation_provider fee_amount_uzrn gas_limit timeout_ms");
  const c = value as unknown as SeedConfig;
  check(c.protocol === "zerone-seed-runtime.config/0.1");
  for (const id of [c.host_id, c.ledger_id]) check(typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id));
  for (const p of [c.ledger_path,c.signed_tx_path,c.helper_trust_file,c.descriptor_file,c.capability_file,c.intent_file,c.currentness_file,c.sponsor_budget_file]) absolute(p);
  const {profile_id, ...profileCore} = c.profile; same(createSeedProfile(profileCore), c.profile);
  const {policy_hash, ...policyCore} = c.policy; same(createSeedPolicy(c.profile, policyCore), c.policy);
  hash(profile_id); hash(policy_hash); executable(c.helper); hash(c.helper_trust_sha256);
  check(c.helper.sha256 === c.profile.helper_sha256);
  check(typeof c.disposable_test === "boolean");
  const gate=c.activation_gate;check(gate && typeof gate === "object","activation_required");
  if(gate.mode === "disposable-local") {
    closed(gate,"mode");check(c.disposable_test && c.profile.chain_reference.startsWith("seed-local-") && c.node.mode === "local","test_gate_on_production");
  } else {
    closed(gate,"mode python verifier codec_sha256 gpgv bundle trust_file trust_sha256 packet_sha256 evidence_sha256 public_keyring artifact_root beta_bundle_manifest authority_verifier");
    check(gate.mode === "production" || gate.mode === "synthetic");
    if(gate.mode === "production") check(!c.disposable_test && c.profile.chain_reference === "zerone-2","production_gate_required");
    else check(c.disposable_test && c.profile.chain_reference.startsWith("seed-local-") && c.node.mode === "local","test_gate_on_production");
    executable(gate.python);executable(gate.verifier);executable(gate.gpgv);hash(gate.codec_sha256);hash(gate.trust_sha256);hash(gate.packet_sha256);
    if(gate.evidence_sha256 !== null) hash(gate.evidence_sha256);
    for(const path of [gate.bundle,gate.trust_file,gate.public_keyring,gate.artifact_root,gate.beta_bundle_manifest,gate.authority_verifier]) absolute(path);
  }
  closed(c.keyring, "backend home key_name"); absolute(c.keyring.home);
  check(["os","file","pass","test"].includes(c.keyring.backend) && (c.keyring.backend !== "test" || c.disposable_test));
  check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(c.keyring.key_name));
  // Operator-local handle only. Validation never opens a terminal or a keyring.
  if (c.keyring_unlock_terminal !== null) {
    check(c.keyring.backend === "file", "unexpected_unlock_terminal");
    absolute(c.keyring_unlock_terminal);
  }
  closed(c.node, c.node.mode === "tls" ? "node_trust_id rpc_url grpc_address mode tls_server_name ca_file" : "node_trust_id rpc_url grpc_address mode");
  hash(c.node.node_trust_id); check(c.node.node_trust_id === c.policy.node_trust_id);
  const url = new URL(c.node.rpc_url);
  check(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/");
  if (c.node.mode === "local") {
    check(url.protocol === "http:" && ["127.0.0.1","[::1]"].includes(url.hostname));
    check(/^(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(c.node.grpc_address));
  } else {
    check(c.node.mode === "tls" && url.protocol === "https:"); absolute(c.node.ca_file);
    check(/^[a-zA-Z0-9.-]+$/.test(c.node.tls_server_name) && /^[a-zA-Z0-9.\[\]:-]+:[1-9][0-9]{0,4}$/.test(c.node.grpc_address));
  }
  publicKey(c.currentness_authority); publicKey(c.sponsor_budget_authority);
  closed(c.simulation_provider, "executable key_file authority"); executable(c.simulation_provider.executable); absolute(c.simulation_provider.key_file); publicKey(c.simulation_provider.authority);
  check(new Set([c.currentness_authority.key_id,c.sponsor_budget_authority.key_id,c.simulation_provider.authority.key_id]).size === 3, "authority_roles_collapsed");
  b64(c.signer_public_key_b64u, 33); uint(c.fee_amount_uzrn,true); uint(c.gas_limit,true);
  check(Number.isInteger(c.timeout_ms) && c.timeout_ms >= 1 && c.timeout_ms <= 30000);
  return freeze(c);
}
/** The independently selected hash is an operator trust input, not data discovered in the file. */
export function loadConfig(path: string, expectedHash: string): Readonly<SeedConfig> {
  hash(expectedHash); const bytes=readBounded(path);
  check(digest(bytes) === expectedHash, "config_digest_mismatch");
  return validateConfig(parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
}
export function records(c: SeedConfig) {
  const descriptor = verifyWalletDescriptor(readJson(c.descriptor_file));
  const capability = verifyWalletCapability(readJson(c.capability_file));
  const intent = verifyTransactionIntent(readJson(c.intent_file));
  return {descriptor,capability,intent};
}
export function trustedSnapshot(c: SeedConfig) {
  return {currentness: readJson(c.currentness_file), budget: readJson(c.sponsor_budget_file)};
}
export function verifyCurrent(c: SeedConfig, r: ReturnType<typeof records>, snapshot: ReturnType<typeof trustedSnapshot>, now: string) {
  const current = verifyAttestation<Currentness>(snapshot.currentness,c.currentness_authority);
  closed(current, "protocol host_id ledger_id profile_id policy_hash node_config_hash descriptor_id capability_record_id intent_record_id owner_identity_id wallet_authority signer_key_id root_revoked capability_revoked revocation_nonce issued_at valid_until");
  check(current.protocol === "zerone-seed-runtime.currentness/0.1");
  check(current.host_id === c.host_id && current.ledger_id === c.ledger_id && current.profile_id === c.profile.profile_id && current.policy_hash === c.policy.policy_hash);
  check(current.node_config_hash === sha256Id(c.node));
  check(current.descriptor_id === r.descriptor.record_id && current.capability_record_id === r.capability.record_id && current.intent_record_id === r.intent.record_id);
  check(current.owner_identity_id === r.descriptor.owner_identity_id);
  same(current.wallet_authority, r.descriptor.authority);
  check(![c.currentness_authority.key_id,c.sponsor_budget_authority.key_id,c.simulation_provider.authority.key_id].includes(r.descriptor.authority.key_id), "authority_roles_collapsed");
  check(current.signer_key_id === digest(b64(c.signer_public_key_b64u,33)));
  check(current.root_revoked === false && current.capability_revoked === false, "revoked");
  check(Number.isSafeInteger(current.revocation_nonce) && current.revocation_nonce === r.capability.revocation_nonce, "revoked");
  window(current.issued_at,current.valid_until,now,300000);
  const budget = verifyAttestation<SponsorBudget>(snapshot.budget,c.sponsor_budget_authority);
  closed(budget, "protocol host_id ledger_id profile_id sponsor_account total_exposure_uzrn outside_journal_exposure_uzrn issued_at valid_until");
  check(budget.protocol === "zerone-seed-runtime.sponsor-budget/0.1" && budget.host_id === c.host_id && budget.ledger_id === c.ledger_id && budget.profile_id === c.profile.profile_id && budget.sponsor_account === c.policy.sponsor_account);
  uint(budget.total_exposure_uzrn,true); uint(budget.outside_journal_exposure_uzrn);
  check(BigInt(budget.outside_journal_exposure_uzrn) <= BigInt(budget.total_exposure_uzrn),"sponsor_budget_exhausted");
  window(budget.issued_at,budget.valid_until,now,300000);
  check(timestamp(now) >= timestamp(c.policy.not_before) && timestamp(now) < timestamp(c.policy.expires_at), "policy_expired");
  check(r.capability.policy_hash === c.policy.policy_hash && r.intent.capability_record_id === r.capability.record_id && r.capability.descriptor_id === r.descriptor.record_id);
  check(r.intent.descriptor_id === r.descriptor.record_id && r.intent.wallet_id === r.descriptor.wallet_id && r.capability.wallet_id === r.descriptor.wallet_id && r.intent.grant_id === r.capability.grant_id);
  same(r.capability.issuer,r.descriptor.authority); same(r.intent.delegate,r.capability.delegate);
  same(r.capability.accounts,[c.policy.claimant_account]);
  check(r.descriptor.accounts.some(a=>a.account_id === c.policy.claimant_account));
  check(r.capability.max_intents === 1 && r.capability.spend_limits.length === 0 && r.intent.declared_spends.length === 0);
  same(r.capability.fee_limits,[{asset_id:c.profile.native_asset_id,max_per_intent:c.policy.max_fee_uzrn}]);
  same(r.capability.call_rules,[{target_account:c.profile.claiming_pot_account,actions:["call"],methods:["zerone.claiming_pot.v1.MsgClaim"],requires_approval:false}]);
  check(r.intent.source_account === c.policy.claimant_account && r.intent.chain_id === c.profile.chain_id);
  // Approval-bearing policies require an independently authenticated approval protocol, not command JSON.
  check(r.capability.approval_threshold === 0 && r.capability.call_rules.every(rule => !rule.requires_approval), "unsupported_approval");
  return {current,budget};
}
export function ledgerBinding(c: SeedConfig) {
  // The next independently selected evidence pin changes per operation, not the
  // journal's immutable activation trust/root. No downgrade to test mode on reopen.
  const activation_gate=c.activation_gate.mode === "disposable-local" ? c.activation_gate : (({evidence_sha256,...root})=>root)(c.activation_gate);
  return { protocol: "zerone-seed-runtime.ledger/0.1", host_id:c.host_id, ledger_id:c.ledger_id, ledger_path:c.ledger_path,
    profile_id:c.profile.profile_id, sponsor_account:c.policy.sponsor_account,
    currentness_authority:c.currentness_authority,sponsor_budget_authority:c.sponsor_budget_authority,
    simulation_authority:c.simulation_provider.authority,activation_gate };
}
