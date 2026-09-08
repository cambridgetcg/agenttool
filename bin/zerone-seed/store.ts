import { Database } from "bun:sqlite";
import { lstatSync } from "node:fs";
import { canonicalJson, sha256Id, verifyWalletDescriptor, verifyWalletCapability, verifyTransactionIntent, verifySimulationReceipt, type WalletDescriptor, type WalletCapability, type TransactionIntent, type SimulationReceipt } from "@agenttool/wallet";
import { assessSeedClaim, assertSeedClaimPlan, createSeedClaimPlan, authorizeSeedClaim, createSeedSimulationBinding, createSeedSigningRequest } from "../../packages/wallet-zerone/src/bootstrap/v1.js";
import type { SeedBlockAnchor, SeedPolicy, SeedClaimPlan, SeedObservation, SeedSimulationResult, SeedSignedSummary, SeedLookupResult } from "../../packages/wallet-zerone/src/bootstrap/types.js";
import { ledgerBinding, records, trustedSnapshot, verifyCurrent, type SeedConfig } from "./config.js";
import { assertNativeResult, evidence, summary, lookupResult } from "./adapters.js";
import { SeedJournalFiles } from "./filesystem.js";
import { assertActivation, preSignOperation, type PreSignCandidate, type GateResult } from "./activation.js";
import { check, closed, freeze, parse, same, timestamp } from "./validation.js";

export interface PreparedClaim { plan: SeedClaimPlan; observation: SeedObservation; prepared_at: string }
export interface ReservedBundle extends PreparedClaim {
  descriptor: WalletDescriptor; capability: WalletCapability; intent: TransactionIntent;
  simulation: SimulationReceipt; simulation_result: SeedSimulationResult;
}
export interface Operation {
  operation_id: string; policy: SeedPolicy; bundle: ReservedBundle; signed_tx_path: string; request_id: string;
  signing_request_hash: string; signing_checked_at: string; status: "signing_unknown" | "signed" | "submission_unknown" | "included_success" | "included_failed";
  signed: SeedSignedSummary | null; inclusion: Extract<SeedLookupResult,{status:"included"}> | null;
  activation: {operation_id:string; evidence_sha256:string; packet_sha256:string; policies:SeedPolicy[]} | null;
  currentness_issued_at: string; currentness_revocation_nonce:number; budget_issued_at: string; exposure_uzrn: string; sequence_retired: boolean;
}
interface EventRow { sequence: number; operation_id: string; action: string; payload: string; previous_hash: string; event_hash: string }
const GENESIS = `sha256:${"0".repeat(64)}`;

function orderedAnchors(previous: SeedBlockAnchor,current: SeedBlockAnchor): void {
  check(BigInt(current.height) >= BigInt(previous.height) && timestamp(current.block_time) >= timestamp(previous.block_time),"observation_rollback");
  if(current.height === previous.height) check(current.block_hash === previous.block_hash && current.block_time === previous.block_time,"forked_observation");
}

/** Rebuild branded records/plans from full persisted public bytes, never bless deserialized brands. */
export function restoreBundle(c: SeedConfig,b: ReservedBundle) {
  closed(b,"plan observation prepared_at descriptor capability intent simulation simulation_result");
  timestamp(b.prepared_at);
  const descriptor = verifyWalletDescriptor(b.descriptor), capability = verifyWalletCapability(b.capability), intent = verifyTransactionIntent(b.intent), simulation = verifySimulationReceipt(b.simulation);
  same(simulation.adapter,c.simulation_provider.authority);
  check(b.observation.status === "observed");
  const plan = createSeedClaimPlan({profile:c.profile,policy:c.policy,observation:b.observation,
    signer_public_key_b64u:c.signer_public_key_b64u,now:b.prepared_at,capability,intent,
    fee_amount_uzrn:b.plan.commitment.fee_amount_uzrn,gas_limit:b.plan.commitment.gas_limit});
  same(plan,b.plan); assertSeedClaimPlan(plan,c.profile,c.policy);
  const binding = createSeedSimulationBinding({plan,simulation,result:b.simulation_result});
  // Historical reconstruction joins anchors but does not re-age preparation at
  // recovery time. Current freshness is enforced separately before effects.
  evidence(b.observation.evidence,c,b.prepared_at);
  evidence(b.simulation_result.evidence,c,b.simulation_result.evidence.observed_at);
  orderedAnchors(b.observation.evidence.anchor,b.simulation_result.evidence.anchor);
  return {descriptor,capability,intent,simulation,plan,binding};
}
function freshAuthorization(c: SeedConfig,b: ReservedBundle,obs: SeedObservation,snapshot: ReturnType<typeof trustedSnapshot>,now: string,count: number) {
  const r = restoreBundle(c,b); const configured = records(c);
  for (const key of ["descriptor","capability","intent"] as const) same(r[key],configured[key]);
  const trusted = verifyCurrent(c,r,snapshot,now);
  const assessed = assessSeedClaim({profile:c.profile,policy:c.policy,observation:obs,signer_public_key_b64u:c.signer_public_key_b64u,now});
  check(assessed.status === "ready","claim_not_ready"); check(obs.status === "observed" && obs.claimant.status === "found");
  evidence(obs.evidence,c,now);
  check(obs.claimant.sequence === r.plan.commitment.sequence && obs.claimant.account_number === r.plan.commitment.account_number,"account_changed");
  const original = b.simulation_result.evidence;
  evidence(original,c,now);
  check(original.latest_height === original.anchor.height,"latest_simulation_required");
  orderedAnchors(original.anchor,obs.evidence.anchor);
  const authorization = authorizeSeedClaim({profile:c.profile,policy:c.policy,descriptor:r.descriptor,capability:r.capability,intent:r.intent,simulation:r.simulation,context:{now,usage:{revocation_nonce:trusted.current.revocation_nonce,intent_count:count,spent:[],host_verified_approval_ids:[]}}});
  return {...r,...trusted,authorization};
}

/** One host / one dedicated sponsor / one explicit journal. No arbitrary injected authorization. */
export class SeedStore {
  private readonly db: Database;
  private readonly files: SeedJournalFiles;
  constructor(readonly config: Readonly<SeedConfig>,private readonly writable = false,create = false) {
    check(!create || writable);
    this.files = new SeedJournalFiles(config.ledger_path,{create});
    const size=lstatSync(config.ledger_path).size;
    check(size <= 64*1024*1024,"journal_limit");
    const initialize=create && size === 0;
    this.db = new Database(config.ledger_path,{readonly:!writable,create:false,strict:true});
    try {
      this.db.exec("PRAGMA busy_timeout=5000");
      if(!writable) this.db.exec("PRAGMA query_only=ON");
      if(initialize) {
        this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON");
        this.db.transaction(() => {
          this.db.exec("CREATE TABLE IF NOT EXISTS seed_meta (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL); CREATE TABLE IF NOT EXISTS seed_events (sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE)");
          this.db.exec("CREATE TRIGGER IF NOT EXISTS seed_no_update BEFORE UPDATE ON seed_events BEGIN SELECT RAISE(ABORT,'append only'); END; CREATE TRIGGER IF NOT EXISTS seed_no_delete BEFORE DELETE ON seed_events BEGIN SELECT RAISE(ABORT,'append only'); END; CREATE TRIGGER IF NOT EXISTS seed_meta_no_update BEFORE UPDATE ON seed_meta BEGIN SELECT RAISE(ABORT,'immutable'); END; CREATE TRIGGER IF NOT EXISTS seed_meta_no_delete BEFORE DELETE ON seed_meta BEGIN SELECT RAISE(ABORT,'immutable'); END;");
          this.db.query("INSERT OR IGNORE INTO seed_meta VALUES(1,?)").run(canonicalJson(ledgerBinding(config)));
        }).immediate();
      }
      if(writable) this.db.exec("PRAGMA synchronous=FULL; PRAGMA fullfsync=ON");
      const m = this.db.query("SELECT binding FROM seed_meta WHERE id=1").get() as {binding:string}|null;
      check(m); same(parse(m.binding),ledgerBinding(config)); this.replay(); this.files.verify();
    } catch(e) { this.db.close(); throw e; }
  }
  close(): void { this.db.close(); this.files.verify(); }
  private replay(): {ops: Map<string,Operation>; head: string; sequence: number} {
    check(lstatSync(this.config.ledger_path).size <= 64*1024*1024,"journal_limit");
    check(this.db.query("SELECT 1 AS invalid FROM seed_events WHERE length(payload)>262144 LIMIT 1").get() === null,"journal_limit");
    const rows = this.db.query("SELECT * FROM seed_events ORDER BY sequence LIMIT 10001").all() as EventRow[];
    check(rows.length <= 10000,"journal_limit");
    let head = GENESIS, sequence = 0; const ops = new Map<string,Operation>();
    for(const row of rows) {
      check(row.sequence === ++sequence && row.previous_hash === head,"journal_tampered");
      const payload = parse(row.payload);
      const core = {sequence:row.sequence,operation_id:row.operation_id,action:row.action,payload,previous_hash:row.previous_hash};
      check(sha256Id(core) === row.event_hash,"journal_tampered"); head = row.event_hash;
      if(row.action === "sign_boundary") {
        check(!ops.has(row.operation_id));
        closed(payload,"operation_id policy bundle signed_tx_path request_id signing_request_hash signing_checked_at status signed inclusion activation currentness_issued_at currentness_revocation_nonce budget_issued_at exposure_uzrn sequence_retired");
        check(payload.operation_id === row.operation_id && payload.status === "signing_unknown" && payload.signed === null && payload.inclusion === null && payload.sequence_retired === false);
        // Reverify archived signed records and every unsigned byte for ALL recipients.
        // Historical verification does not make an expired policy currently authorized.
        check(payload.bundle.plan.commitment.profile_id === this.config.profile.profile_id && payload.bundle.plan.commitment.sponsor_account === this.config.policy.sponsor_account);
        restoreBundle({...this.config,policy:payload.policy,signer_public_key_b64u:payload.bundle.plan.commitment.signer_public_key_b64u},payload.bundle);
        if(this.config.activation_gate.mode === "disposable-local") check(payload.activation === null);
        else {
          closed(payload.activation,"operation_id evidence_sha256 packet_sha256 policies");
          check(Array.isArray(payload.activation.policies) && payload.activation.policies.length > 0 && payload.activation.policies.length <= 32);
          same(payload.activation.policies.find((p:SeedPolicy)=>p.policy_hash === payload.policy.policy_hash),payload.policy);
          check(payload.activation.packet_sha256 === this.config.activation_gate.packet_sha256,"activation_packet_mismatch");
        }
        for(const other of ops.values()) {
          if(other.bundle.descriptor.wallet_id === payload.bundle.descriptor.wallet_id) check(timestamp(payload.currentness_issued_at) >= timestamp(other.currentness_issued_at) && payload.currentness_revocation_nonce >= other.currentness_revocation_nonce,"currentness_rollback");
          check(timestamp(payload.budget_issued_at) >= timestamp(other.budget_issued_at),"budget_snapshot_rollback");
        }
        const b=payload.bundle;
        check(Number.isSafeInteger(payload.currentness_revocation_nonce) && payload.currentness_revocation_nonce === b.capability.revocation_nonce);
        check(timestamp(payload.signing_checked_at) >= timestamp(b.prepared_at));
        // Recompute the original request bytes as inert data, never mint/re-return a new branded request.
        const requestData={request_id:payload.request_id,signer_key_id:b.plan.commitment.signer_key_id,unsigned_payload_b64u:b.plan.sign_doc_bytes_b64u,unsigned_payload_hash:b.plan.sign_doc_bytes_hash,
          authorization:{wallet_id:b.descriptor.wallet_id,grant_id:b.capability.grant_id,capability_record_id:b.capability.record_id,intent_record_id:b.intent.record_id,simulation_record_id:b.simulation.record_id,policy_hash:payload.policy.policy_hash,checked_at:payload.signing_checked_at}};
        check(sha256Id(requestData) === payload.signing_request_hash,"request_commitment_mismatch");
        const exposure = BigInt(payload.policy.grant_spend_limit_uzrn)+BigInt(payload.policy.setup_fee_budget_uzrn);
        check(BigInt(payload.exposure_uzrn) === exposure);
        ops.set(row.operation_id,payload as Operation);
      } else {
        const op = ops.get(row.operation_id); check(op,"journal_tampered");
        if(row.action === "verified") {
          check(op.status === "signing_unknown" || op.status === "signed"); summary(payload,op.bundle.plan);
          if(op.signed) same(op.signed,payload); op.signed=payload; op.status="signed";
        } else if(row.action === "submit_boundary") {
          closed(payload,"currentness_issued_at currentness_revocation_nonce budget_issued_at"); check(op.status === "signed" && op.signed !== null);
          check(Number.isSafeInteger(payload.currentness_revocation_nonce) && payload.currentness_revocation_nonce === op.bundle.capability.revocation_nonce);
          for(const other of ops.values()) {
            if(other.bundle.descriptor.wallet_id === op.bundle.descriptor.wallet_id) check(timestamp(payload.currentness_issued_at) >= timestamp(other.currentness_issued_at) && payload.currentness_revocation_nonce >= other.currentness_revocation_nonce,"currentness_rollback");
            check(timestamp(payload.budget_issued_at) >= timestamp(other.budget_issued_at),"budget_snapshot_rollback");
          }
          op.currentness_issued_at=payload.currentness_issued_at; op.currentness_revocation_nonce=payload.currentness_revocation_nonce; op.budget_issued_at=payload.budget_issued_at; op.status="submission_unknown";
        } else if(row.action === "included") {
          check(op.status === "submission_unknown" && op.signed && payload.status === "included");
          lookupResult(payload,{...this.config,policy:op.policy},op.bundle.plan,op.signed.tx_hash,payload.evidence.observed_at);
          op.inclusion=payload; op.status=payload.code === 0 ? "included_success":"included_failed";
          op.sequence_retired=BigInt(payload.claimant_sequence) > BigInt(op.bundle.plan.commitment.sequence);
        } else check(false,"journal_tampered");
      }
    }
    return {ops,head,sequence};
  }
  private append(operation: string,action: string,payload: unknown): void {
    const {head,sequence} = this.replay(); check(sequence < 10000,"journal_limit");
    const core={sequence:sequence+1,operation_id:operation,action,payload,previous_hash:head};
    this.db.query("INSERT INTO seed_events VALUES(?,?,?,?,?,?)").run(sequence+1,operation,action,canonicalJson(payload),head,sha256Id(core));
  }
  private immediate<T>(fn: () => T): T {
    check(this.writable,"read_only"); this.files.verify();
    const result = this.db.transaction(() => { this.files.verify(); this.replay(); return fn(); }).immediate();
    this.files.verify(); return result;
  }
  get(id: string): Readonly<Operation> {
    this.files.verify(); const op = this.replay().ops.get(id); check(op,"operation_missing");
    check(op.bundle.plan.commitment.policy_hash === this.config.policy.policy_hash,"policy_mismatch");
    check(op.signed_tx_path === this.config.signed_tx_path,"signed_path_mismatch");
    restoreBundle(this.config,op.bundle);
    if(op.signed) summary(op.signed,op.bundle.plan);
    return freeze(op);
  }
  status() {
    this.files.verify(); const {ops,head,sequence} = this.replay();
    return {protocol:"zerone-seed-runtime.status/0.1",ledger_id:this.config.ledger_id,event_count:sequence,head,
      authority:"not_revalidated_by_status",source_outgoing_uzrn:"0",total_reserved_sponsor_exposure_uzrn:[...ops.values()].reduce((s,o)=>s+BigInt(o.exposure_uzrn),0n).toString(),
      operations:[...ops.values()].map(o=>({operation_id:o.operation_id,plan_id:o.bundle.plan.plan_id,status:o.status,tx_hash:o.signed?.tx_hash ?? null,
        credited_amount_uzrn:o.inclusion?.credited_amount_uzrn ?? null,code:o.inclusion?.code ?? null,sequence_retired:o.sequence_retired}))};
  }
  private reservationChecks(b:ReservedBundle,obs:SeedObservation,snapshot:ReturnType<typeof trustedSnapshot>) {
    const now=new Date().toISOString(),{ops}=this.replay();
    // Re-read named authorities within this database snapshot/lock. A caller's
    // earlier attestation snapshot is not currentness at the signing boundary.
    same(snapshot,trustedSnapshot(this.config));
    const uses=[...ops.values()].filter(o=>o.bundle.capability.record_id === b.capability.record_id).length;
    const verified=freshAuthorization(this.config,b,obs,snapshot,now,uses),commitment=verified.plan.commitment;
    for(const op of ops.values()) {
      if(op.bundle.descriptor.wallet_id === b.descriptor.wallet_id) check(timestamp(verified.current.issued_at) >= timestamp(op.currentness_issued_at) && verified.current.revocation_nonce >= op.currentness_revocation_nonce,"currentness_rollback");
      check(timestamp(verified.budget.issued_at) >= timestamp(op.budget_issued_at),"budget_snapshot_rollback");
    }
    check(![...ops.values()].some(o=>
      (o.bundle.plan.commitment.claimant_account === commitment.claimant_account && o.bundle.plan.commitment.pot_id === commitment.pot_id)
      || (!o.sequence_retired && o.bundle.plan.commitment.claimant_account === commitment.claimant_account && o.bundle.plan.commitment.account_number === commitment.account_number && o.bundle.plan.commitment.sequence === commitment.sequence)),"already_reserved");
    const exposure=BigInt(this.config.policy.grant_spend_limit_uzrn)+BigInt(this.config.policy.setup_fee_budget_uzrn);
    const total=[...ops.values()].reduce((n,o)=>n+BigInt(o.exposure_uzrn),exposure+BigInt(verified.budget.outside_journal_exposure_uzrn));
    check(total <= BigInt(verified.budget.total_exposure_uzrn),"sponsor_budget_exhausted");
    check(obs.status === "observed" && total <= BigInt(obs.sponsor_balance_uzrn),"aggregate_sponsor_underfunded");
    return {now,ops,uses,verified,exposure};
  }
  preSign(b:ReservedBundle,obs:SeedObservation,snapshot:ReturnType<typeof trustedSnapshot>,requestId:string):PreSignCandidate {
    assertNativeResult(obs,this.config,"inspect");assertNativeResult(b.simulation_result,this.config,"simulate");
    this.files.verify();
    // Read transaction only. No slot, event, reservation or signer request exists.
    return this.db.transaction(()=>{
      const {uses}=this.reservationChecks(b,obs,snapshot);
      return freeze({protocol:"zerone-seed-runtime.presign/0.1" as const,bundle:b,observation:obs,
        operation:preSignOperation(this.config,b,obs,snapshot,this.status(),uses,requestId)});
    }).deferred();
  }
  reserveAndEnterSigning(b: ReservedBundle,obs: SeedObservation,snapshot: ReturnType<typeof trustedSnapshot>,requestId: string,activation?:{candidate:PreSignCandidate;gate:Readonly<GateResult>}) {
    assertNativeResult(obs,this.config,"inspect");
    if(this.config.activation_gate.mode === "disposable-local") {
      check(activation === undefined);assertNativeResult(b.simulation_result,this.config,"simulate");
    } else check(activation,"activation_required");
    return this.immediate(() => {
      const {now,ops,uses,verified,exposure}=this.reservationChecks(b,obs,snapshot),plan=verified.plan;
      if(activation) {
        const {candidate,gate}=activation;
        closed(candidate,"protocol bundle observation operation");check(candidate.protocol === "zerone-seed-runtime.presign/0.1");same(candidate.bundle,b);
        const derived=preSignOperation(this.config,b,candidate.observation,snapshot,this.status(),uses,requestId);
        same(derived,candidate.operation);assertActivation(this.config,gate,derived,now);
        // Authenticated old observation and real current native observation must
        // both be ready, coherent with each other and within the same deadlines.
        freshAuthorization(this.config,b,candidate.observation,snapshot,now,uses);
        check(candidate.observation.status === "observed" && obs.status === "observed");
        const old=candidate.observation.evidence.anchor,current=obs.evidence.anchor;
        orderedAnchors(old,current);
        const hashes=new Set(gate.policies.map(p=>p.policy_hash));
        const other=[...ops.values()].filter(o=>!hashes.has(o.policy.policy_hash)).reduce((n,o)=>n+BigInt(o.exposure_uzrn),BigInt(verified.budget.outside_journal_exposure_uzrn));
        check(other.toString() === gate.sponsor_other_exposure_uzrn,"activation_exposure_mismatch");
        const total=gate.policies.reduce((n,p)=>n+BigInt(p.grant_spend_limit_uzrn)+BigInt(p.setup_fee_budget_uzrn),other);
        check(total <= BigInt(verified.budget.total_exposure_uzrn),"sponsor_budget_exhausted");
        check(total <= BigInt(obs.sponsor_balance_uzrn),"aggregate_sponsor_underfunded");
      }
      const request=createSeedSigningRequest({plan,simulation:verified.simulation,binding:verified.binding,authorization:verified.authorization,request_id:requestId});
      const op: Operation={operation_id:plan.plan_id,policy:this.config.policy,bundle:b,signed_tx_path:this.config.signed_tx_path,request_id:requestId,signing_request_hash:sha256Id(request),signing_checked_at:now,status:"signing_unknown",signed:null,inclusion:null,
        activation:activation ? {operation_id:activation.gate.operation_id,evidence_sha256:activation.gate.evidence_sha256,packet_sha256:activation.gate.activation_sha256,policies:activation.gate.policies}:null,
        currentness_issued_at:verified.current.issued_at,currentness_revocation_nonce:verified.current.revocation_nonce,budget_issued_at:verified.budget.issued_at,exposure_uzrn:exposure.toString(),sequence_retired:false};
      this.append(op.operation_id,"sign_boundary",op);
      // Returned once only, after commit. Reopen never returns a signing request.
      return {operation_id:op.operation_id,request};
    });
  }
  acceptVerified(id: string,s: SeedSignedSummary): void {
    assertNativeResult(s,this.config,"verify");
    this.immediate(() => { const op=this.get(id); check(["signing_unknown","signed"].includes(op.status),"invalid_transition"); summary(s,op.bundle.plan); if(op.signed) same(s,op.signed); this.append(id,"verified",s); });
  }
  enterSubmission(id: string,obs: SeedObservation,snapshot: ReturnType<typeof trustedSnapshot>): void {
    assertNativeResult(obs,this.config,"inspect");
    this.immediate(() => {
      const op=this.get(id); check(op.status === "signed" && op.signed,"submission_already_attempted");
      // Reauthorize this already-reserved intent, not a second capability use. No new request is returned.
      same(snapshot,trustedSnapshot(this.config));
      const verified=freshAuthorization(this.config,op.bundle,obs,snapshot,new Date().toISOString(),0);
      const all=[...this.replay().ops.values()];
      for(const other of all) {
        if(other.bundle.descriptor.wallet_id === op.bundle.descriptor.wallet_id) check(timestamp(verified.current.issued_at) >= timestamp(other.currentness_issued_at) && verified.current.revocation_nonce >= other.currentness_revocation_nonce,"currentness_rollback");
        check(timestamp(verified.budget.issued_at) >= timestamp(other.budget_issued_at),"budget_snapshot_rollback");
      }
      const cohort=op.activation?.policies ?? [],hashes=new Set(cohort.map(p=>p.policy_hash));
      const total=all.filter(o=>!hashes.has(o.policy.policy_hash)).reduce((n,o)=>n+BigInt(o.exposure_uzrn),
        cohort.reduce((n,p)=>n+BigInt(p.grant_spend_limit_uzrn)+BigInt(p.setup_fee_budget_uzrn),BigInt(verified.budget.outside_journal_exposure_uzrn)));
      check(total <= BigInt(verified.budget.total_exposure_uzrn),"sponsor_budget_exhausted");
      check(obs.status === "observed" && total <= BigInt(obs.sponsor_balance_uzrn),"aggregate_sponsor_underfunded");
      this.append(id,"submit_boundary",{currentness_issued_at:verified.current.issued_at,currentness_revocation_nonce:verified.current.revocation_nonce,budget_issued_at:verified.budget.issued_at});
    });
  }
  reconcileIncluded(id: string,result: SeedLookupResult): void {
    assertNativeResult(result,this.config,"lookup");
    this.immediate(() => {
      const op=this.get(id); check(op.signed && op.status === "submission_unknown","invalid_transition");
      lookupResult(result,this.config,op.bundle.plan,op.signed.tx_hash,new Date().toISOString());
      if(result.status !== "included") return; // Absence/unknown changes neither reservation nor one-use authority.
      this.append(id,"included",result);
    });
  }
}
