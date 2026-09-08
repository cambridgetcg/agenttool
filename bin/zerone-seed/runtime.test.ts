import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { canonicalJson, sealWalletDescriptor, sealWalletCapability, sealTransactionIntent, verifyWalletDescriptor, verifyWalletCapability, verifyTransactionIntent } from "@agenttool/wallet";
import { NativeSeedIo, ExternalRecordSigner } from "./adapters.js";
import { validateConfig, loadConfig } from "./config.js";
import { SeedRuntime } from "./runtime.js";
import { SeedStore } from "./store.js";
import { runCli } from "./main.js";
import { digest, fileDigest, parse, readJson } from "./validation.js";
import { attest, fixture, path, writeJson } from "./test-fixtures.js";

const roots=new Set<string>();
async function setup(options: Parameters<typeof fixture>[0] = {}) { const f=await fixture(options); roots.add(f.root); return f; }
beforeAll(async()=>{
  expect(Bun.version).toBe("1.3.5");
  const build=Bun.spawn([process.execPath,join(path,"build.ts")],{cwd:path,stdout:"ignore",stderr:"inherit"}); expect(await build.exited).toBe(0);
  mkdirSync(join(path,"node_modules/.cache/zerone-seed"),{recursive:true,mode:0o700});
  const compile=Bun.spawn([process.execPath,"build",join(path,"test-helper.ts"),"--compile","--outfile",join(path,"node_modules/.cache/zerone-seed/test-helper")],{cwd:path,stdout:"ignore",stderr:"inherit"}); expect(await compile.exited).toBe(0);
},120000);
afterAll(()=>{for(const root of roots) rmSync(root,{recursive:true,force:true});});
function count(f: Awaited<ReturnType<typeof fixture>>,cmd: string) {return existsSync(f.log) ? readFileSync(f.log,"utf8").split("\n").filter(s=>s===cmd).length : 0;}
function switchMode(f: Awaited<ReturnType<typeof fixture>>,mode: string, timeout=5000) {
  writeJson(f.config.helper_trust_file,{...f.helperFixture,mode});
  const c=validateConfig({...f.config,helper_trust_sha256:fileDigest(f.config.helper_trust_file),timeout_ms:timeout});
  writeJson(f.configPath,c);return new SeedRuntime(c);
}

describe("concrete software record provider and read-first CLI",()=>{
  test("real subprocess Ed25519 signatures seal/verify Wallet records",async()=>{
    const f=await setup();
    expect(verifyWalletDescriptor(f.descriptor).record_id).toBe(f.descriptor.record_id);
    expect(verifyWalletCapability(f.capability).record_id).toBe(f.capability.record_id);
    expect(verifyTransactionIntent(f.intent).record_id).toBe(f.intent.record_id);
    const wrong=new ExternalRecordSigner({...f.config.simulation_provider,authority:f.owner.authority});
    await expect(wrong.sign_digest(new Uint8Array(32))).rejects.toThrow();
    chmodSync(f.config.simulation_provider.key_file,0o644);
    await expect(new ExternalRecordSigner(f.config.simulation_provider).sign_digest(new Uint8Array(32))).rejects.toThrow();
  });
  test("help imports and missing status never create state; prepare never opens custody",async()=>{
    expect(await runCli([])).toContain("No command");
    const f=await setup(),rt=new SeedRuntime(f.config), before=readdirSync(f.root);
    expect(()=>rt.status()).toThrow(); expect(existsSync(f.config.ledger_path)).toBe(false);expect(readdirSync(f.root)).toEqual(before);
    const prepared=await rt.prepare();expect(prepared.plan.commitment.fee_amount_uzrn).toBe("100000");expect(count(f,"sign")).toBe(0);expect(existsSync(f.config.ledger_path)).toBe(false);
    rt.init();const contents=readFileSync(f.config.ledger_path),mtime=statSync(f.config.ledger_path).mtimeMs;
    expect(rt.status().operations).toEqual([]);expect(readFileSync(f.config.ledger_path)).toEqual(contents);expect(statSync(f.config.ledger_path).mtimeMs).toBe(mtime);
    expect(existsSync(f.config.ledger_path+"-wal")).toBe(false);expect(existsSync(f.config.ledger_path+"-shm")).toBe(false);
  });
  test("explicit init refuses an existing unrelated SQLite database without migrating it",async()=>{
    const f=await setup();const db=new Database(f.config.ledger_path);db.exec("CREATE TABLE unrelated(value TEXT)");db.close();chmodSync(f.config.ledger_path,0o600);
    const before=readFileSync(f.config.ledger_path);expect(()=>new SeedRuntime(f.config).init()).toThrow();expect(readFileSync(f.config.ledger_path)).toEqual(before);
  });
  test("built executable runs the complete separate-command lifecycle",async()=>{
    const f=await setup();
    const invoke=async(command: string,args: string[]=[])=>{
      const proc=Bun.spawn([join(path,"dist/zerone-seed"),command,"--config",f.configPath,"--config-sha256",fileDigest(f.configPath),...args],{cwd:f.dir,env:{PATH:"/usr/bin:/bin"},stdout:"pipe",stderr:"pipe"});
      const text=await new Response(proc.stdout).text();expect(await proc.exited).toBe(0);return parse(text);
    };
    await invoke("init");const p=await invoke("prepare"),pfile=join(f.dir,"cli-plan.json");writeJson(pfile,p);
    expect((await invoke("reserve-sign",["--plan",pfile])).status).toBe("signed");
    expect((await invoke("submit",["--operation",p.plan.plan_id])).status).toBe("submission_unknown");
    expect((await invoke("reconcile",["--operation",p.plan.plan_id])).credited_amount_uzrn).toBe("222000");
    expect((await invoke("status")).operations[0].status).toBe("included_success");expect(count(f,"sign")).toBe(1);
  });
  test("operator construction never opens keys or labels execution",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);
    const proposal=await rt.operator("operator-grant");expect(proposal.executed).toBe(false);expect(proposal.status).toBe("unsigned_proposal_only");expect(count(f,"sign")).toBe(0);expect(existsSync(f.config.ledger_path)).toBe(false);
  });
  test("canonical closed configuration and independent trust digest required",async()=>{
    const f=await setup();
    expect(()=>parse('{"a":1,"a":1}')).toThrow();expect(()=>parse('{ "a":1 }')).toThrow();expect(()=>parse(canonicalJson({a:"x".repeat(4097)}))).toThrow();
    expect(()=>validateConfig({...f.config,secret:"never accepted"})).toThrow();
    expect(()=>loadConfig(f.configPath,digest(new Uint8Array([1])))).toThrow();
    expect(()=>validateConfig({...f.config,node:{...f.config.node,rpc_url:"https://user:password@example.com"}})).toThrow();
    expect(()=>validateConfig({...f.config,disposable_test:false})).toThrow();
    expect(()=>validateConfig({...f.config,profile:{...f.config.profile,cosmos_sdk_version:"v0.50.15"}})).toThrow();
  });
  for(const mode of ["wrong-id","null","extra","oversize","stderr"]) test(`malformed ${mode} subprocess result is refused`,async()=>{
    const f=await setup({mode});await expect(new SeedRuntime(f.config).prepare()).rejects.toThrow();expect(existsSync(f.config.ledger_path)).toBe(false);
  });
  for(const mutation of ["hash","height","time"]) test(`preparation anchor ${mutation} conflict leaves no possible signer`,async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const prepared=await rt.prepare();
    const e={...f.helperFixture.observation.evidence,anchor:{...f.helperFixture.observation.evidence.anchor}};
    const helper={...f.helperFixture,observation:{...f.helperFixture.observation,evidence:e}};
    if(mutation === "hash") e.anchor.block_hash=digest(new Uint8Array([55]));
    if(mutation === "height") e.anchor.height=e.latest_height=(BigInt(e.anchor.height)-1n).toString();
    if(mutation === "time") e.anchor.block_time=new Date(Date.parse(e.anchor.block_time)-1).toISOString();
    writeJson(f.config.helper_trust_file,helper);
    const changed=new SeedRuntime(validateConfig({...f.config,helper_trust_sha256:fileDigest(f.config.helper_trust_file)}));
    await expect(changed.reserveSign(prepared)).rejects.toThrow();
    expect(count(f,"sign")).toBe(0);expect(changed.status().event_count).toBe(0);
  });
  test("latest-state simulation cannot silently become historical",async()=>{
    const f=await setup({mode:"stale-simulation"}),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();await expect(rt.reserveSign(p)).rejects.toThrow();expect(count(f,"sign")).toBe(0);expect(rt.status().operations).toEqual([]);
  });
});

describe("operator-local file-keyring terminal configuration",()=>{
  test("mandatory nullable closed field, canonical paths and digest bind operator choice",async()=>{
    const f=await setup(),{keyring_unlock_terminal:_terminal,...old}=f.config;
    expect(f.config.keyring_unlock_terminal).toBeNull();
    expect(()=>validateConfig(old)).toThrow();
    for(const value of [undefined,17,false,"", "relative", "/dev/../dev/tty", "/dev/tty\0"]) {
      expect(()=>validateConfig({...f.config,keyring:{...f.config.keyring,backend:"file"},keyring_unlock_terminal:value})).toThrow();
    }
    expect(()=>validateConfig({...f.config,keyring_unlock_terminal:"/dev/example"})).toThrow();
    expect(()=>validateConfig({...f.config,keyring:{...f.config.keyring,unlock_terminal:"/dev/example"}})).toThrow();
    expect(()=>validateConfig({...f.config,policy:{...f.config.policy,keyring_unlock_terminal:"/dev/example"}})).toThrow();
    const first=validateConfig({...f.config,keyring:{...f.config.keyring,backend:"file"},keyring_unlock_terminal:"/dev/explicit-absent-terminal"});
    writeJson(f.configPath,first);const approved=fileDigest(f.configPath);
    writeJson(f.configPath,{...first,keyring_unlock_terminal:null});
    expect(()=>loadConfig(f.configPath,approved)).toThrow();
  });
  for(const backend of ["file","os","pass"] as const) test(`${backend} read-only commands never open custody; unsupported/missing signer refuses before simulation or reservation`,async()=>{
    const f=await setup(),c=validateConfig({...f.config,keyring:{...f.config.keyring,backend}}),rt=new SeedRuntime(c);
    expect((await rt.inspect()).custody_opened).toBe(false);
    const p=await rt.prepare();rt.init();const before=readFileSync(c.ledger_path);
    const call=spyOn(rt.io,"call");
    try {
      await expect(rt.preSign(p)).rejects.toThrow();await expect(rt.reserveSign(p)).rejects.toThrow();
      expect(call).not.toHaveBeenCalled();expect(rt.status().operations).toEqual([]);
      expect(readFileSync(c.ledger_path)).toEqual(before);expect(count(f,"sign")).toBe(0);expect(count(f,"simulate")).toBe(0);
    } finally {call.mockRestore();}
  });
  test("absent and nonterminal explicit handles remain read-only but cannot reserve",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();
    for(const terminal of [join(f.dir,"missing-tty"),f.configPath,f.dir,"/dev/null","/dev/tty"]) {
      const c=validateConfig({...f.config,keyring:{...f.config.keyring,backend:"file"},keyring_unlock_terminal:terminal}),invalid=new SeedRuntime(c);
      // Configuration/inspect/prepare neither opens nor validates terminal availability.
      expect((await invalid.inspect()).custody_opened).toBe(false);await invalid.prepare();
      const call=spyOn(invalid.io,"call");
      try {await expect(invalid.reserveSign(p)).rejects.toThrow();expect(call).not.toHaveBeenCalled();}
      finally {call.mockRestore();}
      expect(invalid.status().event_count).toBe(0);
    }
    expect(count(f,"simulate")).toBe(0);expect(count(f,"sign")).toBe(0);
  });
});

describe("seed authorization and irreversible boundaries",()=>{
  test("zero outgoing, whole grant plus setup held; positive payout is separate",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();
    const signed=await rt.reserveSign(p);expect(signed.status).toBe("signed");
    const stored=new SeedStore(f.config);try {expect(stored.get(p.plan.plan_id).bundle.simulation_result.gas_wanted).toBe("18446744073709551615");expect(stored.get(p.plan.plan_id).bundle.prepared_at).toBe(p.prepared_at);} finally {stored.close();}
    expect(rt.status().source_outgoing_uzrn).toBe("0");expect(rt.status().total_reserved_sponsor_exposure_uzrn).toBe("350000");
    expect(rt.status().operations[0].credited_amount_uzrn).toBeNull();
    expect((await rt.submit(p.plan.plan_id)).status).toBe("submission_unknown");
    expect((await rt.reconcile(p.plan.plan_id))?.credited_amount_uzrn).toBe("222000");
    await expect(rt.reserveSign(p)).rejects.toThrow();await expect(rt.submit(p.plan.plan_id)).rejects.toThrow();
    expect(count(f,"sign")).toBe(1);expect(count(f,"submit")).toBe(1);
    expect(statSync(f.config.ledger_path).mode&0o777).toBe(0o600);expect(statSync(f.config.signed_tx_path).mode&0o777).toBe(0o600);
  });
  for(const mode of ["failed","credit-unknown"]) test(`positive ${mode} inclusion retires sequence without inventing payout`,async()=>{
    const f=await setup({mode}),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();await rt.reserveSign(p);await rt.submit(p.plan.plan_id);const reconciled=await rt.reconcile(p.plan.plan_id);
    expect(reconciled?.sequence_retired).toBe(true);expect(reconciled?.credited_amount_uzrn).toBeNull();expect(reconciled?.code).toBe(mode === "failed" ? 7:0);expect(rt.status().total_reserved_sponsor_exposure_uzrn).toBe("350000");
  });
  test("positively included ante failure preserves sequence fence through replay",async()=>{
    const f=await setup({mode:"ante-failed"}),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();
    await rt.reserveSign(p);await rt.submit(p.plan.plan_id);
    expect((await rt.reconcile(p.plan.plan_id))?.status).toBe("included_failed");
    const reopened=new SeedRuntime(f.config),op=reopened.status().operations[0];
    expect(op.sequence_retired).toBe(false);expect(op.code).toBe(7);expect(op.credited_amount_uzrn).toBeNull();
    expect(reopened.status().total_reserved_sponsor_exposure_uzrn).toBe("350000");
    await expect(reopened.reserveSign(p)).rejects.toThrow();expect(count(f,"sign")).toBe(1);
  });
  for(const sameIssuedAt of [false,true]) test(`submit rejects wallet-wide currentness rollback (same timestamp: ${sameIssuedAt})`,async()=>{
    const f=await setup(),g=await setup({shared:f.shared});
    const signer=new ExternalRecordSigner({...f.config.simulation_provider,key_file:f.owner.key_file,authority:f.owner.authority});
    const {record_id:_d,signature:_ds,...dc}=f.descriptor;
    const descriptor=await sealWalletDescriptor({...dc,accounts:[...f.descriptor.accounts,...g.descriptor.accounts].sort((a,b)=>a.account_id < b.account_id ? -1:1)},signer);
    const oldTime=f.currentness.issued_at,newTime=new Date().toISOString();
    for(const [n,x] of [f,g].entries()) {
      const {record_id:_c,signature:_cs,...cc}=x.capability;
      const capability=await sealWalletCapability({...cc,wallet_id:descriptor.wallet_id,descriptor_id:descriptor.record_id,issuer:f.owner.authority,revocation_nonce:sameIssuedAt ? n:0},signer);
      const {record_id:_i,signature:_is,...ic}=x.intent;
      const delegate=new ExternalRecordSigner({...x.config.simulation_provider,key_file:x.delegate.key_file,authority:x.delegate.authority});
      const intent=await sealTransactionIntent({...ic,wallet_id:descriptor.wallet_id,descriptor_id:descriptor.record_id,capability_record_id:capability.record_id},delegate);
      writeJson(x.config.descriptor_file,descriptor);writeJson(x.config.capability_file,capability);writeJson(x.config.intent_file,intent);
      writeJson(x.config.currentness_file,attest({...x.currentness,descriptor_id:descriptor.record_id,capability_record_id:capability.record_id,intent_record_id:intent.record_id,wallet_authority:f.owner.authority,revocation_nonce:sameIssuedAt ? n:0,issued_at:n || sameIssuedAt ? newTime:oldTime},f.shared.currentKey.privateKey));
      writeJson(x.config.sponsor_budget_file,attest({...x.budget,issued_at:newTime},f.shared.budgetKey.privateKey));
    }
    const a=new SeedRuntime(f.config),b=new SeedRuntime(g.config);a.init();const p=await a.prepare(),q=await b.prepare();
    await a.reserveSign(p);await b.reserveSign(q);
    writeJson(f.config.sponsor_budget_file,attest({...f.budget,issued_at:new Date().toISOString()},f.shared.budgetKey.privateKey));
    await expect(a.submit(p.plan.plan_id)).rejects.toThrow("Seed runtime rejected");
    expect(count(f,"submit")).toBe(0);expect(a.status().operations).toHaveLength(2);
    await expect(a.reserveSign(p)).rejects.toThrow();expect(count(f,"sign")).toBe(1);
  });
  test("crash after private sign file before persistence remains recoverable only by verify",async()=>{
    const f=await setup({mode:"crash-sign"}),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();
    expect((await rt.reserveSign(p)).status).toBe("signing_unknown");expect(existsSync(f.config.signed_tx_path)).toBe(true);
    const recovered=new SeedRuntime(f.config);expect(recovered.status().operations[0].status).toBe("signing_unknown");
    await expect(recovered.reserveSign(p)).rejects.toThrow();expect(count(f,"sign")).toBe(1);
    expect((await recovered.verify(p.plan.plan_id)).status).toBe("signed");expect(count(f,"sign")).toBe(1);
  });
  test("submit timeout and lookup absence stay sticky; no automatic retry",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();await rt.reserveSign(p);
    const timeout=switchMode(f,"submit-timeout",300);
    expect((await timeout.submit(p.plan.plan_id)).status).toBe("submission_unknown");
    const absent=switchMode(f,"absent");await absent.reconcile(p.plan.plan_id);await expect(absent.submit(p.plan.plan_id)).rejects.toThrow();
    expect(absent.status().operations[0].status).toBe("submission_unknown");expect(count(f,"submit")).toBe(1);expect(absent.status().total_reserved_sponsor_exposure_uzrn).toBe("350000");
  });
  test("revoked and arbitrary self-signed authority never suffice",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();
    writeJson(f.config.currentness_file,attest({...f.currentness,root_revoked:true},f.shared.currentKey.privateKey));
    await expect(rt.prepare()).rejects.toThrow();
    writeJson(f.config.currentness_file,attest(f.currentness,f.owner.privateKey));await expect(rt.prepare()).rejects.toThrow();
    expect(count(f,"sign")).toBe(0);
  });
  test("expired currentness and account/key substitution fail closed",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();
    writeJson(f.config.currentness_file,attest({...f.currentness,issued_at:"2020-01-01T00:00:00.000Z",valid_until:"2020-01-01T00:01:00.000Z"},f.shared.currentKey.privateKey));await expect(rt.prepare()).rejects.toThrow();
    writeJson(f.config.currentness_file,attest({...f.currentness,signer_key_id:digest(new Uint8Array([2]))},f.shared.currentKey.privateKey));await expect(rt.prepare()).rejects.toThrow();
    expect(count(f,"sign")).toBe(0);
  });
  test("signed-file substitution and direct caller-shaped summaries cannot advance",async()=>{
    const f=await setup({mode:"crash-sign"}),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();await rt.reserveSign(p);
    const bad=switchMode(f,"bad-signed");await expect(bad.verify(p.plan.plan_id)).rejects.toThrow();expect(bad.status().operations[0].status).toBe("signing_unknown");
    const store=new SeedStore(f.config,true);try {expect(()=>store.acceptVerified(p.plan.plan_id,{} as never)).toThrow();}finally{store.close();}
  });
  test("signed outside-journal liabilities count before signing and are rechecked before submit",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();
    writeJson(f.config.sponsor_budget_file,attest({...f.budget,outside_journal_exposure_uzrn:"800000"},f.shared.budgetKey.privateKey));
    await expect(rt.reserveSign(p)).rejects.toThrow();expect(count(f,"sign")).toBe(0);
    writeJson(f.config.sponsor_budget_file,attest(f.budget,f.shared.budgetKey.privateKey));await rt.reserveSign(p);
    writeJson(f.config.sponsor_budget_file,attest({...f.budget,outside_journal_exposure_uzrn:"800000",issued_at:new Date().toISOString()},f.shared.budgetKey.privateKey));
    await expect(rt.submit(p.plan.plan_id)).rejects.toThrow();expect(count(f,"submit")).toBe(0);expect(rt.status().operations[0].status).toBe("signed");
  });
  test("missing native key after boundary consumes authority even without a signed file",async()=>{
    const f=await setup({mode:"missing-key"}),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();
    expect((await rt.reserveSign(p)).status).toBe("signing_unknown");expect(existsSync(f.config.signed_tx_path)).toBe(false);
    await expect(new SeedRuntime(f.config).reserveSign(p)).rejects.toThrow();expect(count(f,"sign")).toBe(1);
    expect(rt.status().total_reserved_sponsor_exposure_uzrn).toBe("350000");
  });
  test("revocation between signing and submission fails before transport without restoring cap",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();await rt.reserveSign(p);
    writeJson(f.config.currentness_file,attest({...f.currentness,capability_revoked:true},f.shared.currentKey.privateKey));
    await expect(rt.submit(p.plan.plan_id)).rejects.toThrow();expect(count(f,"submit")).toBe(0);expect(count(f,"sign")).toBe(1);expect(rt.status().operations[0].status).toBe("signed");
  });
  for(const mutation of ["chain","genesis","node","sponsor","pot","exhausted","expired","revoked-grant","account-key"]) test(`observed ${mutation} substitution cannot prepare a signer request`,async()=>{
    const f=await setup(),obs=structuredClone(f.observation) as any;
    if(mutation === "chain") obs.evidence.chain_id="cosmos:wrong-chain";
    if(mutation === "genesis") obs.evidence.genesis_hash=digest(new Uint8Array([3]));
    if(mutation === "node") obs.evidence.node_trust_id=digest(new Uint8Array([4]));
    if(mutation === "sponsor") obs.sponsor_account=f.config.policy.claimant_account;
    if(mutation === "pot") obs.pot.pot_id="bootstrap-wrong";
    if(mutation === "exhausted") obs.allowance.spend_limit_uzrn="1";
    if(mutation === "expired") obs.allowance.expires_at="2000-01-01T00:00:00.000Z";
    if(mutation === "revoked-grant") obs.allowance={status:"absent"};
    if(mutation === "account-key") obs.claimant.public_key={type_url:"/cosmos.crypto.ed25519.PubKey",key_b64u:f.owner.authority.public_key};
    writeJson(f.config.helper_trust_file,{...f.helperFixture,observation:obs});
    const rt=new SeedRuntime(validateConfig({...f.config,helper_trust_sha256:fileDigest(f.config.helper_trust_file)}));
    await expect(rt.prepare()).rejects.toThrow();expect(count(f,"sign")).toBe(0);expect(existsSync(f.config.ledger_path)).toBe(false);
  });
  test("journal tamper is rejected; hash chain is not an external authenticity claim",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();await rt.reserveSign(p);
    const db=new Database(f.config.ledger_path);db.exec("DROP TRIGGER seed_no_update; UPDATE seed_events SET event_hash='tampered' WHERE sequence=1");db.close();
    expect(()=>rt.status()).toThrow();
  });
});

describe("real process concurrency",()=>{
  async function worker(f: Awaited<ReturnType<typeof fixture>>,p: unknown) {
    const planPath=join(f.dir,"prepared.json");writeJson(planPath,p);writeJson(f.configPath,f.config);
    const proc=Bun.spawn([process.execPath,"--tsconfig-override",join(path,"tsconfig.json"),join(path,"test-worker.ts"),f.configPath,fileDigest(f.configPath),planPath],{cwd:path,stdout:"pipe",stderr:"pipe"});
    const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);return {out:parse(out),err,code};
  }
  test("one use across competing processes invokes chain signer once",async()=>{
    const f=await setup(),rt=new SeedRuntime(f.config);rt.init();const p=await rt.prepare();
    const results=await Promise.all([worker(f,p),worker(f,p)]);
    expect(results.filter(r=>r.out.status === "signed")).toHaveLength(1);expect(count(f,"sign")).toBe(1);expect(rt.status().operations).toHaveLength(1);
  });
  test("aggregate dedicated sponsor budget cannot be doubled by parallel recipients",async()=>{
    const f=await setup({total:"600000"}),g=await setup({shared:f.shared,total:"600000"});
    const a=new SeedRuntime(f.config),b=new SeedRuntime(g.config);a.init();const [p,q]=await Promise.all([a.prepare(),b.prepare()]);
    const results=await Promise.all([worker(f,p),worker(g,q)]);
    expect(results.filter(r=>r.out.status === "signed")).toHaveLength(1);expect(count(f,"sign")+count(g,"sign")).toBe(1);
    expect(a.status().total_reserved_sponsor_exposure_uzrn).toBe("350000");expect(a.status().operations).toHaveLength(1);
  });
});
