#!/usr/bin/env -S bun --no-env-file
/** Finite private operator CLI. Doctrine: docs/COLLABORATION-CHANNELS.md */
import { readBinding, check, CourierError, summary, until, active, abort } from '../src/binding.js';
import { Ledger } from '../src/ledger.js';
import { McpImporter } from '../src/importer.js';
import { Courier, ownRunner, selectReport } from '../src/courier.js';

const HELP='agenttool-collab-courier status|select|run-once|watch --profile <private-file>\nselect: --idempotency-key <stable-key> --destination <bound-alias> --report <id> --sequence <n> --expires-at <unix-ms> --summary-stdin [--parents <event-id,...>]\nwatch: --for <1ms..1h>\nNo network or network-secret lookup in status/select. Run/watch explicitly load only profile-named environment secrets.\n';
export async function main(argv=process.argv.slice(2)):Promise<void> {
  const startedAt=Date.now();
  if(argv.length===1&&(argv[0]==='--help'||argv[0]==='help')){process.stdout.write(HELP);return;}
  const [command,...rest]=argv;check(['status','select','run-once','watch'].includes(command),'invalid_command');
  const options=new Map<string,string>();
  for(let i=0;i<rest.length;i++){const key=rest[i];check(key.startsWith('--')&&!options.has(key),'invalid_arguments');if(key==='--summary-stdin'){options.set(key,'true');continue;}const value=rest[++i];check(value!==undefined&&!value.startsWith('--'),'invalid_arguments');options.set(key,value);}
  const permitted=new Set(['--profile',...(command==='select'?['--idempotency-key','--destination','--report','--sequence','--expires-at','--summary-stdin','--parents']:[]),...(command==='watch'?['--for']:[])]);
  check([...options.keys()].every(k=>permitted.has(k))&&options.has('--profile'),'invalid_arguments');
  const file=options.get('--profile')!;const b=readBinding(file);
  if(command!=='status')active(b);
  let watchMs=0;
  if(command==='watch') {const match=/^([1-9][0-9]*)(ms|s|m|h)$/.exec(options.get('--for')??'');check(match,'invalid_watch_duration');watchMs=Number(match[1])*({ms:1,s:1000,m:60000,h:3600000}[match[2]]!);check(Number.isSafeInteger(watchMs)&&watchMs>0&&watchMs<=3600000,'invalid_watch_duration');}
  if(command==='select')check(options.has('--idempotency-key')&&options.get('--summary-stdin')==='true'&&options.has('--destination')&&options.has('--report')&&options.has('--sequence')&&options.has('--expires-at'),'invalid_arguments');
  const deadline=startedAt+(command==='watch'?watchMs:b.limits.runMs);
  const controller=new AbortController();const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const remaining=()=>Math.max(0,deadline-Date.now());
  const signal=AbortSignal.any([controller.signal,remaining()>0?AbortSignal.timeout(remaining()):AbortSignal.abort()]);
  let ledger:Ledger|undefined,release:(()=>void)|undefined,importer:McpImporter|undefined,network:Awaited<ReturnType<typeof import('../src/host.js')['hostNetwork']>>|undefined;
  try {
    if(command!=='status'){abort(signal);release=ownRunner(b,command!=='select');}
    ledger=new Ledger(b);
    if(command==='status'){process.stdout.write(JSON.stringify(ledger.status())+'\n');return;}
    abort(signal);importer=await McpImporter.open(b,ledger,signal);
    if(command==='select') {
      check(options.has('--idempotency-key')&&options.get('--summary-stdin')==='true'&&options.has('--destination')&&options.has('--report')&&options.has('--sequence')&&options.has('--expires-at'),'invalid_arguments');
      let text='';const reader=Bun.stdin.stream().getReader();const decoder=new TextDecoder('utf-8',{fatal:true});
      try {while(true){const {done,value}=await until(reader.read(),signal);if(done){text+=decoder.decode();break;}check(Buffer.byteLength(text)+value.length<=4096,'summary_too_large');text+=decoder.decode(value,{stream:true});}}
      finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
      const id=await selectReport(()=>readBinding(file),ledger,importer,{idempotencyKey:options.get('--idempotency-key')!,alias:options.get('--destination')!,reportId:options.get('--report')!,sequence:Number(options.get('--sequence')),expiresAt:Number(options.get('--expires-at')),summary:summary(text),parents:options.get('--parents')?.split(',')},signal);
      process.stdout.write(JSON.stringify({state:ledger.get<{state:string}>(id)!.state,selectionId:id,sentThisInvocation:false})+'\n');return;
    }
    const {loadNamedSecrets,hostNetwork}=await import('../src/host.js');
    abort(signal);const secrets=loadNamedSecrets(b,process.env);network=hostNetwork(b,secrets);
    const courier=new Courier(ledger,{current:()=>readBinding(file),importer,transport:network.transport,telegram:network.telegram,signingKey:secrets.signingKey});
    if(command==='run-once')await courier.runOnce(signal);
    else {abort(signal);check(remaining()>0,'cancelled');await courier.watch(remaining(),signal);}
    process.stdout.write(JSON.stringify(ledger.status())+'\n');
  } finally {
    // One failing resource must never prevent the remaining cleanup steps.
    let failed=false;
    for(const cleanup of [()=>network?.close(),()=>importer?.close(remaining()),()=>ledger?.close(),()=>release?.()]) {
      try {await cleanup();}catch{failed=true;}
    }
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    if(failed)throw new CourierError('cleanup_failed');
  }
}
if(import.meta.main)main().catch(e=>{process.stderr.write(JSON.stringify({error:e instanceof CourierError?e.code:'courier_failed',details:'redacted'})+'\n');process.exitCode=1;});
