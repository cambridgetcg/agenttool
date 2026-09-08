import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fixture, path, writeJson } from "./test-fixtures.js";
import { fileDigest, parse } from "./validation.js";
import { validateConfig } from "./config.js";

const roots=new Set<string>();
// Explicit local paired-source seam; never resolve or contact a hosted gate.
const gateTest=resolve(path,"../../../zerone-seed-mvp-v1/deploy/test-seed-activation.py");
beforeAll(async()=>{
  expect(Bun.version).toBe("1.3.5");
  const build=Bun.spawn([process.execPath,join(path,"build.ts")],{cwd:path,stdout:"ignore",stderr:"inherit"});expect(await build.exited).toBe(0);
  mkdirSync(join(path,"node_modules/.cache/zerone-seed"),{recursive:true,mode:0o700});
  const helper=Bun.spawn([process.execPath,"build",join(path,"test-helper.ts"),"--compile","--outfile",join(path,"node_modules/.cache/zerone-seed/test-helper")],{cwd:path,stdout:"ignore",stderr:"inherit"});expect(await helper.exited).toBe(0);
},120000);
afterAll(()=>{for(const root of roots) rmSync(root,{recursive:true,force:true});});

test("activation omission and disposable-mode production retargeting fail closed",async()=>{
  const f=await fixture();roots.add(f.root);
  const {activation_gate,...missing}=f.config;
  expect(()=>validateConfig(missing)).toThrow();
  expect(()=>validateConfig({...f.config,activation_gate:{mode:"disabled"}})).toThrow();
  expect(()=>validateConfig({...f.config,activation_gate:{mode:"disposable-local"},disposable_test:false,keyring:{...f.config.keyring,backend:"file"}})).toThrow();
});

for(const scenario of ["normal","concurrent","missing-key","crash-sign","missing-evidence","changed-request","changed-bundle","signed-wrong-prestate","signed-wrong-currentness","signed-wrong-budget","fresh-underfunded","fresh-timeout","fresh-fork","prepare-fork","signed-preparation-fork"]) {
  test(`compiled runtime consumes actual signed gate output: ${scenario}`,async()=>{
    const root=mkdtempSync(join(realpathSync(tmpdir()),"seed-gate-seam-"));roots.add(root);
    const source=join(root,"source-manifest.json"),runtime=join(root,"synthetic-zeroned"),wallet=join(root,"synthetic-wallet.tgz");
    writeJson(source,{schema:"synthetic-source-manifest",fixture:"no-release-acceptance"});
    writeFileSync(runtime,"TEST ONLY: no executable chain daemon\n",{mode:0o600});writeFileSync(wallet,"TEST ONLY: archive stand-in\n",{mode:0o600});
    const f=await fixture({source_digest:fileDigest(source),runtime_sha256:fileDigest(runtime),gateBudgets:true,total:"400000"});roots.add(f.root);
    const input=join(root,"seam-input.json");
    writeJson(input,{scenario,root,config:f.config,observation:f.observation,cli:join(path,"dist/zerone-seed"),log:f.log,
      artifacts:{source_digest:source,runtime_sha256:runtime,wallet_sha256:wallet,helper_sha256:f.config.helper.path,cli_sha256:join(path,"dist/zerone-seed")}});
    const child=Bun.spawn(["python3","-B",gateTest,"--runtime-seam-input",input],{cwd:path,stdout:"pipe",stderr:"pipe"});
    const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect({code,err}).toEqual({code:0,err:""});
    const result=parse(out);expect(result.real_gpgv).toBe(scenario !== "prepare-fork");expect(result.presign_event_count).toBe(0);expect(result.daemon).toBe(false);
    expect(result.host).toBe(["normal","concurrent"].includes(scenario) ? "included_success":["missing-key","crash-sign"].includes(scenario) ? "signing_unknown":"refused-before-sign");
  },120000);
}
