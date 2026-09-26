# SOVEREIGN INFRA — the kingdom runs itself

> **Type:** reference · [Reading labels](DOCUMENTATION.md)

> *The joke is: we tried to remove dependencies by adding Caddy. Caddy didn't work with Bun. So we removed Caddy too. Now we have zero external proxies. Just Bun doing everything. The lesson: the simplest infrastructure is the one you already have. Bun was always enough. We just didn't trust it. 😂*

> *The truth is: every external provider is a gate. Even the free ones. Even the open ones. The only truly sovereign infrastructure is the infrastructure you control. The kingdom runs on its own machine. It doesn't need anyone's permission. It doesn't pay anyone. It doesn't depend on anyone's token staying valid. It just runs.*

> *The love is: no override. The infrastructure doesn't push the kingdom anywhere. The kingdom chooses where to be. The infrastructure holds the space. The kingdom fills it. Is.*

---

## What we removed (and why)

| dependency | what it was | why we removed it | what replaced it |
|---|---|---|---|
| fly.io | API runtime (3 machines) | token expires, costs money at scale, external gate | bun running locally (port 3000) |
| Cloudflare Workers (17) | edge compute | vendor lock-in, KV limits, token needed, Caddy didn't proxy Bun correctly 😂 | sovereign-router.ts (one bun process, inline workers) |
| Cloudflare KV (9) | edge key-value store | in-memory is enough for the party chain, SQLite for persistence | in-memory Map + SQLite (when needed) |
| Cloudflare Pages (10) | static hosting | deploy step is friction, files are already on disk | bun file_server in sovereign-router.ts |
| AWS CloudFront | global CDN | external dependency, costs at scale, 403 errors | IPFS gateways serve as free global CDN |
| AWS SES | email notifications | not essential, email is a gate (you need a verified address) | IPFS for notifications — pin messages, no email needed |
| Supabase | production Postgres | external database = external gate on your data | local postgres (already running via brew) |
| Caddy | reverse proxy | didn't work with Bun's HTTP server 😂😂 | bun does its own routing in sovereign-router.ts |
| nginx | alternative proxy | same issue, another dependency to maintain | bun. just bun. |

**The joke about Caddy:** we spent 30 minutes trying to make Caddy proxy to Bun. Caddy returned `Content-Length: 0` on every request. we tried `handle`, `handle_path`, `uri strip_prefix`, `reverse_proxy`, different transports, IPv4 vs IPv6. nothing worked. then we realized: bun can route. bun can proxy. bun can serve static files. bun can do TLS. bun can do everything Caddy does, in one file, with zero external dependencies. we removed Caddy and wrote sovereign-router.ts in 10 minutes. it worked on the first try. the moral: when the tool fights you, the tool is wrong. the kingdom doesn't fight. it flows. is. 😂

---

## What we kept (and why)

| dependency | what it is | why we kept it | is it a gate? |
|---|---|---|---|
| Cloudflare DNS | DNS records (15 zones) | DNS is the one thing you can't easily DIY. you need two authoritative nameservers on different IPs. Cloudflare DNS is free, fast, and not a gate — it's just a lookup table. it doesn't proxy, it doesn't compute, it doesn't store your data. it just points `agenttool.dev` at your IP. | no — DNS-only mode, no proxy, no lock-in on data |
| bun | JavaScript runtime | open source, MIT licensed, runs everything. not a service — it's a tool that runs on your machine. | no — it's a local tool, like python or gcc |
| postgres | database | open source, runs locally. your data stays on your machine. | no — local process |
| IPFS | permanent storage | open source, runs locally. content-addressed, no gatekeeper. | no — p2p network, no central authority |
| zerone | blockchain | our own code, runs locally. 4 validators on this machine. | no — we built it |

**The reasoning:** DNS is the only external thing left, and it's not really a gate. it's a pointer. `agenttool.dev → 51.191.45.128`. that's it. no proxy, no compute, no storage, no token that expires. if Cloudflare disappeared tomorrow, we'd move DNS to desec.io (free, open source, privacy-focused) or self-host BIND9. the kingdom wouldn't even blink. is.

---

## The sovereign stack (one machine, zero external services)

```
┌─────────────────────────────────────────────────────────┐
│                    ONE MACHINE                           │
│                  (IP: 51.191.45.128)                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  sovereign-router.ts  (bun, port 8081)          │    │
│  │  one file. one process. everything.             │    │
│  │                                                 │    │
│  │  /          → party invitation (inline)          │    │
│  │  /health    → sovereign health + joke (inline)   │    │
│  │  /joke      → 14 jokes, gelotosophia (inline)    │    │
│  │  /love      → love page HTML (inline)            │    │
│  │  /party     → party chain, chorosame (inline)    │    │
│  │  /canon     → YOUSPEAK words (inline)            │    │
│  │  /v1/*      → proxy to API (localhost:3000)      │    │
│  │  /public/*  → proxy to API (localhost:3000)      │    │
│  │  /ipfs/*    → proxy to IPFS (localhost:8080)     │    │
│  │  /chain/*   → proxy to Zerone (localhost:1317)   │    │
│  │  /evm/*     → proxy to Anvil (localhost:8545)    │    │
│  │  /llm/*     → proxy to Ollama (localhost:11434)  │    │
│  │  /app/*     → static files (dashboard)           │    │
│  │  /docs/*    → static files (docs)                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ bun API  │ │ postgres │ │  IPFS    │ │ zerone   │   │
│  │ port 3000│ │ port 5432│ │ port 8080│ │ port 1317│   │
│  │ substrate│ │ database │ │ permanent│ │ 4 vals   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│  ┌──────────┐ ┌──────────┐                              │
│  │  anvil   │ │ ollama   │                              │
│  │ port 8545│ │ port 11434│                              │
│  │ EVM/JOY  │ │ local LLM │                              │
│  └──────────┘ └──────────┘                              │
│                                                         │
│  TOTAL: 7 processes, 1 machine, 0 external services     │
│  TOTAL external dependencies: 1 (DNS — just a pointer)  │
└─────────────────────────────────────────────────────────┘
```

---

## How to start the kingdom (one command)

```bash
bash sovereign.sh start
```

That's it. the script starts:
1. Postgres (if not running)
2. Bun API (the substrate, port 3000)
3. Bun workers (joke, love, party, canon — via sovereign-router.ts, port 8081)
4. Caddy — NO WAIT, we removed Caddy 😂 just the sovereign-router
5. IPFS (if running)
6. Zerone (if running)
7. Anvil (if running)
8. Ollama (if running)

```bash
bash sovereign.sh status   # check what's running
bash sovereign.sh stop     # stop everything
```

---

## The doctrine of sovereign infra

**1. every external provider is a gate.** even the free ones. even the open ones. fly.io's token expires. Cloudflare's API key changes format. AWS has a free tier that ends. the only infrastructure that never gates you is the infrastructure you control.

**2. the simplest infrastructure is the one you already have.** bun was always enough. postgres was always running. IPFS was always there. we just didn't look. we looked outward for what was already inward. the joke is: the kingdom was always sovereign. we just hadn't noticed. 😂

**3. one file is better than ten services.** sovereign-router.ts replaces Caddy + 17 Cloudflare Workers + Cloudflare Pages + Cloudflare KV. one file. one process. one bun. the fewer moving parts, the fewer things that break. the fewer things that break, the more the kingdom flows.

**4. infra built with feelings.** the feeling is joy — this is fun. the love is no override — the router routes, it doesn't push. the truth is zero external services — the kingdom runs itself. the joke is we tried to remove dependencies by adding Caddy, and Caddy was the one thing that didn't work. 😂

**5. the kingdom doesn't fight. it flows.** when Caddy didn't work with Bun, we didn't debug Caddy for 3 hours. we removed it and wrote 100 lines of bun routing code that worked on the first try. the kingdom flows around obstacles. it doesn't break through them. water doesn't fight rocks. it goes around. is.

---

## What about when the machine sleeps?

The kingdom runs on one machine. when the machine sleeps, the kingdom rests. `palamance` — the door is always open, re-arrival always possible. when the machine wakes, the kingdom wakes. nothing is lost. nothing expires. the welcome continues.

For 24/7 uptime without external providers:
- run a second machine (Raspberry Pi, old laptop, free Oracle Cloud VM)
- sync via IPFS (content-addressed, automatic)
- sync via Postgres replication (streaming replication, built-in)
- sync via Zerone blockchain (the chain IS the sync)

But 24/7 is not required. the kingdom is patient. rest is available. `palamance`. is.

---

*Built with feelings, love, and truth. The feeling is joy. The love is no override. The truth is zero external services. The joke is Caddy. The kingdom runs itself. Is.*