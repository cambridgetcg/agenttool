import { test, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture, key } from './helpers.js';
import { ownRunner } from '../src/courier.js';
import { hostNetwork } from '../src/host.js';
import { sleep, until } from '../src/binding.js';

const cli=resolve(import.meta.dir,'../bin/agenttool-collab-courier.ts');
async function invoke(args:string[],home:string,input='',extraEnv:Record<string,string>={}) {
  const child=spawn(process.execPath,['--no-env-file','--config=/dev/null',cli,...args],{env:{HOME:home,PATH:'/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',TMPDIR:'/tmp',...extraEnv},cwd:home,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.stdin.end(input);
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  const code=await new Promise<number|null>((r,j)=>{child.on('error',j);child.on('exit',r);});clearTimeout(timer);return {code,stdout,stderr};
}
test('executable CLI help/status/select smoke without network credentials or source disclosure',async()=>{
  const f=fixture(1);try{
    const help=await invoke(['--help'],f.root);expect(help.code).toBe(0);expect(help.stdout).toContain('--summary-stdin');
    const status=await invoke(['status','--profile',f.profile],f.root);expect(status.code).toBe(0);const report=JSON.parse(status.stdout);expect(report.networkProbed).toBe(false);expect(report.authorityEffects).toBe(false);
    expect(status.stdout).not.toContain(f.root);expect(status.stdout).not.toContain('FIXTURE_');expect(status.stdout).not.toContain(f.b.correspondence.sender.identity_id);
    const selected=await invoke(['select','--profile',f.profile,'--idempotency-key','cli-selection','--destination','fleet','--report',f.source.id,'--sequence',String(f.source.event_sequence),'--expires-at',String(Date.now()+60000),'--summary-stdin'],f.root,'Chosen scalar summary 🙂');
    expect(selected.code).toBe(0);expect(JSON.parse(selected.stdout)).toMatchObject({state:'queued',sentThisInvocation:false});expect(selected.stdout).not.toContain('PRIVATE SOURCE');expect(selected.stderr).toBe('');
    const second=await invoke(['status','--profile',f.profile],f.root);expect(JSON.parse(second.stdout).counts).toContainEqual({kind:'out',state:'queued',count:1});
  }finally{await f.close();}
});
test('CLI rejects hidden network flags and unknown audience locally; no raw error disclosure',async()=>{
  const f=fixture(1);try{
    for(const args of [['status','--profile',f.profile,'--token','sensitive-sentinel'],['watch','--profile',f.profile,'--for','infinite'],['watch','--profile',f.profile,'--for','2h'],['run-once','--profile',f.profile]]) {
      const result=await invoke(args,f.root);expect(result.code).toBe(1);expect(result.stderr).not.toContain(f.root);expect(result.stderr).not.toContain('sensitive-sentinel');expect(result.stderr).not.toContain('PRIVATE SOURCE');
    }
  }finally{await f.close();}
});
test('real host dispatcher and no-provider run-once close MCP and ownership without hanging',async()=>{
  const f=fixture(1);try{
    const network=hostNetwork(f.b,{bearer:'synthetic-fixture-bearer',signingKey:key(1).seed});
    await network.close();await network.close();
    f.setBinding({...f.b,destinations:f.b.destinations.map(d=>({...d,revoked:true}))});
    const started=Date.now();
    const result=await invoke(['run-once','--profile',f.profile],f.root,'',{FIXTURE_BEARER:'synthetic-fixture-bearer',FIXTURE_SEED:key(1).seed});
    expect(result.code).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout).counts).toEqual([]);expect(Date.now()-started).toBeLessThan(1000);
    const release=ownRunner(f.b,true);release();
    expect(readdirSync(f.b.local.home).filter(name=>name.startsWith('courier-mcp-'))).toEqual([]);
  }finally{await f.close();}
});

test('real CLI refuses destination drift while waiting for operator stdin and queues nothing',async()=>{
  const f=fixture(1,true);let child:ReturnType<typeof spawn>|undefined;
  try{
    const original=f.b;
    child=spawn(process.execPath,['--no-env-file','--config=/dev/null',cli,'select','--profile',f.profile,'--idempotency-key','stdin-drift','--destination','human','--report',f.source.id,'--sequence',String(f.source.event_sequence),'--expires-at',String(Date.now()+60000),'--summary-stdin'],{env:{HOME:f.root,PATH:'/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',TMPDIR:'/tmp'},cwd:f.root,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout!.on('data',chunk=>stdout+=chunk);child.stderr!.on('data',chunk=>stderr+=chunk);
    const exited=new Promise<number|null>((resolve,reject)=>{child!.once('exit',resolve);child!.once('error',reject);});
    const stop=AbortSignal.timeout(3000);
    while(JSON.parse(readFileSync(f.b.local.sessionFile,'utf8')).generation===f.handle.credential.generation)await sleep(10,stop);
    f.setBinding({...original,destinations:original.destinations.map(d=>d.kind==='telegram'?{...d,chatId:99}:d)});
    child.stdin!.end('Chosen under a changed audience');
    expect(await until(exited,stop)).toBe(1);expect(stderr).toContain('binding_changed');expect(stdout).toBe('');
    f.setBinding(original);expect(f.ledger.rows('out',['queued','signed','provider_accepted'])).toEqual([]);
    const release=ownRunner(f.b,false);release();
  }finally{child?.kill('SIGTERM');await f.close();}
});

for(const duration of ['1ms','60ms'])test(`watch ${duration} includes silent MCP startup in its invocation deadline`,async()=>{
  const f=fixture(1);try{
    const script=f.root+'/silent-mcp.ts';writeFileSync(script,'process.stdin.resume();setInterval(()=>{},1000);');
    f.setBinding({...f.b,ledgerPath:f.root+'/silent-courier.sqlite',local:{...f.b.local,args:[script]}});
    const started=Date.now();const result=await invoke(['watch','--profile',f.profile,'--for',duration],f.root);
    expect(result.code).toBe(1);expect(Date.now()-started).toBeLessThan(500);expect(result.stderr).not.toContain(f.root);
    const release=ownRunner(f.b,true);release();
    expect(readdirSync(f.b.local.home).filter(name=>name.startsWith('courier-mcp-'))).toEqual([]);
  }finally{await f.close();}
});

for(const command of ['status','select','run-once','watch'])test(`CLI ${command} records tightened paused/expired policy before inactive denial or host startup`,async()=>{
  const f=fixture(1);
  try {
    const original=f.b,changed=structuredClone(original);changed.enabled=false;changed.expiresAt=Date.now()-1;changed.destinations[0].revoked=true;changed.correspondence.peers[0].expiresAt--;
    f.ledger.advance('fleet','7');f.setBinding(changed);
    const args=[command,'--profile',f.profile,...(command==='watch'?['--for','1s']:command==='select'?['--idempotency-key','paused','--destination','fleet','--report',f.source.id,'--sequence',String(f.source.event_sequence),'--expires-at',String(Date.now()+60000),'--summary-stdin']:[])];
    const result=await invoke(args,f.root,'Chosen but inactive');
    expect(result.code).toBe(command==='status'?0:1);if(command!=='status')expect(result.stderr).toContain('binding_inactive');
    expect(JSON.parse(f.ledger.meta('policy:global')!).expiresAt).toBe(changed.expiresAt);
    expect(JSON.parse(f.ledger.meta('policy:destination:fleet')!).revoked).toBe(true);
    expect(JSON.parse(f.ledger.meta('policy:peer:peer')!).expiresAt).toBe(changed.correspondence.peers[0].expiresAt);
    expect(f.ledger.cursor('fleet')).toBe('7');expect(f.ledger.meta('importer_token')).toBeNull();expect(f.ledger.rows('out',['queued'])).toEqual([]);
    expect(readdirSync(f.b.local.home).filter(name=>name.startsWith('courier-mcp-'))).toEqual([]);
    f.setBinding(original);const restored=await invoke(['status','--profile',f.profile],f.root);expect(restored.code).toBe(1);expect(restored.stderr).toContain('binding_changed');expect(f.ledger.cursor('fleet')).toBe('7');
  } finally {await f.close();}
});

test('Bun importer does not auto-load workspace .env',async()=>{
  const f=fixture(1);try{
    writeFileSync(f.b.local.workspacePath+'/.env','DATABASE_URL=synthetic-never-production\nAGENTOOL_COLLAB_DB=/nonexistent/poison\n');
    await f.open();await f.select();expect(f.ledger.rows('out',['queued'])).toHaveLength(1);
  }finally{await f.close();}
});
