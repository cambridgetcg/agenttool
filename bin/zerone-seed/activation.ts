import { dirname, join } from "node:path";
import { sha256Id } from "@agenttool/wallet";
import type { SeedObservation, SeedPolicy, SeedProfile } from "../../packages/wallet-zerone/src/bootstrap/types.js";
import type { ReservedBundle } from "./store.js";
import { ledgerBinding, type SeedConfig, type Executable } from "./config.js";
import { oneShot } from "./adapters.js";
import { check, closed, fileDigest, freeze, hash, same, timestamp } from "./validation.js";

export type ActivationConfig = {mode:"disposable-local"} | {
  mode:"production"|"synthetic"; python:Executable; verifier:Executable; codec_sha256:string; gpgv:Executable;
  bundle:string; trust_file:string; trust_sha256:string; packet_sha256:string; evidence_sha256:string|null;
  public_keyring:string; artifact_root:string; beta_bundle_manifest:string; authority_verifier:string;
};
export interface PreSignOperation {
  operation_id:string; host_id:string; ledger_id:string; ledger_binding_hash:string; ledger_snapshot_sha256:string;
  profile_id:string; source_digest:string; policy_hash:string; plan_id:string; commitment_hash:string;
  descriptor_id:string; capability_record_id:string; intent_record_id:string; simulation_record_id:string;
  bundle_hash:string; observation_hash:string; currentness_sha256:string; budget_sha256:string;
  request_id:string; sign_doc_bytes_hash:string; signer_key_id:string; prepared_at:string;
  account_number:string; sequence:string; fee_uzrn:string; gas_limit:string; timeout_height:string; expires_at:string;
  attempt_status:"unreserved"; ledger_available:true; max_intents_used:number;
  required_grant_exposure_uzrn:string; required_setup_exposure_uzrn:string;
}
export interface PreSignCandidate {
  protocol:"zerone-seed-runtime.presign/0.1"; bundle:ReservedBundle; observation:SeedObservation; operation:PreSignOperation;
}
export interface GateResult {
  schema:"zerone-seed-gate-result/v1"; result:"SYNTHETIC_MATCH"|"AUTHENTICATED_INPUTS_MATCH";
  stage:"operation"; environment:"production"|"synthetic"; activation_sha256:string; evidence_sha256:string; trust_sha256:string;
  chain_truth:"not_independently_verified"; effects:"none"; replay_protection:"host_atomic_ledger_required"; operation_id:string;
  operation:PreSignOperation; profile:SeedProfile; policies:SeedPolicy[]; cli_sha256:string;
  sponsor_other_exposure_uzrn:string; observed_at:string;
}
const verifiedGates=new WeakMap<object,Readonly<SeedConfig>>();

/** Inert coordinates only: no signing request/authorization brand, slot or journal write. */
export function preSignOperation(c:SeedConfig,b:ReservedBundle,observation:SeedObservation,snapshot:{currentness:unknown;budget:unknown},ledger:unknown,uses:number,request_id:string):PreSignOperation {
  const p=b.plan, commitment=p.commitment;
  check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(request_id));
  const core={host_id:c.host_id,ledger_id:c.ledger_id,ledger_binding_hash:sha256Id(ledgerBinding(c)),ledger_snapshot_sha256:sha256Id(ledger),
    profile_id:c.profile.profile_id,source_digest:c.profile.source_digest,policy_hash:c.policy.policy_hash,plan_id:p.plan_id,commitment_hash:p.commitment_hash,
    descriptor_id:b.descriptor.record_id,capability_record_id:b.capability.record_id,intent_record_id:b.intent.record_id,simulation_record_id:b.simulation.record_id,
    bundle_hash:sha256Id(b),observation_hash:sha256Id(observation),currentness_sha256:sha256Id(snapshot.currentness),budget_sha256:sha256Id(snapshot.budget),
    request_id,sign_doc_bytes_hash:p.sign_doc_bytes_hash,signer_key_id:commitment.signer_key_id,prepared_at:b.prepared_at,
    account_number:commitment.account_number,sequence:commitment.sequence,fee_uzrn:commitment.fee_amount_uzrn,gas_limit:commitment.gas_limit,timeout_height:commitment.timeout_height,expires_at:commitment.expires_at,
    attempt_status:"unreserved" as const,ledger_available:true as const,max_intents_used:uses,
    required_grant_exposure_uzrn:c.policy.grant_spend_limit_uzrn,required_setup_exposure_uzrn:c.policy.setup_fee_budget_uzrn};
  return freeze({...core,operation_id:sha256Id(core)});
}

// -I excludes Python user paths/environment. Load the one pinned local dependency
// explicitly; never insert the bundle or verifier directory into the module path.
const PYTHON_BOOT="import importlib.util,runpy,sys; v=sys.argv.pop(1); c=sys.argv.pop(1); s=importlib.util.spec_from_file_location('frozen_evidence',c); m=importlib.util.module_from_spec(s); sys.modules['frozen_evidence']=m; s.loader.exec_module(m); sys.argv[0]=v; runpy.run_path(v,run_name='__main__')";
export async function verifyActivation(c:Readonly<SeedConfig>,candidate:PreSignCandidate):Promise<Readonly<GateResult>> {
  const g=c.activation_gate; check(g.mode !== "disposable-local","activation_required");
  check(g.evidence_sha256 !== null,"activation_evidence_required");
  const codec=join(dirname(g.verifier.path),"frozen_evidence.py");
  const pins=()=>{check(fileDigest(g.verifier.path) === g.verifier.sha256,"activation_verifier_drift");check(fileDigest(codec) === g.codec_sha256,"activation_codec_drift");check(fileDigest(g.gpgv.path) === g.gpgv.sha256,"activation_gpgv_drift");};
  pins();
  const result=await oneShot(g.python,["-I","-B","-c",PYTHON_BOOT,g.verifier.path,codec,"operation","--mode",g.mode,
    "--bundle",g.bundle,"--trust",g.trust_file,"--trust-sha256",g.trust_sha256,"--packet-sha256",g.packet_sha256,"--evidence-sha256",g.evidence_sha256,
    "--public-keyring",g.public_keyring,"--gpgv",g.gpgv.path,"--artifact-root",g.artifact_root,"--beta-bundle-manifest",g.beta_bundle_manifest,
    "--authority-verifier",g.authority_verifier,"--operation-id",candidate.operation.operation_id],{},30000);
  pins();
  closed(result,"schema result stage environment activation_sha256 evidence_sha256 trust_sha256 chain_truth effects replay_protection operation_id operation profile policies cli_sha256 sponsor_other_exposure_uzrn observed_at");
  check(result.schema === "zerone-seed-gate-result/v1" && result.stage === "operation" && result.environment === g.mode);
  check(result.result === (g.mode === "production" ? "AUTHENTICATED_INPUTS_MATCH":"SYNTHETIC_MATCH"),"activation_refused");
  check(result.activation_sha256 === g.packet_sha256 && result.evidence_sha256 === g.evidence_sha256 && result.trust_sha256 === g.trust_sha256);
  check(result.chain_truth === "not_independently_verified" && result.effects === "none" && result.replay_protection === "host_atomic_ledger_required");
  same(result.profile,c.profile);same(result.operation,candidate.operation);check(result.operation_id === candidate.operation.operation_id);
  check(Array.isArray(result.policies) && result.policies.length > 0 && result.policies.length <= 32);
  const policies=result.policies.filter((p:SeedPolicy)=>p.policy_hash === c.policy.policy_hash);check(policies.length === 1);same(policies[0],c.policy);
  hash(result.cli_sha256);check(fileDigest(process.execPath) === result.cli_sha256,"executing_cli_drift");
  const out=freeze(result as GateResult);verifiedGates.set(out,c);return out;
}
export function assertActivation(c:Readonly<SeedConfig>,gate:Readonly<GateResult>,op:PreSignOperation,now:string):void {
  check(verifiedGates.get(gate) === c,"unverified_activation_result");same(gate.operation,op);
  check(timestamp(gate.observed_at) <= timestamp(now) && timestamp(now)-timestamp(gate.observed_at) <= c.policy.max_observation_age_seconds*1000,"stale_activation");
  check(timestamp(now) < timestamp(op.expires_at),"expired_activation");
}
