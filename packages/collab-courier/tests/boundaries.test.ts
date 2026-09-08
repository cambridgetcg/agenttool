import { spawn, spawnSync } from 'node:child_process';
import { Courier, selectReport } from '../src/courier.js';
import { test, expect } from 'bun:test';
import { chmodSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture, FakeNetwork, FakeTelegram, key, sender } from './helpers.js';
import { parseBinding, summary, decimal, bindingKey, readBinding, until } from '../src/binding.js';
import { Ledger, ExclusiveOwner, type Ingress, type Selection } from '../src/ledger.js';
import { CorrespondenceWire, wakeHint } from '../src/correspondence.js';
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
