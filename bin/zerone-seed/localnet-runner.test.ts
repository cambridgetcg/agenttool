import { test,expect } from "bun:test";
import { mkdtempSync,realpathSync,readFileSync,lstatSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetAmounts,diagnostic,options,Processes,successReceipt,testEnvironment,writeNewJson } from "./localnet-runner.js";
import { fileDigest } from "./validation.js";
const hash: `sha256:${string}`=`sha256:${"a".repeat(64)}`;
test("no ambient opt-in, production defaults or ignored flags",()=>{
  expect(()=>options([])).toThrow();expect(()=>testEnvironment({})).toThrow();
  const args=["--ack-disposable-runner","--cli","/private/cli","--cli-sha256",hash,"--record-signer","/private/provider","--record-signer-sha256",hash];
  expect(options(args).cli.sha256).toBe(hash);
  expect(()=>options([...args,"--ignored","1"])).toThrow();
  expect(()=>options([...args,"--max-prepares","2"])).toThrow();
  expect(()=>options(args.map(x=>x==="/private/cli"?"relative":x))).toThrow();
});
test("actual outside grant is nonzero and conservatively double-counted",()=>{
  expect(budgetAmounts("10000000","4000000")).toEqual({outside_journal_exposure_uzrn:"10000000",total_exposure_uzrn:"24000000"});
  expect(()=>budgetAmounts("0","0")).toThrow();
});
test("only positive same-hash inclusion and actual replay refusal produce receipt",()=>{
  const signed={status:"signed",tx_hash:"A".repeat(64),operation_id:hash};
  const confirmed={...signed,status:"included_success",credited_amount_uzrn:"222000",code:0,sequence_retired:true};
  const replay={code:1,value:{status:"error",code:"already_reserved"}};
  expect(successReceipt(signed,confirmed,"test-claimant",replay).actual_amount).toBe("222000");
  expect(Object.keys(successReceipt(signed,{...confirmed,private_key:"NEVER_COPY"},"test-claimant",replay)).sort()).toEqual(["actual_amount","claimed_address","claimed_tx_hash","replay_refused"]);
  for(const change of [{status:"submission_unknown"},{status:"included_failed"},{tx_hash:"B".repeat(64)},{credited_amount_uzrn:null},{sequence_retired:false},{code:1},{operation_id:"other"}]) expect(()=>successReceipt(signed,{...confirmed,...change},"test-claimant",replay)).toThrow();
  expect(()=>successReceipt(signed,confirmed,"test-claimant",{code:0,value:replay.value})).toThrow();
  expect(()=>successReceipt(signed,confirmed,"test-claimant",{code:1,value:{status:"error",code:"helper_unavailable"}})).toThrow();
});
test("diagnostics never copy returned raw bodies or arbitrary error strings",()=>{
  const result=diagnostic("reserve-sign",{code:1,value:{status:"error",code:"PRIVATE CONTENT",private_key:"SECRET",tx_bytes:"SECRET"}});
  expect(JSON.stringify(result)).not.toContain("SECRET");expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(result.error_code).toBe("unclassified");
});
test("owned test children use a clean environment and are reaped",async()=>{
  const root=mkdtempSync(join(realpathSync(tmpdir()),"seed-runner-child-"));const p=new Processes();
  try {const result=await p.run({path:realpathSync(process.execPath),sha256:fileDigest(realpathSync(process.execPath))},["-e","console.log(JSON.stringify({home:process.env.HOME,ambient:process.env.SEED_FIXTURE_JSON??null}))"],root,1000);expect(result.value).toEqual({home:root,ambient:null});expect(p.active.size).toBe(0);}
  finally {rmSync(root,{recursive:true});}
});
test("stop drains and reaps owned child before returning interruption",async()=>{
  const root=mkdtempSync(join(realpathSync(tmpdir()),"seed-runner-stop-"));const p=new Processes();
  try {const promise=p.run({path:realpathSync(process.execPath),sha256:fileDigest(realpathSync(process.execPath))},["-e","setTimeout(()=>console.log('{}'),150)"],root,1000);const timer=setTimeout(p.stop,20);try {await expect(promise).rejects.toThrow();expect(p.active.size).toBe(0);}finally {clearTimeout(timer);}}
  finally {rmSync(root,{recursive:true});}
});
test("bounded child output refuses and reaps rather than retaining raw output",async()=>{
  const root=mkdtempSync(join(realpathSync(tmpdir()),"seed-runner-bound-"));const p=new Processes();
  try {await expect(p.run({path:realpathSync(process.execPath),sha256:fileDigest(realpathSync(process.execPath))},["-e","console.log('x'.repeat(300000));setTimeout(()=>{},5000)"],root,1000)).rejects.toThrow();expect(p.active.size).toBe(0);}
  finally {rmSync(root,{recursive:true});}
});
test("public evidence is canonical exclusive 0600, no overwrite",()=>{
  const root=mkdtempSync(join(realpathSync(tmpdir()),"seed-runner-unit-"));
  try {const path=join(root,"result.json");writeNewJson(path,{z:1,a:true});expect(readFileSync(path,"utf8")).toBe('{"a":true,"z":1}');expect(lstatSync(path).mode&0o777).toBe(0o600);expect(()=>writeNewJson(path,{})).toThrow();}
  finally {rmSync(root,{recursive:true});}
});
