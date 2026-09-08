// Opt-in driver for scripts/seed-localnet-fixture.sh; never imported by the CLI.
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fsyncSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson, sealWalletDescriptor, sealWalletCapability, sealTransactionIntent, sha256Id, type Ed25519PublicKey } from "@agenttool/wallet";
import { encodeSeedMsgClaim } from "../../packages/wallet-zerone/src/bootstrap/v1.js";
import { zeroneAddressFromSecp256k1PublicKey } from "../../packages/wallet-zerone/src/profiles.js";
import { ExternalRecordSigner } from "./adapters.js";
import { validateConfig, type Executable, type SeedConfig, type Currentness, type SponsorBudget } from "./config.js";
import { absolute, check, closed, digest, fileDigest, hash, MAX_JSON, readJson } from "./validation.js";

export const HELP = "TEST ONLY: localnet-runner.ts --ack-disposable-runner --cli ABS --cli-sha256 sha256:HEX --record-signer ABS --record-signer-sha256 sha256:HEX. Requires the fixture's isolated environment. No defaults or production use.";
type Options = { cli: Executable; provider: Executable };
export function options(argv: string[]): Options {
  check(argv[0] === "--ack-disposable-runner", "test_ack_required");
  const flags = ["--cli", "--cli-sha256", "--record-signer", "--record-signer-sha256"];
  check(argv.length === 9); const values: Record<string,string> = {};
  for (let i=1;i<argv.length;i+=2) { check(flags.includes(argv[i]) && !(argv[i] in values)); values[argv[i]]=argv[i+1]; }
  for (const f of flags) check(values[f]);
  absolute(values["--cli"]); absolute(values["--record-signer"]);
  hash(values["--cli-sha256"]); hash(values["--record-signer-sha256"]);
  return {cli:{path:values["--cli"],sha256:values["--cli-sha256"]},provider:{path:values["--record-signer"],sha256:values["--record-signer-sha256"]}};
}
export function writeNewJson(path: string, value: unknown): void {
  absolute(path); const bytes=canonicalJson(value); check(Buffer.byteLength(bytes)<=MAX_JSON);
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {writeFileSync(fd,bytes);fsyncSync(fd);} finally {closeSync(fd);}
}
function privateDirectory(path: string) {
  absolute(path); const s=lstatSync(path);
  check(realpathSync(path)===path && s.isDirectory() && s.uid===process.getuid!() && (s.mode&0o777)===0o700,"unsafe_test_directory");
}
export function testEnvironment(env: NodeJS.ProcessEnv) {
  check(env.SEED_NON_FINAL === "1", "fixture_required");
  for (const k of ["SEED_FIXTURE_JSON","SEED_TEST_WORK_DIR","SEED_RESULT_JSON"]) absolute(env[k]);
  const root=env.SEED_TEST_WORK_DIR!; privateDirectory(root);
  check(env.SEED_RESULT_JSON===join(root,"result.json") && !existsSync(env.SEED_RESULT_JSON),"test_result_path");
  const f=readJson(env.SEED_FIXTURE_JSON!);
  closed(f,"schema label rpc_url grpc_address chain_reference genesis_file zeroned helper runtime source_manifest_file source_commit profile_file policy_file node_file helper_trust_file helper_disposable_test simulation_requires_unchanged_latest_height claimant_address sponsor_address claimant_keyring work_dir result_file expected_amount_uzrn artifact_hashes");
  check(f.schema==="zerone.seed-local-runner/1" && f.label==="NON-FINAL" && f.helper_disposable_test===true && f.simulation_requires_unchanged_latest_height===true,"fixture_required");
  check(/^seed-local-[0-9a-f]{12}$/.test(f.chain_reference) && f.work_dir===root && f.result_file===env.SEED_RESULT_JSON && f.expected_amount_uzrn==="222000","fixture_binding");
  const fixtureRoot=dirname(root); privateDirectory(fixtureRoot);
  check(env.SEED_FIXTURE_JSON===join(fixtureRoot,"fixture.json"),"fixture_binding");
  closed(f.claimant_keyring,"home backend key_name");
  check(f.claimant_keyring.home===join(fixtureRoot,"claimant") && f.claimant_keyring.backend==="test" && f.claimant_keyring.key_name==="claimant","fixture_keyring");
  privateDirectory(f.claimant_keyring.home);
  for (const [field,name] of [["profile_file","profile.json"],["policy_file","policy.json"],["node_file","node.json"],["helper_trust_file","helper-trust.json"]]) check(f[field]===join(fixtureRoot,name),"fixture_binding");
  check(f.genesis_file===join(fixtureRoot,"node/config/genesis.json"),"fixture_binding");
  const profile=readJson(f.profile_file),policy=readJson(f.policy_file),node=readJson(f.node_file);
  check(node.mode==="local" && node.rpc_url===f.rpc_url && node.grpc_address===f.grpc_address && new URL(node.rpc_url).hostname==="127.0.0.1","local_only");
  check(profile.chain_reference===f.chain_reference && profile.chain_id===`cosmos:${f.chain_reference}` && profile.zerone_core_commit===f.source_commit,"fixture_binding");
  check(policy.claimant_account===`${profile.chain_id}:${f.claimant_address}` && policy.sponsor_account===`${profile.chain_id}:${f.sponsor_address}`,"fixture_binding");
  check(profile.genesis_hash===fileDigest(f.genesis_file) && profile.source_digest===fileDigest(f.source_manifest_file),"fixture_artifact_drift");
  for (const name of ["zeroned","runtime","helper"]) check(fileDigest(f[name])===f.artifact_hashes[name],"fixture_artifact_drift");
  check(profile.runtime_sha256===f.artifact_hashes.runtime && profile.helper_sha256===f.artifact_hashes.helper,"fixture_artifact_drift");
  return {f,root,profile,policy,node};
}

// Own direct children by handle, drain bounded streams, resolve only after close/reap.
// On TERM do not strand the CLI's helper: allow its bounded oneShot to finish first.
export class Processes {
  stopped=false;
  active=new Set<ChildProcess>();
  stop=()=>{this.stopped=true;};
  async run(e: Executable,args: string[],cwd: string,timeout=90000): Promise<{code:number;value:any}> {
    check(!this.stopped,"interrupted"); check(fileDigest(e.path)===e.sha256,"executable_digest_mismatch");
    return await new Promise((resolve,reject)=>{
      const child=spawn(e.path,args,{cwd,shell:false,stdio:["ignore","pipe","pipe"],env:{PATH:"/usr/bin:/bin",HOME:cwd,TMPDIR:cwd,LANG:"C",LC_ALL:"C",NO_COLOR:"1"}});
      this.active.add(child); const chunks:Buffer[]=[];let out=0,err=0,failed=false;
      const timer=setTimeout(()=>{failed=true;child.kill("SIGKILL");},timeout);
      child.stdout!.on("data",(b:Buffer)=>{out+=b.length;if(out>MAX_JSON){failed=true;child.kill("SIGKILL");}else chunks.push(b);});
      child.stderr!.on("data",(b:Buffer)=>{err+=b.length;if(err>MAX_JSON){failed=true;child.kill("SIGKILL");}});
      child.on("error",()=>{failed=true;});
      child.on("close",code=>{clearTimeout(timer);this.active.delete(child);
        try {check(!failed && code!==null,"test_child_failed");check(!this.stopped,"interrupted");const text=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));resolve({code:code!,value:JSON.parse(text)});} catch(e){reject(e);}
      });
    });
  }
}
function testKey(root:string,name:string) {
  const pair=generateKeyPairSync("ed25519"),public_key=pair.publicKey.export({format:"jwk"}).x!;
  const authority:Ed25519PublicKey={algorithm:"Ed25519",key_id:digest(Buffer.from(public_key,"base64url")),public_key};
  const key_file=join(root,`${name}.pem`);
  writeFileSync(key_file,pair.privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600,flag:"wx"});
  return {authority,key_file};
}
export function budgetAmounts(grant: string,setup:string) {
  // Grant already exists before this journal. Keep it outside even after reservation:
  // deliberate conservative double-count, not a fictional zero-liability snapshot.
  check(/^[1-9][0-9]*$/.test(grant) && /^(0|[1-9][0-9]*)$/.test(setup));
  return {outside_journal_exposure_uzrn:grant,total_exposure_uzrn:(2n*BigInt(grant)+BigInt(setup)).toString()};
}
const SAFE_CODES=new Set(["already_reserved","submission_already_attempted","helper_failed","helper_unavailable","invalid_input","input_or_runtime_rejected","binding_mismatch","not_current","policy_expired","stale_observation","sponsor_budget_exhausted","invalid_transition"]);
export function diagnostic(command:string,result:{code:number;value:any}) {
  const v=result.value;
  return {command,exit_code:result.code,status:["error","signed","signing_unknown","submission_unknown","included_success","included_failed"].includes(v?.status)?v.status:"response",error_code:v?.status==="error"?(SAFE_CODES.has(v.code)?v.code:"unclassified"):null};
}
export function successReceipt(signed:any,confirmed:any,claimant:string,replay:{code:number;value:any}) {
  check(signed?.status==="signed" && /^[0-9A-F]{64}$/.test(signed.tx_hash),"not_signed");
  check(confirmed?.status==="included_success" && confirmed.tx_hash===signed.tx_hash && confirmed.operation_id===signed.operation_id && confirmed.credited_amount_uzrn==="222000" && confirmed.code===0 && confirmed.sequence_retired===true,"not_confirmed");
  check(replay.code!==0 && replay.value?.status==="error" && replay.value.code==="already_reserved","replay_not_refused");
  return {claimed_tx_hash:signed.tx_hash,claimed_address:claimant,actual_amount:"222000",replay_refused:true};
}
export async function runLocalnet(opts:Options) {
  process.umask(0o077);
  const {f,root,profile,policy,node}=testEnvironment(process.env);
  check(fileDigest(opts.cli.path)===opts.cli.sha256 && fileDigest(opts.provider.path)===opts.provider.sha256,"executable_digest_mismatch");
  const processes=new Processes(); process.on("SIGTERM",processes.stop);process.on("SIGINT",processes.stop);
  const evidence:any={schema:"zerone.seed-local-runner-evidence/1",label:"NON-FINAL local candidate",result:"FAIL",stages:[],cli_sha256:opts.cli.sha256,record_signer_sha256:opts.provider.sha256,source_digest:profile.source_digest,prepare_attempts:0};
  let stage="public_key";
  try {
    // Native public-key read from the fixture's freshly generated handle, never export.
    const keyResult=await processes.run({path:f.zeroned,sha256:f.artifact_hashes.zeroned},["keys","show","claimant","--pubkey","--keyring-backend","test","--home",f.claimant_keyring.home],root);
    check(keyResult.code===0 && keyResult.value?.["@type"]==="/cosmos.crypto.secp256k1.PubKey","public_key_shape");
    const signerKey=Buffer.from(keyResult.value.key,"base64");
    check(signerKey.length===33 && zeroneAddressFromSecp256k1PublicKey(signerKey)===f.claimant_address,"public_key_mismatch");
    stage="records";
    const owner=testKey(root,"wallet-owner"),delegate=testKey(root,"wallet-delegate"),current=testKey(root,"currentness"),budget=testKey(root,"sponsor-budget"),simulation=testKey(root,"simulation");
    const provider=(key:ReturnType<typeof testKey>)=>new ExternalRecordSigner({...key,executable:opts.provider},10000);
    const now=Date.now(),start=new Date(now-1000).toISOString(),end=new Date(Math.min(now+240000,Date.parse(policy.expires_at))).toISOString();
    const descriptor=await sealWalletDescriptor({schema:"agent-wallet/descriptor/0.1",wallet_id:randomUUID(),owner_identity_id:"did:at:seed-disposable-localnet",authority:owner.authority,custody_mode:"delegated_signer",accounts:[{account_id:policy.claimant_account,account_kind:"eoa"}],recovery_mode:"owner_rotation",created_at:start},provider(owner));
    const capability=await sealWalletCapability({schema:"agent-wallet/capability/0.1",grant_id:randomUUID(),wallet_id:descriptor.wallet_id,descriptor_id:descriptor.record_id,issuer:owner.authority,delegate:delegate.authority,accounts:[policy.claimant_account],call_rules:[{target_account:profile.claiming_pot_account,actions:["call"],methods:["zerone.claiming_pot.v1.MsgClaim"],requires_approval:false}],spend_limits:[],fee_limits:[{asset_id:profile.native_asset_id,max_per_intent:policy.max_fee_uzrn}],max_intents:1,approval_threshold:0,issued_at:start,not_before:start,expires_at:end,revocation_nonce:0,policy_hash:policy.policy_hash,purpose:"Authorized disposable real localnet test only"},provider(owner));
    const payload=encodeSeedMsgClaim({claimant:f.claimant_address,pot_id:policy.pot_id});
    const intent=await sealTransactionIntent({schema:"agent-wallet/intent/0.1",intent_id:randomUUID(),wallet_id:descriptor.wallet_id,descriptor_id:descriptor.record_id,grant_id:capability.grant_id,capability_record_id:capability.record_id,delegate:delegate.authority,chain_id:profile.chain_id,source_account:policy.claimant_account,calls:[{action:"call",target_account:profile.claiming_pot_account,method:"zerone.claiming_pot.v1.MsgClaim",payload_b64u:Buffer.from(payload).toString("base64url"),payload_hash:digest(payload),native_value:null}],declared_spends:[],max_fee:{asset_id:profile.native_asset_id,amount_atomic:policy.max_fee_uzrn},issued_at:start,expires_at:end,nonce:randomUUID()},provider(delegate));
    const config:SeedConfig={protocol:"zerone-seed-runtime.config/0.1",host_id:randomUUID(),ledger_id:randomUUID(),ledger_path:join(root,"seed.sqlite"),signed_tx_path:join(root,"signed.tx"),profile,policy,node,helper:{path:f.helper,sha256:profile.helper_sha256},helper_trust_file:f.helper_trust_file,helper_trust_sha256:fileDigest(f.helper_trust_file),disposable_test:true,activation_gate:{mode:"disposable-local"},keyring:f.claimant_keyring,keyring_unlock_terminal:null,signer_public_key_b64u:signerKey.toString("base64url"),descriptor_file:join(root,"descriptor.json"),capability_file:join(root,"capability.json"),intent_file:join(root,"intent.json"),currentness_file:join(root,"currentness.json"),currentness_authority:current.authority,sponsor_budget_file:join(root,"budget.json"),sponsor_budget_authority:budget.authority,simulation_provider:{executable:opts.provider,key_file:simulation.key_file,authority:simulation.authority},fee_amount_uzrn:policy.max_fee_uzrn,gas_limit:policy.max_gas,timeout_ms:10000};
    validateConfig(config);
    writeNewJson(config.descriptor_file,descriptor);writeNewJson(config.capability_file,capability);writeNewJson(config.intent_file,intent);
    const currentCore:Currentness={protocol:"zerone-seed-runtime.currentness/0.1",host_id:config.host_id,ledger_id:config.ledger_id,profile_id:profile.profile_id,policy_hash:policy.policy_hash,node_config_hash:sha256Id(node),descriptor_id:descriptor.record_id,capability_record_id:capability.record_id,intent_record_id:intent.record_id,owner_identity_id:descriptor.owner_identity_id,wallet_authority:owner.authority,signer_key_id:digest(signerKey),root_revoked:false,capability_revoked:false,revocation_nonce:0,issued_at:start,valid_until:end};
    const budgetCore:SponsorBudget={protocol:"zerone-seed-runtime.sponsor-budget/0.1",host_id:config.host_id,ledger_id:config.ledger_id,profile_id:profile.profile_id,sponsor_account:policy.sponsor_account,...budgetAmounts(policy.grant_spend_limit_uzrn,policy.setup_fee_budget_uzrn),issued_at:start,valid_until:end};
    const attest=async(core:unknown,key:ReturnType<typeof testKey>)=>({core,signature:await provider(key).sign_digest(Buffer.from(sha256Id(core).slice(7),"hex"))});
    writeNewJson(config.currentness_file,await attest(currentCore,current));writeNewJson(config.sponsor_budget_file,await attest(budgetCore,budget));
    const configPath=join(root,"config.json");writeNewJson(configPath,config);const configHash=fileDigest(configPath);
    // Only this explicit fixture/test author approves these freshly generated test keys.
    evidence.config_sha256=configHash;evidence.budget=budgetAmounts(policy.grant_spend_limit_uzrn,policy.setup_fee_budget_uzrn);
    const cli=async(command:string,...args:string[])=>{
      stage=command; const result=await processes.run(opts.cli,[command,"--config",configPath,"--config-sha256",configHash,...args],root);
      evidence.stages.push(diagnostic(command,result));return result;
    };
    const inspect=await cli("inspect");check(inspect.code===0 && inspect.value.assessment?.status==="ready","inspection_not_eligible");
    check(!existsSync(config.ledger_path) && !existsSync(config.signed_tx_path),"readonly_inspection_effect");
    const prepared=await cli("prepare");check(prepared.code===0,"preparation_failed");
    check(!existsSync(config.ledger_path) && !existsSync(config.signed_tx_path),"readonly_preparation_effect");
    const init=await cli("init");check(init.code===0 && init.value.operations.length===0,"journal_not_empty");
    const planPath=join(root,"prepared-1.json");writeNewJson(planPath,prepared.value);evidence.prepare_attempts=1;
    const signing=await cli("reserve-sign","--plan",planPath);
    if(signing.code!==0 || signing.value?.status!=="signed") {
      // Preserve read-only boundary evidence, never infer retry permission from an error.
      const status=await cli("status");
      if(status.code===0 && Array.isArray(status.value.operations)) evidence.stopped_status={operation_count:status.value.operations.length,signed_file_present:existsSync(config.signed_tx_path)};
      check(false,"signing_not_confirmed");
    }
    const signed=signing.value;
    check(signed?.status==="signed","signing_not_confirmed"); evidence.tx_hash=signed.tx_hash;evidence.operation_id=signed.operation_id;
    const submitted=await cli("submit","--operation",signed.operation_id);check(submitted.code===0 && submitted.value.status==="submission_unknown" && submitted.value.tx_hash===signed.tx_hash,"submission_not_confirmed");
    let confirmed:any; const until=Date.now()+60000;
    for(let poll=0;poll<30 && Date.now()<until;poll++) {
      const result=await cli("reconcile","--operation",signed.operation_id);check(result.code===0,"reconcile_failed");confirmed=result.value;
      if(confirmed.status!=="submission_unknown") break;
      await Bun.sleep(1000);
    }
    const replay=await cli("reserve-sign","--plan",planPath);
    const receipt=successReceipt(signed,confirmed,f.claimant_address,replay);
    const resubmit=await cli("submit","--operation",signed.operation_id);
    check(resubmit.code!==0 && resubmit.value?.code==="submission_already_attempted","submission_replay_not_refused");
    check(fileDigest(opts.cli.path)===opts.cli.sha256 && fileDigest(opts.provider.path)===opts.provider.sha256 && fileDigest(configPath)===configHash,"test_artifact_drift");
    evidence.result="PASS";evidence.confirmation={status:"included_success",operation_id:signed.operation_id,tx_hash:signed.tx_hash,credited_amount_uzrn:"222000",code:0,sequence_retired:true};evidence.replay_code="already_reserved";
    writeNewJson(f.result_file,receipt);
  } catch(e) {
    evidence.failure={stage,code:e instanceof Error && "code" in e && SAFE_CODES.has(String(e.code))?String(e.code):"test_stage_failed"};
    throw e;
  } finally {
    process.removeListener("SIGTERM",processes.stop);process.removeListener("SIGINT",processes.stop);
    evidence.direct_children_reaped=processes.active.size===0;
    writeNewJson(join(root,"runner-evidence.json"),evidence);
  }
}
if(import.meta.main) {
  if(process.argv.length===2 || process.argv.slice(2).join(" ")==="--help") console.log(HELP);
  else try {await runLocalnet(options(process.argv.slice(2)));console.log(canonicalJson({result:"PASS",label:"NON-FINAL"}));}
  catch {console.log(canonicalJson({result:"FAIL",label:"NON-FINAL",code:"localnet_runner_refused"}));process.exitCode=1;}
}
