import { canonicalJson } from "@agenttool/wallet";
import { loadConfig } from "./config.js";
import { SeedRuntime } from "./runtime.js";
import { SeedRuntimeError } from "./errors.js";
import { check, readJson } from "./validation.js";

export const HELP = `zerone-seed (candidate; Bun 1.3.5)

No command / help / --help: this text only, no files, providers or network.
All other commands require --config ABSOLUTE_FILE --config-sha256 sha256:HEX.
The digest is an independently approved operator trust input, not auto-discovery.

inspect                 Read configured records/currentness and bounded native state.
status                  Read an EXISTING private journal; no creation/recovery writes.
prepare                 Emit {plan,observation,prepared_at}; unsigned, no reservation.
init                    Explicitly initialize only the named journal (parent must exist).
pre-sign --plan FILE     Simulate/seal public records; emit unreserved candidate, no chain signing.
reserve-sign --plan FILE Consume signed gate-bound candidate atomically, then sign+verify.
                        Disposable-local mode alone accepts original prepared input.
verify --operation ID    Recover same private signed file; never opens a signer.
submit --operation ID    Fresh reauthorization, persisted boundary, ONE broadcast attempt.
reconcile --operation ID Exact-hash positive evidence; absence never enables replay.
operator-grant          Construct unsigned allowance proposal only.
operator-revoke         Construct unsigned revoke proposal only; pots remain committed.
operator-admit --authority RAW_ADDRESS
                        Construct unsigned admission only; no registrar/sponsor key use.

No key/account creation, ambient credentials, signAndSend, auto retry or default endpoint.
Software custody is not hardware isolation. One signer host and dedicated sponsor only.
Production provenance/custody/activation and independent localnet acceptance remain gates.
`;
export async function runCli(argv: string[]): Promise<unknown> {
  if(argv.length === 0 || (argv.length === 1 && ["help","--help","-h"].includes(argv[0]))) return HELP;
  const [command,...rest]=argv;
  check(["inspect","status","prepare","init","pre-sign","reserve-sign","verify","submit","reconcile","operator-grant","operator-revoke","operator-admit"].includes(command));
  const allowed=["--config","--config-sha256"];
  if(["pre-sign","reserve-sign"].includes(command)) allowed.push("--plan");
  if(["verify","submit","reconcile"].includes(command)) allowed.push("--operation");
  if(command === "operator-admit") allowed.push("--authority");
  check(rest.length === allowed.length*2);
  const options: Record<string,string>={};
  for(let i=0;i<rest.length;i+=2) { check(allowed.includes(rest[i]) && !(rest[i] in options)); options[rest[i]]=rest[i+1]; }
  for(const k of allowed) check(typeof options[k] === "string" && options[k].length > 0);
  const runtime=new SeedRuntime(loadConfig(options["--config"],options["--config-sha256"]));
  switch(command) {
    case "inspect": return runtime.inspect();
    case "status": return runtime.status();
    case "prepare": return runtime.prepare();
    case "init": return runtime.init();
    case "pre-sign": return runtime.preSign(readJson(options["--plan"]));
    case "reserve-sign": return runtime.reserveSign(readJson(options["--plan"]));
    case "verify": return runtime.verify(options["--operation"]);
    case "submit": return runtime.submit(options["--operation"]);
    case "reconcile": return runtime.reconcile(options["--operation"]);
    case "operator-grant": case "operator-revoke": case "operator-admit": return runtime.operator(command,options["--authority"]);
  }
}
if(import.meta.main) {
  try { const result=await runCli(process.argv.slice(2)); console.log(typeof result === "string" ? result : canonicalJson(result)); }
  catch(e) { console.log(canonicalJson({status:"error",code:e instanceof SeedRuntimeError ? e.code : "input_or_runtime_rejected"})); process.exitCode=1; }
}
