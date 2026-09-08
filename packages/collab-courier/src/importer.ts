/** Dedicated version-pinned local stdio importer; no live CollabStore access.
 * Doctrine: docs/COLLABORATION-CHANNELS.md */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Binding, check, CourierError, digest, privateRead, privateParent, until, abort } from './binding.js';
import { Ledger, ImportRequest } from './ledger.js';

export interface SourceReport { id:string; workspace_id:string; event_sequence:number; from_session_id:string|null }
export interface LocalImporter {
  readonly sessionId:string;
  source(reportId:string,sequence:number,signal:AbortSignal):Promise<SourceReport>;
  append(request:ImportRequest,signal:AbortSignal):Promise<{id:string;from_session_id:string|null}>;
  close():Promise<void>;
}
export class McpImporter implements LocalImporter {
  readonly sessionId:string;
  private child:ChildProcessWithoutNullStreams;
  private next=0;
  private pending=new Map<number,{resolve:(x:any)=>void;reject:(e:unknown)=>void}>();
  private buffer=Buffer.alloc(0);
  private outputBytes=0;
  private closed=false;
  private readonly runtimeHome:string;
  private constructor(readonly b:Binding) {
    this.sessionId=b.local.sessionId;
    privateParent(join(b.local.home,'courier-mcp-'));
    this.runtimeHome=mkdtempSync(join(b.local.home,'courier-mcp-'));
    // --no-env-file does NOT suppress bunfig preloads. Isolate both local and
    // global config roots before Bun starts, then explicitly choose empty config.
    // All journal/session/workspace references remain the absolute bound values.
    try {
      this.child=spawn(b.local.binary,['--no-env-file','--config=/dev/null',...b.local.args],{cwd:this.runtimeHome,shell:false,detached:true,env:{HOME:this.runtimeHome,XDG_CONFIG_HOME:this.runtimeHome,PATH:'/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',TMPDIR:'/tmp',AGENTOOL_COLLAB_DB:b.local.databasePath,AGENTOOL_COLLAB_SESSION_FILE:b.local.sessionFile},stdio:['pipe','pipe','pipe']});
    } catch {
      rmSync(this.runtimeHome,{recursive:true,force:true});throw new CourierError('mcp_unavailable');
    }
    this.child.stdout.on('data',(chunk:Buffer)=>{
      this.outputBytes+=chunk.length;
      if(this.outputBytes>8*1024*1024 || this.buffer.length+chunk.length>b.limits.maxResponseBytes) {this.fail();return;}
      this.buffer=Buffer.concat([this.buffer,chunk]);
      for(let index;(index=this.buffer.indexOf(10))>=0;) {
        const line=this.buffer.subarray(0,index);this.buffer=this.buffer.subarray(index+1);
        try {const value=JSON.parse(line.toString('utf8'));check(value.jsonrpc==='2.0','mcp_protocol');
          if(value.id!==undefined){const p=this.pending.get(value.id);check(p,'mcp_protocol');this.pending.delete(value.id);value.error?p.reject(new CourierError('mcp_rejected')):p.resolve(value.result);}
        } catch {this.fail();return;}
      }
    });
    // Deliberately discard all child diagnostics: may include paths or secret-bearing errors.
    let errorBytes=0;this.child.stderr.on('data',(chunk:Buffer)=>{errorBytes+=chunk.length;if(errorBytes>65536)this.fail();});
    this.child.on('error',()=>this.fail());this.child.on('exit',()=>this.fail());this.child.stdin.on('error',()=>this.fail());
  }
  static async open(b:Binding,ledger:Ledger,signal:AbortSignal):Promise<McpImporter> {
    check(process.platform!=='win32','unsupported_host');
    check(b.local.runtime==='bun','unsupported_runtime');abort(signal);
    try {
      const credential=JSON.parse(privateRead(b.local.sessionFile,16384));
      check(credential.session_id===b.local.sessionId && typeof credential.session_token==='string' && credential.session_token.length>=32,'importer_session_mismatch');
      const fingerprint=digest(credential.session_token);
      const existing=ledger.meta('importer_token'); check(!existing || existing===fingerprint,'importer_session_replaced');
      if(!existing) ledger.setMeta('importer_token',fingerprint);
    } catch(e) {throw e instanceof CourierError?e:new CourierError('importer_session_unavailable');}
    const importer=new McpImporter(b);
    try {
      const init=await importer.rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'collab-courier-private',version:'0.1.0-dev.0'}},signal);
      check(init?.serverInfo?.name==='agenttool-collab' && init.serverInfo.version===b.local.version,'mcp_version_mismatch');
      importer.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      const status=await importer.tool('collab_workspace_status',{workspace_id:b.local.workspaceId},signal);
      check(status.workspace?.id===b.local.workspaceId && status.workspace.root_path===b.local.workspacePath && status.workspace.repository_key===b.local.repositoryKey,'mcp_workspace_mismatch');
      check(status.active_sessions?.some((s:any)=>s.id===b.local.sessionId && s.status==='active' && !s.cursor_recovery_required),'importer_session_inactive');
      return importer;
    } catch(e) {await importer.close(signal.aborted?0:500);throw e;}
  }
  private fail():void {
    if(this.closed)return;
    this.closed=true;
    try {if(this.child.pid)process.kill(-this.child.pid,'SIGKILL');}catch{this.child.kill('SIGKILL');}
    for(const p of this.pending.values())p.reject(new CourierError('mcp_unavailable'));this.pending.clear();
  }
  private async rpc(method:string,params:unknown,signal:AbortSignal):Promise<any> {
    abort(signal);check(!this.closed,'mcp_unavailable');
    const id=++this.next;
    const stop=AbortSignal.any([signal,AbortSignal.timeout(this.b.limits.requestMs)]);
    const response=new Promise<any>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
    try {return await until(response,stop);} catch {this.fail();throw new CourierError('mcp_unavailable');}
  }
  private async tool(name:string,args:unknown,signal:AbortSignal):Promise<any> {
    const value=await this.rpc('tools/call',{name,arguments:args},signal);
    check(!value?.isError && value?.structuredContent && typeof value.structuredContent==='object','mcp_rejected');return value.structuredContent;
  }
  async source(reportId:string,sequence:number,signal:AbortSignal):Promise<SourceReport> {
    const result=await this.tool('collab_report_list',{workspace_id:this.b.local.workspaceId,after_event_sequence:sequence-1,limit:1},signal);
    const report=result.reports?.[0];check(report?.id===reportId && report.event_sequence===sequence && report.workspace_id===this.b.local.workspaceId,'source_report_not_found');
    return {id:report.id,workspace_id:report.workspace_id,event_sequence:report.event_sequence,from_session_id:report.from_session_id};
  }
  async append(request:ImportRequest,signal:AbortSignal):Promise<{id:string;from_session_id:string|null}> {
    check(request.workspace_id===this.b.local.workspaceId,'importer_workspace_mismatch');
    const result=await this.tool('collab_report_append',request,signal);const report=result.report;
    check(typeof report?.id==='string' && report.from_session_id===this.sessionId && report.kind==='observation' && report.workspace_id===request.workspace_id,'importer_receipt_mismatch');
    return {id:report.id,from_session_id:report.from_session_id};
  }
  async close(waitMs=500):Promise<void> {
    if(this.child.exitCode===null && this.child.signalCode===null) {
      this.fail();
      if(waitMs>0)await new Promise<void>(r=>{const t=setTimeout(r,Math.min(500,waitMs));this.child.once('exit',()=>{clearTimeout(t);r();});});
    }
    rmSync(this.runtimeHome,{recursive:true,force:true});
  }
}
