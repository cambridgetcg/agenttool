import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "@agenttool/wallet";

if(Bun.version !== "1.3.5") throw new Error("Release build requires Bun 1.3.5");
const root=import.meta.dir, out=resolve(root,"dist"); mkdirSync(out,{recursive:true});
// The shared candidate bootstrap source is deliberately bundled, not an unreleased economy dependency.
// Force one exact Wallet module instance: verification brands are private WeakSets.
const wallet=resolve(root,"node_modules/@agenttool/wallet/dist/index.js");
const artifacts: Record<string,string>={};
for(const name of ["main","record-signer"]) {
  const result=await Bun.build({entrypoints:[resolve(root,`${name}.ts`)],target:"bun",outdir:out,naming:`${name}.js`,
    plugins:[{name:"released-wallet-singleton",setup(build){
      build.onResolve({filter:/^@agenttool\/wallet$/},()=>({path:wallet}));
      build.onResolve({filter:/^(@noble\/(curves|hashes)\/|@scure\/base$)/},args=>({path:Bun.resolveSync(args.path,root)}));
    }}]});
  if(!result.success) throw new Error("Seed build failed");
  const output=result.outputs[0]; artifacts[`${name}.js`]=`sha256:${createHash("sha256").update(new Uint8Array(await output.arrayBuffer())).digest("hex")}`;
  const binary=name === "main" ? "zerone-seed" : "zerone-seed-record-signer";
  const child=Bun.spawn([process.execPath,"build",resolve(out,`${name}.js`),"--compile","--outfile",resolve(out,binary)],{cwd:root,env:{PATH:"/usr/bin:/bin",LANG:"C"},stdout:"ignore",stderr:"ignore"});
  if(await child.exited !== 0) throw new Error("Seed executable build failed");
  artifacts[binary]=`sha256:${createHash("sha256").update(new Uint8Array(await Bun.file(resolve(out,binary)).arrayBuffer())).digest("hex")}`;
}
writeFileSync(resolve(out,"manifest.json"),canonicalJson({protocol:"zerone-seed-runtime.artifacts/0.1",bun:"1.3.5",wallet:"0.1.3",source_integrated_bootstrap:true,artifacts})+"\n");
console.log(canonicalJson({status:"built",artifacts}));
