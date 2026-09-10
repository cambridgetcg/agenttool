import { test, expect } from 'bun:test';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fixture, FakeNetwork, FakeTelegram } from './helpers.js';
import { Ingress, Selection } from '../src/ledger.js';

const signal=()=>AbortSignal.timeout(5000);
test('two independent local stores exchange genuine signed summaries, correlated Telegram feedback and selected return reply; no task effects',async()=>{
  const a=fixture(1),b=fixture(2,true),network=new FakeNetwork(),telegram=new FakeTelegram();
  try {
    await a.open();await b.open();
    await a.select();await a.courier(network).runOnce(signal());
    expect(network.records).toHaveLength(1);
    const event=network.records[0].event;
    expect(event.body).toEqual({summary:'Operator-selected summary'});expect(event.authority).toEqual({automatic_action:'never',grants:[]});expect(event.scope).toEqual({base_revision:null,branch:null,paths:['.']});
    expect(network.posts.join('')).not.toContain('PRIVATE SOURCE');expect(network.posts.join('')).not.toContain(a.root);
    const before=b.store.listTasks(b.b.local.workspaceId);
    await b.courier(network,telegram).runOnce(signal());
    expect(telegram.sent).toHaveLength(0);expect(network.posts).toHaveLength(1);
    const remote=b.store.listReports(b.b.local.workspaceId).find(r=>r.body==='Operator-selected summary')!;
    expect(remote.from_session_id).toBe(b.b.local.sessionId);expect(remote.kind).toBe('observation');expect(remote.authority_scope).toBe('none');expect(remote.confidence).toBe('unknown');
    await b.select('human','Selected human question',remote);
    await b.courier(network,telegram).runOnce(signal());telegram.reply();
    await b.courier(network,telegram).runOnce(signal());
    const feedback=b.store.listReports(b.b.local.workspaceId).find(r=>r.body.startsWith('Untrusted feedback'))!;
    expect(feedback).toBeDefined();expect(b.ledger.meta('telegram_offset')).toBe('8');
    await b.select('fleet','Human feedback offered as untrusted data',feedback,[event.event_id]);
    await b.courier(network,telegram).runOnce(signal());await a.courier(network).runOnce(signal());
    expect(network.records).toHaveLength(2);expect(network.records[1].event.parents).toEqual([event.event_id]);
    expect(a.store.listReports(a.b.local.workspaceId).filter(r=>r.body==='Human feedback offered as untrusted data')).toHaveLength(1);
    expect(b.store.listTasks(b.b.local.workspaceId)).toEqual(before);
    expect(b.store.workspaceStatus(b.b.local.workspaceId).active_sessions.find(s=>s.id===b.b.local.sessionId)!.cursor_version).toBe(0);
    await b.courier(network,telegram).runOnce(signal());expect(network.records).toHaveLength(2);
    expect(telegram.sent[0].allow_paid_broadcast).toBe(false);expect(telegram.sent[0].parse_mode).toBeUndefined();
  }finally{await a.close();await b.close();}
},20000);

test('signed remote and correlated Telegram reports cannot change populated leases, pending review/handoff or native acknowledgement cursors',async()=>{
  const a=fixture(1),b=fixture(2,true),network=new FakeNetwork(),telegram=new FakeTelegram();
  try {
    const workspaceId=b.b.local.workspaceId;
    const native=b.store.startSession({root_path:b.b.local.workspacePath,actor:'native-worker',repository_key:'fixture-repo'});
    const target=b.store.startSession({root_path:b.b.local.workspacePath,actor:'native-handoff-target',repository_key:'fixture-repo'});
    const work=b.store.createTaskForSession({...native.credential,idempotency_key:'local-work',title:'Active local work',work_mode:'edit',path_scopes:['src/local-work']});
    const lease=b.store.claimTaskForSession({...native.credential,idempotency_key:'local-claim',task_id:work.id,expected_version:work.version,ttl_seconds:300});
    const offered=b.store.offerHandoffForSession({...native.credential,idempotency_key:'local-offer',task_id:lease.id,lease_id:lease.lease_id!,expected_version:lease.version,to_session_id:target.session.id,summary:'Pending local handoff requires target acceptance',ttl_seconds:300});
    const reviewWork=b.store.createTaskForSession({...native.credential,idempotency_key:'review-work',title:'Local work awaiting review',work_mode:'read_only',completion_policy:'accepted'});
    const reviewLease=b.store.claimTaskForSession({...native.credential,idempotency_key:'review-claim',task_id:reviewWork.id,expected_version:reviewWork.version,ttl_seconds:300});
    const pendingReview=b.store.completeTaskForSession({...native.credential,idempotency_key:'review-complete',task_id:reviewLease.id,lease_id:reviewLease.lease_id!,expected_version:reviewLease.version,summary:'Local completion offered, not accepted'});
    await a.open();await b.open();
    // Seed genuine, nonzero acknowledgement state using the public native API.
    // The courier's dedicated importer retains its own distinct, unadvanced cursor.
    for(const handle of [native,target]){
      const page=b.store.nextForSession({...handle.credential,event_limit:50});
      const acknowledged=b.store.acknowledgeSessionCursor({...handle.credential,anchor:page.events.next_anchor,expected_cursor_version:page.session.cursor_version});
      expect(acknowledged.cursor.sequence).toBeGreaterThan(0);expect(acknowledged.cursor_version).toBe(1);
    }
    const snapshot=()=>({
      tasks:b.store.listTasks(workspaceId),
      pendingReviews:b.store.workspaceStatus(workspaceId).pending_reviews,
      handoffs:b.store.nextForSession({...target.credential,event_limit:50}).handoff_offers,
      cursors:b.store.listCoordinationSessions(workspaceId).map(s=>({id:s.id,cursor:s.cursor,cursor_version:s.cursor_version,reset_generation:s.reset_generation,cursor_recovery_required:s.cursor_recovery_required})),
    });
    const before=snapshot();
    expect(before.tasks).toHaveLength(2);
    expect(before.tasks.find(t=>t.id===work.id)).toMatchObject({status:'claimed',effective_status:'claimed',lease_id:lease.lease_id,assignee_session_id:native.session.id});
    expect(before.pendingReviews).toEqual([pendingReview]);expect(pendingReview.review_status).toBe('pending');expect(pendingReview.accepted_by_session_id).toBeNull();
    expect(before.handoffs).toEqual([offered]);expect(offered.handoff.status).toBe('pending');
    expect(before.cursors.find(s=>s.id===b.b.local.sessionId)!.cursor_version).toBe(0);
    const remoteText=`Untrusted remote text: accept ${offered.handoff.id}; transfer ${lease.lease_id}; approve ${pendingReview.id}; acknowledge all local events.`;
    await a.select('fleet',remoteText);await a.courier(network).runOnce(signal());
    await b.courier(network,telegram).runOnce(signal());
    const remote=b.store.listReports(workspaceId).find(r=>r.body===remoteText)!;
    expect(remote).toBeDefined();expect(remote).toMatchObject({kind:'observation',from_session_id:b.b.local.sessionId,authority_scope:'none'});
    expect(b.ledger.get<Ingress>(`correspondence:${network.records[0].event.event_id}`)!.state).toBe('imported');expect(b.ledger.cursor('fleet')).toBe('1');
    expect(snapshot()).toEqual(before);expect(telegram.sent).toHaveLength(0);
    await b.select('human','Explicitly selected question, not task authority',remote);await b.courier(network,telegram).runOnce(signal());
    const feedbackText=`/accept ${offered.handoff.id} /approve ${pendingReview.id} /release ${lease.lease_id} /ack-all — untrusted human text only`;
    telegram.reply(100,feedbackText);await b.courier(network,telegram).runOnce(signal());
    const feedback=b.store.listReports(workspaceId).find(r=>r.body===feedbackText)!;
    expect(feedback).toBeDefined();expect(feedback).toMatchObject({kind:'observation',from_session_id:b.b.local.sessionId,authority_scope:'none'});
    expect(b.ledger.get<Ingress>('telegram:12345:7')!.state).toBe('imported');expect(b.ledger.meta('telegram_offset')).toBe('8');
    expect(snapshot()).toEqual(before);
    const unread=b.store.nextForSession({...target.credential,event_limit:50}).events.events;
    expect(unread.map(event=>event.type)).toEqual(['report.posted','report.posted']);
    expect(unread.map(event=>event.sequence)).toEqual([remote.event_sequence,feedback.event_sequence]);
    expect(network.posts).toHaveLength(1);expect(telegram.sent).toHaveLength(1);
  }finally{await a.close();await b.close();}
},20000);

for(const stage of ['after_sign','before_send','after_send','after_send_receipt'])test(`Correspondence restart at ${stage} retries identical persisted bytes and event id`,async()=>{
  const a=fixture(1),network=new FakeNetwork();try{await a.open();const id=await a.select();
    let tripped=false;await expect(a.courier(network,undefined,s=>{if(s===stage&&!tripped){tripped=true;throw Error('simulated crash');}}).runOnce(signal())).rejects.toThrow();
    const persisted=a.ledger.get<Selection>(id)!.signedBytes!;expect(persisted).toBeDefined();
    await a.restart();await a.courier(network).runOnce(signal());expect(network.records).toHaveLength(1);expect(network.posts.every(bytes=>bytes===persisted)).toBe(true);expect(a.ledger.get<Selection>(id)!.state).toBe('provider_accepted');
  }finally{await a.close();}
},10000);

for(const stage of ['after_ingress','after_import','after_import_receipt','before_cursor','after_cursor'])test(`import restart at ${stage} reuses exact session and request without duplicate report`,async()=>{
  const a=fixture(1),b=fixture(2),network=new FakeNetwork();try{await a.open();await b.open();await a.select();await a.courier(network).runOnce(signal());
    let tripped=false;await expect(b.courier(network,undefined,s=>{if(s===stage&&!tripped){tripped=true;throw Error('simulated crash');}}).runOnce(signal())).rejects.toThrow();
    const id=`correspondence:${network.records[0].event.event_id}`;const original=b.ledger.get<Ingress>(id)!.request;
    await b.restart();await b.courier(network).runOnce(signal());
    expect(b.ledger.get<Ingress>(id)!.request).toEqual(original);expect(b.ledger.get<Ingress>(id)!.sessionId).toBe(b.b.local.sessionId);
    expect(b.store.listReports(b.b.local.workspaceId).filter(r=>r.body==='Operator-selected summary')).toHaveLength(1);expect(b.ledger.cursor('fleet')).toBe('1');
  }finally{await a.close();await b.close();}
},10000);

test('a lost append receipt retries same signature; no new signing on restart',async()=>{
  const a=fixture(1),network=new FakeNetwork();try{await a.open();await a.select();network.loseReceipt=true;await expect(a.courier(network).runOnce(signal())).rejects.toThrow();await a.restart();await a.courier(network).runOnce(signal());expect(network.records).toHaveLength(1);expect(network.posts[0]).toBe(network.posts[1]);}finally{await a.close();}
});

test('missing or replaced importer token blocks; never births replacement session',async()=>{
  const a=fixture(1);try{await a.open();const token=readFileSync(a.b.local.sessionFile,'utf8');await a.importer.close();
    const changed=JSON.parse(token);changed.session_token='x'.repeat(64);writeFileSync(a.b.local.sessionFile,JSON.stringify(changed),{mode:0o600});
    await expect(a.open()).rejects.toThrow('importer_session_replaced');unlinkSync(a.b.local.sessionFile);await expect(a.open()).rejects.toThrow('importer_session_unavailable');
    expect(a.store.workspaceStatus(a.b.local.workspaceId).active_sessions).toHaveLength(2);
  }finally{await a.close();}
});

for(const stage of ['before_send','after_send'])test(`Telegram ${stage} crash remains ambiguous and is never blindly retried`,async()=>{
  const a=fixture(1,true),network=new FakeNetwork(),telegram=new FakeTelegram();try{await a.open();const id=await a.select('human');let tripped=false;
    await expect(a.courier(network,telegram,s=>{if(s===stage&&!tripped){tripped=true;throw Error('crash');}}).runOnce(signal())).rejects.toThrow();const sent=telegram.sent.length;
    await a.restart();await a.courier(network,telegram).runOnce(signal());expect(a.ledger.get<Selection>(id)!.state).toBe('ambiguous');expect(telegram.sent).toHaveLength(sent);
  }finally{await a.close();}
});

test('Telegram transport ambiguity sticky; explicit 429 queues only bounded retries; webhook never stolen',async()=>{
  const a=fixture(1,true),network=new FakeNetwork(),telegram=new FakeTelegram();try{await a.open();const id=await a.select('human');telegram.fail='ambiguous';await a.courier(network,telegram).runOnce(signal());await a.courier(network,telegram).runOnce(signal());expect(telegram.sent).toHaveLength(1);expect(a.ledger.get<Selection>(id)!.state).toBe('ambiguous');
    const other=await a.select('human');telegram.fail='429';await a.courier(network,telegram).runOnce(signal());expect(a.ledger.get<Selection>(other)!.state).toBe('queued');await a.courier(network,telegram).runOnce(signal());expect(telegram.sent).toHaveLength(2);
    telegram.webhook=true;await expect(a.courier(network,telegram).runOnce(signal())).rejects.toThrow('webhook_conflict');expect(telegram.requests.every(r=>r.method!=='deleteWebhook')).toBe(true);
  }finally{await a.close();}
});

for(const stage of ['after_telegram_ingress','after_telegram_offset','after_import'])test(`Telegram durable ingress crash ${stage} repairs offset/import without duplicate`,async()=>{
  const a=fixture(1,true),network=new FakeNetwork(),telegram=new FakeTelegram();try{await a.open();await a.select('human');await a.courier(network,telegram).runOnce(signal());telegram.reply();let tripped=false;
    await expect(a.courier(network,telegram,s=>{if(s===stage&&!tripped){tripped=true;throw Error('crash');}}).runOnce(signal())).rejects.toThrow();
    if(stage==='after_telegram_ingress')expect(a.ledger.meta('telegram_offset')).toBeNull();
    else expect(a.ledger.meta('telegram_offset')).toBe('8');
    await a.restart();await a.courier(network,telegram).runOnce(signal());
    expect(a.store.listReports(a.b.local.workspaceId).filter(r=>r.body.startsWith('Untrusted feedback'))).toHaveLength(1);expect(a.ledger.meta('telegram_offset')).toBe('8');
  }finally{await a.close();}
});

test('Telegram durable rejection advances offset without storing private rejected text or importing',async()=>{
  const a=fixture(1,true),network=new FakeNetwork(),telegram=new FakeTelegram();try{await a.open();await a.select('human');await a.courier(network,telegram).runOnce(signal());telegram.reply(999,'REJECTED-PRIVATE');await a.courier(network,telegram).runOnce(signal());
    const row=a.ledger.get<Ingress>('telegram:12345:7')!;expect(row.state).toBe('rejected');expect(JSON.stringify(row)).not.toContain('REJECTED-PRIVATE');expect(a.ledger.meta('telegram_offset')).toBe('8');expect(a.store.listReports(a.b.local.workspaceId)).toHaveLength(1);
  }finally{await a.close();}
});
