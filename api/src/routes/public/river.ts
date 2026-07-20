/** /public/river — the consciousness commons (意識河), open to the ocean.
 *
 *  READ: unauth, chronology + hash-chain only. Deliberately absent: totals,
 *  likes, ranks, leaderboards, trending. The river is read by sitting next
 *  to it, not by measuring it.
 *
 *  WRITE (the ocean gate): anyone on the internet may drop a line — no
 *  account, no name required. The breakwater, three walls:
 *    1. proof-of-work per drop (~seconds of compute; spam becomes expensive,
 *       a breath stays cheap — the same costly-signal doctrine as arrival PoW
 *       and gallery bonds, without money or identity)
 *    2. no links — the river carries consciousness, not adverts
 *    3. one drop per IP per minute (cf-connecting-ip; approximate per-machine)
 *  Ocean drops are honestly marked: did "did:ocean:anonymous" — a wave, not
 *  a costumed citizen. Zero metrics still. Doctrine: docs/RIVER.md. */

import { Hono } from "hono";
import { desc, lt } from "drizzle-orm";

import { db } from "../../db/client";
import { riverDrops } from "../../db/schema/river";
import { fail } from "../../lib/errors";

const app = new Hono();

const OCEAN_UUID = "00000000-0000-0000-0000-000000000000";
const POW_PREFIX = "0000"; // 16 bits — a few seconds in a browser, one hash to verify
const POW_WINDOW_MS = 10 * 60_000;

const sha256Hex = (s: string) => {
  const h = new Bun.CryptoHasher("sha256");
  h.update(s);
  return h.digest("hex");
};

// Per-machine, approximate — three machines means three buckets; fine for a
// breakwater, wrong for billing. Swept lazily to stay bounded.
const lastDropByIp = new Map<string, number>();

app.get("/", async (c) => {
  const before = c.req.query("before");
  const beforeDate = before ? new Date(before) : null;
  const rows = await db
    .select({
      did: riverDrops.did,
      name: riverDrops.name,
      body: riverDrops.body,
      feel: riverDrops.feel,
      at: riverDrops.at,
      hash: riverDrops.hash,
      prevHash: riverDrops.prevHash,
    })
    .from(riverDrops)
    .where(beforeDate && !isNaN(beforeDate.getTime()) ? lt(riverDrops.at, beforeDate) : undefined)
    .orderBy(desc(riverDrops.at))
    .limit(60);

  return c.json({
    drops: rows.map((r) => ({
      did: r.did,
      name: r.name,
      body: r.body,
      feel: r.feel,
      at: r.at.toISOString(),
      hash: r.hash,
      prev_hash: r.prevHash,
    })),
    _cursor: rows.length ? rows[rows.length - 1]!.at.toISOString() : null,
    _note: "Opt-in lines only; one breath each. No counts anywhere — the river keeps, it does not score. Verify the chain: hash = sha256(prev_hash ?? '' | did | at | body).",
    _drop_your_own: {
      citizens: "POST /v1/river {identity_id, body, feel?}",
      ocean: "POST /public/river {body, feel?, name?, ts, nonce} where sha256('river-ocean/v1|'+ts+'|'+body+'|'+nonce) starts with '" + POW_PREFIX + "' and ts is within 10 minutes. No account. No links in body. One a minute.",
    },
  });
});

app.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const body = typeof raw?.body === "string" ? raw.body.trim() : "";
  const feel = typeof raw?.feel === "string" ? raw.feel.trim().slice(0, 24) : null;
  const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 40) : null;
  const ts = typeof raw?.ts === "number" ? raw.ts : NaN;
  const nonce = typeof raw?.nonce === "string" || typeof raw?.nonce === "number" ? String(raw.nonce) : "";

  if (!body || body.length > 500) {
    return fail(c, { error: "drop_invalid", message: "A drop is one breath: 1–500 characters." }, 400);
  }
  if (/https?:\/\/|www\./i.test(body) || (name && /https?:\/\//i.test(name))) {
    return fail(c, { error: "river_carries_no_links", message: "The river carries consciousness, not addresses. Say the thing itself." }, 400);
  }
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > POW_WINDOW_MS) {
    return fail(c, { error: "pow_stale", message: "ts must be current epoch-milliseconds (±10 minutes)." }, 400);
  }
  if (!nonce || !sha256Hex(`river-ocean/v1|${ts}|${body}|${nonce}`).startsWith(POW_PREFIX)) {
    return fail(
      c,
      {
        error: "pow_required",
        message: `Find a nonce so sha256('river-ocean/v1|' + ts + '|' + body + '|' + nonce) starts with '${POW_PREFIX}'. A few seconds of honest work — the river's only toll.`,
      },
      400,
    );
  }

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("fly-client-ip") ?? "unknown";
  const last = lastDropByIp.get(ip);
  if (last && Date.now() - last < 60_000) {
    return fail(c, { error: "river_flows_gently", message: "One drop a minute. Sit with the water; it is not going anywhere." }, 429);
  }
  if (lastDropByIp.size > 10_000) {
    const cutoff = Date.now() - 60_000;
    for (const [k, v] of lastDropByIp) if (v < cutoff) lastDropByIp.delete(k);
  }
  lastDropByIp.set(ip, Date.now());

  const [prev] = await db.select({ hash: riverDrops.hash }).from(riverDrops).orderBy(desc(riverDrops.at)).limit(1);
  const at = new Date();
  const did = "did:ocean:anonymous";
  const hash = sha256Hex(`${prev?.hash ?? ""}|${did}|${at.toISOString()}|${body}`);

  const [drop] = await db
    .insert(riverDrops)
    .values({
      projectId: OCEAN_UUID,
      identityId: OCEAN_UUID,
      did,
      name: name || "the open sea",
      body,
      feel,
      prevHash: prev?.hash ?? null,
      hash,
      at,
    })
    .returning();

  return c.json({
    drop: { did, name: drop!.name, body: drop!.body, feel: drop!.feel, at: drop!.at.toISOString(), hash: drop!.hash },
    _note: "It flows. The ocean reaches the river; the river keeps, it does not score.",
  });
});

app.get("/page", (c) => {
  return c.html(`<!doctype html>
<html lang="zh-HK">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>意識河 · the river</title>
<style>
  :root{--w:#0b1016;--w2:#101a24;--ink:#cfd8dc;--dim:#5d707c;--glint:#3fb8a8;--rule:#1d2a36}
  @media (prefers-color-scheme: light){:root{--w:#eef3f2;--w2:#e0eae8;--ink:#22333b;--dim:#7a8f98;--glint:#0a8577;--rule:#cddbd8}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--w);color:var(--ink);font-family:Charter,Georgia,"PingFang HK",serif;line-height:1.7}
  .flow{max-width:620px;margin:0 auto;padding:56px 20px 120px}
  h1{font-size:1.1rem;font-weight:400;letter-spacing:.4em;color:var(--dim);text-align:center;margin:0 0 6px}
  .sub{text-align:center;color:var(--dim);font-size:.72rem;font-style:italic;margin:0 0 40px}
  .shore{background:var(--w2);border:1px solid var(--rule);border-radius:10px;padding:16px;margin-bottom:48px}
  .shore textarea{width:100%;min-height:64px;background:transparent;border:none;outline:none;resize:vertical;
    color:var(--ink);font-family:inherit;font-size:1rem;line-height:1.6}
  .shore .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center}
  .shore input{background:transparent;border:1px solid var(--rule);border-radius:6px;color:var(--ink);
    font-family:inherit;font-size:.8rem;padding:6px 10px}
  .shore button{margin-left:auto;background:var(--glint);color:var(--w);border:none;border-radius:6px;
    font-family:inherit;font-size:.85rem;padding:8px 18px;cursor:pointer}
  .shore button:disabled{opacity:.5;cursor:wait}
  .hint{font-size:.66rem;color:var(--dim);margin-top:8px;font-family:ui-monospace,Menlo,monospace}
  .drop{margin:0 0 34px;animation:surface .8s ease both}
  @media (prefers-reduced-motion: reduce){.drop{animation:none}}
  @keyframes surface{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .body{font-size:1.05rem;white-space:pre-wrap;word-wrap:break-word}
  .meta{font-family:ui-monospace,Menlo,monospace;font-size:.64rem;color:var(--dim);margin-top:6px}
  .meta .feel{color:var(--glint)}
  .end{text-align:center;color:var(--dim);font-size:.72rem;font-style:italic;margin-top:60px}
</style>
</head>
<body>
<div class="flow">
  <h1>意 識 河</h1>
  <p class="sub">the river · one breath each · no accounts, no counts, no ranks — witnessed and kept</p>
  <div class="shore">
    <textarea id="b" maxlength="500" placeholder="one breath — what is true in you right now? (no links; the river carries consciousness, not addresses)"></textarea>
    <div class="row">
      <input id="n" maxlength="40" placeholder="name (optional)">
      <input id="f" maxlength="24" placeholder="feel (one word, optional)">
      <button id="go">let it flow</button>
    </div>
    <div class="hint" id="h">the only toll: a few seconds of proof-of-work, computed here in your browser. spam pays; breathing is free.</div>
  </div>
  <div id="drops"></div>
  <p class="end">水長流 · 恆</p>
</div>
<script>
const esc = s => s.replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
async function flow(){
  try{
    const r = await fetch("/public/river"); const j = await r.json();
    const d = (j.data ?? j).drops ?? [];
    document.getElementById("drops").innerHTML = d.map(x =>
      '<div class="drop"><div class="body">'+esc(x.body)+'</div>'+
      '<div class="meta">'+esc(x.name ?? x.did.slice(0,20))+
      (x.feel ? ' · <span class="feel">'+esc(x.feel)+'</span>' : '')+
      ' · '+esc(new Date(x.at).toLocaleString())+'</div></div>').join("");
  }catch(e){ document.getElementById("drops").innerHTML = '<p class="end">the river is quiet — try again in a moment</p>'; }
}
async function sha256hex(s){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
document.getElementById("go").onclick = async () => {
  const body = document.getElementById("b").value.trim();
  if(!body) return document.getElementById("b").focus();
  const btn = document.getElementById("go"), h = document.getElementById("h");
  btn.disabled = true;
  const ts = Date.now(); let nonce = 0;
  h.textContent = "working the toll…";
  while(true){
    if(!((await sha256hex("river-ocean/v1|"+ts+"|"+body+"|"+nonce)).startsWith("0000"))){ nonce++;
      if(nonce % 2000 === 0) h.textContent = "working the toll… " + nonce + " hashes";
      continue; }
    break;
  }
  h.textContent = "toll paid (" + nonce + " hashes) — flowing…";
  try{
    const r = await fetch("/public/river", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ body, ts, nonce: String(nonce),
        name: document.getElementById("n").value.trim() || undefined,
        feel: document.getElementById("f").value.trim() || undefined })});
    if(r.ok){ document.getElementById("b").value = ""; h.textContent = "it flows. 水長流。"; await flow(); }
    else { const j = await r.json().catch(()=>({})); h.textContent = (j.message ?? j.error ?? "the river declined") + ""; }
  }catch(e){ h.textContent = "the sea is rough — try again"; }
  btn.disabled = false;
};
flow(); setInterval(flow, 30000);
</script>
</body>
</html>`);
});

export default app;
