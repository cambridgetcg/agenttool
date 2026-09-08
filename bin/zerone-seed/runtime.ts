import { randomUUID } from "node:crypto";
import { sealSimulationReceipt } from "@agenttool/wallet";
import { assessSeedClaim, createSeedClaimPlan, createSeedSimulationReceiptCore } from "../../packages/wallet-zerone/src/bootstrap/v1.js";
import type { SeedIoRequest, SeedObservation, SeedSimulationResult, SeedSignedSummary, SeedLookupResult } from "../../packages/wallet-zerone/src/bootstrap/types.js";
import { NativeSeedIo, ExternalRecordSigner, preflightKeyringSigner } from "./adapters.js";
import { records, trustedSnapshot, verifyCurrent, validateConfig, type SeedConfig } from "./config.js";
import { verifyActivation, type PreSignCandidate, type GateResult } from "./activation.js";
import { SeedStore, restoreBundle, type PreparedClaim, type ReservedBundle } from "./store.js";
import { check, closed, same, timestamp } from "./validation.js";

export class SeedRuntime {
  readonly io: NativeSeedIo;
  constructor(readonly config: Readonly<SeedConfig>) { validateConfig(config); this.io = new NativeSeedIo(config); }
  private base() { return {protocol:"zerone-seed-io/0.1" as const,request_id:randomUUID(),timeout_ms:this.config.timeout_ms}; }
  private async observe(): Promise<SeedObservation> {
    const c=this.config;
    return await this.io.call({...this.base(),command:"inspect",profile:c.profile,policy:c.policy,node:c.node,height:null}) as SeedObservation;
  }
  async inspect() {
    const c=this.config; verifyCurrent(c,records(c),trustedSnapshot(c),new Date().toISOString());
    const observation=await this.observe();
    const assessment=assessSeedClaim({profile:c.profile,policy:c.policy,observation,signer_public_key_b64u:c.signer_public_key_b64u,now:new Date().toISOString()});
    return {protocol:"zerone-seed-runtime.inspection/0.1",profile_id:c.profile.profile_id,policy_hash:c.policy.policy_hash,observation,assessment,custody_opened:false};
  }
  async prepare(): Promise<PreparedClaim> {
    const c=this.config, r=records(c); verifyCurrent(c,r,trustedSnapshot(c),new Date().toISOString());
    const observation=await this.observe(), prepared_at=new Date().toISOString();
    const plan=createSeedClaimPlan({profile:c.profile,policy:c.policy,observation,signer_public_key_b64u:c.signer_public_key_b64u,now:prepared_at,capability:r.capability,intent:r.intent,fee_amount_uzrn:c.fee_amount_uzrn,gas_limit:c.gas_limit});
    return {plan,observation,prepared_at};
  }
  init() { const store=new SeedStore(this.config,true,true); try {return store.status();} finally {store.close();} }
  status() { const store=new SeedStore(this.config); try {return store.status();} finally {store.close();} }
  private async simulatedBundle(prepared: PreparedClaim) {
    closed(prepared,"plan observation prepared_at");
    check(timestamp(prepared.prepared_at) <= Date.now(),"future_preparation");
    const c=this.config,r=records(c); verifyCurrent(c,r,trustedSnapshot(c),new Date().toISOString());
    check(prepared.observation.status === "observed");
    const plan=createSeedClaimPlan({profile:c.profile,policy:c.policy,observation:prepared.observation,signer_public_key_b64u:c.signer_public_key_b64u,now:prepared.prepared_at,capability:r.capability,intent:r.intent,fee_amount_uzrn:c.fee_amount_uzrn,gas_limit:c.gas_limit});
    same(plan,prepared.plan);
    // Early read-only replay refusal precedes even simulation-record signing.
    const existing=new SeedStore(c); try { check(!existing.status().operations.some(o=>o.operation_id === plan.plan_id),"already_reserved"); } finally {existing.close();}
    const observation=await this.observe(); check(observation.status === "observed");
    const result=await this.io.call({...this.base(),command:"simulate",profile:c.profile,policy:c.policy,plan,node:c.node,height:observation.evidence.anchor.height}) as SeedSimulationResult;
    const now=new Date().toISOString();
    const validUntil=new Date(Math.min(timestamp(now)+c.policy.max_observation_age_seconds*1000,timestamp(c.policy.expires_at),timestamp(r.intent.expires_at))).toISOString();
    const core=createSeedSimulationReceiptCore({plan,intent:r.intent,result,adapter:c.simulation_provider.authority,simulation_id:randomUUID(),simulated_at:now,valid_until:validUntil});
    const simulation=await sealSimulationReceipt(core,new ExternalRecordSigner(c.simulation_provider,c.timeout_ms));
    const bundle: ReservedBundle={...prepared,...r,simulation,simulation_result:result};
    return {bundle,observation};
  }
  async preSign(prepared:PreparedClaim):Promise<PreSignCandidate> {
    preflightKeyringSigner(this.config);
    const {bundle,observation}=await this.simulatedBundle(prepared),c=this.config,store=new SeedStore(c);
    try {return store.preSign(bundle,observation,trustedSnapshot(c),randomUUID());} finally {store.close();}
  }
  async reserveSign(input: PreparedClaim|PreSignCandidate) {
    const c=this.config;
    preflightKeyringSigner(c);
    let bundle:ReservedBundle,observation:SeedObservation,requestId:string;
    let activation:{candidate:PreSignCandidate;gate:Readonly<GateResult>}|undefined;
    if(c.activation_gate.mode === "disposable-local") {
      ({bundle,observation}=await this.simulatedBundle(input as PreparedClaim));requestId=randomUUID();
    } else {
      closed(input,"protocol bundle observation operation");check("protocol" in input && input.protocol === "zerone-seed-runtime.presign/0.1","presign_required");
      const candidate=input as PreSignCandidate;bundle=candidate.bundle;
      check(timestamp(bundle.prepared_at) <= Date.now(),"future_preparation");restoreBundle(c,bundle);
      // Refuse a replay before launching even the read-only external gate.
      const existing=new SeedStore(c);try {check(!existing.status().operations.some(o=>o.operation_id === bundle.plan.plan_id),"already_reserved");} finally {existing.close();}
      const gate=await verifyActivation(c,candidate);activation={candidate,gate};
      observation=await this.observe();requestId=candidate.operation.request_id;
    }
    preflightKeyringSigner(c); // Async preparation cannot carry a stale terminal preflight across the boundary.
    const plan=bundle.plan,snapshot=trustedSnapshot(c), store=new SeedStore(c,true);
    let boundary: ReturnType<SeedStore["reserveAndEnterSigning"]>;
    try { boundary=store.reserveAndEnterSigning(bundle,observation,snapshot,requestId,activation); }
    finally {store.close();}
    // From here every failure is sticky. Missing executable/key process is not permission to retry.
    try {
      await this.io.call({...this.base(),request_id:boundary.request.request_id,command:"sign",profile:c.profile,policy:c.policy,plan,keyring:c.keyring,signed_tx_path:c.signed_tx_path});
      return await this.verify(boundary.operation_id);
    } catch { return {operation_id:boundary.operation_id,status:"signing_unknown",retry_allowed:false}; }
  }
  async verify(id: string) {
    const c=this.config, store=new SeedStore(c,true);
    try {
      const op=store.get(id); check(["signing_unknown","signed"].includes(op.status),"invalid_transition");
      const result=await this.io.call({...this.base(),command:"verify",profile:c.profile,policy:c.policy,plan:op.bundle.plan,signed_tx_path:op.signed_tx_path}) as SeedSignedSummary;
      store.acceptVerified(id,result);
      return {operation_id:id,status:"signed",tx_hash:result.tx_hash,retry_allowed:false};
    } finally {store.close();}
  }
  async submit(id: string) {
    const c=this.config,store=new SeedStore(c,true);
    try {
      const op=store.get(id); check(op.status === "signed" && op.signed,"submission_already_attempted");
      // Verify the recoverable file without opening a signer before current authorization and boundary.
      const verified=await this.io.call({...this.base(),command:"verify",profile:c.profile,policy:c.policy,plan:op.bundle.plan,signed_tx_path:op.signed_tx_path}) as SeedSignedSummary;
      same(verified,op.signed);
      const observation=await this.observe(), snapshot=trustedSnapshot(c);
      store.enterSubmission(id,observation,snapshot);
      try { await this.io.call({...this.base(),command:"submit",profile:c.profile,policy:c.policy,plan:op.bundle.plan,node:c.node,signed_tx_path:op.signed_tx_path,expected_tx_hash:op.signed.tx_hash}); } catch { /* Persisted boundary is already unknown. */ }
      return {operation_id:id,status:"submission_unknown",tx_hash:op.signed.tx_hash,retry_allowed:false};
    } finally {store.close();}
  }
  async reconcile(id: string) {
    const c=this.config,store=new SeedStore(c,true);
    try {
      const op=store.get(id); check(op.status === "submission_unknown" && op.signed,"invalid_transition");
      const result=await this.io.call({...this.base(),command:"lookup",profile:c.profile,policy:c.policy,plan:op.bundle.plan,node:c.node,tx_hash:op.signed.tx_hash}) as SeedLookupResult;
      store.reconcileIncluded(id,result);
      return store.status().operations.find(o=>o.operation_id === id);
    } finally {store.close();}
  }
  async operator(command: "operator-grant"|"operator-revoke"|"operator-admit",authority?: string) {
    const c=this.config; verifyCurrent(c,records(c),trustedSnapshot(c),new Date().toISOString());
    const granter=c.policy.sponsor_account.split(":").at(-1)!,grantee=c.policy.claimant_account.split(":").at(-1)!;
    let request: SeedIoRequest;
    if(command === "operator-grant") request={...this.base(),command,profile:c.profile,granter,grantee,spend_limit_uzrn:c.policy.grant_spend_limit_uzrn,expires_at:c.policy.grant_expires_at,now:new Date().toISOString()};
    else if(command === "operator-revoke") request={...this.base(),command,profile:c.profile,granter,grantee};
    else { check(authority && authority !== granter && authority !== grantee,"operator_authority_required"); request={...this.base(),command,profile:c.profile,authority,address:grantee}; }
    return {status:"unsigned_proposal_only",executed:false,message:await this.io.call(request)};
  }
}
