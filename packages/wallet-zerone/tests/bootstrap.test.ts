import { describe, test, expect } from "bun:test";
import {
  assertIntentWithinCapabilityStatic, base64UrlDecode, base64UrlEncode, concatBytes, sha256Id, sha256BytesId,
  sealSimulationReceipt, verifyTransactionIntent,
} from "@agenttool/wallet";
import * as seed from "../src/bootstrap/v1.js";
import * as root from "../src/index.js";
import { decodeSeedMsgClaim } from "../src/bootstrap/transactions.js";
import { bytesField, stringField, uintField, decodeFields, requireBytesField, decodeUtf8 } from "../src/wire.js";
import {
  PROFILE, PROFILE_CORE, POLICY, POLICY_CORE, NOW, KEY, D, END,
  SOURCE_ADDRESS, RECIPIENT_ADDRESS, observation, records, planned, authorized, context, simulationAdapter,
} from "./bootstrap-fixtures.js";

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const clone = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value)) as Mutable<T>;
function assessment(obs = observation(), overrides = {}) {
  return seed.assessSeedClaim({ profile: PROFILE, policy: POLICY, observation: obs, signer_public_key_b64u: KEY, now: NOW, ...overrides });
}
function rehash(plan: seed.SeedClaimPlan): seed.SeedClaimPlan {
  const { plan_id: _old, ...core } = plan;
  return { ...core, commitment_hash: sha256Id(core.commitment), plan_id: sha256Id({ ...core, commitment_hash: sha256Id(core.commitment) }) };
}

describe("separate unreleased profile and closed policy", () => {
  test("implements the frozen API without widening historical root or exports", async () => {
    const api: seed.SeedPlannerApi = seed;
    expect(Object.keys(api).filter((key) => /signed|signAndSend|fetch|private|secret/iu.test(key))).toEqual([]);
    expect(Object.keys(root).filter((key) => /seed/iu.test(key))).toEqual([]);
    expect(root.getZeroneProfile("mainnet").chain_reference).toBe("zerone-1");
    expect(seed.SEED_BOOTSTRAP_RELEASE_STATUS).toBe("developer-preview");
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(manifest.exports["./bootstrap/v1"]).toEqual({ types: "./dist/bootstrap/v1.d.ts", import: "./dist/bootstrap/v1.js" });
  });
  test("bootstrap sources have no ambient I/O, clock, randomness, signing or custody implementation", async () => {
    const files = ["v1", "policy", "assessment", "transactions", "validation"];
    const source = (await Promise.all(files.map((name) => Bun.file(new URL(`../src/bootstrap/${name}.ts`, import.meta.url)).text()))).join("\n");
    expect(source).not.toMatch(/\bfetch\s*\(|\bprocess\.env\b|\bDate\.now\s*\(|\bMath\.random\s*\(/u);
    expect(source).not.toMatch(/from\s+["'][^"']*(node:|bun:|keyring|custody|marketplace|api\/)/u);
    expect(source).not.toMatch(/\.sign\s*\(|\bsignAndSend\b|\bsigned_payload_b64u\b/u);
  });
  test("content IDs, source pins, and deep immutable snapshots", () => {
    expect(PROFILE.profile_id).toBe(sha256Id(PROFILE_CORE)); expect(POLICY.policy_hash).toBe(sha256Id(POLICY_CORE));
    const mutable = clone(POLICY_CORE); const policy = seed.createSeedPolicy(PROFILE, mutable);
    mutable.max_fee_uzrn = "250000";
    expect(policy.max_fee_uzrn).toBe("200000"); expect(Object.isFrozen(policy)).toBe(true);
    expect(seed.createSeedPolicy(clone(PROFILE), clone(POLICY_CORE))).toEqual(POLICY);
    expect(seed.createSeedProfile({ ...PROFILE_CORE, source_digest: D("1") }).profile_id).not.toBe(PROFILE.profile_id);
  });
  for (const [field, bad] of Object.entries({
    protocol: "other/0.1", chain_reference: "other-1", chain_id: "cosmos:other", native_asset_id: "cosmos:seed-local-1/denom:other",
    claiming_pot_account: POLICY.claimant_account, genesis_hash: D("A"), source_digest: "b".repeat(40), zerone_core_commit: "0".repeat(64),
    cosmos_sdk_version: "v0.50.15", runtime_sha256: "sha256:bad", helper_sha256: "sha256:bad", native_denom: "zrn", bech32_prefix: "cosmos",
    seed_amount_uzrn: "222001", claim_type_url: "/cosmos.bank.v1beta1.MsgSend", claim_gas_floor: "1", tx_gas_cap: "11111112", min_gas_price_uzrn: "0", confirmation_depth: 0,
  })) test(`reject profile ${field}`, () => expect(() => seed.createSeedProfile({ ...PROFILE_CORE, [field]: bad } as never)).toThrow());
  for (const [field, bad] of Object.entries({
    protocol: "other/0.1", profile_id: D("0"), node_trust_id: "sha256:bad", claimant_account: POLICY.sponsor_account, sponsor_account: POLICY.claimant_account,
    pot_id: "arbitrary-pot", max_intents: 2, seed_amount_uzrn: "0", max_fee_uzrn: "0", max_gas: "22221", grant_spend_limit_uzrn: "199999",
    grant_expires_at: "2026-09-08T08:04:59.999Z", setup_fee_budget_uzrn: "-1", not_before: END, expires_at: "2026-09-08T09:00:00.000Z",
    timeout_height: "0", max_observation_age_seconds: 301, max_height_lag: 101,
  })) test(`reject policy ${field}`, () => expect(() => seed.createSeedPolicy(PROFILE, { ...POLICY_CORE, [field]: bad } as never)).toThrow());
  test("reject dirty shapes, getters without invoking, invalid JSON and numeric forms", () => {
    let calls = 0;
    const getter = { ...PROFILE_CORE }; Object.defineProperty(getter, "source_digest", { enumerable: true, get() { calls++; return D(); } });
    expect(() => seed.createSeedProfile(getter)).toThrow(); expect(calls).toBe(0);
    for (const bad of [null, [], { ...PROFILE_CORE, extra: true }, { ...PROFILE_CORE, [Symbol("hidden")]: 1 }, { ...PROFILE_CORE, source_digest: "\ud800" }]) expect(() => seed.createSeedProfile(bad as never)).toThrow();
    for (const bad of ["01", "-1", "1.0", "1e3", "18446744073709551616"]) expect(() => seed.createSeedPolicy(PROFILE, { ...POLICY_CORE, timeout_height: bad })).toThrow();
    for (const bad of ["0", "01", "1".repeat(79), (1n << 256n).toString()]) expect(() => seed.createSeedPolicy(PROFILE, { ...POLICY_CORE, grant_spend_limit_uzrn: bad })).toThrow();
    for (const bad of [-0, 0, 1.5, NaN, Infinity, 301]) expect(() => seed.createSeedPolicy(PROFILE, { ...POLICY_CORE, max_observation_age_seconds: bad })).toThrow();
    for (const bad of ["2026-02-30T08:00:00.000Z", "2026-09-08T08:10:00Z", "2026-09-08T08:10:00.000000Z"]) expect(() => seed.createSeedPolicy(PROFILE, { ...POLICY_CORE, grant_expires_at: bad })).toThrow();
    expect(() => seed.createSeedProfile({ ...PROFILE_CORE, zerone_core_commit: [PROFILE_CORE.zerone_core_commit] } as never)).toThrow();
    expect(() => seed.createSeedPolicy({ ...PROFILE, helper_sha256: D("1") }, POLICY_CORE)).toThrow();
    expect(() => assessment(observation(), { policy: { ...POLICY, max_fee_uzrn: "222222" } })).toThrow();
  });
});

describe("all-or-unknown, full exposure seed assessment", () => {
  test("222000 nominal incoming is not spend; reserve grant plus setup not fee", () => {
    expect(assessment()).toEqual({ status: "ready", observation_hash: sha256Id(observation()), expected_credit_uzrn: "222000", sponsor_exposure_uzrn: "350000" });
    const obs = clone(observation()); obs.supply.current_supply_uzrn = "999999"; obs.supply.max_supply_uzrn = "1000000";
    expect(assessment(obs)).toMatchObject({ status: "ready", expected_credit_uzrn: "1" });
    obs.supply.total_minted_uzrn = "0"; expect(assessment(obs)).toMatchObject({ status: "ready", expected_credit_uzrn: "1" });
    obs.sponsor_balance_uzrn = "349999"; expect(assessment(obs)).toEqual({ status: "blocked", reason: "sponsor_underfunded" });
  });
  test("unknown stays unknown and malformed required surfaces cannot become absent/zero", () => {
    expect(assessment(observation(), { observation: { protocol: "agent-wallet-zerone.seed-observation/0.1", status: "unknown", profile_id: PROFILE.profile_id, reason: "unavailable" } })).toEqual({ status: "unknown", reason: "unavailable" });
    for (const field of Object.keys(observation())) {
      const obs = clone(observation()); delete (obs as any)[field]; expect(assessment(obs).status).toBe("unknown");
    }
    const malformed = observation(); (malformed.allowance as any).extra = "unlimited";
    expect(assessment(malformed)).toEqual({ status: "unknown", reason: "invalid_response" });
  });
  const cases: [string, (o: any) => void, string][] = [
    ["profile", (o) => { o.evidence.profile_id = D("0"); }, "policy_mismatch"],
    ["node trust", (o) => { o.evidence.node_trust_id = D("0"); }, "policy_mismatch"],
    ["chain", (o) => { o.evidence.chain_id = "cosmos:other"; }, "chain_mismatch"],
    ["genesis", (o) => { o.evidence.genesis_hash = D("0"); }, "genesis_mismatch"],
    ["catching up", (o) => { o.evidence.catching_up = true; }, "catching_up"],
    ["height lag", (o) => { o.evidence.latest_height = "103"; }, "incoherent_height"],
    ["future anchor", (o) => { o.evidence.anchor.height = "101"; }, "incoherent_height"],
    ["stale block", (o) => { o.evidence.anchor.block_time = "2026-09-08T07:58:00.000Z"; }, "stale"],
    ["future observation", (o) => { o.evidence.observed_at = END; }, "stale"],
    ["future block time", (o) => { o.evidence.anchor.block_time = NOW; }, "stale"],
    ["timeout", (o) => { o.evidence.anchor.height = "200"; o.evidence.latest_height = "200"; }, "timeout_height"],
    ["claimant", (o) => { o.claimant.account = POLICY.sponsor_account; }, "policy_mismatch"],
    ["sponsor", (o) => { o.sponsor_account = POLICY.claimant_account; }, "policy_mismatch"],
    ["missing pot", (o) => { o.pot = null; }, "pot_missing"],
    ["inactive", (o) => { o.pot.status = "depleted"; }, "pot_inactive"],
    ["native non-expiry", (o) => { o.pot.status = "expired"; }, "pot_inactive"],
    ["pot substitution", (o) => { o.pot.pot_id = "other"; }, "pot_shape"],
    ["amount", (o) => { o.pot.total_amount_uzrn = "222001"; }, "pot_shape"],
    ["overclaimed", (o) => { o.pot.claimed_amount_uzrn = "222001"; }, "pot_shape"],
    ["duration", (o) => { o.pot.end_block = "12"; }, "pot_shape"],
    ["cliff", (o) => { o.pot.cliff_blocks = "1"; }, "pot_shape"],
    ["period", (o) => { o.pot.period_blocks = "1"; }, "pot_shape"],
    ["tier", (o) => { o.pot.min_staking_tier = 1; }, "pot_shape"],
    ["registration", (o) => { o.pot.min_registration_age = "1"; }, "pot_shape"],
    ["whitelist", (o) => { o.pot.whitelist = [RECIPIENT_ADDRESS]; }, "pot_shape"],
    ["open whitelist", (o) => { o.pot.whitelist = []; }, "pot_shape"],
    ["wider whitelist", (o) => { o.pot.whitelist = [SOURCE_ADDRESS, RECIPIENT_ADDRESS]; }, "invalid_response"],
    ["prior claim", (o) => { o.prior_claim = { pot_id: POLICY.pot_id, claimant: SOURCE_ADDRESS, amount_uzrn: "1", claimed_at: "12" }; }, "already_claimed"],
    ["unexplained issuance", (o) => { o.pot.claimed_amount_uzrn = "1"; }, "invalid_response"],
    ["not vested", (o) => { o.pot.start_block = "100"; o.pot.end_block = "101"; }, "not_vested"],
    ["minimum", (o) => { o.min_claim_amount_uzrn = "222001"; }, "below_minimum"],
    ["supply", (o) => { o.supply.current_supply_uzrn = o.supply.max_supply_uzrn; }, "supply_exhausted"],
    ["account missing", (o) => { o.claimant = { status: "absent", account: POLICY.claimant_account }; }, "account_missing"],
    ["grant missing/revoked", (o) => { o.allowance = { status: "absent" }; }, "allowance_missing"],
    ["granter", (o) => { o.allowance.granter = SOURCE_ADDRESS; }, "allowance_mismatch"],
    ["grantee", (o) => { o.allowance.grantee = RECIPIENT_ADDRESS; }, "allowance_mismatch"],
    ["grant budget", (o) => { o.allowance.spend_limit_uzrn = "300001"; }, "allowance_mismatch"],
    ["partly consumed grant", (o) => { o.allowance.spend_limit_uzrn = "299999"; }, "allowance_mismatch"],
    ["grant expiry", (o) => { o.allowance.expires_at = END; }, "allowance_mismatch"],
    ["grant inner type", (o) => { o.allowance.inner_type_url = "/cosmos.feegrant.v1beta1.PeriodicAllowance"; }, "invalid_response"],
    ["extra allowed message", (o) => { o.allowance.allowed_messages.push("/cosmos.bank.v1beta1.MsgSend"); }, "invalid_response"],
    ["account key type", (o) => { o.claimant.public_key = { type_url: "/cosmos.crypto.ed25519.PubKey", key_b64u: KEY }; }, "invalid_response"],
  ];
  for (const [name, change, reason] of cases) test(`refuse ${name}`, () => { const obs = observation(); change(obs); expect(assessment(obs)).toMatchObject({ reason }); });
  test("time interval is half-open and matching/unset account keys only", () => {
    expect(assessment(observation(), { now: "2026-09-08T07:59:59.999Z" })).toEqual({ status: "blocked", reason: "not_yet_valid" });
    expect(assessment(observation(), { now: END })).toEqual({ status: "blocked", reason: "expired" });
    const obs = observation(); (obs.claimant as any).public_key = { type_url: "/cosmos.crypto.secp256k1.PubKey", key_b64u: KEY };
    expect(assessment(obs).status).toBe("ready");
    expect(assessment(obs, { signer_public_key_b64u: "not-base64" })).toEqual({ status: "blocked", reason: "key_mismatch" });
  });
});

describe("exact native wire and portable immutable planning", () => {
  test("Claim fields 1/2, timeout 3, Fee granter 4 and no payer; canonical zero defaults", async () => {
    const { plan, input } = await planned();
    const claim = seed.encodeSeedMsgClaim({ claimant: SOURCE_ADDRESS, pot_id: POLICY.pot_id });
    const fields = decodeFields(claim); expect(fields.map((f) => f.number)).toEqual([1, 2]); expect(decodeSeedMsgClaim(claim)).toEqual({ claimant: SOURCE_ADDRESS, pot_id: POLICY.pot_id });
    expect(decodeFields(base64UrlDecode(plan.body_bytes_b64u)).map((f) => f.number)).toEqual([1, 3]);
    const auth = decodeFields(base64UrlDecode(plan.auth_info_bytes_b64u));
    const fee = decodeFields(requireBytesField(auth[1], 2, "fee")); expect(fee.map((f) => f.number)).toEqual([1, 2, 4]);
    expect(decodeUtf8(requireBytesField(fee[2], 4, "granter"), "granter")).toBe(RECIPIENT_ADDRESS);
    expect(Array.from(base64UrlDecode(plan.simulation_tx_bytes_b64u).slice(-2))).toEqual([0x1a, 0x00]);
    const obs = observation(); (obs.claimant as any).sequence = "0"; (obs.claimant as any).account_number = "0";
    const zero = seed.createSeedClaimPlan({ ...input, observation: obs });
    expect(decodeFields(base64UrlDecode(zero.sign_doc_bytes_b64u)).map((f) => f.number)).toEqual([1, 2, 3]);
    const zeroAuth = decodeFields(base64UrlDecode(zero.auth_info_bytes_b64u));
    expect(decodeFields(requireBytesField(zeroAuth[0], 1, "signer")).map((f) => f.number)).toEqual([1, 2]);
    expect(() => seed.assertSeedClaimPlan(clone(plan), clone(PROFILE), clone(POLICY))).not.toThrow();
    expect(Object.isFrozen(plan.commitment)).toBe(true);
    const before = plan.plan_id; (input.observation.claimant as any).sequence = "77"; expect(plan.plan_id).toBe(before); expect(plan.commitment.sequence).toBe("9");
  });
  test("reject canonical Claim attacks before planning", () => {
    const c = stringField(1, SOURCE_ADDRESS); const p = stringField(2, POLICY.pot_id);
    for (const bytes of [concatBytes(p, c), concatBytes(c, c, p), concatBytes(c, p, uintField(3, 1n)), concatBytes(c, p, bytesField(3, new Uint8Array(), { emitEmpty: true })),
      concatBytes(uintField(1, 1n), p), concatBytes(c, p).slice(0, -1), concatBytes(Uint8Array.from([0x8a, 0]), c.slice(1), p), new Uint8Array(16_385)]) expect(() => decodeSeedMsgClaim(bytes)).toThrow();
    expect(() => seed.encodeSeedMsgClaim({ claimant: SOURCE_ADDRESS, pot_id: `bootstrap-${RECIPIENT_ADDRESS}` })).toThrow();
    expect(() => seed.encodeSeedMsgClaim({ claimant: SOURCE_ADDRESS, pot_id: POLICY.pot_id, extra: 1 } as never)).toThrow();
  });
  test("all commitment fields covered by immutable hashes; bound substitutions reject even rehashed", async () => {
    const { plan } = await planned();
    for (const key of Object.keys(plan.commitment)) {
      const changed = clone(plan); (changed.commitment as any)[key] = `${(changed.commitment as any)[key]}x`;
      expect(() => seed.assertSeedClaimPlan(changed, PROFILE, POLICY), key).toThrow();
    }
    for (const [key, value] of Object.entries({ profile_id: D("0"), source_digest: D("0"), genesis_hash: D("0"), chain_id: "cosmos:other", chain_reference: "other",
      policy_hash: D("0"), claimant_account: POLICY.sponsor_account, sponsor_account: POLICY.claimant_account, pot_id: "other", signer_key_id: D("0"), timeout_height: "201", grant_spend_limit_uzrn: "300001", grant_expires_at: END,
      fee_amount_uzrn: "1", gas_limit: "22221", expires_at: "2026-09-08T08:06:00.000Z" })) {
      const changed = clone(plan); (changed.commitment as any)[key] = value;
      expect(() => seed.assertSeedClaimPlan(rehash(changed), PROFILE, POLICY), key).toThrow();
    }
    expect(() => seed.assertSeedClaimPlan({ ...plan, extra: true } as never, PROFILE, POLICY)).toThrow();
    expect(() => seed.assertSeedClaimPlan({ ...plan, observation_hash: D("0") }, PROFILE, POLICY)).toThrow();
  });
  test("unsigned components reject swapped, signed, extra/reordered/default fields even with new hashes and IDs", async () => {
    const { plan } = await planned();
    for (const field of ["body_bytes", "auth_info_bytes", "sign_doc_bytes", "simulation_tx_bytes"] as const) {
      for (const suffix of [Uint8Array.from([0x1a, 0]), uintField(77, 1n)]) {
        const changed: any = clone(plan); const bytes = concatBytes(base64UrlDecode(changed[`${field}_b64u`]), suffix);
        changed[`${field}_b64u`] = base64UrlEncode(bytes); changed[`${field}_hash`] = sha256BytesId(bytes);
        expect(() => seed.assertSeedClaimPlan(rehash(changed), PROFILE, POLICY)).toThrow();
      }
      const changed: any = clone(plan); changed[`${field}_b64u`] += "=";
      expect(() => seed.assertSeedClaimPlan(rehash(changed), PROFILE, POLICY)).toThrow();
    }
    const auth = decodeFields(base64UrlDecode(plan.auth_info_bytes_b64u)); const fee = requireBytesField(auth[1], 2, "fee");
    for (const payer of ["", SOURCE_ADDRESS, RECIPIENT_ADDRESS]) {
      const fields = decodeFields(fee); const granter = requireBytesField(fields[2], 4, "granter");
      const originalWithoutGranter = fee.slice(0, fee.length - bytesField(4, granter).length);
      const badFee = concatBytes(originalWithoutGranter, bytesField(3, new TextEncoder().encode(payer), { emitEmpty: true }), bytesField(4, granter));
      const bytes = concatBytes(bytesField(1, requireBytesField(auth[0], 1, "signer")), bytesField(2, badFee));
      const changed = { ...plan, auth_info_bytes_b64u: base64UrlEncode(bytes), auth_info_bytes_hash: sha256BytesId(bytes) };
      expect(() => seed.assertSeedClaimPlan(rehash(changed), PROFILE, POLICY)).toThrow();
    }
    // A signature may appear ONLY in the external runtime; pure plan has exactly 1a00.
    const sim = base64UrlDecode(plan.simulation_tx_bytes_b64u);
    const signed = concatBytes(sim.slice(0, -2), bytesField(3, new Uint8Array(64).fill(1)));
    expect(() => seed.assertSeedClaimPlan(rehash({ ...plan, simulation_tx_bytes_b64u: base64UrlEncode(signed), simulation_tx_bytes_hash: sha256BytesId(signed) }), PROFILE, POLICY)).toThrow();
  });
  test("gas/fee/intent/account substitutions fail at creation", async () => {
    const { input } = await planned();
    for (const changes of [{ gas_limit: "22221" }, { gas_limit: "200001" }, { gas_limit: "11111112" }, { fee_amount_uzrn: "99999" }, { fee_amount_uzrn: "200001" }, { fee_amount_uzrn: "0" }]) expect(() => seed.createSeedClaimPlan({ ...input, ...changes })).toThrow();
    expect(() => seed.createSeedClaimPlan({ ...input, intent: clone(input.intent) })).toThrow();
    expect(() => seed.createSeedClaimPlan({ ...input, capability: clone(input.capability) })).toThrow();
    const reverified = await verifyTransactionIntent(clone(input.intent));
    expect(seed.createSeedClaimPlan({ ...input, intent: reverified }).plan_id).toBe(seed.createSeedClaimPlan(input).plan_id);
    expect(() => seed.createSeedClaimPlan({ ...input, now: END })).toThrow();
    expect(() => seed.createSeedClaimPlan({ ...input, signer_public_key_b64u: KEY + "=" })).toThrow();
  });
});

describe("independent native SDK v0.53.8 Claim/granter vector", () => {
  test("reconstructs Go-marshaled unsigned bytes and all portable JSON commitments", async () => {
    const vector = await Bun.file(new URL("../vectors/seed-go-cosmos.json", import.meta.url)).json() as {
      fixture: string; cosmos_sdk_version: string; feegrant_version: string; generator: string; source_fixture_sha256: string;
      claim_value_b64u: string; profile: seed.SeedProfile; policy: seed.SeedPolicy; plan: seed.SeedClaimPlan;
    };
    expect(vector.fixture).toBe("public-disposable-test-key-only");
    expect(vector.cosmos_sdk_version).toBe("v0.53.8"); expect(vector.feegrant_version).toBe("v0.2.0");
    expect(vector.generator).toBe("zerone/tools/zerone-seed-io/main_test.go#TestNativeVector");
    expect(vector.source_fixture_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.keys(vector).sort()).toEqual(["claim_value_b64u", "cosmos_sdk_version", "feegrant_version", "fixture", "generator", "plan", "policy", "profile", "source_fixture_sha256"]);
    const { profile_id, ...profileCore } = vector.profile;
    expect(seed.createSeedProfile(profileCore)).toEqual(vector.profile); expect(sha256Id(profileCore)).toBe(profile_id);
    const { policy_hash, ...policyCore } = vector.policy;
    expect(seed.createSeedPolicy(vector.profile, policyCore)).toEqual(vector.policy); expect(sha256Id(policyCore)).toBe(policy_hash);
    const claimant = vector.plan.commitment.claimant_account.slice(vector.profile.chain_id.length + 1);
    expect(base64UrlEncode(seed.encodeSeedMsgClaim({ claimant, pot_id: vector.policy.pot_id }))).toBe(vector.claim_value_b64u);
    expect(() => seed.assertSeedClaimPlan(vector.plan, vector.profile, vector.policy)).not.toThrow();
    for (const field of ["body_bytes", "auth_info_bytes", "sign_doc_bytes", "simulation_tx_bytes"] as const) {
      expect(sha256BytesId(base64UrlDecode(vector.plan[`${field}_b64u`]))).toBe(vector.plan[`${field}_hash`]);
    }
    // Native fixture has omitted sequence=0, nonzero account=7, timeout=1000.
    expect(vector.plan.commitment.sequence).toBe("0"); expect(vector.plan.commitment.account_number).toBe("7");
    expect(vector.plan.commitment.timeout_height).toBe("1000");
    expect(Array.from(base64UrlDecode(vector.plan.simulation_tx_bytes_b64u).slice(-2))).toEqual([0x1a, 0x00]);
  });
});

describe("Wallet authority, exact simulation and in-process provenance", () => {
  test("complete pure journey produces the exact unsigned direct-sign request", async () => {
    const a = await authorized();
    expect(a.request.unsigned_payload_b64u).toBe(a.plan.sign_doc_bytes_b64u);
    expect(a.request.unsigned_payload_hash).toBe(a.plan.sign_doc_bytes_hash);
    expect(a.request.signer_key_id).toBe(a.plan.commitment.signer_key_id);
    expect(a.simulation.estimated_fee.amount_atomic).toBe("100000");
    expect(a.simulation.effects).toEqual([{ action: "call", target_account: PROFILE.claiming_pot_account, method: seed.SEED_CLAIM_METHOD, asset_id: null, amount_atomic: "0" }]);
    expect(a.simulation.block_hash).toBe(observation().evidence.anchor.block_hash);
    expect(a.authorization.policy_hash).toBe(POLICY.policy_hash);
  });
  test("Proxy options cannot switch signing bytes after provenance checks", async () => {
    // Regression from independent reviewer artifact_42540142. Consume the same
    // data descriptors that were validated, never later dynamic property reads.
    const a = await authorized();
    const obs = observation(); (obs.claimant as any).sequence = "10";
    const otherPlan = seed.createSeedClaimPlan({ ...a.input, observation: obs });
    let planReads = 0;
    const options = new Proxy({ ...a.requestInput }, {
      get(target, key, receiver) {
        if (key === "plan" && ++planReads === 8) return otherPlan;
        return Reflect.get(target, key, receiver);
      },
    });
    const request = seed.createSeedSigningRequest(options);
    expect(request.unsigned_payload_hash).toBe(a.plan.sign_doc_bytes_hash);
    expect(request.unsigned_payload_hash).not.toBe(otherPlan.sign_doc_bytes_hash);
    expect(planReads).toBe(0);
  });
  test("every branded API consumes descriptor snapshots, including nested usage", async () => {
    const a = await authorized();
    const descriptorOnly = <T extends object>(value: T): T => new Proxy(value, {
      get() { throw new Error("dynamic property read is not a validated descriptor"); },
    });
    expect(seed.assessSeedClaim(descriptorOnly({ profile: PROFILE, policy: POLICY, observation: observation(), signer_public_key_b64u: KEY, now: NOW })).status).toBe("ready");
    expect(seed.createSeedClaimPlan(descriptorOnly({ ...a.input })).plan_id).toBe(a.plan.plan_id);
    expect(seed.createSeedSimulationReceiptCore(descriptorOnly({ ...a.receiptInput }))).toEqual(a.core);
    expect(seed.createSeedSimulationBinding(descriptorOnly({ plan: a.plan, simulation: a.simulation, result: a.result })).plan_id).toBe(a.plan.plan_id);
    const checked = seed.authorizeSeedClaim(descriptorOnly({ ...a.authorizationInput, context: descriptorOnly({ ...context(), usage: descriptorOnly(context().usage) }) }));
    expect(checked.checked_at).toBe(NOW);
    expect(seed.createSeedSigningRequest(descriptorOnly({ ...a.requestInput, authorization: checked })).unsigned_payload_hash).toBe(a.plan.sign_doc_bytes_hash);
    expect(() => seed.authorizeSeedClaim({ ...a.authorizationInput, context: { ...context(), extra: true } } as never)).toThrow();
    let reads = 0;
    const accessor = { ...a.requestInput };
    Object.defineProperty(accessor, "plan", { enumerable: true, get() { reads++; return a.plan; } });
    expect(() => seed.createSeedSigningRequest(accessor)).toThrow(); expect(reads).toBe(0);
  });
  test("generic Wallet authorization and JSON cannot launder Seed provenance", async () => {
    const a = await authorized();
    for (const field of ["plan", "simulation", "binding", "authorization"] as const) expect(() => seed.createSeedSigningRequest({ ...a.requestInput, [field]: clone(a.requestInput[field]) })).toThrow();
    expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, plan: clone(a.plan) })).toThrow();
    expect(() => seed.createSeedSimulationBinding({ plan: clone(a.plan), simulation: a.simulation, result: a.result })).toThrow();
    const generic = assertIntentWithinCapabilityStatic({ ...a.bundle, simulation: a.simulation, context: context() });
    expect(() => seed.createSeedSigningRequest({ ...a.requestInput, authorization: generic })).toThrow();
    const second = await authorized();
    expect(second.plan.plan_id).toBe(a.plan.plan_id);
    expect(() => seed.createSeedSigningRequest({ ...a.requestInput, binding: second.binding })).toThrow();
    expect(() => seed.createSeedSigningRequest({ ...a.requestInput, simulation: second.simulation })).toThrow();
  });
  test("reject widened capability, wrong policy, altered payload, spend and native value", async () => {
    const base = await planned();
    for (const cap of [{ policy_hash: D("0") }, { max_intents: 2 }, { accounts: [POLICY.sponsor_account] },
      { fee_limits: [{ asset_id: PROFILE.native_asset_id, max_per_intent: "200001" }] },
      { spend_limits: [{ asset_id: PROFILE.native_asset_id, max_per_intent: "1", max_total: "1" }] },
      { call_rules: [{ target_account: PROFILE.claiming_pot_account, actions: ["call"], methods: ["other", seed.SEED_CLAIM_METHOD], requires_approval: false }] },
      { issued_at: "2026-09-08T07:59:00.000Z", not_before: "2026-09-08T07:59:00.000Z" }, { expires_at: "2026-09-08T08:06:00.000Z" },
    ]) { const bundle = await records(cap as never); expect(() => seed.createSeedClaimPlan({ ...base.input, capability: bundle.capability, intent: bundle.intent })).toThrow(); }
    const call = base.bundle.intent.calls[0]!;
    const changedClaim = seed.encodeSeedMsgClaim({ claimant: RECIPIENT_ADDRESS, pot_id: `bootstrap-${RECIPIENT_ADDRESS}` });
    for (const change of [{ source_account: POLICY.sponsor_account }, { max_fee: { asset_id: PROFILE.native_asset_id, amount_atomic: "0" } },
      { calls: [{ ...call, target_account: POLICY.sponsor_account }] }, { calls: [{ ...call, method: "cosmos.bank.v1beta1.MsgSend" }] },
      { calls: [{ ...call, payload_b64u: base64UrlEncode(changedClaim), payload_hash: sha256BytesId(changedClaim) }] },
      { calls: [{ ...call, native_value: { asset_id: PROFILE.native_asset_id, amount_atomic: "1" } }], declared_spends: [{ asset_id: PROFILE.native_asset_id, amount_atomic: "1" }] },
      { declared_spends: [{ asset_id: PROFILE.native_asset_id, amount_atomic: "1" }] }, { calls: [call, call] },
    ]) { const bundle = await records({}, change); expect(() => seed.createSeedClaimPlan({ ...base.input, capability: bundle.capability, intent: bundle.intent })).toThrow(); }
  });
  test("core usage revocation, exhaustion, approvals, and lifetime gates remain enforced", async () => {
    const a = await authorized();
    for (const usage of [{ ...context().usage, revocation_nonce: 1 }, { ...context().usage, intent_count: 1 }]) expect(() => seed.authorizeSeedClaim({ ...a.authorizationInput, context: { now: NOW, usage } })).toThrow();
    expect(() => seed.authorizeSeedClaim({ ...a.authorizationInput, context: { ...context(), now: END } })).toThrow();
    const approvals = await records({ approval_threshold: 1, call_rules: [{ target_account: PROFILE.claiming_pot_account, actions: ["call"], methods: [seed.SEED_CLAIM_METHOD], requires_approval: true }] });
    const plan = seed.createSeedClaimPlan({ ...a.input, capability: approvals.capability, intent: approvals.intent });
    const result = { ...a.result, plan_id: plan.plan_id, simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash };
    const core = seed.createSeedSimulationReceiptCore({ ...a.receiptInput, plan, result, intent: approvals.intent });
    const simulation = await sealSimulationReceipt(core, simulationAdapter.signer);
    const input = { profile: PROFILE, policy: POLICY, ...approvals, simulation, context: context() };
    expect(() => seed.authorizeSeedClaim(input)).toThrow();
    expect(() => seed.authorizeSeedClaim({ ...input, context: { now: NOW, usage: { ...context().usage, host_verified_approval_ids: ["approved-exact-fixture"] } } })).not.toThrow();
  });
  test("native infinite-meter GasWanted never substitutes for finite transaction gas", async () => {
    // Independently measured SDK0.53.8 ante.SetGasMeter(true,...).Limit(), not
    // a transaction gas limit. Keep native gas_used bounded by the committed cap.
    const a = await authorized();
    const result = { ...a.result, gas_wanted: "18446744073709551615" };
    const core = seed.createSeedSimulationReceiptCore({ ...a.receiptInput, result });
    const simulation = await sealSimulationReceipt(core, simulationAdapter.signer);
    const binding = seed.createSeedSimulationBinding({ plan: a.plan, simulation, result });
    const authorization = seed.authorizeSeedClaim({ ...a.authorizationInput, simulation });
    const request = seed.createSeedSigningRequest({ ...a.requestInput, simulation, binding, authorization });
    expect(request.unsigned_payload_hash).toBe(a.plan.sign_doc_bytes_hash);
    expect(a.plan.commitment.gas_limit).toBe("100000"); expect(core.estimated_fee.amount_atomic).toBe("100000");
    expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, result: { ...result, gas_used: "100001" } })).toThrow();
    expect(() => seed.createSeedClaimPlan({ ...a.input, gas_limit: result.gas_wanted })).toThrow();
    expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, result: { ...result, gas_wanted: "18446744073709551614" } })).toThrow();
    expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, result: { ...result, gas_wanted: "18446744073709551616" } })).toThrow();
    expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, result: { ...result, gas_wanted: a.plan.commitment.gas_limit } })).not.toThrow();
  });
  test("simulation substitutions and failed/oversized/old gas observations never bind", async () => {
    const a = await authorized();
    for (const changes of [{ plan_id: D("0") }, { simulation_tx_bytes_hash: D("0") }, { status: "failed" }, { code: 1 }, { gas_used: "100001" }, { gas_used: "0" }, { gas_wanted: "100001" },
      { evidence: { ...a.result.evidence, genesis_hash: D("0") } }, { evidence: { ...a.result.evidence, node_trust_id: D("0") } },
      { evidence: { ...a.result.evidence, catching_up: true } },
    ]) expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, result: { ...a.result, ...changes } as never })).toThrow();
    const failed = { ...a.result, status: "failed" as const, code: 1 };
    const failedCore = seed.createSeedSimulationReceiptCore({ ...a.receiptInput, result: failed }); expect(failedCore.success).toBe(false);
    const failedRecord = await sealSimulationReceipt(failedCore, simulationAdapter.signer);
    expect(() => seed.createSeedSimulationBinding({ plan: a.plan, simulation: failedRecord, result: failed })).toThrow();
    for (const change of [{ block_hash: D("0") }, { block_ref: "seed-local-1:99" }, { estimated_fee: { asset_id: PROFILE.native_asset_id, amount_atomic: "99999" } }, { effects: [] }]) {
      const simulation = await sealSimulationReceipt({ ...a.core, ...change }, simulationAdapter.signer);
      expect(() => seed.createSeedSimulationBinding({ plan: a.plan, simulation, result: a.result })).toThrow();
    }
    expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, valid_until: "2026-09-08T08:06:00.000Z" })).toThrow();
    expect(() => seed.createSeedSimulationReceiptCore({ ...a.receiptInput, simulated_at: "2026-09-08T08:02:00.000Z", valid_until: "2026-09-08T08:03:00.000Z" })).toThrow();
  });
  test("reauthorization cannot revive stale full-node simulation; request IDs retain Wallet UUID requirement", async () => {
    const a = await authorized();
    const core = { ...a.core, valid_until: END };
    const simulation = await sealSimulationReceipt(core, simulationAdapter.signer);
    const binding = seed.createSeedSimulationBinding({ plan: a.plan, simulation, result: a.result });
    const authorization = seed.authorizeSeedClaim({ ...a.authorizationInput, simulation, context: { ...context(), now: "2026-09-08T08:02:00.000Z" } });
    expect(() => seed.createSeedSigningRequest({ ...a.requestInput, simulation, binding, authorization })).toThrow();
    expect(() => seed.createSeedSigningRequest({ ...a.requestInput, request_id: "helper-id-not-wallet-uuid" })).toThrow();
    expect(() => seed.createSeedSigningRequest({ ...a.requestInput, request_id: "x".repeat(65) })).toThrow();
  });
});
