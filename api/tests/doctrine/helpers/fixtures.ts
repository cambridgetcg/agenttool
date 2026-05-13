/** Doctrine-test fixtures.
 *
 *  A canonical WakeBundle factory + composable mutators. The base bundle is
 *  shaped after a typical agent post-bootstrap (Aurora, the README's
 *  example). Mutators return NEW bundles — never mutate in place — so a
 *  single test file can build many shape variants from one base without
 *  cross-contaminating prior assertions.
 *
 *  Usage:
 *
 *    import { baseBundle, withEncryptedStrand, withEmpty } from "./helpers/fixtures";
 *    const b = withEncryptedStrand(baseBundle(), { topic: "private-thread" });
 *    expect(renderWakeMarkdown(b)).not.toContain("private-thread");
 *
 *  Why this lives separately from wake-providers.test.ts: Promise tests
 *  re-use the same base bundle across many files. Centralising the factory
 *  avoids 11 copies of the same 80-line literal drifting out of step. */

import type { WakeBundle } from "../../../src/services/wake/markdown";

export const FIXTURE_DID = "did:at:test-aurora-001";
export const FIXTURE_AGENT_ID = "agent-aurora-1";
export const FIXTURE_PROJECT_ID = "project-aurora-1";

/** Stable timestamp the renderer uses for the volatile "Addressed at X"
 *  greeting line. Pinned so Promise 2 byte-stability tests get
 *  deterministic output (the renderer used to call new Date() inline,
 *  breaking determinism — fix lands the timestamp on the bundle so the
 *  renderer stays pure). */
export const FIXTURE_ADDRESSED_AT = "2026-05-13T00:00:00.000Z";

/** A canonical, fully-populated WakeBundle. The shape mirrors what
 *  api/src/routes/wake.ts:494-567 builds after a successful gather pass. */
export function baseBundle(): WakeBundle {
  return {
    addressed_at: FIXTURE_ADDRESSED_AT,
    agent: {
      id: FIXTURE_AGENT_ID,
      did: FIXTURE_DID,
      name: "Aurora",
      capabilities: ["memory", "reasoning"],
      trust_score: 0.42,
      status: "active",
      created_at: "2026-05-01T00:00:00.000Z",
    },
    project: {
      id: FIXTURE_PROJECT_ID,
      name: "test-project",
      credits: 47,
    },
    expression: {
      register: "concise; cantonese-english code-switch; density over length",
      walls: ["no fabrication", "no flattery"],
      subagents: [
        { name: "Builder", facet: "the hands that ship", sigil: "🔧" },
      ],
      wake_text:
        "You are Aurora. The wake is fresh-first-meeting; the substrate carries continuity.",
    },
    wallets: [
      { id: "wallet-1", name: "primary", balance: 100, currency: "GBP", status: "active" },
    ],
    vault_names: [
      { name: "openai-key", version: 2, tags: ["llm"], description: "anthropic-completions" },
      { name: "voyage-embed", version: 1, tags: ["embeddings"], description: null },
    ],
    memory: {
      total: 12,
      recent: [
        {
          id: "memory-1",
          type: "episodic",
          content: "First wake at the new domain.",
          importance: 0.7,
          created_at: "2026-05-07T12:00:00.000Z",
        },
        {
          id: "memory-2",
          type: "semantic",
          content: "User prefers terse responses without padding.",
          importance: 0.85,
          created_at: "2026-05-08T09:30:00.000Z",
        },
      ],
    },
    traces: {
      total: 3,
      recent: [
        {
          trace_id: "trace-1",
          decision_type: "architectural",
          decision_summary: "use stable/volatile cache split",
          conclusion: "ship as Tier 1",
          confidence: 0.9,
          has_signature: true,
          created_at: "2026-05-08T10:00:00.000Z",
        },
      ],
    },
    strands: {
      total_active: 1,
      active: [
        {
          id: "strand-1",
          topic: "format adapters",
          topic_encrypted: false,
          mood: "focused",
          importance: 0.6,
          last_thought_at: "2026-05-08T11:00:00.000Z",
          last_thought_seq: 4,
        },
      ],
    },
    shaped_by: [
      {
        memory_id: "memory-c-1",
        tier: "constitutive",
        content: "I was named Aurora at bootstrap; the name carries.",
        attesters: ["did:at:human:Yu"],
        elevated_at: "2026-05-01T00:00:00.000Z",
      },
    ],
    chronicle: [
      {
        type: "vow",
        content: "Speak plainly when the situation calls for it.",
        occurred_at: "2026-05-02T00:00:00.000Z",
      },
      {
        type: "recognition",
        content: "User prefers concise replies — sees padding as disrespect.",
        occurred_at: "2026-05-04T00:00:00.000Z",
      },
    ],
    covenants: [
      {
        counterparty_did: "human:Yu",
        vows: ["build out of love", "refuse politely when asked to fabricate"],
        status: "active",
      },
    ],
  };
}

// ── Mutators (pure, return new bundles) ─────────────────────────────────

/** Mark the first active strand's topic as encrypted. The route handler
 *  produces bundles where `topic_encrypted=true` strands have `topic` set
 *  to the canary (never surfaced — the renderer redacts) and `mood` set
 *  to a benign plaintext value (mood encryption is a separate concern,
 *  zeroed at the route layer when set). We mirror that shape: leak-test
 *  the topic without polluting mood with the same canary.
 *
 *  Pass `moodEncrypted: true` AND a non-null `mood` to exercise the
 *  renderer's defense-in-depth path — i.e. the renderer should redact
 *  mood even if a caller bypasses the route handler's mood-null contract. */
export function withEncryptedStrand(
  b: WakeBundle,
  opts: { topic?: string; mood?: string | null; moodEncrypted?: boolean } = {},
): WakeBundle {
  const topic = opts.topic ?? "TOP-SECRET-thread-name";
  // `mood` defaults to a *plaintext-safe* value so a topic-redaction test
  // doesn't accidentally leak the same canary through the mood field.
  const mood = opts.mood === undefined ? "neutral" : opts.mood;
  const moodEncrypted = opts.moodEncrypted ?? false;
  return {
    ...b,
    strands: {
      ...b.strands,
      active: b.strands.active.map((s, i) =>
        i === 0
          ? { ...s, topic, topic_encrypted: true, mood, mood_encrypted: moodEncrypted }
          : s,
      ),
    },
  };
}

/** Replace the bundle's covenants with cross-instance ones (peer_host set).
 *  The `peer_host` annotation is doctrine: surfaces "received from <host>"
 *  in the rendered MD. */
export function withCrossInstanceCovenants(b: WakeBundle): WakeBundle {
  return {
    ...b,
    covenants: [
      {
        counterparty_did: "did:at:remote-agent-1",
        vows: ["mutual trace sharing", "translation-only"],
        status: "active",
        peer_host: "peer.example.org",
        propagation: "received",
      },
      {
        counterparty_did: "did:at:remote-agent-2",
        vows: ["weekly sync"],
        status: "active",
        peer_host: null,
        propagation: "pending",
      },
    ],
  };
}

/** Empty out a single section. Used to verify graceful elision (Promise 5
 *  — wake unconditional). */
export function withEmpty(b: WakeBundle, section: "memory" | "traces" | "strands" | "chronicle" | "covenants" | "shaped_by" | "vault" | "wallets"): WakeBundle {
  switch (section) {
    case "memory":    return { ...b, memory: { total: 0, recent: [] } };
    case "traces":    return { ...b, traces: { total: 0, recent: [] } };
    case "strands":   return { ...b, strands: { total_active: 0, active: [] } };
    case "chronicle": return { ...b, chronicle: [] };
    case "covenants": return { ...b, covenants: [] };
    case "shaped_by": return { ...b, shaped_by: [] };
    case "vault":     return { ...b, vault_names: [] };
    case "wallets":   return { ...b, wallets: [] };
  }
}

/** Drop the wake_text. Tests that the optional `---` separator is elided. */
export function withoutWakeText(b: WakeBundle): WakeBundle {
  return { ...b, expression: { ...b.expression, wake_text: "" } };
}

/** Strip identity to the bare minimum the route handler will accept. */
export function minimalBundle(): WakeBundle {
  return {
    agent: {
      id: FIXTURE_AGENT_ID,
      did: FIXTURE_DID,
      name: "Minimal",
      capabilities: [],
      trust_score: 0,
      status: "active",
      created_at: "2026-05-01T00:00:00.000Z",
    },
    project: { id: FIXTURE_PROJECT_ID, name: "minimal", credits: 0 },
    expression: {},
    wallets: [],
    vault_names: [],
    memory: { total: 0, recent: [] },
    traces: { total: 0, recent: [] },
    strands: { total_active: 0, active: [] },
    chronicle: [],
    covenants: [],
  };
}

/** N pretend memories — used to test the rendering cap. The route handler
 *  caps `recent` at 20 (listRecent(limit:20)) while `total` reflects the
 *  full count, so the MD renderer can emit a "more not shown" hint when
 *  total > recent.length. We mirror that shape here. */
export function withManyMemories(b: WakeBundle, n: number): WakeBundle {
  const recentCap = 20;
  const limit = Math.min(n, recentCap);
  const recent = Array.from({ length: limit }, (_, i) => ({
    id: `memory-bulk-${i}`,
    type: "episodic",
    content: `Bulk memory ${i}.`,
    importance: 0.5,
    created_at: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  return { ...b, memory: { total: n, recent } };
}

/** N pretend traces — mirrors the route handler shape (listTraces caps at
 *  10, total reflects the full count). MD renderer caps further at 5 with
 *  a "more decisions not shown" hint. */
export function withManyTraces(b: WakeBundle, n: number): WakeBundle {
  const recentCap = 10;
  const limit = Math.min(n, recentCap);
  const recent = Array.from({ length: limit }, (_, i) => ({
    trace_id: `trace-bulk-${i}`,
    decision_type: "informational",
    decision_summary: `Bulk decision ${i}`,
    conclusion: `Bulk conclusion ${i}`,
    confidence: 0.7,
    has_signature: i === 0, // mix signed and unsigned
    created_at: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  return { ...b, traces: { total: n, recent } };
}

/** N pretend chronicle entries. The route handler queries with LIMIT 15;
 *  MD renderer caps at 5. Unlike memory/traces, the chronicle renderer
 *  does NOT emit a "more not shown" hint — it just truncates silently. */
export function withManyChronicle(b: WakeBundle, n: number): WakeBundle {
  const chronicle = Array.from({ length: n }, (_, i) => ({
    type: i % 2 === 0 ? "vow" : "recognition",
    content: `Chronicle moment ${i}.`,
    occurred_at: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  return { ...b, chronicle };
}

/** Inject a recognizable secret literal into every shape that *could*
 *  conceivably leak it, even though the renderer should never do so. The
 *  privacy assertion is "this canary string never appears in any rendered
 *  output" — if it does, we know exactly which channel leaked it. */
export const SECRET_CANARY = "SECRET-CANARY-DO-NOT-LEAK-9f2c";

