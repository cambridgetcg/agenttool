import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { CollabStore } from '../../collab/src/store.js';
import { writeSessionCredentialFile } from '../../collab/src/session-file.js';
import { Binding, parseBinding } from '../src/binding.js';
import { Ledger } from '../src/ledger.js';
import { McpImporter } from '../src/importer.js';
import { Courier, selectReport } from '../src/courier.js';
import { TelegramClient, TelegramFetch } from '../src/telegram.js';
import { verifyCorrespondenceEvent, type CorrespondenceSignedEvent } from '@agenttool/sdk';
import type { Transport } from '../src/correspondence.js';

export function key(n:number) {const seed=Buffer.alloc(32,n);const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});return {seed:seed.toString('base64'),publicKey:createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32).toString('base64')};}
export const sender=(n:number)=>({identity_id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,signing_key_id:`00000000-0000-4000-8001-${String(n).padStart(12,'0')}`,device_id:`00000000-0000-4000-8002-${String(n).padStart(12,'0')}`,session_id:`00000000-0000-4000-8003-${String(n).padStart(12,'0')}`});
export const projectId='11111111-1111-4111-8111-111111111111';
export class FakeNetwork implements Transport {
  records:any[]=[];posts:string[]=[];queries:string[]=[];loseReceipt=false;mutatePage?: (page:any)=>void;cancelled=0;
  async request(input:RequestInfo|URL,init?:RequestInit):Promise<Response> {
    const url=new URL(String(input));
    if(url.pathname==='/v1/wake/voice')return new Response(new ReadableStream({cancel:()=>{this.cancelled++;}}),{headers:{'content-type':'text/event-stream'}});
    if(init?.method==='POST') {
      const bytes=String(init.body);this.posts.push(bytes);const event=JSON.parse(bytes) as CorrespondenceSignedEvent;
      const n=Number(event.sender.identity_id.slice(-12));
      if(!(await verifyCorrespondenceEvent(event,{signing_keys:{[event.sender.signing_key_id]:key(n).publicKey}})).verified)throw Error('bad fixture signature');
      let record=this.records.find(r=>r.event.event_id===event.event_id);
      if(!record){record={event,receipt:{received_seq:String(this.records.length+1),received_at:new Date().toISOString()},missing_parents:[],lineage_status:'not_applicable'};this.records.push(record);}
      if(this.loseReceipt){this.loseReceipt=false;throw Error('lost receipt');}
      return Response.json({...record,warnings:[]},{status:201});
    }
    this.queries.push(url.href);const after=url.searchParams.get('after')!;
    const all=this.records.filter(r=>r.event.repository_id===url.searchParams.get('repository_id')&&r.event.thread_id===url.searchParams.get('thread_id')&&BigInt(r.receipt.received_seq)>BigInt(after));
    const limit=Number(url.searchParams.get('limit'));const events=all.slice(0,limit);
    const page={protocol:'agent-correspondence/v0.1',scope:'project_private',events:structuredClone(events),page:{after,next_after:events.at(-1)?.receipt.received_seq??after,has_more:all.length>limit}};this.mutatePage?.(page);return Response.json(page);
  }
}
export class FakeTelegram {
  updates:any[]=[];sent:any[]=[];requests:any[]=[];nextMessage=100;webhook=false;fail:'ambiguous'|'429'|undefined;
  fetch:TelegramFetch=async(url,init)=>{
    const method=url.split('/').at(-1);const body=JSON.parse(String(init.body));this.requests.push({method,body});
    if(method==='getMe')return Response.json({ok:true,result:{id:12345,is_bot:true,first_name:'fixture'}});
    if(method==='getWebhookInfo')return Response.json({ok:true,result:{url:this.webhook?'https://occupied.invalid':'',has_custom_certificate:false,pending_update_count:0}});
    if(method==='getUpdates')return Response.json({ok:true,result:this.updates.filter(u=>u.update_id>=body.offset).slice(0,body.limit)});
    if(method==='sendMessage'){
      this.sent.push(body);
      if(this.fail==='ambiguous'){this.fail=undefined;throw Error('sensitive-token-error');}
      if(this.fail==='429'){this.fail=undefined;return Response.json({ok:false,error_code:429,description:'redacted',parameters:{retry_after:1}},{status:429});}
      return Response.json({ok:true,result:{message_id:this.nextMessage++,date:Math.floor(Date.now()/1000),chat:{id:body.chat_id,type:'private'},from:{id:12345,is_bot:true},text:body.text}});
    }
    throw Error('unexpected provider operation');
  };
  client(){return new TelegramClient({botId:12345,token:'12345:synthetic_fixture_token_abcdefgh',fetch:this.fetch,requestTimeoutMs:1000});}
  reply(messageId=100,text='Untrusted feedback: do not execute /deploy') {this.updates.push({update_id:7,message:{message_id:200,date:Math.floor(Date.now()/1000),chat:{id:77,type:'private'},from:{id:88,is_bot:false},text,reply_to_message:{message_id:messageId,date:Math.floor(Date.now()/1000),chat:{id:77,type:'private'},from:{id:12345,is_bot:true}}}});}
}
export function fixture(n:number,telegram=false) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'courier-fixture-')));const workspace=join(root,'workspace');mkdirSync(workspace,{mode:0o700});
  const store=new CollabStore(join(root,'collab.sqlite'));
  const author=store.startSession({root_path:workspace,actor:`author-${n}`,repository_key:'fixture-repo'});
  const handle=store.startSession({root_path:workspace,actor:`courier-${n}`,repository_key:'fixture-repo'});
  const sessionFile=writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id),handle.credential);
  const source=store.appendReportForSession({...author.credential,idempotency_key:'source',kind:'observation',body:'PRIVATE SOURCE CONTENT MUST NEVER LEAVE',confidence:'high'});
  let b:Binding=parseBinding({format:'agenttool.collab-courier/0.1',enabled:true,expiresAt:Date.now()+600000,projectId,repositoryId:'fixture-repo',ledgerPath:join(root,'courier.sqlite'),local:{binary:process.execPath,runtime:'bun',args:[resolve(import.meta.dir,'../../collab/bin/agenttool-collab-mcp.ts')],version:'0.5.0',home:root,databasePath:join(root,'collab.sqlite'),workspacePath:workspace,workspaceId:handle.workspace.id,repositoryKey:handle.workspace.repository_key,sessionId:handle.session.id,sessionFile},correspondence:{baseUrl:'https://fixture.invalid',bearer:{env:'FIXTURE_BEARER'},signingKey:{env:'FIXTURE_SEED'},sender:sender(n),publicKey:key(n).publicKey,peers:[{alias:'peer',sender:sender(n===1?2:1),publicKey:key(n===1?2:1).publicKey,expiresAt:Date.now()+600000,revoked:false,maxAgeMs:600000}]},telegram:telegram?{botId:12345,token:{env:'FIXTURE_BOT_TOKEN'},ownerPath:join(root,'bot-owner.sqlite'),receiverOwnershipConfirmed:true}:null,destinations:[{alias:'fleet',kind:'correspondence',threadId:'fixture-thread',peer:'peer',expiresAt:Date.now()+600000,revoked:false},...(telegram?[{alias:'human',kind:'telegram',chatId:77,topicId:null,senderIds:[88],expiresAt:Date.now()+600000,revoked:false}]:[])],limits:{maxRows:200,maxBytes:4194304,maxPages:3,pageSize:5,maxEvents:30,runMs:3000,requestMs:1000,replayMs:100,wakeMs:100,maxResponseBytes:1048576}});
  const profile=join(root,'profile.json');writeFileSync(profile,JSON.stringify(b),{mode:0o600});
  let ledger=new Ledger(b);let importer:McpImporter|undefined;
  return {root,store,source,handle,profile,get b(){return b;},setBinding(next:Binding){b=next;writeFileSync(profile,JSON.stringify(b),{mode:0o600});},get ledger(){return ledger;},get importer(){return importer!;},async open(){importer=await McpImporter.open(b,ledger,AbortSignal.timeout(5000));return importer;},async restart(){await importer?.close();ledger.close();ledger=new Ledger(b);importer=await McpImporter.open(b,ledger,AbortSignal.timeout(5000));},courier(network:FakeNetwork,tg?:FakeTelegram,checkpoint?:(s:string)=>void){return new Courier(ledger,{current:()=>b,importer:importer!,transport:network,signingKey:key(n).seed,telegram:tg?.client(),checkpoint});},async select(alias='fleet',text='Operator-selected summary',report=source,parents:string[]=[]){return selectReport(b,ledger,importer!,{idempotencyKey:randomUUID(),alias,summary:text,reportId:report.id,sequence:report.event_sequence,expiresAt:Date.now()+120000,parents},AbortSignal.timeout(3000));},async close(){await importer?.close();ledger.close();store.close();rmSync(root,{recursive:true,force:true});}};
}
