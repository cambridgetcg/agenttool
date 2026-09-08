import { spawn } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { isatty } from "node:tty";
import { dirname } from "node:path";
import { canonicalJson, strictEd25519Verify, type RecordSigner } from "@agenttool/wallet";
import { assessSeedClaim, assertSeedClaimPlan } from "../../packages/wallet-zerone/src/bootstrap/v1.js";
import type { SeedIoRequest, SeedIoResponse, SeedReadEvidence, SeedSignedSummary, SeedClaimPlan, SeedLookupResult } from "../../packages/wallet-zerone/src/bootstrap/types.js";
import type { Executable, ProviderConfig, SeedConfig } from "./config.js";
import { executable } from "./config.js";
import { absolute, b64, check, closed, fileDigest, freeze, hash, MAX_JSON, openChecked, parse, same, timestamp, u64, uint } from "./validation.js";

const nativeResults = new WeakMap<object,{config: Readonly<SeedConfig>; command: string}>();
export function assertNativeResult(value: object,c: Readonly<SeedConfig>,command: string): void {
  const origin=nativeResults.get(value); check(origin?.config === c && origin.command === command,"untrusted_native_result");
}

/** No shell, inherited credentials, stdout logs, diagnostic bodies, retries or unbounded buffers. */
export async function oneShot(e: Executable, argv: string[], input: unknown, timeout: number): Promise<unknown> {
  executable(e); check(fileDigest(e.path) === e.sha256, "executable_digest_mismatch");
  const stdin = canonicalJson(input); check(Buffer.byteLength(stdin) <= MAX_JSON);
  check(Number.isInteger(timeout) && timeout >= 1 && timeout <= 30000);
  return await new Promise((resolve,reject) => {
    let done = false, outSize = 0, errSize = 0; const chunks: Buffer[] = [];
    const child = spawn(e.path,argv,{shell:false,stdio:["pipe","pipe","pipe"],cwd:"/",env:{PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C",TZ:"UTC"}});
    const finish = (error?: unknown, result?: unknown) => {
      if (done) return; done = true; clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); } else resolve(result);
    };
    const failure = () => { try { check(false,"helper_unavailable"); } catch(e) { finish(e); } };
    const timer = setTimeout(failure,timeout);
    child.on("error",failure); child.stdin.on("error",failure);
    child.stdout.on("data",(b: Buffer) => { if ((outSize += b.length) > MAX_JSON) failure(); else chunks.push(b); });
    // Never preserve or relay diagnostics from a custody process.
    child.stderr.on("data",(b: Buffer) => { if ((errSize += b.length) > 8192) failure(); });
    child.on("close",code => {
      if (done) return;
      try { check(code === 0,"helper_unavailable"); finish(undefined,parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)))); }
      catch { failure(); }
    });
    child.stdin.end(stdin);
  });
}
export class ExternalRecordSigner implements RecordSigner {
  readonly public_key: string;
  constructor(private readonly config: ProviderConfig, private readonly timeout = 10000) { this.public_key = config.authority.public_key; }
  async sign_digest(digest: Uint8Array): Promise<string> {
    check(digest.length === 32);
    const response = await oneShot(this.config.executable,["sign-digest","--key-file",this.config.key_file,"--expected-public-key",this.public_key],
      {protocol:"zerone-seed-record-signer/0.1",digest_b64u:Buffer.from(digest).toString("base64url")},this.timeout);
    closed(response,"protocol algorithm public_key signature");
    check(response.protocol === "zerone-seed-record-signer/0.1" && response.algorithm === "Ed25519" && response.public_key === this.public_key,"record_provider_mismatch");
    check(strictEd25519Verify(b64(response.signature,64),digest,b64(this.public_key,32)),"record_signature_invalid"); return response.signature;
  }
}
const REASONS = ["unavailable","not_found_unproven","unsupported_state","incoherent_height","chain_mismatch","genesis_mismatch","stale","catching_up","response_limit","invalid_response"];
function anchor(a: any): void { closed(a,"height block_hash block_time"); u64(a.height,true); hash(a.block_hash); timestamp(a.block_time); }
export function evidence(e: SeedReadEvidence,c: SeedConfig,now: string, fresh = true): void {
  closed(e,"trust node_trust_id profile_id chain_id genesis_hash anchor latest_height catching_up observed_at"); anchor(e.anchor); u64(e.latest_height,true); timestamp(e.observed_at);
  check(e.trust === "configured_full_node" && e.node_trust_id === c.node.node_trust_id && e.profile_id === c.profile.profile_id && e.chain_id === c.profile.chain_id && e.genesis_hash === c.profile.genesis_hash,"node_binding_mismatch");
  check(e.catching_up === false && BigInt(e.latest_height) >= BigInt(e.anchor.height));
  check(BigInt(e.latest_height) - BigInt(e.anchor.height) <= BigInt(c.policy.max_height_lag));
  if (fresh) {
    const n = timestamp(now), age = c.policy.max_observation_age_seconds*1000;
    check(timestamp(e.anchor.block_time) <= n && n - timestamp(e.anchor.block_time) <= age && timestamp(e.observed_at) <= n && n - timestamp(e.observed_at) <= age,"stale_observation");
  }
}
export function summary(s: SeedSignedSummary,plan: SeedClaimPlan): void {
  closed(s,"plan_id commitment_hash signer_key_id sign_doc_bytes_hash signed_tx_bytes_hash tx_hash");
  check(s.plan_id === plan.plan_id && s.commitment_hash === plan.commitment_hash && s.signer_key_id === plan.commitment.signer_key_id && s.sign_doc_bytes_hash === plan.sign_doc_bytes_hash,"signed_plan_mismatch");
  hash(s.signed_tx_bytes_hash); check(/^[0-9A-F]{64}$/.test(s.tx_hash) && s.signed_tx_bytes_hash === `sha256:${s.tx_hash.toLowerCase()}`,"signed_hash_mismatch");
}
function allowance(a: any): void {
  closed(a,a.status === "absent" ? "status" : "status granter grantee type_url inner_type_url allowed_messages spend_limit_uzrn expires_at");
  if (a.status === "absent") return;
  check(a.status === "found" && a.type_url === "/cosmos.feegrant.v1beta1.AllowedMsgAllowance" && a.inner_type_url === "/cosmos.feegrant.v1beta1.BasicAllowance");
  same(a.allowed_messages,["/zerone.claiming_pot.v1.MsgClaim"]); uint(a.spend_limit_uzrn); timestamp(a.expires_at);
}
export function lookupResult(r: SeedLookupResult,c: SeedConfig,plan: SeedClaimPlan,tx: string,now: string): void {
  check(r !== null && typeof r === "object");
  closed(r,r.status === "included" ? "status tx_hash inclusion evidence code gas_used credited_amount_uzrn claimant_sequence allowance" : r.status === "absent" ? "status tx_hash evidence" : "status tx_hash reason");
  check(r.tx_hash === tx && /^[0-9A-F]{64}$/.test(r.tx_hash));
  if (r.status === "unknown") { check(REASONS.includes(r.reason)); return; }
  check(r.status === "included" || r.status === "absent"); evidence(r.evidence,c,now);
  if (r.status === "absent") return;
  anchor(r.inclusion); check(BigInt(r.evidence.anchor.height) >= BigInt(r.inclusion.height)+1n,"confirmation_missing");
  check(Number.isSafeInteger(r.code) && r.code >= 0 && r.code <= 4294967295); u64(r.gas_used); u64(r.claimant_sequence); allowance(r.allowance);
  if (r.allowance.status === "found") check(r.allowance.granter === c.policy.sponsor_account.split(":").at(-1) && r.allowance.grantee === c.policy.claimant_account.split(":").at(-1));
  if (r.credited_amount_uzrn !== null) { uint(r.credited_amount_uzrn,true); check(r.code === 0 && BigInt(r.credited_amount_uzrn) <= BigInt(c.profile.seed_amount_uzrn)); }
  // DeliverTx may fail in ante before sequence increment. Inclusion and fence
  // retirement are independent facts; neither failure nor absence refunds a use.
  check(BigInt(r.claimant_sequence) >= BigInt(plan.commitment.sequence),"sequence_rollback");
  if(r.code === 0) check(BigInt(r.claimant_sequence) > BigInt(plan.commitment.sequence),"sequence_not_advanced");
}
/** No unlock/read/write: validate the explicitly selected terminal before reserving a use.
 * Rechecked at native invocation; a later disappearance is still signing_unknown.
 * The helper owns password entry and final terminal/key checks, not this host.
 */
export function preflightKeyringSigner(c: Readonly<SeedConfig>): string | null {
  check(c.keyring.backend === "file" || c.keyring.backend === "test", "unsupported_keyring_backend");
  if (c.keyring.backend === "test") {
    check(c.disposable_test && c.node.mode === "local" && c.profile.chain_reference.startsWith("seed-local-") && c.keyring_unlock_terminal === null, "test_keyring_not_local");
    return null;
  }
  const path=c.keyring_unlock_terminal;
  check(path !== null, "unlock_terminal_required"); absolute(path);
  check(path !== "/dev/tty", "unsafe_unlock_terminal"); // Never select the ambient controlling TTY.
  let fd: number | undefined;
  try {
    const named=lstatSync(path);
    // Reject special nonterminals/symlinks first. Canonicalize only the parent:
    // Bun's realpath may open its input, bypassing our nonblocking/no-ctty flags.
    check(named.isCharacterDevice() && named.uid === process.getuid!(), "unsafe_unlock_terminal");
    check(realpathSync(dirname(path)) === dirname(path), "unsafe_unlock_terminal");
    fd=openSync(path,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_NOCTTY);
    const s=fstatSync(fd);
    check(s.isCharacterDevice() && s.uid === process.getuid!() && s.dev === named.dev && s.ino === named.ino && isatty(fd), "unsafe_unlock_terminal");
  } catch { check(false,"unsafe_unlock_terminal"); }
  finally { if(fd !== undefined) closeSync(fd); }
  return path;
}
export class NativeSeedIo {
  constructor(readonly config: Readonly<SeedConfig>) {}
  async call<T extends SeedIoRequest>(request: T): Promise<Extract<SeedIoResponse,{status:"ok"}>["result"]> {
    const c = this.config;
    check(request.protocol === "zerone-seed-io/0.1" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(request.request_id));
    same(request.profile,c.profile);
    if ("policy" in request) same(request.policy,c.policy);
    if ("node" in request) same(request.node,c.node);
    if ("plan" in request) assertSeedClaimPlan(request.plan,c.profile,c.policy);
    if ("signed_tx_path" in request) { check(request.signed_tx_path === c.signed_tx_path); if (request.command !== "sign") closeSync(openChecked(c.signed_tx_path,16384,true)); }
    check(fileDigest(c.helper_trust_file,MAX_JSON) === c.helper_trust_sha256,"helper_trust_mismatch");
    const argv = [request.command,"--trust-file",c.helper_trust_file]; if(c.disposable_test) argv.push("--disposable-test");
    if(request.command === "sign") {
      same(request.keyring,c.keyring);
      const terminal=preflightKeyringSigner(c);
      if(terminal !== null) argv.push("--unlock-terminal",terminal);
    }
    const response = await oneShot(c.helper,argv,request,request.timeout_ms);
    check(response !== null && typeof response === "object");
    const r = response as SeedIoResponse;
    closed(r,r.status === "ok" ? "protocol request_id command status result" : "protocol request_id command status code");
    check(r.protocol === request.protocol && r.command === request.command && r.request_id === request.request_id,"helper_response_mismatch");
    check(r.status === "ok","helper_failed");
    const result: any = r.result, now = new Date().toISOString();
    check(result !== null && typeof result === "object");
    switch(request.command) {
      case "inspect":
        assessSeedClaim({profile:c.profile,policy:c.policy,observation:result,signer_public_key_b64u:c.signer_public_key_b64u,now});
        if(result.status === "observed") evidence(result.evidence,c,now);
        else { closed(result,"protocol status profile_id reason"); check(result.status === "unknown" && result.profile_id === c.profile.profile_id && REASONS.includes(result.reason)); }
        break;
      case "simulate":
        closed(result,"status plan_id simulation_tx_bytes_hash evidence code gas_wanted gas_used");
        check(["succeeded","failed"].includes(result.status) && result.plan_id === request.plan.plan_id && result.simulation_tx_bytes_hash === request.plan.simulation_tx_bytes_hash);
        evidence(result.evidence,c,now); check(result.evidence.anchor.height === request.height && result.evidence.latest_height === request.height,"latest_simulation_required");
        check(Number.isSafeInteger(result.code) && result.code >= 0 && result.code <= 4294967295 && (result.status === "succeeded") === (result.code === 0)); u64(result.gas_wanted); u64(result.gas_used); break;
      case "sign": case "verify": summary(result,request.plan); closeSync(openChecked(c.signed_tx_path,16384,true)); break;
      case "submit": closed(result,"status tx_hash"); check(["accepted","submission_unknown"].includes(result.status) && result.tx_hash === request.expected_tx_hash); break;
      case "lookup": lookupResult(result,c,request.plan,request.tx_hash,now); break;
      default: {
        closed(result,"type_url value_b64u value_hash");
        const expected = {"operator-grant":"/cosmos.feegrant.v1beta1.MsgGrantAllowance","operator-revoke":"/cosmos.feegrant.v1beta1.MsgRevokeAllowance","operator-admit":"/zerone.claiming_pot.v1.MsgAddBootstrapEntry"}[request.command];
        check(result.type_url === expected && b64(result.value_b64u).length <= 16384); hash(result.value_hash);
        const {digest} = await import("./validation.js"); check(digest(b64(result.value_b64u)) === result.value_hash);
      }
    }
    freeze(r.result); nativeResults.set(r.result,{config:c,command:request.command});
    return r.result;
  }
}
