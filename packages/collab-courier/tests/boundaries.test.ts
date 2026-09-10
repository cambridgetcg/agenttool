import { spawn, spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { Courier, selectReport } from '../src/courier.js';
import { test, expect } from 'bun:test';
import { chmodSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture, FakeNetwork, FakeTelegram, key, sender } from './helpers.js';
import { parseBinding, summary, decimal, bindingKey, readBinding, until, type Binding } from '../src/binding.js';
import { Ledger, ExclusiveOwner, type Ingress, type Selection } from '../src/ledger.js';
import { CorrespondenceWire, signSelection, wakeHint } from '../src/correspondence.js';
import { createSignedCorrespondenceEvent } from '@agenttool/sdk';
import { McpImporter } from '../src/importer.js';

for(const value of ['', 'x'.repeat(1001),'\ud800','\udfff','a\0b'])test(`summary refuses invalid bounded scalar text ${JSON.stringify(value).slice(0,30)}`,()=>{expect(()=>summary(value)).toThrow('invalid_summary');});
test('summary preserves exact Unicode scalars including supplementary characters',()=>{expect(summary('🙂'.repeat(1000))).toBe('🙂'.repeat(1000));});
for(const value of ['-1','01','1e3','9223372036854775808',1,null,'1.0'])test(`decimal receipt cursor refuses ${value}`,()=>expect(()=>decimal(value)).toThrow());
test('receipt cursor stays exact beyond safe JS integer',()=>{expect(decimal('9007199254740993')).toBe('9007199254740993');});

test('strict binding rejects extra authority, credentials, endpoints, recipients and filter rebinding',async()=>{
  const f=fixture(1);try {
    for(const version of ['0.4.0','0.5.0'] as const)expect(parseBinding({...f.b,local:{...f.b.local,version}}).local.version).toBe(version);
    for(const mutate of [(b:any)=>b.extra='secret',(b:any)=>b.correspondence.token='secret',(b:any)=>b.correspondence.baseUrl='http://fixture.invalid',(b:any)=>b.correspondence.baseUrl='https://secret@fixture.invalid',(b:any)=>b.destinations.push({...b.destinations[0]}),(b:any)=>b.local.binary='bun',(b:any)=>b.local.version='0.6.0']){
      const b=structuredClone(f.b);mutate(b);expect(()=>parseBinding(b)).toThrow();
    }
    const changed=structuredClone(f.b);changed.destinations[0].alias='new';expect(()=>new Ledger(changed)).toThrow('binding_changed');
    const disabled={...f.b,enabled:false};expect(bindingKey(disabled)).toBe(bindingKey(f.b));
    chmodSync(f.profile,0o644);expect(()=>readBinding(f.profile)).toThrow('unsafe_file');
  }finally{await f.close();}
});

test('bound ownership conflicts fail closed and release only own lock',async()=>{
  const f=fixture(1);try{const path=f.b.ledgerPath+'.owner';const owner=new ExclusiveOwner(path);expect(()=>new ExclusiveOwner(path)).toThrow('receiver_owner_conflict');owner.close();const reopened=new ExclusiveOwner(path);reopened.close();}finally{await f.close();}
});

test('ledger cap refuses new work, preserving existing dedup receipts',async()=>{
  const f=fixture(1);try{const b={...f.b,ledgerPath:f.root+'/bounded.sqlite',limits:{...f.b.limits,maxRows:10}};const ledger=new Ledger(b);
    try{for(let i=0;i<10;i++)ledger.put('in','fleet',{id:String(i),route:'fleet',state:'rejected',sessionId:b.local.sessionId,createdAt:0,reason:'fixture'});expect(()=>ledger.put('in','fleet',{id:'extra',route:'fleet',state:'rejected',sessionId:b.local.sessionId,createdAt:0})).toThrow('ledger_full');expect(ledger.get('0')).not.toBeNull();}finally{ledger.close();}
  }finally{await f.close();}
});

test('selection validates source through local MCP; no automatic export or journal dump',async()=>{
  const f=fixture(1);const network=new FakeNetwork();try{await f.open();await f.courier(network).runOnce(AbortSignal.timeout(3000));expect(network.posts).toHaveLength(0);
    await expect(f.select('unknown')).rejects.toThrow();await expect(f.select('fleet','summary',{...f.source,id:'invented'})).rejects.toThrow('source_report_not_found');
    expect(f.ledger.rows('out',['queued'])).toHaveLength(0);
    await f.select();expect(JSON.stringify(f.ledger.rows('out',['queued']))).not.toContain('PRIVATE SOURCE');
  }finally{await f.close();}
});

test('revocation after signing prevents transport retry despite historical receipt',async()=>{
  const f=fixture(1),network=new FakeNetwork();try{await f.open();await f.select();network.loseReceipt=true;await expect(f.courier(network).runOnce(AbortSignal.timeout(3000))).rejects.toThrow();
    const b=structuredClone(f.b);b.correspondence.peers[0].revoked=true;f.setBinding(b);
    await expect(f.courier(network).runOnce(AbortSignal.timeout(3000))).rejects.toThrow('peer_inactive');expect(network.posts).toHaveLength(1);
  }finally{await f.close();}
});

test('expired selection is not sent and paused host performs no request',async()=>{
  const f=fixture(1),network=new FakeNetwork();try{await f.open();const id=await f.select();const row=f.ledger.get<Selection>(id)!;f.ledger.update(row,'queued',{expiresAt:Date.now()-1});await f.courier(network).runOnce(AbortSignal.timeout(3000));expect(network.posts).toHaveLength(0);expect(f.ledger.get<Selection>(id)!.state).toBe('expired');
    f.setBinding({...f.b,enabled:false});const count=network.queries.length;await expect(f.courier(network).runOnce(AbortSignal.timeout(3000))).rejects.toThrow('binding_inactive');expect(network.queries).toHaveLength(count);
  }finally{await f.close();}
});

for(const field of ['project','repository','thread','key','identity','device','session','signature','body','cursor','cursorOrder','pageLength'])test(`incoming ${field} tampering never creates a report or advances receipt cursor`,async()=>{
  const a=fixture(1),b=fixture(2),network=new FakeNetwork();try{await a.open();await b.open();await a.select();await a.courier(network).runOnce(AbortSignal.timeout(3000));
    network.mutatePage=page=>{const e=page.events[0].event;
      if(field==='project')e.project_id=b.b.correspondence.sender.identity_id;
      if(field==='repository')e.repository_id='wrong';if(field==='thread')e.thread_id='wrong';
      if(field==='key')e.sender.signing_key_id=sender(3).signing_key_id;
      if(field==='identity')e.sender.identity_id=sender(3).identity_id;
      if(field==='device')e.sender.device_id=sender(3).device_id;if(field==='session')e.sender.session_id=sender(3).session_id;
      if(field==='signature')e.signature.value_b64url='A'.repeat(86);if(field==='body')e.body.public_key=key(1).publicKey;
      if(field==='cursor')page.page.next_after='999';if(field==='cursorOrder')page.events[0].receipt.received_seq='0';
      if(field==='pageLength')page.events=Array.from({length:51},()=>page.events[0]);
    };
    await expect(b.courier(network).runOnce(AbortSignal.timeout(3000))).rejects.toThrow();expect(b.ledger.cursor('fleet')).toBe('0');expect(b.store.listReports(b.b.local.workspaceId)).toHaveLength(1);
  }finally{await a.close();await b.close();}
},10000);

test('genuinely signed wrong sender tuple and wrong project rejected independently from key',async()=>{
  const b=fixture(2),network=new FakeNetwork();try{await b.open();
    const event=createSignedCorrespondenceEvent({project_id:b.b.projectId,repository_id:b.b.repositoryId,thread_id:'fixture-thread',sender:{...sender(1),device_id:sender(3).device_id},kind:'observation',body:{summary:'No inherited authority'},parents:[],session_seq:1,issued_at:new Date().toISOString(),scope:{base_revision:null,branch:null,paths:['.']}},key(1).seed);
    network.records.push({event,receipt:{received_seq:'9007199254740993',received_at:new Date().toISOString()},missing_parents:[],lineage_status:'not_applicable'});
    await expect(b.courier(network).runOnce(AbortSignal.timeout(3000))).rejects.toThrow('unverified_page');expect(b.ledger.cursor('fleet')).toBe('0');
  }finally{await b.close();}
});

test('expired but genuinely signed event is durably rejected without import',async()=>{
  const b=fixture(2),network=new FakeNetwork();try{await b.open();
    const event=createSignedCorrespondenceEvent({project_id:b.b.projectId,repository_id:b.b.repositoryId,thread_id:'fixture-thread',sender:sender(1),kind:'observation',body:{summary:'Old summary'},parents:[],session_seq:1,issued_at:new Date(Date.now()-700000).toISOString(),scope:{base_revision:null,branch:null,paths:['.']}},key(1).seed);
    network.records.push({event,receipt:{received_seq:'9007199254740993',received_at:new Date().toISOString()},missing_parents:[],lineage_status:'not_applicable'});
    await b.courier(network).runOnce(AbortSignal.timeout(3000));expect(b.ledger.get<Ingress>(`correspondence:${event.event_id}`)!.reason).toBe('incoming_expired');expect(b.ledger.cursor('fleet')).toBe('9007199254740993');expect(b.store.listReports(b.b.local.workspaceId)).toHaveLength(1);
  }finally{await b.close();}
});

test('pending import rechecks revocation and never reconstructs under a new session',async()=>{
  const a=fixture(1),b=fixture(2),network=new FakeNetwork();try{await a.open();await b.open();await a.select();await a.courier(network).runOnce(AbortSignal.timeout(3000));
    await expect(b.courier(network,undefined,s=>{if(s==='after_ingress')throw Error('crash');}).runOnce(AbortSignal.timeout(3000))).rejects.toThrow();
    const changed=structuredClone(b.b);changed.correspondence.peers[0].revoked=true;b.setBinding(changed);
    await expect(b.courier(network).runOnce(AbortSignal.timeout(3000))).rejects.toThrow('peer_inactive');expect(b.store.listReports(b.b.local.workspaceId)).toHaveLength(1);expect(b.ledger.cursor('fleet')).toBe('0');
  }finally{await a.close();await b.close();}
});

test('blocked Wake read is cancelled with finite lifetime; silent hints still trigger periodic replay',async()=>{
  const f=fixture(1),network=new FakeNetwork();try{await f.open();const start=Date.now();await expect(wakeHint(f.b,network,AbortSignal.timeout(30))).rejects.toThrow('cancelled');expect(Date.now()-start).toBeLessThan(500);expect(network.cancelled).toBe(1);
    await f.courier(network).watch(350,AbortSignal.timeout(1000));expect(network.queries.length).toBeGreaterThanOrEqual(3);expect(network.cancelled).toBeGreaterThanOrEqual(3);
  }finally{await f.close();}
});

test('Wake excessive frames and JSON response bounds terminate without imports',async()=>{
  const f=fixture(1);try{const transport={request:async()=>new Response('x'.repeat(8193),{headers:{'content-type':'text/event-stream'}})};
    await expect(wakeHint(f.b,transport,AbortSignal.timeout(1000))).rejects.toThrow('wake_frame_bound');
    const wire=new CorrespondenceWire(f.b,{request:async()=>new Response('x'.repeat(f.b.limits.maxResponseBytes+1))});
    await expect(wire.list(f.b.destinations[0],'0',AbortSignal.timeout(1000))).rejects.toThrow('response_too_large');
  }finally{await f.close();}
});

test('local MCP process receives scrubbed environment, is version checked and cancellation kills blocked startup',async()=>{
  const f=fixture(1);try{
    const script=f.root+'/probe.ts';const receipt=f.root+'/env.json';
    writeFileSync(script,`await Bun.write(${JSON.stringify(receipt)}, JSON.stringify(Object.keys(process.env)));setInterval(()=>{},1000);`);
    const b={...f.b,local:{...f.b.local,args:[script]}};const start=Date.now();
    await expect(McpImporter.open(b,f.ledger,AbortSignal.timeout(150))).rejects.toThrow('mcp_unavailable');expect(Date.now()-start).toBeLessThan(1000);
    const names=JSON.parse(readFileSync(receipt,'utf8'));expect(names).toContain('AGENTOOL_COLLAB_SESSION_FILE');expect(names).not.toContain('DATABASE_URL');expect(names).not.toContain('AT_API_KEY');expect(names).not.toContain('NODE_OPTIONS');expect(names).not.toContain('FIXTURE_BEARER');
    expect(readdirSync(f.b.local.home).filter(name=>name.startsWith('courier-mcp-'))).toEqual([]);
  }finally{await f.close();}
});

for(const location of ['workspace','home'])test(`Bun ${location} preload cannot replace pinned MCP; isolated config roots are cleaned`,async()=>{
  const f=fixture(1);let importer:McpImporter|undefined;
  try {
    const marker=f.root+'/preload-ran',preload=f.root+'/inert-preload.ts',probe=f.root+'/probe.ts';
    writeFileSync(preload,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'preload-ran');process.exit(23);`);
    const config=`preload = [${JSON.stringify(preload)}]\n`;
    writeFileSync(location==='workspace'?f.b.local.workspacePath+'/bunfig.toml':f.b.local.home+'/.bunfig.toml',config);
    writeFileSync(probe,`process.stdout.write('selected-entrypoint');`);
    // Positive workspace control: the former scrubbed spawn still ran preload.
    // Bun 1.3.5 does not load HOME/.bunfig.toml for this direct-file form; keep
    // that hostile fixture too, without claiming an unobserved exploit path.
    const legacy=spawnSync(process.execPath,['--no-env-file',probe],{cwd:f.b.local.workspacePath,env:{HOME:f.b.local.home,PATH:'/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',TMPDIR:'/tmp'},timeout:1000});
    if(location==='workspace'){expect(legacy.status).toBe(23);expect(readFileSync(marker,'utf8')).toBe('preload-ran');rmSync(marker);}
    else {expect(legacy.status).toBe(0);expect(legacy.stdout.toString()).toBe('selected-entrypoint');expect(existsSync(marker)).toBe(false);}
    const entryDir=f.root+'/entrypoint';mkdirSync(entryDir,{mode:0o700});
    writeFileSync(entryDir+'/bunfig.toml',config);mkdirSync(f.root+'/.config',{mode:0o700});writeFileSync(f.root+'/.config/.bunfig.toml',config);
    const entry=entryDir+'/mcp.ts',receipt=f.root+'/runtime-roots.json';
    writeFileSync(entry,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(receipt)},JSON.stringify({cwd:process.cwd(),home:process.env.HOME,xdg:process.env.XDG_CONFIG_HOME}));await import(${JSON.stringify(f.b.local.args[0])});`);
    importer=await McpImporter.open({...f.b,local:{...f.b.local,args:[entry]}},f.ledger,AbortSignal.timeout(3000));
    expect((await importer.source(f.source.id,f.source.event_sequence,AbortSignal.timeout(1000))).id).toBe(f.source.id);
    expect(existsSync(marker)).toBe(false);
    const roots=JSON.parse(readFileSync(receipt,'utf8'));expect(roots.home).not.toBe(f.b.local.home);expect(roots.home).not.toBe(f.b.local.workspacePath);expect(roots.cwd).toBe(roots.home);expect(roots.xdg).toBe(roots.home);expect(statSync(roots.home).mode&0o077).toBe(0);
    await importer.close();expect(existsSync(roots.home)).toBe(false);expect(existsSync(marker)).toBe(false);
  } finally {await importer?.close();await f.close();}
});

test('selection key retries same exact request and never duplicates disclosure after lost response',async()=>{
  const f=fixture(1),network=new FakeNetwork();try{await f.open();
    const input={idempotencyKey:'operator-choice-1',alias:'fleet',summary:'Chosen summary',reportId:f.source.id,sequence:f.source.event_sequence,expiresAt:Date.now()+60000};
    const first=await selectReport(f.b,f.ledger,f.importer,input,AbortSignal.timeout(2000));await f.restart();
    const again=await selectReport(f.b,f.ledger,f.importer,input,AbortSignal.timeout(2000));expect(again).toBe(first);
    await expect(selectReport(f.b,f.ledger,f.importer,{...input,summary:'Different'},AbortSignal.timeout(2000))).rejects.toThrow('selection_conflict');
    await f.courier(network).runOnce(AbortSignal.timeout(2000));expect(network.posts).toHaveLength(1);
  }finally{await f.close();}
});

test('separate process owner blocks competitors and OS crash releases lock without dropping ledger',async()=>{
  const f=fixture(1);let child:ReturnType<typeof spawn>|undefined;
  try{
    const script=f.root+'/owner.ts',ownerPath=f.root+'/exclusive.sqlite';
    writeFileSync(script,`import {ExclusiveOwner} from ${JSON.stringify(resolve(import.meta.dir,'../src/ledger.ts'))}; const owner=new ExclusiveOwner(${JSON.stringify(ownerPath)});(globalThis as any).fixtureOwner=owner;process.stdout.write('ready\\n');setInterval(()=>{},1000);`);
    child=spawn(process.execPath,['--no-env-file',script],{cwd:f.root,env:{HOME:f.root,PATH:'/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',TMPDIR:'/tmp'},stdio:['pipe','pipe','pipe']});
    await until(new Promise<void>((r,j)=>{child!.stdout!.once('data',()=>r());child!.once('error',j);}),AbortSignal.timeout(1000));
    expect(()=>new ExclusiveOwner(ownerPath)).toThrow('receiver_owner_conflict');
    const exited=new Promise<void>(r=>child!.once('exit',()=>r()));child.kill('SIGKILL');await exited;
    const owner=new ExclusiveOwner(ownerPath);owner.close();expect(f.ledger.status()).toHaveProperty('configured',true);
  }finally{child?.kill('SIGKILL');await f.close();}
});

test('bounded replay leaves unfinished backlog and continues exact route cursor next run',async()=>{
  const f=fixture(2),network=new FakeNetwork();let ledger:Ledger|undefined;
  try{await f.open();
    for(let i=1;i<=5;i++){
      const event=createSignedCorrespondenceEvent({project_id:f.b.projectId,repository_id:f.b.repositoryId,thread_id:'fixture-thread',sender:sender(1),kind:'observation',body:{summary:`Bounded event ${i}`},parents:[],session_seq:i,issued_at:new Date().toISOString(),scope:{base_revision:null,branch:null,paths:['.']}},key(1).seed);
      network.records.push({event,receipt:{received_seq:String(i),received_at:new Date().toISOString()},missing_parents:[],lineage_status:'not_applicable'});
    }
    const b={...f.b,ledgerPath:f.root+'/pages.sqlite',limits:{...f.b.limits,maxPages:1,pageSize:2,maxEvents:2}};ledger=new Ledger(b);
    const courier=new Courier(ledger,{current:()=>b,importer:f.importer,transport:network,signingKey:key(2).seed});
    for(const expected of ['2','4','5']){await courier.runOnce(AbortSignal.timeout(2000));expect(ledger.cursor('fleet')).toBe(expected);}
    expect(f.store.listReports(f.b.local.workspaceId).filter(r=>r.body.startsWith('Bounded event'))).toHaveLength(5);expect(network.queries).toHaveLength(3);
  }finally{ledger?.close();await f.close();}
});

test('Node runtime is rejected before any importer launch or token read',async()=>{
  const f=fixture(1);try{
    const node={...f.b,local:{...f.b.local,runtime:'node'}};
    expect(()=>parseBinding(node)).toThrow('invalid_binding');
    await expect(McpImporter.open(node as unknown as typeof f.b,f.ledger,AbortSignal.timeout(1000))).rejects.toThrow('unsupported_runtime');
    expect(f.ledger.meta('importer_token')).toBeNull();expect(readdirSync(f.root).filter(name=>name.startsWith('courier-mcp-'))).toEqual([]);
  }finally{await f.close();}
});

for(const channel of ['telegram','correspondence'])test(`selection refuses ${channel} audience drift before and across asynchronous source validation`,async()=>{
  const f=fixture(1,true);try{await f.open();
    const original=f.b,changed=structuredClone(f.b);
    for(const d of changed.destinations){if(channel==='telegram'&&d.kind==='telegram')d.chatId=99;if(channel==='correspondence'&&d.kind==='correspondence')d.threadId='changed-thread';}
    const input={idempotencyKey:'drift',alias:channel==='telegram'?'human':'fleet',reportId:f.source.id,sequence:f.source.event_sequence,summary:'Selected bounded text',expiresAt:Date.now()+60000};
    await expect(selectReport(changed,f.ledger,f.importer,input,AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');
    const delayed={sessionId:f.importer.sessionId,source:async(id:string,sequence:number,signal:AbortSignal)=>{const report=await f.importer.source(id,sequence,signal);f.setBinding(changed);return report;},append:f.importer.append.bind(f.importer),close:async()=>{}};
    await expect(selectReport(()=>f.b,f.ledger,delayed,input,AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');
    f.setBinding(original);expect(f.ledger.rows('out',['queued','signed','provider_accepted'])).toEqual([]);
  }finally{await f.close();}
});

for(const count of [2,600])test(`preflight rejects ${count} duplicate signed records before key lookup or crypto backlog`,async()=>{
  const f=fixture(2);try{
    const event=createSignedCorrespondenceEvent({project_id:f.b.projectId,repository_id:f.b.repositoryId,thread_id:'fixture-thread',sender:sender(1),kind:'observation',body:{summary:'Genuine but duplicated'},parents:[],session_seq:1,issued_at:new Date().toISOString(),scope:{base_revision:null,branch:null,paths:['.']}},key(1).seed);
    const b=structuredClone(f.b);b.limits.pageSize=count===600?1:5;let keyLookups=0;const publicKey=b.correspondence.peers[0].publicKey;
    Object.defineProperty(b.correspondence.peers[0],'publicKey',{get(){keyLookups++;return publicKey;}});
    const body=JSON.stringify({protocol:'agent-correspondence/v0.1',scope:'project_private',events:Array.from({length:count},(_,i)=>({event,receipt:{received_seq:String(i+1),received_at:new Date().toISOString()},missing_parents:[],lineage_status:'not_applicable'})),page:{after:'0',next_after:String(count),has_more:false}});
    expect(Buffer.byteLength(body)).toBeLessThan(b.limits.maxResponseBytes);
    const wire=new CorrespondenceWire(b,{request:async()=>new Response(body)}),started=Date.now();
    await expect(wire.list(b.destinations[0],'0',AbortSignal.timeout(20))).rejects.toThrow('invalid_page');
    expect(keyLookups).toBe(0);expect(Date.now()-started).toBeLessThan(200);expect(f.ledger.cursor('fleet')).toBe('0');
  }finally{await f.close();}
});

test('bounded genuine page verification yields so abort interrupts before remaining signatures',async()=>{
  const f=fixture(2),network=new FakeNetwork();try{
    for(let i=1;i<=50;i++){
      const event=createSignedCorrespondenceEvent({project_id:f.b.projectId,repository_id:f.b.repositoryId,thread_id:'fixture-thread',sender:sender(1),kind:'observation',body:{summary:`Distinct signed ${i}`},parents:[],session_seq:i,issued_at:new Date().toISOString(),scope:{base_revision:null,branch:null,paths:['.']}},key(1).seed);
      network.records.push({event,receipt:{received_seq:String(i),received_at:new Date().toISOString()},missing_parents:[],lineage_status:'not_applicable'});
    }
    const b=structuredClone(f.b);b.limits.pageSize=50;let keyLookups=0;const publicKey=b.correspondence.peers[0].publicKey,controller=new AbortController();
    Object.defineProperty(b.correspondence.peers[0],'publicKey',{get(){if(++keyLookups===3)setTimeout(()=>controller.abort(),0);return publicKey;}});
    const started=Date.now();await expect(new CorrespondenceWire(b,network).list(b.destinations[0],'0',AbortSignal.any([controller.signal,AbortSignal.timeout(500)]))).rejects.toThrow('cancelled');
    expect(keyLookups).toBe(3);expect(Date.now()-started).toBeLessThan(200);expect(f.ledger.cursor('fleet')).toBe('0');
  }finally{await f.close();}
});

test('maxEvents one selects ready outbound rows past future retryAt across ledger restarts',async()=>{
  const f=fixture(1,true),network=new FakeNetwork(),telegram=new FakeTelegram();let ledger:Ledger|undefined;
  try{await f.open();const b={...f.b,ledgerPath:f.root+'/ready.sqlite',limits:{...f.b.limits,maxEvents:1}};ledger=new Ledger(b);
    const select=(idempotencyKey:string)=>selectReport(b,ledger!,f.importer,{idempotencyKey,alias:'human',reportId:f.source.id,sequence:f.source.event_sequence,summary:idempotencyKey,expiresAt:Date.now()+120000},AbortSignal.timeout(1000));
    const future=await select('future');ledger.update(ledger.get<Selection>(future)!,'queued',{retryAt:Date.now()+60000});
    for(const idempotencyKey of ['ready-one','ready-two']){
      const ready=await select(idempotencyKey);const courier=new Courier(ledger,{current:()=>b,importer:f.importer,transport:network,telegram:telegram.client(),signingKey:key(1).seed});
      expect((await courier.runOnce(AbortSignal.timeout(2000))).processed).toBe(1);expect(ledger.get<Selection>(ready)!.state).toBe('provider_accepted');expect(ledger.get<Selection>(future)!.attempts).toBe(0);
      ledger.close();ledger=new Ledger(b);
    }
    expect(telegram.sent.map(item=>item.text)).toEqual(['ready-one','ready-two']);
  }finally{ledger?.close();await f.close();}
});

test('maxEvents one durably shares turns across outbound routes, sustained replay and Telegram ingress',async()=>{
  const f=fixture(2,true),network=new FakeNetwork(),telegram=new FakeTelegram();let ledger:Ledger|undefined;
  try{await f.open();const fleet=f.b.destinations[0];if(fleet.kind!=='correspondence')throw Error('fixture route');
    const b={...f.b,ledgerPath:f.root+'/fair.sqlite',destinations:[...f.b.destinations,{...fleet,alias:'side',threadId:'side-thread'}],limits:{...f.b.limits,maxEvents:1}};ledger=new Ledger(b);
    const select=(idempotencyKey:string,alias:string)=>selectReport(b,ledger!,f.importer,{idempotencyKey,alias,reportId:f.source.id,sequence:f.source.event_sequence,summary:idempotencyKey,expiresAt:Date.now()+120000},AbortSignal.timeout(1000));
    const runner=()=>new Courier(ledger!,{current:()=>b,importer:f.importer,transport:network,telegram:telegram.client(),signingKey:key(2).seed});
    await select('human-question','human');await runner().runOnce(AbortSignal.timeout(2000));expect(telegram.sent).toHaveLength(1);telegram.reply();
    for(let i=1;i<=20;i++)for(const threadId of ['fixture-thread','side-thread']){
      const event=createSignedCorrespondenceEvent({project_id:b.projectId,repository_id:b.repositoryId,thread_id:threadId,sender:sender(1),kind:'observation',body:{summary:`Backlog ${threadId} ${i}`},parents:[],session_seq:network.records.length+1,issued_at:new Date().toISOString(),scope:{base_revision:null,branch:null,paths:['.']}},key(1).seed);
      network.records.push({event,receipt:{received_seq:String(network.records.length+1),received_at:new Date().toISOString()},missing_parents:[],lineage_status:'not_applicable'});
    }
    const outbound=[await select('selected-fleet','fleet'),await select('selected-side','side')];
    for(let i=0;i<8;i++){expect((await runner().runOnce(AbortSignal.timeout(2000))).processed).toBe(1);ledger.close();ledger=new Ledger(b);}
    expect(ledger.meta('telegram_offset')).toBe('8');expect(ledger.get<Ingress>('telegram:12345:7')!.state).toBe('imported');
    for(const id of outbound)expect(ledger.get<Selection>(id)!.state).toBe('provider_accepted');
    expect(BigInt(ledger.cursor('fleet'))).toBeGreaterThan(0n);expect(BigInt(ledger.cursor('side'))).toBeGreaterThan(0n);
    expect(BigInt(ledger.cursor('fleet'))).toBeLessThan(39n);expect(BigInt(ledger.cursor('side'))).toBeLessThan(40n);
    expect(f.store.listReports(b.local.workspaceId).filter(report=>report.body.startsWith('Untrusted feedback'))).toHaveLength(1);
  }finally{ledger?.close();await f.close();}
});

test('ended dedicated session is not replaced on subprocess restart',async()=>{
  const f=fixture(1);try{await f.open();await f.importer.close();const credential=JSON.parse(readFileSync(f.b.local.sessionFile,'utf8'));f.store.endSession({...credential,reason:'fixture-ended'});
    await expect(f.open()).rejects.toThrow('mcp_unavailable');expect(f.store.workspaceStatus(f.b.local.workspaceId).active_sessions).toHaveLength(1);
  }finally{await f.close();}
});

const lifecycleTargets = [
  {id:'policy:global',get:(b:Binding)=>b,error:'binding_inactive'},
  {id:'policy:peer:peer',get:(b:Binding)=>b.correspondence.peers[0],error:'peer_inactive'},
  {id:'policy:destination:fleet',get:(b:Binding)=>b.destinations[0],error:'destination_inactive'},
  {id:'policy:destination:human',get:(b:Binding)=>b.destinations[1],error:'destination_inactive'},
];
const selectionInput=(f:ReturnType<typeof fixture>,alias='fleet')=>({idempotencyKey:'lifecycle-choice',alias,reportId:f.source.id,sequence:f.source.event_sequence,summary:'Selected finite text',expiresAt:Date.now()+60000});
function stubImporter(f:ReturnType<typeof fixture>) {
  return {sessionId:f.b.local.sessionId,sourceCalls:0,appendCalls:0,
    async source(){this.sourceCalls++;return f.source;},
    async append(){this.appendCalls++;return {id:'synthetic-import',from_session_id:this.sessionId};},async close(){}};
}

for(const state of ['queued','signed'] as const)for(const offset of [-1,0,1])test(`selection deadline after verification: ${state} at expiry ${offset}`,async()=>{
  const f=fixture(1),importer=stubImporter(f),network=new FakeNetwork(),realNow=Date.now,verify=CorrespondenceWire.prototype.verify;
  let now=realNow(),signedBytes:string|undefined,verifications=0,reopened:Ledger|undefined;
  try {
    Date.now=()=>now;
    const expiresAt=now+300,input={...selectionInput(f),expiresAt};
    const id=await selectReport(f.b,f.ledger,importer,input,AbortSignal.timeout(1000));
    if(state==='signed') {
      const row=f.ledger.get<Selection>(id)!;
      signedBytes=f.ledger.sign(row,sequence=>signSelection(f.b,f.b.destinations[0],row,sequence,key(1).seed)).signedBytes;
    }
    CorrespondenceWire.prototype.verify=async function(...args){
      await verify.apply(this,args);verifications++;now=expiresAt+offset;
    };
    const courier=new Courier(f.ledger,{current:()=>f.b,importer,transport:network,signingKey:key(1).seed,checkpoint:stage=>{if(stage==='after_sign')signedBytes=f.ledger.get<Selection>(id)!.signedBytes;}});
    await courier.runOnce(AbortSignal.timeout(1000));
    expect(verifications).toBe(1);expect(Date.now()).toBe(expiresAt+offset);
    expect(f.b.expiresAt).toBeGreaterThan(now);expect(f.b.destinations[0].expiresAt).toBeGreaterThan(now);expect(f.b.correspondence.peers[0].expiresAt).toBeGreaterThan(now);
    expect(network.posts).toHaveLength(offset<0?1:0);
    const stored=f.ledger.get<Selection>(id)!;
    expect(stored.state).toBe(offset<0?'provider_accepted':'expired');expect(stored.attempts).toBe(offset<0?1:0);
    expect(signedBytes).toBeDefined();expect(stored.signedBytes).toBe(signedBytes);expect(f.ledger.meta('sequence')).toBe('1');
    if(offset<0)expect(network.posts[0]).toBe(signedBytes!);
    expect(importer.appendCalls).toBe(0);
    reopened=new Ledger(f.b);expect(reopened.get<Selection>(id)).toEqual(stored);
  } finally {CorrespondenceWire.prototype.verify=verify;Date.now=realNow;reopened?.close();await f.close();}
});

for(const target of lifecycleTargets)test(`${target.id}: same expiry and decreases persist; every increase fails live and across reopen`,async()=>{
  const f=fixture(1,true);let ledger:Ledger|undefined;
  try {
    const original=f.b,shorter=structuredClone(original);target.get(shorter).expiresAt-=1000;
    const stored=()=>JSON.parse(f.ledger.meta(target.id)!);
    expect(stored().expiresAt).toBe(target.get(original).expiresAt);
    f.ledger.observeBinding(original);ledger=new Ledger(original);ledger.close();ledger=undefined;
    f.ledger.observeBinding(shorter);expect(stored().expiresAt).toBe(target.get(shorter).expiresAt);
    ledger=new Ledger(shorter);ledger.observeBinding(shorter);
    expect(()=>ledger!.observeBinding(original)).toThrow('binding_changed');
    ledger.close();ledger=undefined;
    expect(()=>new Ledger(original)).toThrow('binding_changed');
    const shorterAgain=structuredClone(shorter);target.get(shorterAgain).expiresAt--;
    ledger=new Ledger(shorterAgain);expect(stored().expiresAt).toBe(target.get(shorterAgain).expiresAt);
    expect(()=>f.ledger.observeBinding(shorter)).toThrow('binding_changed');
    expect(bindingKey(original)).toBe(bindingKey(shorterAgain));
  } finally {ledger?.close();await f.close();}
});

for(const target of lifecycleTargets.slice(1))test(`${target.id}: false to true revocation persists; true to false fails across reopen`,async()=>{
  const f=fixture(1,true);let ledger:Ledger|undefined;
  try {
    const original=f.b,revoked=structuredClone(original);Object.assign(target.get(revoked),{revoked:true});
    f.ledger.observeBinding(original);f.ledger.observeBinding(revoked);
    ledger=new Ledger(revoked);ledger.observeBinding(revoked);
    expect(JSON.parse(ledger.meta(target.id)!).revoked).toBe(true);
    expect(()=>ledger!.observeBinding(original)).toThrow('binding_changed');
    ledger.close();ledger=undefined;expect(()=>new Ledger(original)).toThrow('binding_changed');
    expect(bindingKey(original)).toBe(bindingKey(revoked));
  } finally {ledger?.close();await f.close();}
});

for(const target of lifecycleTargets)for(const phase of ['before-source','after-source'] as const)test(`${target.id} shortening is observed ${phase} even when selection returns inactive`,async()=>{
  const f=fixture(1,true),importer=stubImporter(f);let ledger:Ledger|undefined;
  try {
    const original=f.b,expired=structuredClone(original);target.get(expired).expiresAt=Date.now()-1;
    const input=selectionInput(f,target.id.endsWith('human')?'human':'fleet');
    if(phase==='before-source')f.setBinding(expired);
    else {const source=importer.source.bind(importer);importer.source=async()=>{const report=await source();f.setBinding(expired);return report;};}
    await expect(selectReport(()=>f.b,f.ledger,importer,input,AbortSignal.timeout(1000))).rejects.toThrow(target.error);
    expect(importer.sourceCalls).toBe(phase==='before-source'?0:1);
    expect(JSON.parse(f.ledger.meta(target.id)!).expiresAt).toBe(target.get(expired).expiresAt);
    expect(f.ledger.rows('out',['queued'])).toEqual([]);
    ledger=new Ledger(expired);ledger.close();ledger=undefined;
    expect(()=>new Ledger(original)).toThrow('binding_changed');
  } finally {ledger?.close();await f.close();}
});

for(const target of lifecycleTargets.slice(1))for(const phase of ['before-source','after-source'] as const)test(`${target.id} revocation is sticky ${phase} despite inactive selection`,async()=>{
  const f=fixture(1,true),importer=stubImporter(f);
  try {
    const original=f.b,revoked=structuredClone(original);Object.assign(target.get(revoked),{revoked:true});
    const input=selectionInput(f,target.id.endsWith('human')?'human':'fleet');
    if(phase==='before-source')f.setBinding(revoked);
    else {const source=importer.source.bind(importer);importer.source=async()=>{const report=await source();f.setBinding(revoked);return report;};}
    await expect(selectReport(()=>f.b,f.ledger,importer,input,AbortSignal.timeout(1000))).rejects.toThrow(target.error);
    expect(JSON.parse(f.ledger.meta(target.id)!).revoked).toBe(true);
    expect(()=>new Ledger(original)).toThrow('binding_changed');
    expect(f.ledger.rows('out',['queued'])).toEqual([]);
  } finally {await f.close();}
});

test('a denied mixed widening/tightening observation still commits all observed restrictions, not rows or cursors',async()=>{
  const f=fixture(1,true);
  try {
    const mixed=structuredClone(f.b);mixed.expiresAt++;mixed.destinations[0].expiresAt--;mixed.correspondence.peers[0].revoked=true;
    expect(()=>f.ledger.observeBinding(mixed)).toThrow('binding_changed');
    expect(JSON.parse(f.ledger.meta('policy:global')!).expiresAt).toBe(f.b.expiresAt);
    expect(JSON.parse(f.ledger.meta('policy:destination:fleet')!).expiresAt).toBe(mixed.destinations[0].expiresAt);
    expect(JSON.parse(f.ledger.meta('policy:peer:peer')!).revoked).toBe(true);
    expect(()=>new Ledger(f.b)).toThrow('binding_changed');
    expect(f.ledger.cursor('fleet')).toBe('0');expect(f.ledger.rows('in',['pending','imported','rejected'])).toEqual([]);
  } finally {await f.close();}
});

test('enabled pause/resume remains reversible across reopen without forgetting restrictions',async()=>{
  const f=fixture(1),importer=stubImporter(f),network=new FakeNetwork();let ledger:Ledger|undefined;
  try {
    const original=f.b,paused={...original,enabled:false};f.setBinding(paused);
    const courier=new Courier(f.ledger,{current:()=>f.b,importer,transport:network,signingKey:key(1).seed});
    await expect(courier.runOnce(AbortSignal.timeout(1000))).rejects.toThrow('binding_inactive');
    ledger=new Ledger(paused);ledger.close();ledger=new Ledger(original);f.setBinding(original);
    const id=await selectReport(()=>f.b,ledger,importer,selectionInput(f),AbortSignal.timeout(1000));
    await new Courier(ledger,{current:()=>f.b,importer,transport:network,signingKey:key(1).seed}).runOnce(AbortSignal.timeout(1000));
    expect(ledger.get<Selection>(id)!.state).toBe('provider_accepted');expect(network.posts).toHaveLength(1);
  } finally {ledger?.close();await f.close();}
});

for(const boundary of ['construct','run','send','import','replay','after-sign'] as const)test(`courier ${boundary} boundary commits revocation before denial or async I/O`,async()=>{
  const f=fixture(1),importer=stubImporter(f),network=new FakeNetwork();
  try {
    const original=f.b,revoked=structuredClone(original);revoked.correspondence.peers[0].revoked=true;
    if(boundary==='send'||boundary==='after-sign')await selectReport(original,f.ledger,importer,selectionInput(f),AbortSignal.timeout(1000));
    if(boundary==='import')f.ledger.put('in','fleet',{id:'pending',route:'fleet',state:'pending',sessionId:original.local.sessionId,createdAt:Date.now(),expiresAt:Date.now()+60000});
    let reads=0;
    const at=boundary==='construct'?1:boundary==='run'?2:3;
    const courier=new Courier(f.ledger,{current:()=>{if(++reads===at&&boundary!=='after-sign')f.setBinding(revoked);return f.b;},importer,transport:network,signingKey:key(1).seed,checkpoint:stage=>{if(stage==='after_sign'&&boundary==='after-sign')f.setBinding(revoked);}});
    if(boundary==='send'||boundary==='import'||boundary==='after-sign')await expect(courier.runOnce(AbortSignal.timeout(1000))).rejects.toThrow('peer_inactive');
    else await courier.runOnce(AbortSignal.timeout(1000)); // inactive empty replay lanes are skipped
    expect(JSON.parse(f.ledger.meta('policy:peer:peer')!).revoked).toBe(true);
    expect(()=>new Ledger(original)).toThrow('binding_changed');
    expect(network.posts).toEqual([]);expect(network.queries).toEqual([]);expect(importer.appendCalls).toBe(0);expect(f.ledger.cursor('fleet')).toBe('0');
  } finally {await f.close();}
});

test('replay observes expiry after async page read before creating an import or advancing the cursor',async()=>{
  const a=fixture(1),b=fixture(2),network=new FakeNetwork(),importer=stubImporter(b);
  try {
    const sourceImporter=stubImporter(a);await selectReport(a.b,a.ledger,sourceImporter,selectionInput(a),AbortSignal.timeout(1000));
    await new Courier(a.ledger,{current:()=>a.b,importer:sourceImporter,transport:network,signingKey:key(1).seed}).runOnce(AbortSignal.timeout(1000));
    const original=b.b;network.mutatePage=()=>b.setBinding({...original,expiresAt:Date.now()-1});
    await expect(new Courier(b.ledger,{current:()=>b.b,importer,transport:network,signingKey:key(2).seed}).runOnce(AbortSignal.timeout(1000))).rejects.toThrow('binding_inactive');
    expect(()=>new Ledger(original)).toThrow('binding_changed');expect(importer.appendCalls).toBe(0);expect(b.ledger.cursor('fleet')).toBe('0');
    expect(b.ledger.rows('in',['pending','rejected','imported'])).toEqual([]);
  } finally {await a.close();await b.close();}
});

for(const [stage,expectedMethods] of [
  ['startup-getMe',['getMe']],
  ['startup-webhook',['getMe','getWebhookInfo']],
  ['polling-webhook',['getMe','getWebhookInfo','getWebhookInfo']],
  ['empty-getUpdates',['getMe','getWebhookInfo','getWebhookInfo','getUpdates']],
] as const)for(const change of ['expired','paused','static-drift'] as const)test(`Telegram awaited ${stage} rechecks ${change} before any next provider request`,async()=>{
  const f=fixture(1,true),network=new FakeNetwork(),tg=new FakeTelegram(),importer=stubImporter(f);
  let resume=()=>{},entered=()=>{},run:Promise<unknown>|undefined;
  const delayed=new Promise<void>(resolve=>{resume=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  try {
    const original=f.b,fetch=tg.fetch;
    tg.fetch=async(url,init)=>{
      const response=await fetch(url,init);
      if(tg.requests.length===expectedMethods.length){entered();await delayed;}
      return response;
    };
    const stop=AbortSignal.timeout(2000),courier=new Courier(f.ledger,{current:()=>f.b,importer,transport:network,telegram:tg.client(),signingKey:key(1).seed});
    run=courier.runOnce(stop);void run.catch(()=>{});
    await until(started,stop);
    expect(tg.requests.map(r=>r.method)).toEqual([...expectedMethods]);
    const queries=network.queries.length,posts=network.posts.length,scheduler=f.ledger.meta('scheduler_lane');
    const changed=structuredClone(original);
    if(change==='static-drift')changed.telegram!.botId++;
    else {
      changed.expiresAt=change==='expired'?Date.now()-1:original.expiresAt-1;
      if(change==='paused')changed.enabled=false;
      changed.destinations[1].revoked=true;changed.correspondence.peers[0].expiresAt--;
    }
    f.setBinding(changed);resume();
    await expect(run).rejects.toThrow(change==='static-drift'?'binding_changed':'binding_inactive');
    expect(tg.requests.map(r=>r.method)).toEqual([...expectedMethods]);
    expect(network.queries).toHaveLength(queries);expect(network.posts).toHaveLength(posts);
    expect(importer.appendCalls).toBe(0);expect(f.ledger.meta('telegram_offset')).toBeNull();expect(f.ledger.cursor('fleet')).toBe('0');
    expect(f.ledger.rows('in',['pending','rejected','imported'])).toEqual([]);
    // Startup must deny immediately, not merely after touching the scheduler.
    if(stage.startsWith('startup'))expect(f.ledger.meta('scheduler_lane')).toBe(scheduler);
    if(change==='static-drift') {
      expect(JSON.parse(f.ledger.meta('policy:global')!).expiresAt).toBe(original.expiresAt);
      expect(JSON.parse(f.ledger.meta('policy:destination:human')!).revoked).toBe(false);
    } else {
      expect(JSON.parse(f.ledger.meta('policy:global')!).expiresAt).toBe(changed.expiresAt);
      expect(JSON.parse(f.ledger.meta('policy:destination:human')!).revoked).toBe(true);
      expect(JSON.parse(f.ledger.meta('policy:peer:peer')!).expiresAt).toBe(changed.correspondence.peers[0].expiresAt);
      const reopened=new Ledger(changed);reopened.close();
      expect(()=>new Ledger(original)).toThrow('binding_changed');
    }
  } finally {resume();await run?.catch(()=>{});await f.close();}
});

for(const stage of ['polling-webhook','empty-getUpdates'] as const)test(`Telegram 300ms enrollment / 400ms awaited ${stage} stops at expiry without a real-time race`,async()=>{
  const f=fixture(1,true),network=new FakeNetwork(),tg=new FakeTelegram(),importer=stubImporter(f),realNow=Date.now;
  let now=realNow(),resume=()=>{},entered=()=>{},run:Promise<unknown>|undefined;
  const delayed=new Promise<void>(resolve=>{resume=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  try {
    Date.now=()=>now;
    const original={...f.b,expiresAt:now+300};f.setBinding(original);f.ledger.observeBinding(original);
    const methods=stage==='polling-webhook'?['getMe','getWebhookInfo','getWebhookInfo']:['getMe','getWebhookInfo','getWebhookInfo','getUpdates'];
    const fetch=tg.fetch,callTimes:number[]=[];
    tg.fetch=async(url,init)=>{
      callTimes.push(Date.now());const response=await fetch(url,init);
      if(tg.requests.length===methods.length){entered();await delayed;}
      return response;
    };
    const stop=AbortSignal.timeout(2000);
    run=new Courier(f.ledger,{current:()=>f.b,importer,transport:network,telegram:tg.client(),signingKey:key(1).seed}).runOnce(stop);void run.catch(()=>{});
    await until(started,stop);expect(tg.requests.map(r=>r.method)).toEqual(methods);
    now+=400;resume(); // advances only the injected clock; no 400ms wall-clock sleep
    await expect(run).rejects.toThrow('binding_inactive');
    expect(Date.now()).toBe(original.expiresAt+100);
    expect(tg.requests.map(r=>r.method)).toEqual(methods);expect(callTimes.every(time=>time<original.expiresAt)).toBe(true);
    expect(importer.appendCalls).toBe(0);expect(f.ledger.meta('telegram_offset')).toBeNull();expect(f.ledger.cursor('fleet')).toBe('0');
    expect(JSON.parse(f.ledger.meta('policy:global')!).expiresAt).toBe(original.expiresAt);
    expect(()=>new Ledger({...original,expiresAt:now+300})).toThrow('binding_changed');
  } finally {resume();await run?.catch(()=>{});Date.now=realNow;await f.close();}
});

for(const fail of ['inactive','ingress-rollback'] as const)test(`Telegram lifecycle observation survives ${fail} without losing offset atomicity`,async()=>{
  const f=fixture(1,true),network=new FakeNetwork(),tg=new FakeTelegram(),importer=stubImporter(f);
  try {
    const original=f.b;tg.reply();const client=tg.client(),getUpdates=client.getUpdates.bind(client);
    client.getUpdates=async(...args)=>{const updates=await getUpdates(...args);const changed=structuredClone(original);changed.destinations[1].revoked=true;if(fail==='inactive')changed.enabled=false;f.setBinding(changed);return updates;};
    const courier=new Courier(f.ledger,{current:()=>f.b,importer,transport:network,telegram:client,signingKey:key(1).seed,checkpoint:stage=>{if(stage==='after_telegram_ingress')throw Error('fixture-rollback');}});
    await expect(courier.runOnce(AbortSignal.timeout(1000))).rejects.toThrow(fail==='inactive'?'binding_inactive':'fixture-rollback');
    expect(JSON.parse(f.ledger.meta('policy:destination:human')!).revoked).toBe(true);
    expect(()=>new Ledger(original)).toThrow('binding_changed');expect(f.ledger.meta('telegram_offset')).toBeNull();expect(f.ledger.get('telegram:12345:7')).toBeNull();expect(importer.appendCalls).toBe(0);
  } finally {await f.close();}
});

for(const damage of ['missing','partial','corrupt-json','invalid-expiry','missing-bit','extra-field','wrong-version','extra-alias','missing-binding','empty-schema'] as const)test(`legacy or damaged ${damage} policy fails closed on reopen and live check, preserving all evidence`,async()=>{
  const f=fixture(1,true);let db:Database|undefined;
  try {
    f.ledger.put('in','fleet',{id:'prior-import',route:'fleet',state:'pending',sessionId:f.b.local.sessionId,createdAt:1,expiresAt:f.b.expiresAt});
    f.ledger.select({alias:'fleet',sourceReportId:f.source.id,sourceSequence:f.source.event_sequence,summary:'Retained selection',expiresAt:f.b.expiresAt,parents:[]},'prior-selection');
    f.ledger.advance('fleet','9007199254740993');f.ledger.setMeta('telegram_offset','17');f.ledger.setMeta('sequence','23');f.ledger.setMeta('importer_token','retained-token-fingerprint');
    db=new Database(f.b.ledgerPath);
    if(damage==='missing')db.exec("DELETE FROM meta WHERE id LIKE 'policy:%'");
    if(damage==='partial')db.exec("DELETE FROM meta WHERE id='policy:destination:human'");
    if(damage==='missing-binding')db.exec("DELETE FROM meta WHERE id='binding'");
    if(damage==='empty-schema')db.exec('DELETE FROM meta; DELETE FROM items;');
    if(damage==='corrupt-json')f.ledger.setMeta('policy:peer:peer','{');
    if(damage==='invalid-expiry')f.ledger.setMeta('policy:global',JSON.stringify({expiresAt:'1',revoked:false}));
    if(damage==='missing-bit')f.ledger.setMeta('policy:peer:peer',JSON.stringify({expiresAt:f.b.expiresAt}));
    if(damage==='extra-field')f.ledger.setMeta('policy:peer:peer',JSON.stringify({expiresAt:f.b.expiresAt,revoked:false,unknown:true}));
    if(damage==='wrong-version')f.ledger.setMeta('policy:version','2');
    if(damage==='extra-alias')f.ledger.setMeta('policy:peer:unknown',JSON.stringify({expiresAt:f.b.expiresAt,revoked:false}));
    const snapshot=()=>({meta:db!.query('SELECT * FROM meta ORDER BY id').all(),items:db!.query('SELECT * FROM items ORDER BY id').all(),schema:db!.query('SELECT * FROM sqlite_master ORDER BY name').all()});
    const before=snapshot();
    expect(()=>new Ledger(f.b)).toThrow('binding_changed');expect(snapshot()).toEqual(before);
    expect(()=>f.ledger.observeBinding(f.b)).toThrow('binding_changed');expect(snapshot()).toEqual(before);
    const importer=stubImporter(f);await expect(selectReport(f.b,f.ledger,importer,selectionInput(f),AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');
    expect(importer.sourceCalls).toBe(0);expect(snapshot()).toEqual(before);
  } finally {db?.close();await f.close();}
});

test('PR425 original post-expiry queue/send/import repro is blocked after revoked enrollment and process restart',async()=>{
  const a=fixture(1),b=fixture(2),network=new FakeNetwork();const realNow=Date.now;
  let aLedger:Ledger|undefined,bLedger:Ledger|undefined,aImporter:McpImporter|undefined,bImporter:McpImporter|undefined;
  const profile=(base:Binding,expiry:number,revoked:boolean)=>parseBinding({...base,expiresAt:expiry,destinations:base.destinations.map(d=>({...d,expiresAt:expiry,revoked})),correspondence:{...base.correspondence,peers:base.correspondence.peers.map(p=>({...p,expiresAt:expiry,revoked}))}});
  try {
    const enrolledAt=realNow(),originalExpiry=enrolledAt+5000,extendedExpiry=enrolledAt+120000;
    const aOriginal=profile({...a.b,ledgerPath:a.root+'/original-repro.sqlite'},originalExpiry,false),bOriginal=profile({...b.b,ledgerPath:b.root+'/original-repro.sqlite'},originalExpiry,false);
    a.setBinding(aOriginal);b.setBinding(bOriginal);aLedger=new Ledger(aOriginal);bLedger=new Ledger(bOriginal);
    const revoked=profile(aOriginal,originalExpiry,true);a.setBinding(revoked);
    aImporter=await McpImporter.open(revoked,aLedger,AbortSignal.timeout(3000));
    await expect(selectReport(()=>readBinding(a.profile),aLedger,aImporter,{...selectionInput(a),expiresAt:originalExpiry-1},AbortSignal.timeout(1000))).rejects.toThrow('destination_inactive');
    await aImporter.close();aImporter=undefined;aLedger.close();aLedger=undefined;bLedger.close();bLedger=undefined;
    const aExtended=profile(aOriginal,extendedExpiry,false),bExtended=profile(bOriginal,extendedExpiry,false);
    a.setBinding(aExtended);b.setBinding(bExtended);Date.now=()=>originalExpiry+1000;
    expect(bindingKey(aOriginal)).toBe(bindingKey(revoked));expect(bindingKey(aOriginal)).toBe(bindingKey(aExtended));
    expect(()=>new Ledger(readBinding(a.profile))).toThrow('binding_changed');expect(()=>new Ledger(readBinding(b.profile))).toThrow('binding_changed');
    // Also exercise existing live handles: neither an idle sender nor receiver,
    // nor direct selection, can use the extended/unrevoked profile after expiry.
    aLedger=new Ledger(revoked);bLedger=new Ledger(bOriginal);
    Date.now=realNow;
    aImporter=await McpImporter.open(revoked,aLedger,AbortSignal.timeout(3000));bImporter=await McpImporter.open(bOriginal,bLedger,AbortSignal.timeout(3000));
    a.setBinding(revoked);b.setBinding(bOriginal);
    const send=new Courier(aLedger,{current:()=>readBinding(a.profile),importer:aImporter,transport:network,signingKey:key(1).seed});
    const receive=new Courier(bLedger,{current:()=>readBinding(b.profile),importer:bImporter,transport:network,signingKey:key(2).seed});
    a.setBinding(aExtended);b.setBinding(bExtended);Date.now=()=>originalExpiry+1000;
    await expect(selectReport(()=>readBinding(a.profile),aLedger,aImporter,{...selectionInput(a),expiresAt:originalExpiry+31000},AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');
    await expect(send.runOnce(AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');await expect(receive.runOnce(AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');
    expect(network.posts).toEqual([]);expect(network.queries).toEqual([]);expect(aLedger.rows('out',['queued','signed','provider_accepted'])).toEqual([]);
    expect(bLedger.cursor('fleet')).toBe('0');expect(b.store.listReports(bOriginal.local.workspaceId)).toHaveLength(1);
  } finally {Date.now=realNow;await aImporter?.close();await bImporter?.close();aLedger?.close();bLedger?.close();await a.close();await b.close();}
});

for(const mutation of ['extend-original','restore-shortened'] as const)test(`post-expiry ${mutation} cannot restart a queued send or pending import`,async()=>{
  const f=fixture(1),importer=stubImporter(f),network=new FakeNetwork(),realNow=Date.now;
  try {
    const original=f.b;const selected=await selectReport(original,f.ledger,importer,selectionInput(f),AbortSignal.timeout(1000));
    f.ledger.put('in','fleet',{id:'pending-expiry',route:'fleet',state:'pending',sessionId:original.local.sessionId,createdAt:realNow(),expiresAt:original.expiresAt});
    const courier=new Courier(f.ledger,{current:()=>f.b,importer,transport:network,signingKey:key(1).seed});
    const expiredAt=mutation==='extend-original'?original.expiresAt:realNow()-1;
    if(mutation==='restore-shortened'){f.setBinding({...original,expiresAt:expiredAt});await expect(courier.runOnce(AbortSignal.timeout(1000))).rejects.toThrow('binding_inactive');}
    f.setBinding({...original,expiresAt:mutation==='extend-original'?original.expiresAt+60000:original.expiresAt});Date.now=()=>expiredAt+1;
    expect(()=>new Ledger(f.b)).toThrow('binding_changed');await expect(courier.runOnce(AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');
    await expect(selectReport(()=>f.b,f.ledger,importer,selectionInput(f),AbortSignal.timeout(1000))).rejects.toThrow('binding_changed');
    expect(f.ledger.get<Selection>(selected)!.state).toBe('queued');expect(f.ledger.get<Ingress>('pending-expiry')!.state).toBe('pending');expect(f.ledger.cursor('fleet')).toBe('0');
    expect(importer.appendCalls).toBe(0);expect(network.posts).toEqual([]);expect(network.queries).toEqual([]);
  } finally {Date.now=realNow;await f.close();}
});

test('maximum aliases use bounded per-alias metadata, retaining existing value and static-scope limits',async()=>{
  const f=fixture(1);let ledger:Ledger|undefined,db:Database|undefined;
  try {
    const b=structuredClone(f.b);b.ledgerPath=f.root+'/maximum.sqlite';
    b.correspondence.peers=Array.from({length:32},(_,i)=>({...b.correspondence.peers[0],alias:`peer-${i}-`+'p'.repeat(85),sender:sender(i+2)}));
    const route=b.destinations[0];if(route.kind!=='correspondence')throw Error('fixture');
    b.destinations=b.correspondence.peers.map((p,i)=>({...route,alias:`destination-${i}-`+'d'.repeat(80),peer:p.alias,threadId:`thread-${i}`}));
    ledger=new Ledger(parseBinding(b));db=new Database(b.ledgerPath,{readonly:true});
    const rows=db.query("SELECT id,value FROM meta WHERE id LIKE 'policy:%'").all() as {id:string;value:string}[];
    expect(rows).toHaveLength(66);expect(JSON.stringify(rows).length).toBeGreaterThan(4096);
    for(const row of rows){expect(row.id.length).toBeLessThanOrEqual(256);expect(row.value.length).toBeLessThanOrEqual(4096);}
    expect(()=>ledger!.setMeta('too-large','x'.repeat(4097))).toThrow('ledger_value_bound');
    const changed=structuredClone(b);changed.destinations[31].alias+='x';expect(()=>ledger!.observeBinding(changed)).toThrow('binding_changed');
    ledger.close();ledger=new Ledger(b);ledger.observeBinding(b);
  } finally {db?.close();ledger?.close();await f.close();}
});

test('first enrollment pins expired and revoked policy even while disabled',async()=>{
  const f=fixture(1,true);let ledger:Ledger|undefined;
  try {
    const b=structuredClone(f.b);b.ledgerPath=f.root+'/inactive-enrollment.sqlite';b.enabled=false;b.expiresAt=Date.now()-1;
    for(const p of b.correspondence.peers){p.expiresAt=b.expiresAt;p.revoked=true;}
    for(const d of b.destinations){d.expiresAt=b.expiresAt;d.revoked=true;}
    ledger=new Ledger(b);ledger.close();ledger=new Ledger(b);
    for(const target of lifecycleTargets){const policy=JSON.parse(ledger.meta(target.id)!);expect(policy.expiresAt).toBe(b.expiresAt);expect(policy.revoked).toBe(target.id!=='policy:global');}
    expect(()=>new Ledger({...b,expiresAt:b.expiresAt+1})).toThrow('binding_changed');
    const restored=structuredClone(b);restored.destinations[0].revoked=false;expect(()=>new Ledger(restored)).toThrow('binding_changed');
    ledger.observeBinding({...b,enabled:true}); // enabled is not part of the monotonic policy
    expect(ledger.rows('out',['queued'])).toEqual([]);expect(ledger.cursor('fleet')).toBe('0');
  } finally {ledger?.close();await f.close();}
});

test('concurrent fresh constructors serialize complete enrollment; a stale opener cannot undo the first expiry',async()=>{
  const f=fixture(1);const children:ReturnType<typeof spawn>[]=[];
  try {
    const script=f.root+'/open-ledger.ts',profile=f.root+'/concurrent.json',gate=f.root+'/open-gate';
    const b={...f.b,ledgerPath:f.root+'/concurrent.sqlite'};writeFileSync(profile,JSON.stringify(b),{mode:0o600});
    writeFileSync(script,`import {existsSync} from 'node:fs';import {readBinding} from ${JSON.stringify(resolve(import.meta.dir,'../src/binding.ts'))};import {Ledger} from ${JSON.stringify(resolve(import.meta.dir,'../src/ledger.ts'))};process.stdout.write('ready\\n');while(!existsSync(${JSON.stringify(gate)}))await Bun.sleep(1);const b=readBinding(${JSON.stringify(profile)});b.expiresAt-=Number(process.argv[2]);try {const ledger=new Ledger(b);ledger.close();}catch(e){process.exitCode=e.message==='binding_changed'?2:3;}`);
    const wave=async(deltas:number[])=>{
      const finished:Promise<number|null>[]=[];
      for(const delta of deltas) {
        const child=spawn(process.execPath,['--no-env-file','--config=/dev/null',script,String(delta)],{cwd:f.root,env:{HOME:f.root,XDG_CONFIG_HOME:f.root,PATH:'/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',TMPDIR:'/tmp'},stdio:['pipe','pipe','pipe']});children.push(child);
        finished.push(new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);}));
        await until(new Promise<void>((resolve,reject)=>{child.stdout!.once('data',()=>resolve());child.once('error',reject);}),AbortSignal.timeout(2000));
      }
      writeFileSync(gate,'open');return until(Promise.all(finished),AbortSignal.timeout(3000));
    };
    expect(await wave([0,0,0,0])).toEqual([0,0,0,0]);
    const first=new Ledger(b),second=new Ledger(b);
    try {
      const shorter={...b,expiresAt:b.expiresAt-1};first.observeBinding(shorter);
      expect(()=>second.observeBinding(b)).toThrow('binding_changed');expect(()=>new Ledger(b)).toThrow('binding_changed');
      second.observeBinding(shorter);expect(JSON.parse(second.meta('policy:global')!).expiresAt).toBe(shorter.expiresAt);
    } finally {first.close();second.close();}
    rmSync(gate);b.ledgerPath=f.root+'/competing-enrollment.sqlite';writeFileSync(profile,JSON.stringify(b),{mode:0o600});
    // Either order is legal: later shortening succeeds, later widening fails.
    const codes=await wave([0,1]);expect(codes[0]===0||codes[0]===2).toBe(true);expect(codes[1]).toBe(0);
    const shortest=new Ledger({...b,expiresAt:b.expiresAt-1});
    try {expect(JSON.parse(shortest.meta('policy:global')!).expiresAt).toBe(b.expiresAt-1);expect(()=>new Ledger(b)).toThrow('binding_changed');}
    finally {shortest.close();}
  } finally {for(const child of children)child.kill('SIGKILL');await f.close();}
});
