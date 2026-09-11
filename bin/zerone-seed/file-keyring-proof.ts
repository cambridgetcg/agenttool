// Test-only child of file-keyring-proof.py. No daemon, provider discovery or key export.
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "@agenttool/wallet";
import { createSeedClaimPlan } from "../../packages/wallet-zerone/src/bootstrap/v1.js";
import { NativeSeedIo, preflightKeyringSigner } from "./adapters.js";
import { loadConfig, validateConfig } from "./config.js";
import { SeedRuntime } from "./runtime.js";
import { check, fileDigest, readJson, same } from "./validation.js";
import { fixture, writeJson } from "./test-fixtures.js";

async function proof(inputPath:string) {
  const progress=(stage:string)=>writeJson(join(dirname(inputPath),"progress.json"),{stage});
  progress("input");
  const input=readJson(inputPath),roots:string[]=[];
  check(input.ack === "disposable-file-keyring-proof" && input.helper.sha256 === fileDigest(input.helper.path));
  const f=await fixture({helper:input.helper,signer_public_key_b64u:input.public_key_b64u,genesis_hash:fileDigest(input.genesis),source_digest:fileDigest(input.source),runtime_sha256:fileDigest(input.runtime)});
  roots.push(f.root);
  try {
    writeJson(f.config.helper_trust_file,{protocol:"zerone-seed-trust/0.1",profile_id:f.config.profile.profile_id,node:f.config.node,genesis_file:input.genesis,runtime_file:input.runtime,source_manifest_file:input.source,disposable_test:true});
    const c=validateConfig({...f.config,helper_trust_sha256:fileDigest(f.config.helper_trust_file),keyring:{backend:"file",home:input.home,key_name:"claimant"},keyring_unlock_terminal:input.terminal,timeout_ms:10000});
    writeJson(f.configPath,c);
    const approved=fileDigest(f.configPath);same(loadConfig(f.configPath,approved),c);
    writeJson(f.configPath,{...c,keyring_unlock_terminal:null});
    let digestRefused=false;try {loadConfig(f.configPath,approved);} catch {digestRefused=true;}
    check(digestRefused);writeJson(f.configPath,c);
    progress("preflight");
    check(preflightKeyringSigner(c) === input.terminal);
    const alias=join(f.dir,"tty-alias");symlinkSync(input.terminal,alias);
    for(const terminal of [null,alias,input.fifo,join(f.dir,"missing"),f.configPath,"/dev/null","/dev/tty"]) {
      progress(terminal === input.fifo ? "fifo_preflight":"negative_preflight");
      let refused=false;try {preflightKeyringSigner({...c,keyring_unlock_terminal:terminal});} catch {refused=true;}
      check(refused,"terminal_negative_control");
    }
    const plan=createSeedClaimPlan({profile:c.profile,policy:c.policy,observation:f.observation,signer_public_key_b64u:c.signer_public_key_b64u,now:new Date().toISOString(),capability:f.capability,intent:f.intent,fee_amount_uzrn:c.fee_amount_uzrn,gas_limit:c.gas_limit});
    const base={protocol:"zerone-seed-io/0.1" as const,request_id:"owned-file-keyring",timeout_ms:c.timeout_ms,profile:c.profile,policy:c.policy,plan,signed_tx_path:c.signed_tx_path};
    const io=new NativeSeedIo(c);
    progress("native_sign");
    const signed=await io.call({...base,command:"sign",keyring:c.keyring});
    check(existsSync(c.signed_tx_path));
    // The signed bytes remain in the native helper's private file, never read here.
    progress("native_verify");
    const verified=await io.call({...base,command:"verify"});same(signed,verified);
    progress("wrong_password");
    const bad=validateConfig({...c,signed_tx_path:join(f.dir,"wrong-password.tx"),keyring_unlock_terminal:input.wrong_terminal});
    let wrongPasswordRefused=false;
    try {await new NativeSeedIo(bad).call({...base,signed_tx_path:bad.signed_tx_path,command:"sign",keyring:bad.keyring});} catch {wrongPasswordRefused=true;}
    check(wrongPasswordRefused && !existsSync(bad.signed_tx_path));

    progress("argv_probe");
    // Argv probe refuses every sign; it is not the encrypted-keyring success proof.
    const probe=join(f.dir,"argv-probe"),log=join(f.dir,"argv.json");
    writeFileSync(probe,`#!/usr/bin/python3\nimport sys,json\nr=json.load(sys.stdin)\nwith open(${JSON.stringify(log)},"w") as f: json.dump({"argv":sys.argv[1:],"request_keys":sorted(r)},f)\nout={"protocol":r["protocol"],"request_id":r["request_id"],"command":r["command"],"status":"error","code":"invalid_request"}\nif r["command"]=="inspect": out={"protocol":r["protocol"],"request_id":r["request_id"],"command":"inspect","status":"ok","result":{"protocol":"agent-wallet-zerone.seed-observation/0.1","status":"unknown","profile_id":r["profile"]["profile_id"],"reason":"unavailable"}}\nprint(json.dumps(out,sort_keys=True,separators=(",",":")))\n`,{mode:0o700});
    const g=await fixture({helper:{path:probe,sha256:fileDigest(probe)},signer_public_key_b64u:input.public_key_b64u});roots.push(g.root);
    const pc=validateConfig({...g.config,keyring:c.keyring,keyring_unlock_terminal:input.terminal});
    const pp=createSeedClaimPlan({profile:pc.profile,policy:pc.policy,observation:g.observation,signer_public_key_b64u:pc.signer_public_key_b64u,now:new Date().toISOString(),capability:g.capability,intent:g.intent,fee_amount_uzrn:pc.fee_amount_uzrn,gas_limit:pc.gas_limit});
    const request={...base,profile:pc.profile,policy:pc.policy,plan:pp,signed_tx_path:pc.signed_tx_path,command:"sign" as const,keyring:pc.keyring};
    let probeRefused=false;try {await new NativeSeedIo(pc).call(request);} catch {probeRefused=true;}check(probeRefused);
    const logged=JSON.parse(readFileSync(log,"utf8"));
    same(logged.argv,["sign","--trust-file",pc.helper_trust_file,"--disposable-test","--unlock-terminal",input.terminal]);
    check(!logged.request_keys.includes("keyring_unlock_terminal") && !logged.request_keys.includes("unlock_terminal"));
    const unknown=await new NativeSeedIo(pc).call({protocol:base.protocol,request_id:"read-no-terminal",timeout_ms:1000,command:"inspect",profile:pc.profile,policy:pc.policy,node:pc.node,height:null}) as any;
    check(unknown.status === "unknown" && unknown.reason === "unavailable");
    same(JSON.parse(readFileSync(log,"utf8")).argv,["inspect","--trust-file",pc.helper_trust_file,"--disposable-test"]);
    const previousLog=readFileSync(log,"utf8");
    let keyRefused=false;try {await new NativeSeedIo(pc).call({...request,keyring:{...pc.keyring,key_name:"substituted"}});} catch {keyRefused=true;}
    check(keyRefused && readFileSync(log,"utf8") === previousLog);
    writeFileSync(probe,"\n# changed artifact\n",{flag:"a"});
    let hashRefused=false;try {await new NativeSeedIo(pc).call(request);} catch {hashRefused=true;}
    check(hashRefused && readFileSync(log,"utf8") === previousLog);
    progress("synthetic_boundary");
    // Separate synthetic boundary test; the real encrypted backend was verified above.
    const boundary=await fixture({mode:"missing-key"});roots.push(boundary.root);
    const bc=validateConfig({...boundary.config,keyring:c.keyring,keyring_unlock_terminal:input.terminal}),rt=new SeedRuntime(bc);
    rt.init();const prepared=await rt.prepare();
    const uncertain=await rt.reserveSign(prepared);check(uncertain.status === "signing_unknown" && uncertain.retry_allowed === false);
    let replayRefused=false;try {await new SeedRuntime(bc).reserveSign(prepared);} catch {replayRefused=true;}
    check(replayRefused && rt.status().operations[0].status === "signing_unknown" && rt.status().total_reserved_sponsor_exposure_uzrn === "350000");
    check(readFileSync(boundary.log,"utf8").split("\n").filter(x=>x === "sign").length === 1);
    return {result:"PASS",synthetic_file_boundary_sticky_unknown:true,native_sign_verified:true,wrong_password_refused:true,terminal_negative_controls:7,exact_sign_argv:true,inspect_no_terminal_flag:true,unknown_preserved:true,key_substitution_refused:true,helper_digest_drift_refused:true,config_digest_bound:true,native_helper_sha256:c.helper.sha256,private_signed_bytes_read:false,daemon_started:false};
  } finally {for(const root of roots) rmSync(root,{recursive:true,force:true});}
}
if(import.meta.main) {
  try {check(process.argv.length === 4 && process.argv[2] === "--ack-disposable-file-keyring");console.log(canonicalJson(await proof(process.argv[3])));}
  catch(e) {console.log(canonicalJson({result:"FAIL",code:e instanceof Error && "code" in e ? String(e.code):"file_keyring_proof_failed"}));process.exitCode=1;}
}
