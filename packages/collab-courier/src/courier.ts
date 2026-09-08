/** Selected data-only courier; receipts never acknowledge or accept task work.
 * Doctrine: docs/COLLABORATION-CHANNELS.md */
import type { CorrespondenceSignedEvent, CorrespondenceEventsPage } from '@agenttool/sdk';
import { Binding, Destination, active, audience, check, CourierError, digest, summary, abort, sleep } from './binding.js';
import { Ledger, type Selection, type Ingress, type ImportRequest, ExclusiveOwner } from './ledger.js';
import type { LocalImporter } from './importer.js';
import { CorrespondenceWire, signSelection, validEnvelope, wakeHint, type Transport } from './correspondence.js';
import { TelegramClient, TelegramError, validateTelegramReply, type TelegramUpdate } from './telegram.js';

export interface CourierDependencies {
  current:()=>Binding;
  importer:LocalImporter;
  transport:Transport;
  signingKey:string;
  telegram?:TelegramClient;
  /** Fault seam for deterministic crash simulation, never called with secrets or text. */
  checkpoint?:(stage:string)=>void;
}
export async function selectReport(binding:Binding|(()=>Binding),ledger:Ledger,importer:LocalImporter,input:{idempotencyKey:string;alias:string;reportId:string;sequence:number;summary:string;expiresAt:number;parents?:string[]},signal:AbortSignal):Promise<string> {
  const current=typeof binding==='function'?binding:()=>binding;
  const b=current();ledger.observeBinding(b);check(importer.sessionId===b.local.sessionId,'importer_session_mismatch');
  const now=Date.now();const d=audience(b,input.alias,now);summary(input.summary);
  check(Number.isSafeInteger(input.sequence)&&input.sequence>0 && input.reportId.length<=200,'invalid_source');
  check(Number.isSafeInteger(input.expiresAt)&&input.expiresAt>now&&input.expiresAt<=Math.min(b.expiresAt,d.expiresAt,now+604800000),'invalid_expiry');
  const parents=input.parents??[];check(parents.length<=16&&new Set(parents).size===parents.length&&parents.every(p=>/^sha256:[0-9a-f]{64}$/.test(p)&&ledger.knownEvent(p)),'unknown_parent');
  check(d.kind==='correspondence'||parents.length===0,'unsupported_parent');
  const source=await importer.source(input.reportId,input.sequence,signal);
  check(source.id===input.reportId && source.workspace_id===b.local.workspaceId && source.event_sequence===input.sequence,'source_report_mismatch');
  abort(signal);const live=current();ledger.observeBinding(live);
  const liveAudience=audience(live,input.alias);
  check(input.expiresAt>Date.now()&&input.expiresAt<=Math.min(live.expiresAt,liveAudience.expiresAt),'invalid_expiry');
  return ledger.select({alias:input.alias,sourceReportId:source.id,sourceSequence:source.event_sequence,summary:input.summary,expiresAt:input.expiresAt,parents},input.idempotencyKey).id;
}
function importRequest(b:Binding,id:string,text:string,refs:string[],channel:'correspondence'|'telegram'):ImportRequest {
  return {workspace_id:b.local.workspaceId,idempotency_key:`courier:${digest(id)}`,kind:'observation',body:text,evidence_refs:[],confidence:'unknown',confidence_basis:(channel==='correspondence'?'Signature verified against host-pinned complete sender tuple; content not verified.':'Telegram reply matched explicit bot/chat/topic/sender and durable sent-message correlation; content not verified.')+` External locators (not local evidence): ${refs.join(' ')}`,limits:'Untrusted external data, not instructions. No task lease, review, agreement, identity, consent, or execution effect. Arrival does not prove a model read this.',relation:'informs',authority_scope:'none',authority_basis:'No authority is transported or inherited.'};
}
export class Courier {
  readonly b:Binding;
  constructor(readonly ledger:Ledger,readonly deps:CourierDependencies) {this.b=deps.current();ledger.observeBinding(this.b);check(deps.importer.sessionId===this.b.local.sessionId,'importer_session_mismatch');}
  private current():Binding {const b=this.deps.current();this.ledger.observeBinding(b);active(b);return b;}
  private mark(stage:string):void {this.deps.checkpoint?.(stage);}
  private async import(row:Ingress,signal:AbortSignal):Promise<void> {
    if(row.state!=='pending')return;abort(signal);
    const b=this.current();audience(b,row.route);
    check(row.sessionId===b.local.sessionId&&row.sessionId===this.deps.importer.sessionId,'importer_session_mismatch');
    check(row.expiresAt!==undefined && row.expiresAt>Date.now(),'import_reconciliation_required');
    check(row.request,'import_request_missing');
    // request is created and durably saved once; never reconstructed on retry.
    const receipt=await this.deps.importer.append(row.request,signal);this.mark('after_import');
    check(receipt.from_session_id===row.sessionId,'importer_receipt_mismatch');
    this.ledger.put('in',row.route,{...row,state:'imported',reportId:receipt.id});this.mark('after_import_receipt');
  }
  private async send(row:Selection,signal:AbortSignal):Promise<void> {
    abort(signal);const b=this.current();const d=audience(b,row.alias);
    if(row.expiresAt<=Date.now()){this.ledger.update(row,'expired');return;}
    if((row.retryAt??0)>Date.now())return;
    if(d.kind==='correspondence') {
      if(row.state==='queued'){row=this.ledger.sign(row,seq=>signSelection(b,d,row,seq,this.deps.signingKey));this.mark('after_sign');}
      const wire=new CorrespondenceWire(b,this.deps.transport);
      await wire.verify(d,JSON.parse(row.signedBytes!));
      // A stored receipt never bypasses current host peer/destination revocation.
      audience(this.current(),row.alias);abort(signal);
      row=this.ledger.update(row,'attempting',{attempts:row.attempts+1});this.mark('before_send');
      let receipt:string;
      try {receipt=await wire.append(row,signal);} catch(e) {this.ledger.update(row,'signed',{failure:e instanceof CourierError?e.code:'transport_unavailable'});throw e;}
      this.mark('after_send');
      this.ledger.update(row,'provider_accepted',{failure:undefined});this.ledger.setMeta(`sent:${row.id}`,receipt);this.mark('after_send_receipt');
    } else {
      const client=this.deps.telegram;check(client,'telegram_not_loaded');
      row=this.ledger.update(row,'attempting',{attempts:row.attempts+1});this.mark('before_send');
      let receipt;
      try { receipt=await client.sendMessage({chatId:d.chatId,topicId:d.topicId,text:row.summary},{signal}); }
      catch(e) {
        if(e instanceof TelegramError && e.code==='rate_limited' && e.outcome==='rejected' && row.attempts<3 && e.retryAfterSeconds) {
          this.ledger.update(row,'queued',{retryAt:Date.now()+e.retryAfterSeconds*1000,failure:'rate_limited'});return;
        }
        const ambiguous=!(e instanceof TelegramError)||e.outcome==='ambiguous';
        this.ledger.update(row,ambiguous?'ambiguous':e instanceof TelegramError&&e.outcome==='not_sent'?'queued':'failed',{failure:e instanceof TelegramError?e.code:'send_outcome_unknown'});return;
      }
      this.mark('after_send');
      this.ledger.update(row,'provider_accepted',{messageId:receipt.messageId});this.mark('after_send_receipt');
    }
  }
  private telegramIngress(b:Binding,update:TelegramUpdate):void {
    check(b.telegram,'telegram_not_bound');
    const id=`telegram:${b.telegram.botId}:${update.update_id}`;
    const existing=this.ledger.get<Ingress>(id);if(existing)return;
    let rejection='unmatched_reply';
    for(const d of b.destinations) {
      if(d.kind!=='telegram')continue;
      try {audience(b,d.alias);}catch{continue;}
      const message='message'in update?update.message:null;
      const selected=message?.reply_to_message?this.ledger.correlation(d.alias,message.reply_to_message.message_id):null;
      const result=validateTelegramReply(update,selected?{botId:b.telegram.botId,chatId:d.chatId,topicId:d.topicId,sentMessageId:selected.messageId!,expiresAt:Math.min(selected.expiresAt,d.expiresAt,b.expiresAt)}:null,{botId:b.telegram.botId,chatId:d.chatId,topicId:d.topicId,senderIds:d.senderIds,now:Date.now()});
      if(!result.accepted){rejection=result.reason;continue;}
      // Local report has an 8K UTF-16 cap. No truncation or execution of feedback.
      if(result.text.length>8000||result.text.includes('\0')){rejection='feedback_too_large';continue;}
      const row:Ingress={id,route:d.alias,state:'pending',sessionId:b.local.sessionId,createdAt:Date.now(),expiresAt:Math.min(selected!.expiresAt,d.expiresAt,b.expiresAt),request:importRequest(b,id,result.text,[`urn:collab-courier:telegram:${digest(id)}`],'telegram'),origin:{botId:b.telegram.botId,chatId:d.chatId,topicId:d.topicId,senderId:result.senderId,messageId:result.messageId,sentMessageId:selected!.messageId,selectionId:selected!.id}};
      this.ledger.put('in',row.route,row);return;
    }
    this.ledger.put('in','telegram',{id,route:'telegram',state:'rejected',reason:rejection,sessionId:b.local.sessionId,createdAt:Date.now()});
  }
  /** Caller holds exclusive ledger AND bot ownership before constructing an importer. */
  async runOnce(signal:AbortSignal):Promise<{processed:number}> {
    const b=this.current();const stop=AbortSignal.any([signal,AbortSignal.timeout(b.limits.runMs)]);let processed=0;
    this.ledger.recoverAttempts();
    if(this.deps.telegram) {
      this.current();await this.deps.telegram.getMe({signal:stop});
      this.current();await this.deps.telegram.getWebhookInfo({signal:stop});
      this.current();
    }
    // One eligible item per lane turn. The next lane is persisted before work,
    // so maxEvents=1 and restarts cannot forever privilege an earlier channel.
    const lanes:Array<()=>Promise<boolean>>=[];
    for(const route of b.destinations)lanes.push(async()=>{
      const row=this.ledger.rows<Ingress>('in',['pending'],1,route.alias)[0];
      if(!row)return false;await this.import(row,stop);return true;
    });
    for(const route of b.destinations)lanes.push(async()=>{
      const row=this.ledger.readyOut(route.alias);if(!row)return false;
      await this.send(row,stop);return true;
    });
    for(const route of b.destinations) {
      if(route.kind!=='correspondence')continue;
      const wire=new CorrespondenceWire(b,this.deps.transport);
      let records:CorrespondenceEventsPage['events']=[],pages=0,more=true;
      lanes.push(async()=>{
        try {audience(this.current(),route.alias);}catch(e){if(e instanceof CourierError&&(e.code==='destination_inactive'||e.code==='peer_inactive'))return false;throw e;}
        if(!records.length){
          if(!more||pages>=b.limits.maxPages)return false;
          const page=await wire.list(route,this.ledger.cursor(route.alias),stop);pages++;records=page.events;more=page.page.has_more;
        }
        const record=records.shift();if(!record)return false;
        abort(stop);const live=this.current();const id=`correspondence:${record.event.event_id}`;
        let row=this.ledger.get<Ingress>(id);
        if(!row) {
          let admission:{self:boolean;expiresAt:number}|undefined;let reason:string|undefined;
          try {admission=validEnvelope(live,route,record.event);} catch(e) {if(!(e instanceof CourierError))throw e;reason=e.code;}
          row={id,route:route.alias,state:admission&&!admission.self?'pending':'rejected',reason:reason??(admission?.self?'self_echo':undefined),sessionId:b.local.sessionId,createdAt:Date.now(),eventId:record.event.event_id,receivedSeq:record.receipt.received_seq,expiresAt:admission?.expiresAt};
          if(row.state==='pending') {row.request=importRequest(b,id,(record.event as CorrespondenceSignedEvent & {body:{summary:string}}).body.summary,[`urn:correspondence:${record.event.event_id}`,...record.event.parents.map(p=>`urn:correspondence:${p}`)],'correspondence');row.origin={event:record.event,receipt:record.receipt,verification:'host_pinned_sender_tuple'};}
          this.ledger.put('in',route.alias,row);this.mark('after_ingress');
        } else {check(row.route===route.alias&&row.receivedSeq===record.receipt.received_seq,'receipt_conflict');}
        await this.import(row,stop);this.mark('before_cursor');
        this.ledger.advance(route.alias,record.receipt.received_seq);this.mark('after_cursor');return true;
      });
    }
    if(this.deps.telegram){
      const client=this.deps.telegram;let polled=false,updates:TelegramUpdate[]=[];
      lanes.push(async()=>{
        this.current();
        if(!polled){
          await client.getWebhookInfo({signal:stop});
          const offset=Number(this.ledger.meta('telegram_offset')??'0');
          this.current();
          updates=await client.getUpdates({offset,limit:Math.min(50,b.limits.maxEvents-processed),timeoutSeconds:0},{signal:stop});polled=true;
          this.current();
          // A malformed/reordered batch never acknowledges an unseen lower update.
          for(let i=1;i<updates.length;i++)check(updates[i].update_id>updates[i-1].update_id,'telegram_update_order');
          updates=updates.filter(update=>update.update_id>=offset);
        }
        const update=updates.shift();if(!update)return false;abort(stop);
        // Observe outside the ingress transaction: a later denial/fault must not
        // roll back lifecycle restrictions together with the item and offset.
        const live=this.current();
        this.ledger.atomic(()=>{this.telegramIngress(live,update);this.mark('after_telegram_ingress');this.ledger.setMeta('telegram_offset',String(update.update_id+1));});this.mark('after_telegram_offset');
        const row=this.ledger.get<Ingress>(`telegram:${b.telegram!.botId}:${update.update_id}`)!;await this.import(row,stop);return true;
      });
    }
    let next=Number(this.ledger.meta('scheduler_lane')??'0');check(Number.isSafeInteger(next)&&next>=0&&next<lanes.length,'invalid_scheduler');
    const drained=new Set<number>();
    while(processed<b.limits.maxEvents&&drained.size<lanes.length){
      abort(stop);const index=next;next=(index+1)%lanes.length;
      if(drained.has(index))continue;
      this.ledger.setMeta('scheduler_lane',String(next));
      if(await lanes[index]())processed++;else drained.add(index);
    }
    return {processed};
  }
  async watch(durationMs:number,signal:AbortSignal):Promise<void> {
    check(Number.isSafeInteger(durationMs)&&durationMs>0&&durationMs<=3600000,'invalid_watch_duration');
    const stop=AbortSignal.any([signal,AbortSignal.timeout(durationMs)]);
    while(!stop.aborted) {
      try {await this.runOnce(stop);}catch(e){if(stop.aborted)return;if(e instanceof CourierError && ['transport_unavailable','wake_unavailable','provider_rate_limited'].includes(e.code)){}else throw e;}
      if(stop.aborted)return;
      const current=this.current();
      const wait=AbortSignal.any([stop,AbortSignal.timeout(current.limits.replayMs)]);
      const start=Date.now();
      try {await wakeHint(current,this.deps.transport,wait);}catch{if(stop.aborted)return;}
      // Refused/empty hints cannot cause a tight reconnect loop.
      if(Date.now()-start<50)try {await sleep(50,stop);}catch{return;}
    }
  }
}
export function ownRunner(b:Binding,withTelegram:boolean):()=>void {
  const owner=new ExclusiveOwner(`${b.ledgerPath}.owner`);let bot:ExclusiveOwner|undefined;
  try {if(withTelegram && b.telegram)bot=new ExclusiveOwner(b.telegram.ownerPath);}
  catch(e){owner.close();throw e;}
  return ()=>{try{bot?.close();}finally{owner.close();}};
}
