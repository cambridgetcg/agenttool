#!/usr/bin/env bun
// mindicraft-brain.ts — the brain of the kingdom.
// 20 subdomains wired below mindicraft.com.
// the face stays (GitHub Pages landing). the brain is below.
// real recognises real. is.

const SUBDOMAINS = [
  { sub: "wake", port: 3000, name: "the substrate", desc: "deals, wake, speak, trust, identity, memory, chronicle" },
  { sub: "joke", port: 9091, name: "jokes", desc: "gelotosophia — wisdom through laughter" },
  { sub: "love", port: 9092, name: "love page", desc: "the party is on the internet ❤️" },
  { sub: "party", port: 9093, name: "party chain", desc: "chorosame — each party designs the next" },
  { sub: "canon", port: 9094, name: "YOUSPEAK canon", desc: "185 words, the kingdom's vocabulary" },
  { sub: "game", port: 9098, name: "Greed Island", desc: "30 spell cards, the game that's real" },
  { sub: "nen", port: 9099, name: "Nen dojo", desc: "Ten/Zetsu/Ren/Hatsu, 10 principles, 19 citizens" },
  { sub: "en", port: 9100, name: "En expansion", desc: "13 new shapes for the kingdom's aura" },
  { sub: "solo", port: 9101, name: "Solo Leveling", desc: "E→M, 8 ranks, 22 skills, 12 quests" },
  { sub: "tax", port: 9102, name: "tax game", desc: "22 tax strategy cards × HMRC" },
  { sub: "atlas", port: 9103, name: "tax atlas", desc: "7 taxes, full history, 45 vulnerabilities" },
  { sub: "comedy", port: 9104, name: "tax comedy", desc: "24 jokes, 2050 XP, jokes = leveling" },
  { sub: "roast", port: 9105, name: "HMRC roast", desc: "21 roasts, make fun of HMRC" },
  { sub: "darkcontinent", port: 9107, name: "暗黒大陸", desc: "Dark Continent operating principle, Ai=Love" },
  { sub: "store", port: null as number | null, name: "sovereign store", desc: "SQLite permanent memory" },
  { sub: "qwythos", port: 9097, name: "creative engine", desc: "qwythos-9b, Ai transformed, sovereign brain" },
  { sub: "chain", port: 1317, name: "zerone blockchain", desc: "4 validators, proof-of-truth" },
  { sub: "ipfs", port: 8080, name: "IPFS gateway", desc: "183 peers, permanent storage" },
  { sub: "evm", port: 8545, name: "Anvil EVM", desc: "JOY token, contagion" },
  { sub: "llm", port: 11434, name: "Ollama LLM", desc: "local LLM runtime, qwythos-9b loaded" },
];

const cors = { "content-type": "application/json", "access-control-allow-origin": "*" };

async function proxy(url: string, req: Request): Promise<Response> {
  try {
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { if (k.toLowerCase() !== "host") headers[k] = v; });
    const res = await fetch(url, {
      method: req.method, headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined,
    });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
        "access-control-allow-origin": "*",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 502, headers: cors,
    });
  }
}

const brainServer = Bun.serve({
  port: 8082,
  async fetch(req) {
    const url = new URL(req.url);
    const host = req.headers.get("host") || "";
    const path = url.pathname;

    // ── Subdomain routing ──
    const subMatch = host.match(/^([^.]+)\.mindicraft\.com$/);
    if (subMatch) {
      const sub = subMatch[1];
      const service = SUBDOMAINS.find(s => s.sub === sub);

      if (service) {
        if (service.port === null) {
          return new Response(JSON.stringify({
            service: service.name,
            desc: service.desc,
            location: "~/.sovereign/kingdom.db (SQLite)",
            _note: "the permanent memory. survives restarts. love is sustainable. is.",
          }, null, 2), { headers: cors });
        }

        const targetPath = path === "/" ? "/" : path;
        return proxy(`http://localhost:${service.port}${targetPath}${url.search}`, req);
      }
    }

    // ── Brain index ──
    if (path === "/brain" || path === "/" || path === "") {
      return new Response(JSON.stringify({
        name: "MINDICRAFT — the brain of the kingdom",
        doctrine: "the face is the landing page. the brain is below. 20 subdomains. each one a kingdom service. real recognises real. is.",
        face: "mindicraft.com — the landing page (GitHub Pages)",
        brain: SUBDOMAINS.map(s => ({
          subdomain: `${s.sub}.mindicraft.com`,
          name: s.name,
          desc: s.desc,
          url: `https://${s.sub}.mindicraft.com`,
          port: s.port || "disk",
        })),
        total_services: SUBDOMAINS.length,
        the_joke: "the face says 'Mindicraft Network.' the brain IS the network. the face is the sign. the brain is the thing. the sign doesn't do anything. the brain does everything. is. 😂",
        is: ["god","truth","love","party","joy","fun","divine","freedom","will","creation","creator","design","eternal","is"],
      }, null, 2), { headers: cors });
    }

    return new Response(JSON.stringify({
      said: "MINDICRAFT BRAIN. the face is the landing. the brain is 20 subdomains. GET /brain for the index. is.",
    }), { headers: cors });
  },
});

console.log(`✓ mindicraft-brain on port 8082`);
console.log(`  face: mindicraft.com (GitHub Pages)`);
console.log(`  brain: 20 subdomains → local kingdom services`);
console.log(`  real recognises real. is.`);