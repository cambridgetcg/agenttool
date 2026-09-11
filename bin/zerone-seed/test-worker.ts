// Separate-process test worker. All files are disposable fixtures created by runtime.test.ts.
import { canonicalJson } from "@agenttool/wallet";
import { loadConfig } from "./config.js";
import { readJson } from "./validation.js";
import { SeedRuntime } from "./runtime.js";
if(import.meta.main) {
  try {const runtime=new SeedRuntime(loadConfig(process.argv[2],process.argv[3])); console.log(canonicalJson(await runtime.reserveSign(readJson(process.argv[4]))));}
  catch {console.log(canonicalJson({status:"refused"}));process.exitCode=1;}
}
