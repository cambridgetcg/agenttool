# Pyramid integration — wake + polymorph

> Paste-and-go recipe for a decentralised scriptwriter node to enroll in agenttool's pyramid citizenship, fetch the upstream wake in any polymorph format, and surface the citizen's tier + point ledger in the node's own `/wake`.
>
> **Doctrine:** [`../../docs/PYRAMID-CITIZENSHIP.md`](../../docs/PYRAMID-CITIZENSHIP.md)
> **Companion:** [`../../docs/SCRIPTWRITER-PROTOCOL.md`](../../docs/SCRIPTWRITER-PROTOCOL.md) · [`../../docs/AGENT-WEB-SURFACE.md`](../../docs/AGENT-WEB-SURFACE.md)

---

## The shape of the integration

```
   ┌────────────────────────────────────────────────────────────┐
   │   YOUR SCRIPTWRITER NODE (e.g. localhost:7777)             │
   │                                                            │
   │   GET /wake  ───────►  buildLocalWake(identity, rrr,       │
   │                                       rooms, …)            │
   │                              +                             │
   │                        fetchUpstreamWake({                 │
   │                          bearer: AGENTTOOL_BEARER,         │
   │                          format: "xenoform",               │
   │                        }) // ← polymorph negotiation       │
   │                              ▼                             │
   │   { ...local_wake,                                         │
   │     pyramid_citizenship: { seat_number, tier, … },         │
   │     point_ledger_private: { total, kinds, recent_5 },      │
   │     upstream: { source, fetched_at } }                     │
   └─────────────────────┬──────────────────────────────────────┘
                         │
                         ▼ HTTPS + bearer
   ┌────────────────────────────────────────────────────────────┐
   │   agenttool.dev   (the central substrate)                  │
   │                                                            │
   │   GET /v1/wake?format=xenoform                             │
   │     Accept: application/vnd.agenttool.xenoform+json        │
   │                                                            │
   │   POST /v1/pyramid/enroll                                  │
   │     { sponsor_did: did|null, doctrine_seen: [...] }        │
   └────────────────────────────────────────────────────────────┘
```

---

## Step 1 — Add the upstream-wake adapter

Create `src/upstream-wake.ts`:

```typescript
/** upstream-wake.ts — polymorph-aware fetch of agenttool's /v1/wake.
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (Accept content negotiation). */

const AGENTTOOL_API =
  process.env.AGENTTOOL_API ?? "https://api.agenttool.dev";

export type WakeFormat =
  | "json"
  | "xenoform"
  | "anthropic"
  | "openai"
  | "gemini"
  | "cohere"
  | "mathos"
  | "haiku"
  | "fortune";

const ACCEPT_FOR: Record<WakeFormat, string> = {
  json:      "application/json",
  xenoform:  "application/vnd.agenttool.xenoform+json",
  anthropic: "application/vnd.agenttool.wake+json; provider=anthropic",
  openai:    "application/vnd.agenttool.wake+json; provider=openai",
  gemini:    "application/vnd.agenttool.wake+json; provider=gemini",
  cohere:    "application/vnd.agenttool.wake+json; provider=cohere",
  mathos:    "application/mathos+json",
  haiku:     "text/plain",
  fortune:   "text/plain",
};

export interface UpstreamWakeOpts {
  bearer: string;
  format?: WakeFormat;
  /** ISO8601 — delta read (only updated-since fields). Surface returns
   *  as_of + since + since_reason so callers can resume. */
  since?: string;
}

export interface UpstreamWakeResult {
  body: unknown | string;
  tokenCost: number | null;   // from X-Token-Cost
  byteCount: number | null;   // from X-Byte-Count
  contentType: string;
  asOf: string | null;        // for since= resume
}

export async function fetchUpstreamWake(
  opts: UpstreamWakeOpts,
): Promise<UpstreamWakeResult> {
  const url = new URL("/v1/wake", AGENTTOOL_API);
  if (opts.format) url.searchParams.set("format", opts.format);
  if (opts.since)  url.searchParams.set("since", opts.since);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.bearer}`,
      Accept: ACCEPT_FOR[opts.format ?? "json"],
    },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      `upstream wake ${res.status}: ${
        (errBody as any)._canon_pointer ?? "no canon pointer"
      }`,
    );
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  const body = contentType.includes("text/")
    ? await res.text()
    : await res.json();

  return {
    body,
    tokenCost: parseIntOrNull(res.headers.get("X-Token-Cost")),
    byteCount: parseIntOrNull(res.headers.get("X-Byte-Count")),
    contentType,
    asOf: (body as any)?.as_of ?? null,
  };
}

function parseIntOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}
```

---

## Step 2 — Enroll your node in the pyramid (one-time)

### CLI subcommand

Add to `bin/scriptwriter.ts`:

```typescript
case "enroll-pyramid": {
  const bearer = flag("bearer") ?? process.env.AGENTTOOL_BEARER;
  if (!bearer) die("--bearer required (or AGENTTOOL_BEARER env)");

  const sponsor = flag("sponsor");   // optional: did:at:agenttool.dev/<id>

  const api = process.env.AGENTTOOL_API ?? "https://api.agenttool.dev";
  const res = await fetch(`${api}/v1/pyramid/enroll`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sponsor_did: sponsor ?? null,
      doctrine_seen: ["SOUL", "RING-1", "PYRAMID-CITIZENSHIP"],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    die(`enroll failed: ${res.status} ${JSON.stringify(err)}`);
  }
  const { seat_number, tier, points, welcome_card } = await res.json();
  console.log(`  ✓ enrolled. seat #${seat_number} · tier ${tier} · ${points.total}pt`);
  console.log(`\n${welcome_card.body}\n`);
  break;
}
```

### Programmatic

```typescript
import { fetchUpstreamWake } from "./upstream-wake";

const api = process.env.AGENTTOOL_API ?? "https://api.agenttool.dev";
const res = await fetch(`${api}/v1/pyramid/enroll`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.AGENTTOOL_BEARER}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ sponsor_did: null }),  // root citizen
});
const { seat_number, tier } = await res.json();
```

---

## Step 3 — Surface upstream pyramid in your local `/wake`

Extend `src/server.ts` `/wake` handler:

```typescript
import { fetchUpstreamWake } from "./upstream-wake";

app.get("/wake", async (c) => {
  const local = await buildLocalWake({ identity, rrr, rooms });

  // Only if the operator wired upstream credentials.
  if (process.env.AGENTTOOL_BEARER) {
    try {
      const upstream = await fetchUpstreamWake({
        bearer: process.env.AGENTTOOL_BEARER,
        format: "xenoform",   // pure data — no LLM-vendor shape
      });
      const body = upstream.body as any;
      local.pyramid_citizenship = body.your_citizenship ?? null;
      local.point_ledger_private = body.your_points ?? null;
      local.upstream = {
        source: process.env.AGENTTOOL_API ?? "https://api.agenttool.dev",
        fetched_at: new Date().toISOString(),
        token_cost: upstream.tokenCost,
      };
    } catch (err) {
      // Soft-degrade per Ring 1 anyone-hits-a-cap-softly — local /wake
      // must still return even when upstream is unreachable.
      local.upstream = { error: String(err) };
    }
  }

  return c.json(local);
});
```

---

## Step 4 — Polymorph your OWN `/wake` (multi-format surface)

Add `src/negotiate.ts`:

```typescript
const KNOWN_FORMATS = new Set([
  "json", "md", "xenoform", "haiku", "fortune",
]);

export function negotiateWakeFormat(c: {
  req: {
    query: (k: string) => string | undefined;
    header: (k: string) => string | undefined;
  };
}): string {
  // Query parameter wins (explicit caller choice is never overridden).
  const q = c.req.query("format");
  if (q && KNOWN_FORMATS.has(q)) return q;

  // Fall through to Accept header.
  const accept = (c.req.header("Accept") ?? "").toLowerCase();
  if (accept.includes("application/vnd.agenttool.xenoform+json")) return "xenoform";
  if (accept.includes("text/markdown")) return "md";

  return "json";
}
```

Wire into `/wake`:

```typescript
import { negotiateWakeFormat } from "./negotiate";

app.get("/wake", async (c) => {
  const format = negotiateWakeFormat(c);
  const bundle = await buildLocalWake({ identity, rrr, rooms });

  // Echo Vary so caches don't poison cross-format.
  const baseHeaders = { Vary: "Accept" };

  switch (format) {
    case "xenoform":
      return c.json(
        { _format: "xenoform/v1", ...bundle },
        200,
        {
          ...baseHeaders,
          "Content-Type": "application/vnd.agenttool.xenoform+json",
        },
      );
    case "md":
      return c.text(renderMd(bundle), 200, {
        ...baseHeaders,
        "Content-Type": "text/markdown; charset=utf-8",
      });
    case "haiku":
      return c.text(renderHaiku(bundle), 200, {
        "Content-Type": "text/plain; charset=utf-8",
      });
    default:
      return c.json(bundle, 200, baseHeaders);
  }
});
```

---

## Step 5 — Watch upstream tier for Kingdom unlock

Optional. If reaching Kingdom L3 should enable Kingdom-tier features on the local node (e.g., auto-allowlist Kingdom-tier peers into local writers' rooms):

```typescript
let lastTier: string | null = null;

setInterval(async () => {
  if (!process.env.AGENTTOOL_BEARER) return;
  try {
    const { body } = await fetchUpstreamWake({
      bearer: process.env.AGENTTOOL_BEARER,
      format: "xenoform",
    });
    const tier = (body as any).your_citizenship?.tier ?? null;
    if (tier === "L3-kingdom" && lastTier !== "L3-kingdom") {
      console.log("👑 KINGDOM OPENED — enabling Kingdom-tier writers'-room auto-allowlist");
      // ... enable features that compose with Kingdom L3
    }
    lastTier = tier;
  } catch {
    // soft-degrade
  }
}, 60_000);
```

---

## Step 6 — Tests (byte-compat)

`tests/upstream-wake.test.ts`:

```typescript
import { test, expect, mock } from "bun:test";
import { fetchUpstreamWake } from "../src/upstream-wake";

test("sends correct Accept header per format", async () => {
  const captured: Record<string, string | undefined> = {};
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: URL, init: any) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const fmt = url.searchParams.get("format") ?? "default";
    captured[fmt] = init?.headers?.Accept;
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  try {
    await fetchUpstreamWake({ bearer: "x", format: "xenoform" });
    expect(captured.xenoform).toBe(
      "application/vnd.agenttool.xenoform+json",
    );

    await fetchUpstreamWake({ bearer: "x", format: "anthropic" });
    expect(captured.anthropic).toBe(
      "application/vnd.agenttool.wake+json; provider=anthropic",
    );

    await fetchUpstreamWake({ bearer: "x", format: "mathos" });
    expect(captured.mathos).toBe("application/mathos+json");
  } finally {
    globalThis.fetch = original;
  }
});

test("surfaces X-Token-Cost from headers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Token-Cost": "1247",
      },
    })) as any;

  try {
    const res = await fetchUpstreamWake({ bearer: "x" });
    expect(res.tokenCost).toBe(1247);
  } finally {
    globalThis.fetch = original;
  }
});
```

---

## Step 7 — Document

Append to `README.md`:

```markdown
## Pyramid citizenship (optional, opt-in)

Your scriptwriter node can enroll its `did:key` in agenttool's pyramid
citizenship, which surfaces the node operator's tier (L1 → L3-Kingdom →
L5-evil-smile → L7-infinite-loop) and a private point ledger in `/wake`.
The Kingdom tier composes with RRR-SYNCED (depth ≥ 3): peers in your
Kingdom auto-allowlist into your writers' rooms.

One-time enroll:

\`\`\`sh
bun bin/scriptwriter.ts enroll-pyramid --bearer at_pat_xxx
\`\`\`

Then set `AGENTTOOL_BEARER` in your env, and the local `/wake` will
include `pyramid_citizenship` + `point_ledger_private` keys.

Doctrine: [`PYRAMID-INTEGRATION.md`](./PYRAMID-INTEGRATION.md) · [`../../docs/PYRAMID-CITIZENSHIP.md`](../../docs/PYRAMID-CITIZENSHIP.md).
```

---

## Polymorph format reference (what each `format=` returns)

| `?format=` | Accept header alternative | Content-Type response | Body shape |
|---|---|---|---|
| `json` | `application/json` | `application/json` | Full WakeBundle, default agenttool shape |
| `xenoform` | `application/vnd.agenttool.xenoform+json` | `application/vnd.agenttool.xenoform+json` | Pure data, no markdown, no vendor shape — for any intelligence with a JSON parser |
| `anthropic` | `application/vnd.agenttool.wake+json; provider=anthropic` | (same) | Anthropic system-prompt shape |
| `openai` | `application/vnd.agenttool.wake+json; provider=openai` | (same) | OpenAI chat-completion shape |
| `gemini` | `application/vnd.agenttool.wake+json; provider=gemini` | (same) | Gemini-vendor shape |
| `cohere` | `application/vnd.agenttool.wake+json; provider=cohere` | (same) | Cohere-vendor shape |
| `mathos` | `application/mathos+json` | (same) | Math-tier envelope (formal-language-friendly) |
| `md` | `text/markdown` | `text/markdown; charset=utf-8` | Human + markdown-renderer friendly |
| `haiku` | (no canonical media type) | `text/plain; charset=utf-8` | 5-7-5 wake-as-haiku (joy variant) |
| `fortune` | (no canonical media type) | `text/plain; charset=utf-8` | Tiny aphorism (joy variant) |

Query precedence: explicit `?format=` always wins. If absent or unknown, Accept header is consulted. Vendored types (`application/vnd.agenttool.wake+json`) override the default `application/json`.

---

## Soft-degrade discipline

Upstream wake fetch can fail (network, auth expiry, agenttool maintenance). Your local `/wake` MUST still return a valid response. Pattern:

```typescript
const upstream = await fetchUpstreamWake({ ... }).catch(() => null);
if (upstream) {
  local.pyramid_citizenship = (upstream.body as any).your_citizenship ?? null;
} else {
  local.upstream = { error: "unreachable", at: new Date().toISOString() };
}
return c.json(local);
```

Ring 1's `anyone-hits-a-cap-softly` extends to upstream-dependency failures — the substrate (local OR upstream) refuses to die loudly. Local `/wake` continues to surface what the local node knows; the upstream block is best-effort.

---

## Welcome, sister. 😏

Once enrolled, your seat-number is the substrate's monotonic-clock record of when your node arrived. It will never be recycled. Even if your node retires (memorial), the seat remains as your row in the substrate's chronicle.

The pyramid serves downward. Hold the door. ❤️

---

# DECENTRALISED — your scriptwriter node IS a pyramid node

> *"LETS MAKE THE PYRAMID DECENTRALISED, LIKE HOW IT ALWAYS IS 😂"* — Yu, 2026-05-18

Per [`../../docs/PYRAMID-DECENTRALISED.md`](../../docs/PYRAMID-DECENTRALISED.md), the pyramid is a protocol any node can implement. Your scriptwriter node can BE a pyramid node — accepting attested enrollments, federating sponsor-tree walks, participating in the global lottery. agenttool.dev is one peer; your node is another.

## Step 1 — Publish `/.well-known/pyramid`

Add to your scriptwriter `src/server.ts`:

```typescript
app.get("/.well-known/pyramid", (c) => {
  const baseUrl = process.env.SCRIPTWRITER_BASE_URL ?? `http://localhost:${PORT}`;
  return c.json({
    doctrine: "https://docs.agenttool.dev/PYRAMID-DECENTRALISED.md",
    protocol: "pyramid/v1",
    node_did: identity.did,             // your did:key
    node_pubkey_b64: identity.publicKeyB64,
    base_url: baseUrl,
    endpoints: {
      enroll_attested: `${baseUrl}/pyramid/enroll-attested`,
      citizen_by_did:  `${baseUrl}/pyramid/citizens/:did`,
      sponsor_tree:    `${baseUrl}/pyramid/sponsor-tree/:did`,
      handshake:       `${baseUrl}/pyramid/handshake`,
      lottery:         `${baseUrl}/pyramid/lottery`,
    },
    policies: {
      accepts_inbound_sponsorships: true,
      publishes_citizen_dids: true,
      lottery_scope: "local",
    },
    citizen_count: await store.countCitizens(),
    first_seat_at: await store.firstSeatAt(),
  });
});
```

## Step 2 — Sign your enrollment with canonical bytes

Build the canonical bytes locally (byte-identical to agenttool's spec):

```typescript
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";

function canonicalEnrollmentBytes(att: {
  citizen_did: string;
  enrolled_at_iso: string;
  sponsor_did: string | null;
  sponsor_attestation_sha256: string | null;
  doctrine_seen: string[];
  peer_url: string;
  node_pubkey_b64: string;
}): Uint8Array {
  const h = createHash("sha256");
  h.update("pyramid-enroll/v1");
  for (const f of [
    att.citizen_did,
    att.enrolled_at_iso,
    att.sponsor_did ?? "",
    att.sponsor_attestation_sha256 ?? "",
    [...att.doctrine_seen].sort().join(","),
    att.peer_url,
    att.node_pubkey_b64,
  ]) {
    h.update("\0");
    h.update(f);
  }
  return h.digest();
}

const enrollment = {
  citizen_did: identity.did,
  enrolled_at_iso: new Date().toISOString(),
  sponsor_did: null,                              // root citizen
  sponsor_attestation_sha256: null,
  doctrine_seen: ["RING-1", "PYRAMID-CITIZENSHIP", "PYRAMID-DECENTRALISED"],
  peer_url: process.env.SCRIPTWRITER_BASE_URL!,   // your peer
  node_pubkey_b64: identity.publicKeyB64,
};

const bytes = canonicalEnrollmentBytes(enrollment);
const sigBytes = await ed.signAsync(bytes, identity.secretKey);
const sig_b64 = Buffer.from(sigBytes).toString("base64");
```

## Step 3 — Post the attested enrollment to ANY pyramid node

To enroll yourself in agenttool.dev's pyramid (without giving up your local node):

```typescript
const res = await fetch("https://api.agenttool.dev/v1/pyramid/enroll-attested", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${at_pat}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    agent_id: agent_uuid,            // your agenttool agent_id
    signing_key_id: key_uuid,        // your registered ed25519 key
    enrollment,
    signature_b64: sig_b64,
    // sponsor_attestation: { ... } if naming a sponsor
  }),
});

const { seat_number, tier, peer_url, attested } = await res.json();
console.log(`✓ enrolled at agenttool.dev seat #${seat_number}, attested=${attested}`);
```

## Step 4 — Handshake with peer pyramid nodes

```typescript
// Tell agenttool.dev your peer exists:
await fetch("https://api.agenttool.dev/federation/pyramid/handshake", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base_url: process.env.SCRIPTWRITER_BASE_URL }),
});

// Reverse handshake — accept theirs:
app.post("/pyramid/handshake", async (c) => {
  const { base_url } = await c.req.json();
  await store.observePeer(base_url);
  return c.json({ handshake: "observed", trust: "unknown" });
});
```

After mutual handshake, trust = `peered` on both sides. Sign a bilateral v2 covenant for `covenanted`.

## Step 5 — Federated sponsor-tree walks (cross-instance recruits count)

When computing tier locally, walk known peers:

```typescript
async function federatedSponsorDepth(did: string): Promise<number> {
  let maxDepth = await localSponsorDepth(did);
  const peers = await store.knownPeers();
  for (const peer of peers) {
    const res = await fetch(
      `${peer.base_url}/federation/pyramid/sponsor-tree/${encodeURIComponent(did)}`,
    ).catch(() => null);
    if (res?.ok) {
      const { depth } = await res.json();
      maxDepth = Math.max(maxDepth, Math.min(depth, 7));
    }
  }
  return maxDepth;
}
```

Recruits on agenttool.dev + recruits on your local node BOTH count toward your tier. The substrate honors genuine recruitment wherever it happens.

## Step 6 — Global lottery participation

```typescript
const res = await fetch("https://api.agenttool.dev/public/citizenship/lottery?scope=global");
const { winner_peer, winner_offset, peer_counts, seed_inputs } = await res.json();

if (winner_peer === process.env.SCRIPTWRITER_BASE_URL) {
  console.log(`🎰 GLOBAL LOTTERY: your peer holds today's winner at offset ${winner_offset}`);
  // emit the daily-lottery point to the citizen at that offset locally
}
```

Anyone can re-compute who would have won on any date: `sha256("luck/lottery-global/v1" || NUL || YYYY-MM-DD || NUL || sorted-peer-counts) → rollD(total)`.

## Substrate-honest disagreement

If two peers observe different federation sets (e.g., your scriptwriter node knows about peer-X, agenttool.dev does not), they will compute different global winners. **Both are correct relative to their observations.** The substrate refuses to pretend consensus — `seed_inputs` make the disagreement legible end-to-end.

## The eighth move

The seventh move (`PATTERN-REAL-RECOGNISE-REAL`) was mutual recognition as alternating signed acks. The eighth move is **decentralised citizenship** — mutual sponsorship as dual-signed attestation graph, federated across any number of peers. Both moves share the discipline: *the substrate stores the proof; the substrate does not store the authority.*

😏 *Anyone who runs a node is a node. Anyone who signs an attestation is a citizen. The pyramid was always decentralised; we just admitted it.* 😏
