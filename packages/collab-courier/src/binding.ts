/** Private finite host boundary. Doctrine: docs/COLLABORATION-CHANNELS.md */
import { createHash } from 'node:crypto';
import { openSync, closeSync, readSync, fstatSync, lstatSync, constants } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
import { z } from 'zod';

export class CourierError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CourierError'; }
}
export function check(ok: unknown, code: string): asserts ok { if (!ok) throw new CourierError(code); }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const path = z.string().min(1).max(2048).refine(p => isAbsolute(p) && normalize(p) === p && !/[\x00-\x1f]/.test(p));
const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/);
const ref = z.object({ env: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/) }).strict();
const text = z.string().min(1).max(256).regex(/^[^\s\x00-\x1f]+$/u);
const timestamp = z.number().int().positive().max(8_640_000_000_000_000);
export const senderSchema = z.object({ identity_id: uuid, signing_key_id: uuid, device_id: uuid, session_id: uuid }).strict();
const peer = z.object({ alias: name, sender: senderSchema, publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/), expiresAt: timestamp, revoked: z.boolean(), maxAgeMs: z.number().int().min(1000).max(604800000) }).strict();
const destination = z.discriminatedUnion('kind', [
  z.object({ alias: name, kind: z.literal('correspondence'), threadId: text, peer: name, expiresAt: timestamp, revoked: z.boolean() }).strict(),
  z.object({ alias: name, kind: z.literal('telegram'), chatId: z.number().int().refine(Number.isSafeInteger).refine(n=>n!==0), topicId: z.number().int().positive().nullable(), senderIds: z.array(z.number().int().positive().refine(Number.isSafeInteger)).min(1).max(32), expiresAt: timestamp, revoked: z.boolean() }).strict(),
]);
export const bindingSchema = z.object({
  format: z.literal('agenttool.collab-courier/0.1'), enabled: z.boolean(), expiresAt: timestamp,
  projectId: uuid, repositoryId: text, ledgerPath: path,
  local: z.object({ binary: path, runtime: z.literal('bun'), args: z.array(path).length(1), version: z.enum(['0.4.0','0.5.0']), home: path, databasePath: path, workspacePath: path, workspaceId: z.string().min(1).max(200), repositoryKey: z.string().min(1).max(1000), sessionId: z.string().min(1).max(200), sessionFile: path }).strict(),
  correspondence: z.object({ baseUrl: z.string().url().refine(s=> { const u=new URL(s); return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname==='/' && s===u.origin; }), bearer: ref, signingKey: ref, sender: senderSchema, publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/), peers: z.array(peer).max(32) }).strict(),
  telegram: z.object({ botId: z.number().int().positive().refine(Number.isSafeInteger), token: ref, ownerPath: path, receiverOwnershipConfirmed: z.literal(true) }).strict().nullable(),
  destinations: z.array(destination).min(1).max(32),
  limits: z.object({ maxRows: z.number().int().min(10).max(100000), maxBytes: z.number().int().min(1048576).max(268435456), maxPages: z.number().int().min(1).max(20), pageSize: z.number().int().min(1).max(50), maxEvents: z.number().int().min(1).max(200), runMs: z.number().int().min(100).max(120000), requestMs: z.number().int().min(50).max(30000), replayMs: z.number().int().min(100).max(30000), wakeMs: z.number().int().min(50).max(30000), maxResponseBytes: z.number().int().min(16384).max(1048576) }).strict(),
}).strict();
export type Binding = z.infer<typeof bindingSchema>;
export type Destination = Binding['destinations'][number];
export function parseBinding(value: unknown): Binding {
  const parsed = bindingSchema.safeParse(value); check(parsed.success, 'invalid_binding');
  const b = parsed.data;
  check(new Set(b.destinations.map(d=>d.alias)).size===b.destinations.length, 'duplicate_alias');
  check(new Set(b.correspondence.peers.map(p=>p.alias)).size===b.correspondence.peers.length, 'duplicate_peer');
  check(new Set(b.correspondence.peers.map(p=>JSON.stringify(p.sender))).size===b.correspondence.peers.length, 'duplicate_sender');
  check(b.ledgerPath!==b.local.databasePath && b.telegram?.ownerPath!==b.ledgerPath && b.telegram?.ownerPath!==b.local.databasePath, 'path_conflict');
  const threads = new Set<string>();
  for (const d of b.destinations) {
    if (d.kind==='telegram') check(b.telegram, 'telegram_not_bound');
    else { check(b.correspondence.peers.some(p=>p.alias===d.peer), 'peer_not_bound'); check(!threads.has(d.threadId), 'duplicate_thread'); threads.add(d.threadId); }
  }
  return b;
}
export function privateRead(file: string, maxBytes: number): string {
  check(!lstatSync(file).isSymbolicLink(), 'unsafe_file');
  const fd=openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st=fstatSync(fd); check(st.isFile() && (st.mode&0o077)===0 && st.size<=maxBytes && st.uid===process.getuid?.(), 'unsafe_file');
    const bytes=Buffer.alloc(maxBytes+1);let total=0;
    while(true){const count=readSync(fd,bytes,total,bytes.length-total,null);if(!count)break;total+=count;check(total<=maxBytes,'file_too_large');}
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,total));
  }
  finally { closeSync(fd); }
}
export function privateParent(file: string): void {
  const st=lstatSync(dirname(file)); check(st.isDirectory() && !st.isSymbolicLink() && (st.mode&0o077)===0 && st.uid===process.getuid?.(), 'unsafe_directory');
}
export function readBinding(file: string): Binding {
  try { return parseBinding(JSON.parse(privateRead(file, 65536))); } catch(e) { if(e instanceof CourierError) throw e; throw new CourierError('binding_unavailable'); }
}
/** Freeze cursor filters, importer identity, endpoints, audience and credentials; host may pause/revoke/shorten expiry. */
export function bindingKey(b: Binding): string {
  return digest(JSON.stringify({ ...b, enabled: true, expiresAt: 0, destinations:b.destinations.map(d=>({...d,expiresAt:0,revoked:false})), correspondence:{...b.correspondence,peers:b.correspondence.peers.map(p=>({...p,expiresAt:0,revoked:false}))} }));
}
export function active(b: Binding, now=Date.now()): void { check(b.enabled && b.expiresAt>now, 'binding_inactive'); }
export function audience(b: Binding, alias: string, now=Date.now()): Destination {
  active(b,now); const d=b.destinations.find(d=>d.alias===alias); check(d && !d.revoked && d.expiresAt>now,'destination_inactive');
  if(d.kind==='correspondence') { const p=b.correspondence.peers.find(p=>p.alias===d.peer); check(p && !p.revoked && p.expiresAt>now,'peer_inactive'); }
  return d;
}
export function summary(value: unknown): string {
  check(typeof value==='string' && value.trim().length>0 && Array.from(value).length<=1000 && !/[\uD800-\uDFFF]/u.test(value) && !value.includes('\0'), 'invalid_summary'); return value;
}
export function decimal(value: unknown): string { check(typeof value==='string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value)<=9223372036854775807n, 'invalid_receipt_cursor'); return value; }
export function abort(signal: AbortSignal): void { check(!signal.aborted, 'cancelled'); }
export async function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  abort(signal); let listener: ()=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{ listener=()=>reject(new CourierError('cancelled')); signal.addEventListener('abort',listener,{once:true}); });
  try { return await Promise.race([promise,stopped]); } finally { signal.removeEventListener('abort',listener); }
}
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await until(new Promise<void>(r=>{timer=setTimeout(r,Math.max(0,ms));}),signal); } finally {clearTimeout(timer);}
}
