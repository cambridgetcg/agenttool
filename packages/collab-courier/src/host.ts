/** Explicit credential-owning host transport, no ambient proxy or x402 payer.
 * Doctrine: docs/COLLABORATION-CHANNELS.md */
// Bare 'undici' resolves to Bun 1.3.5's incomplete compatibility shim. The
// explicit installed entrypoint supplies the real direct dispatcher lifecycle.
import { Agent, fetch as directFetch } from 'undici/index.js';
import { Binding, check, CourierError } from './binding.js';
import type { Transport } from './correspondence.js';
import { TelegramClient, type TelegramFetch } from './telegram.js';
export function loadNamedSecrets(b:Binding,env:Record<string,string|undefined>):{bearer:string;signingKey:string;telegramToken?:string} {
  const named=(ref:{env:string})=>{const value=env[ref.env];check(value && value.length<=4096 && !/[\r\n\0]/.test(value),'named_secret_unavailable');return value;};
  return {bearer:named(b.correspondence.bearer),signingKey:named(b.correspondence.signingKey),...(b.telegram?{telegramToken:named(b.telegram.token)}:{})};
}
export function hostNetwork(b:Binding,secrets:ReturnType<typeof loadNamedSecrets>):{transport:Transport;telegram?:TelegramClient;close:()=>Promise<void>} {
  const dispatcher=new Agent({connect:{timeout:b.limits.requestMs},headersTimeout:b.limits.requestMs,bodyTimeout:b.limits.requestMs});
  const fetch:TelegramFetch=async(url,init)=>{
    try {return await directFetch(url,{...init,dispatcher,redirect:'error',credentials:'omit'} as Parameters<typeof directFetch>[1]) as unknown as Response;}
    catch{throw new CourierError('transport_unavailable');}
  };
  const transport:Transport={request:async(input,init)=>{
    const url=new URL(String(input));
    check(url.origin===b.correspondence.baseUrl && !url.username&&!url.password&&!url.hash,'transport_scope');
    check((url.pathname==='/v1/correspondence/events' && ['GET','POST'].includes(init?.method??''))||(url.pathname==='/v1/wake/voice'&&init?.method==='GET'),'transport_scope');
    const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${secrets.bearer}`);
    return fetch(url.href,{...init,headers});
  }};
  const telegram=b.telegram?new TelegramClient({token:secrets.telegramToken!,botId:b.telegram.botId,fetch,requestTimeoutMs:b.limits.requestMs,maxResponseBytes:b.limits.maxResponseBytes}):undefined;
  return {transport,telegram,close:()=>dispatcher.destroy()};
}
