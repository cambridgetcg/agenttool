/** Bounded delivery evidence, never task truth. Doctrine: docs/COLLABORATION-CHANNELS.md */
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, lstatSync, openSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Binding, bindingKey, bindingLifecycle, lifecycleSchema, check, CourierError, decimal, digest, privateParent } from './binding.js';

export interface Selection { id:string; alias:string; sourceReportId:string; sourceSequence:number; summary:string; expiresAt:number; parents:string[]; state:'queued'|'signed'|'attempting'|'provider_accepted'|'ambiguous'|'failed'|'expired'; createdAt:number; updatedAt:number; signedBytes?:string; eventId?:string; messageId?:number; attempts:number; retryAt?:number; failure?:string }
export interface ImportRequest { workspace_id:string; idempotency_key:string; kind:'observation'; body:string; evidence_refs:string[]; confidence:'unknown'; confidence_basis:string; limits:string; relation:'informs'; authority_scope:string; authority_basis:string }
export interface Ingress { id:string; route:string; state:'pending'|'imported'|'rejected'; reason?:string; sessionId:string; request?:ImportRequest; eventId?:string; receivedSeq?:string; expiresAt?:number; createdAt:number; reportId?:string; origin?:unknown }

function privateDb(path:string, maxBytes:number): Database {
  privateParent(path);
  if(!existsSync(path)) {
    try { closeSync(openSync(path,'wx',0o600)); }
    catch(e) { if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e; }
  }
  // A concurrent opener may have created the file; validate it either way.
  const s=lstatSync(path); check(s.isFile() && !s.isSymbolicLink() && (s.mode&0o077)===0 && s.uid===process.getuid?.() && s.size<=maxBytes,'unsafe_ledger');
  const db=new Database(path); chmodSync(path,0o600);
  try {
    const pageSize=(db.query('PRAGMA page_size').get() as {page_size:number}).page_size;
    db.exec(`PRAGMA busy_timeout=100; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=${Math.floor(maxBytes/pageSize)};`);
    return db;
  } catch(e) {db.close();throw e;}
}
/** SQLite-held ownership survives no process: an OS process death releases the lock, not delivery evidence. */
export class ExclusiveOwner {
  private db:Database;
  constructor(path:string) {
    try { this.db=privateDb(path,1048576); }
    catch(e) {if(e instanceof CourierError)throw e;throw new CourierError('receiver_owner_conflict');}
    try { this.db.exec('CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;'); }
    catch {this.db.close(); throw new CourierError('receiver_owner_conflict');}
  }
  close():void { try {this.db.exec('ROLLBACK');} finally {this.db.close();} }
}
export class Ledger {
  private db:Database;
  constructor(readonly binding:Binding) {
    this.db=privateDb(binding.ledgerPath,binding.limits.maxBytes);
    try {
      const allowed=this.db.transaction(()=>{
        // Decide first enrollment under the same write lock as schema + policy.
        // Existing tables, even empty ones, are NOT a fresh enrollment.
        const fresh=!this.db.query("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
        this.db.exec(`CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, route TEXT NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS item_lookup ON items(kind,route,state);`);
        if(fresh) {
          this.setMeta('binding',bindingKey(binding));this.setMeta('session',binding.local.sessionId);
          this.setMeta('policy:version','1');
          for(const [id,value] of bindingLifecycle(binding)) {
            check(lifecycleSchema.safeParse(value).success,'binding_changed');
            this.setMeta(id,JSON.stringify(value));
          }
          return true;
        }
        return this.observePolicy(binding);
      }).immediate();
      check(allowed,'binding_changed');
    } catch(e) {this.db.close();throw e;}
  }
  /** Synchronous, bounded transaction; commit restrictions BEFORE callers deny or await I/O. */
  observeBinding(binding:Binding):void {
    const allowed=this.db.transaction(()=>this.observePolicy(binding)).immediate();
    check(allowed,'binding_changed');
  }
  private observePolicy(binding:Binding):boolean {
    check(this.meta('binding')===bindingKey(binding) && this.meta('policy:version')==='1','binding_changed');
    const policy=bindingLifecycle(binding);
    const count=(this.db.query("SELECT count(*) AS n FROM meta WHERE id LIKE 'policy:%'").get() as {n:number}).n;
    check(count===policy.length+1,'binding_changed');
    // Validate the COMPLETE prior record before writing anything. Legacy, corrupt
    // or partial metadata needs explicit reconciliation, never current-profile seeding.
    const entries=policy.map(([id,current])=>{
      const raw=this.meta(id);check(raw!==null && raw.length<=4096,'binding_changed');
      let value:unknown;try {value=JSON.parse(raw);}catch{throw new CourierError('binding_changed');}
      const prior=lifecycleSchema.safeParse(value);
      check(prior.success && lifecycleSchema.safeParse(current).success,'binding_changed');
      check(id!=='policy:global' || !prior.data.revoked,'binding_changed');
      return {id,current,prior:prior.data};
    });
    let allowed=true;
    for(const {id,current,prior} of entries) {
      if(current.expiresAt>prior.expiresAt || (prior.revoked && !current.revoked))allowed=false;
      const next={expiresAt:Math.min(prior.expiresAt,current.expiresAt),revoked:prior.revoked||current.revoked};
      // Even a mixed widening/tightening observation retains its restrictions.
      if(next.expiresAt!==prior.expiresAt || next.revoked!==prior.revoked)this.setMeta(id,JSON.stringify(next));
    }
    return allowed;
  }
  close():void {this.db.close();}
  atomic<T>(fn:()=>T):T {return this.db.transaction(fn)();}
  meta(id:string):string|null { return (this.db.query('SELECT value FROM meta WHERE id=?').get(id) as {value:string}|null)?.value??null; }
  setMeta(id:string,value:string):void {check(value.length<=4096 && id.length<=256,'ledger_value_bound');this.db.query('INSERT INTO meta VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,value);}
  cursor(alias:string):string {return decimal(this.meta(`cursor:${alias}`)??'0');}
  advance(alias:string,value:string):void {check(BigInt(decimal(value))>=BigInt(this.cursor(alias)),'cursor_rollback');this.setMeta(`cursor:${alias}`,value);}
  get<T>(id:string):T|null {const row=this.db.query('SELECT value FROM items WHERE id=?').get(id) as {value:string}|null;return row?JSON.parse(row.value):null;}
  put(kind:'out'|'in', route:string, row:Selection|Ingress):void {
    const value=JSON.stringify(row); check(Buffer.byteLength(value)<=32768,'ledger_value_bound');
    this.atomic(()=>{ if(!this.get(row.id)) {const count=(this.db.query('SELECT count(*) AS n FROM items').get() as {n:number}).n;check(count<this.binding.limits.maxRows,'ledger_full');}
      this.db.query('INSERT INTO items VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,value=excluded.value').run(row.id,kind,route,row.state,value);
    });
  }
  rows<T>(kind:'out'|'in', states:string[], limit=this.binding.limits.maxEvents, route?:string):T[] {
    check(limit>=1 && limit<=200,'invalid_limit');
    const placeholders=states.map(()=>'?').join(',');
    return (this.db.query(`SELECT value FROM items WHERE kind=? AND state IN (${placeholders})${route===undefined?'':' AND route=?'} ORDER BY rowid LIMIT ?`).all(kind,...states,...(route===undefined?[]:[route]),limit) as {value:string}[]).map(r=>JSON.parse(r.value));
  }
  readyOut(route:string,now=Date.now()):Selection|null {
    const row=this.db.query(`SELECT value FROM items WHERE kind='out' AND route=? AND state IN ('queued','signed')
      AND (json_extract(value,'$.expiresAt')<=? OR coalesce(json_extract(value,'$.retryAt'),0)<=?) ORDER BY rowid LIMIT 1`).get(route,now,now) as {value:string}|null;
    return row?JSON.parse(row.value):null;
  }
  select(input:Omit<Selection,'id'|'state'|'attempts'|'createdAt'|'updatedAt'>, idempotencyKey:string, now=Date.now()):Selection {
    check(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(idempotencyKey),'invalid_selection_key');
    return this.atomic(()=>{
      check(bindingKey(this.binding)===this.meta('binding'),'binding_changed');
      const id=digest(`selection:${this.meta('binding')}:${idempotencyKey}`);const existing=this.get<Selection>(id);
      if(existing){check(existing.alias===input.alias&&existing.sourceReportId===input.sourceReportId&&existing.sourceSequence===input.sourceSequence&&existing.summary===input.summary&&existing.expiresAt===input.expiresAt&&JSON.stringify(existing.parents)===JSON.stringify(input.parents),'selection_conflict');return existing;}
      const value:Selection={...input,id,state:'queued',attempts:0,createdAt:now,updatedAt:now};this.put('out',value.alias,value);return value;
    });
  }
  update(row:Selection, state:Selection['state'], extra:Partial<Selection>={}):Selection {
    const next={...row,...extra,state,updatedAt:Date.now()};this.put('out',row.alias,next);return next;
  }
  sign(row:Selection, signer:(sequence:number)=>{signedBytes:string;eventId:string}):Selection {
    return this.atomic(()=>{
      const prior=this.get<Selection>(row.id);check(prior?.state==='queued','invalid_outbox_state');
      const sequence=Number(this.meta('sequence')??'0')+1;check(Number.isSafeInteger(sequence),'sequence_exhausted');
      const signed=signer(sequence); const next=this.update(prior,'signed',signed);this.setMeta('sequence',String(sequence));return next;
    });
  }
  recoverAttempts():void {
    // Do not confuse Correspondence exact-id replay with Telegram's non-idempotent sends.
    for(const row of this.rows<Selection>('out',['attempting'],200)) this.update(row,row.signedBytes?'signed':'ambiguous',{failure:row.signedBytes?'receipt_unknown':'send_outcome_unknown'});
  }
  importedReport(id:string):boolean {return !!this.db.query('SELECT 1 FROM items WHERE kind=\'in\' AND json_extract(value,\'$.reportId\')=?').get(id);}
  knownEvent(id:string):boolean {return !!this.db.query('SELECT 1 FROM items WHERE json_extract(value,\'$.eventId\')=?').get(id);}
  correlation(alias:string, messageId:number):Selection|null {const r=this.db.query("SELECT value FROM items WHERE kind='out' AND route=? AND state='provider_accepted' AND json_extract(value,'$.messageId')=?").get(alias,messageId) as {value:string}|null;return r?JSON.parse(r.value):null;}
  status():unknown {
    const counts=this.db.query('SELECT kind,state,count(*) AS count FROM items GROUP BY kind,state ORDER BY kind,state').all();
    const updated=this.db.query("SELECT max(json_extract(value,'$.updatedAt')) AS lastDeliveryObservationAt FROM items WHERE kind='out'").get();
    return {format:'agenttool.collab-courier.status/0.1',configured:true,enabled:this.binding.enabled,observedAt:Date.now(),counts,...updated as object,networkProbed:false,readByAgent:'unknown',authorityEffects:false};
  }
}
