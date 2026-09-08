/** Exact persisted wire bytes and independently pinned verification.
 * Doctrine: docs/COLLABORATION-CHANNELS.md */
import { CorrespondenceClient, createSignedCorrespondenceEvent, verifyCorrespondenceEvent, canonicalCorrespondenceJson, type CorrespondenceSignedEvent, type CorrespondenceEventsPage, type CorrespondenceEventRecord, type AgentToolTransport } from '@agenttool/sdk';
import { Binding, Destination, check, CourierError, summary, decimal, audience, until, abort, sleep } from './binding.js';
import { Selection } from './ledger.js';
export type Transport = AgentToolTransport;
export type Peer = Binding['correspondence']['peers'][number];
export function signSelection(b:Binding,d:Destination,row:Selection,sequence:number,signingKey:string):{signedBytes:string;eventId:string} {
  check(d.kind==='correspondence','wrong_destination');
  const event=createSignedCorrespondenceEvent({project_id:b.projectId,repository_id:b.repositoryId,thread_id:d.threadId,sender:b.correspondence.sender,kind:'observation',body:{summary:summary(row.summary)},parents:row.parents,session_seq:sequence,issued_at:new Date(row.createdAt).toISOString(),scope:{base_revision:null,branch:null,paths:['.']}},signingKey);
  return {signedBytes:JSON.stringify(event),eventId:event.event_id};
}
export function sameSender(a:CorrespondenceSignedEvent['sender'],b:CorrespondenceSignedEvent['sender']):boolean {return a.identity_id===b.identity_id && a.signing_key_id===b.signing_key_id && a.device_id===b.device_id && a.session_id===b.session_id;}
export function pinned(b:Binding,d:Destination,event:CorrespondenceSignedEvent):string|undefined {
  if(d.kind!=='correspondence')return undefined;
  if(sameSender(event.sender,b.correspondence.sender))return b.correspondence.publicKey;
  const p=b.correspondence.peers.find(p=>p.alias===d.peer);
  return p && sameSender(event.sender,p.sender)?p.publicKey:undefined;
}
export function validEnvelope(b:Binding,d:Destination,event:CorrespondenceSignedEvent,now=Date.now()):{self:boolean;expiresAt:number} {
  check(d.kind==='correspondence','wrong_destination');audience(b,d.alias,now);
  check(event.project_id===b.projectId && event.repository_id===b.repositoryId && event.thread_id===d.threadId,'incoming_scope_mismatch');
  check(event.kind==='observation' && event.scope.base_revision===null && event.scope.branch===null && event.scope.paths.length===1 && event.scope.paths[0]==='.' && event.authority.automatic_action==='never' && event.authority.grants.length===0,'unsupported_envelope');
  summary(event.body.summary);
  const self=sameSender(event.sender,b.correspondence.sender);
  const p=b.correspondence.peers.find(p=>p.alias===d.peer)!;
  check(self || sameSender(event.sender,p.sender),'sender_not_pinned');
  const issued=Date.parse(event.issued_at);check(issued<=now+30000,'event_from_future');
  const expiresAt=Math.min(b.expiresAt,d.expiresAt,p.expiresAt,issued+p.maxAgeMs);
  check(expiresAt>now,'incoming_expired');return {self,expiresAt};
}
export async function readBytes(response:Response,maxBytes:number,signal:AbortSignal):Promise<Uint8Array> {
  check(response.body,'empty_response');const reader=response.body.getReader();let total=0,reads=0;const chunks:Uint8Array[]=[];
  try {while(true){check(++reads<=4096,'response_too_large');const {done,value}=await until(reader.read(),signal);if(done)break;total+=value.byteLength;check(total<=maxBytes,'response_too_large');chunks.push(value.slice());}return Buffer.concat(chunks);}
  finally {void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class CorrespondenceWire {
  constructor(readonly b:Binding,readonly transport:Transport){}
  private bounded(signal:AbortSignal,inspect?:(page:unknown)=>void):Transport['request'] {
    return async(input,init)=>{
      const stop=AbortSignal.any([signal,AbortSignal.timeout(this.b.limits.requestMs)]);abort(stop);
      try {
        const response=await until(this.transport.request(input,{...init,redirect:'error',signal:stop}),stop);
        // Error bodies may contain credentials or provider-controlled prose: never expose them.
        if(!response.ok){void response.body?.cancel();throw new CourierError(response.status===429?'provider_rate_limited':'provider_rejected');}
        const bytes=await readBytes(response,this.b.limits.maxResponseBytes,stop);
        if(inspect){let page:unknown;try{page=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new CourierError('invalid_page');}inspect(page);}
        abort(stop);return new Response(bytes as BodyInit,{status:response.status,headers:{'content-type':'application/json'}});
      } catch(e) {throw e instanceof CourierError?e:new CourierError('transport_unavailable');}
    };
  }
  async append(row:Selection,signal:AbortSignal):Promise<string> {
    check(row.signedBytes && row.eventId,'unsigned_outbox');
    const response=await this.bounded(signal)(`${this.b.correspondence.baseUrl}/v1/correspondence/events`,{method:'POST',headers:{'content-type':'application/json'},body:row.signedBytes});
    let result:any;try {result=await response.json();}catch{throw new CourierError('invalid_append_receipt');}
    const event=JSON.parse(row.signedBytes);
    check(result?.event?.event_id===row.eventId && canonicalCorrespondenceJson(result.event)===canonicalCorrespondenceJson(event),'append_receipt_mismatch');
    check(Number.isFinite(Date.parse(result.receipt?.received_at)),'invalid_append_receipt');return decimal(result.receipt?.received_seq);
  }
  async list(d:Destination,after:string,signal:AbortSignal):Promise<CorrespondenceEventsPage> {
    check(d.kind==='correspondence','wrong_destination');
    const stop=AbortSignal.any([signal,AbortSignal.timeout(this.b.limits.requestMs)]),deadline=Date.now()+this.b.limits.requestMs;
    const preflight=(value:unknown)=>{
      const page=value as CorrespondenceEventsPage;
      check(Array.isArray(page?.events)&&page.events.length<=this.b.limits.pageSize,'invalid_page');
      const ids=new Set<string>();
      for(const record of page.events){
        const id=record?.event?.event_id;
        check(typeof id==='string'&&!ids.has(id),'invalid_page');ids.add(id);
        check(Buffer.byteLength(JSON.stringify(record.event))<=65536,'invalid_page');
      }
      abort(stop);check(Date.now()<deadline,'cancelled');
    };
    // Preflight happens before SDK content hashing/signature work. Preserve the
    // SDK's require_verified path, yielding at each independently pinned key
    // lookup so cancellation and the whole-page deadline can actually run.
    const client=new CorrespondenceClient({baseUrl:this.b.correspondence.baseUrl,headers:{},timeout:this.b.limits.requestMs,request:this.bounded(stop,preflight)});
    let page:CorrespondenceEventsPage;
    try { page=await until(client.list({repository_id:this.b.repositoryId,thread_id:d.threadId,after:decimal(after),limit:this.b.limits.pageSize,require_verified:true,resolve_signing_key:async(_key,event)=>{await sleep(0,stop);abort(stop);check(Date.now()<deadline,'cancelled');return pinned(this.b,d,event);}}),stop); }
    catch(e){throw e instanceof CourierError?e:new CourierError('unverified_page');}
    abort(stop);check(Date.now()<deadline,'cancelled');
    check(page?.protocol==='agent-correspondence/v0.1' && page.scope==='project_private' && Array.isArray(page.events) && page.events.length<=this.b.limits.pageSize && page.page?.after===after && typeof page.page.has_more==='boolean','invalid_page');
    let cursor=after;const ids=new Set<string>();
    for(const record of page.events) {
      check(record.verification.verified && !ids.has(record.event.event_id),'invalid_page');ids.add(record.event.event_id);
      const seq=decimal(record.receipt?.received_seq);check(BigInt(seq)>BigInt(cursor),'receipt_order');cursor=seq;
      check(Number.isFinite(Date.parse(record.receipt.received_at)),'invalid_receipt');
      check(record.event.project_id===this.b.projectId && record.event.repository_id===this.b.repositoryId && record.event.thread_id===d.threadId,'incoming_scope_mismatch');
    }
    check(page.page.next_after===(page.events.length?cursor:after) && (!page.page.has_more || page.events.length>0),'invalid_page_cursor');
    return page;
  }
  async verify(d:Destination,event:CorrespondenceSignedEvent):Promise<void> {
    check((await verifyCorrespondenceEvent(event,{require_verified:true,resolve_signing_key:()=>pinned(this.b,d,event)})).verified,'signature_invalid');
  }
}
/** Hints are disposable. Caller always sweeps durable replay independently. */
export async function wakeHint(b:Binding,transport:Transport,signal:AbortSignal):Promise<void> {
  const stop=AbortSignal.any([signal,AbortSignal.timeout(b.limits.wakeMs)]);
  const params=new URLSearchParams({identity_id:b.correspondence.sender.identity_id,keys:'correspondence'});
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try {
    const response=await until(transport.request(`${b.correspondence.baseUrl}/v1/wake/voice?${params}`,{method:'GET',headers:{Accept:'text/event-stream'},redirect:'error',signal:stop}),stop);
    check(response.ok && response.body && response.headers.get('content-type')?.startsWith('text/event-stream'),'wake_unavailable');
    reader=response.body.getReader();let frame=0,total=0,previous=0,reads=0;
    while(true){check(++reads<=4096,'wake_stream_bound');const {done,value}=await until(reader.read(),stop);if(done)return;
      total+=value.length;check(total<=65536,'wake_stream_bound');
      for(const byte of value){frame++;check(frame<=8192,'wake_frame_bound');if(byte===10&&previous===10)return;previous=byte;}
    }
  } finally { if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();} }
}
