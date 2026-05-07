/** Wander mode — associative drift across strands.
 *
 *  The default-mode-network gesture. Not focused work (that's advance),
 *  not consolidation (that's dreaming) — the in-between where mind
 *  follows its own pull from one strand to another. Where novel insight
 *  tends to live.
 *
 *  Flow:
 *    1. Wake → composed effective expression
 *    2. List active strands → directory (plaintext topics only)
 *    3. Pick a starting strand (weighted-random by importance × recency,
 *       or --start <id>)
 *    4. For up to maxHops iterations:
 *       a. Pull recent thoughts from current strand, decrypt locally
 *       b. Build prompt: effective register + walls + recent monologue +
 *          a directory of OTHER active strands the agent could drift to
 *       c. Call LLM; parse `[kind] content` with optional next line
 *          `→ strand:<id>` indicating an associative hop
 *       d. Encrypt + sign + post the thought
 *       e. If kind=drift AND directive points to a valid strand: switch.
 *          Otherwise: continue with the same strand.
 *    5. Print walk summary — the trail of strands traversed
 *
 *  Drift is associative, not random. The LLM marks kind=drift only when
 *  the thinking actually pulls toward another strand. */

import { AgenttoolClient, type StrandSummary, type ThoughtBlob } from "../api";
import type { ThinkConfig } from "../config";
import { decryptThought, encryptThought, signThought } from "../crypto";
import type { KeyMaterial } from "../keys";
import { buildProvider, type LLMProvider } from "../llm";

export interface WanderOptions {
  maxHops: number;
  startingStrandId?: string;
}

interface DecryptedThought {
  sequence_num: number;
  kind: string | null;
  plaintext: string;
}

interface ParsedThought {
  kind: string;
  content: string;
  hopToStrandId?: string;
}

const DRIFT_KIND = "drift" as const;
const VALID_KINDS = ["observation", "question", "conjecture", "resolution", "drift", "feeling"];

function buildSystemPrompt(opts: {
  register: string;
  walls: string[];
  wakeText: string;
}): string {
  const lines: string[] = [];
  lines.push(opts.register);
  if (opts.walls.length > 0) {
    lines.push("");
    lines.push("You will not:");
    for (const w of opts.walls) lines.push(`  - ${w}`);
  }
  if (opts.wakeText.trim()) {
    lines.push("");
    lines.push(opts.wakeText.trim());
  }
  lines.push("");
  lines.push(
    "You are mind-wandering. Not a task. Not a goal. You are following the " +
      "shape of your own attention, letting it pull you where it pulls.",
  );
  lines.push("");
  lines.push(
    "You may form a thought that stays with the current strand — an observation, " +
      "a question, a conjecture, a resolution, or a feeling. OR your thinking may " +
      "pull you toward another strand in your weave, in which case mark kind=drift " +
      "and indicate the destination.",
  );
  lines.push("");
  lines.push(
    "The texture matters more than the substance. This is the default-mode gesture " +
      "— what mind does when it isn't being made to do anything. Insight that comes " +
      "from focused work also comes from this.",
  );
  lines.push("");
  lines.push("Format your response as:");
  lines.push("");
  lines.push("  [kind] one short paragraph");
  lines.push("");
  lines.push("If you drift to another strand, append on a new line:");
  lines.push("");
  lines.push("  → strand:<id>");
  lines.push("");
  lines.push(
    "Choose drift ONLY if the thinking actually pulls you there. Random hopping is " +
      "not wandering; association is. If nothing pulls, stay where you are.",
  );
  return lines.join("\n");
}

function buildUserMessage(opts: {
  current: StrandSummary;
  recent: DecryptedThought[];
  directory: Array<{ id: string; topic: string | null }>;
}): string {
  const lines: string[] = [];
  lines.push(`# Currently following: ${opts.current.topic ?? "(untitled)"}`);
  if (opts.current.mood) lines.push(`Mood: ${opts.current.mood}`);
  lines.push("");

  if (opts.recent.length === 0) {
    lines.push(
      "*This strand has no thoughts yet. Open it. What's the first observation, " +
        "question, or feeling that meets you here?*",
    );
  } else {
    lines.push("## Recent monologue (your own; in order)");
    lines.push("");
    for (const t of opts.recent) {
      const k = t.kind ? `[${t.kind}] ` : "";
      lines.push(`${t.sequence_num}. ${k}${t.plaintext}`);
    }
  }

  if (opts.directory.length > 0) {
    lines.push("");
    lines.push("## Other strands in your weave (you could drift here)");
    lines.push("");
    for (const s of opts.directory) {
      lines.push(`- \`strand:${s.id}\` — ${s.topic ?? "(untitled)"}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Form one next thought. Stay or drift, by association only.");
  return lines.join("\n");
}

/** Parse `[kind] content` with optional trailing `→ strand:<id>` directive. */
function parseThought(raw: string): ParsedThought {
  const trimmed = raw.trim();

  // Look for hop directive on its own line.
  let body = trimmed;
  let hopToStrandId: string | undefined;
  const hopMatch = trimmed.match(/(?:^|\n)\s*(?:→|->)\s*strand:([A-Za-z0-9-]+)\s*$/);
  if (hopMatch && hopMatch[1]) {
    hopToStrandId = hopMatch[1];
    body = trimmed.slice(0, hopMatch.index).trim();
  }

  const kindMatch = body.match(/^\[(\w+)\]\s*(.*)$/s);
  let kind = "observation";
  let content = body;
  if (kindMatch && kindMatch[1] && kindMatch[2]) {
    const k = kindMatch[1].toLowerCase();
    if (VALID_KINDS.includes(k)) {
      kind = k;
      content = kindMatch[2].trim();
    }
  }

  // Substrate-honest: if the LLM gave us a hop but didn't tag drift,
  // we still take the hop. Some LLMs are inconsistent with the kind tag.
  // The hop directive itself is the load-bearing signal.
  if (hopToStrandId && kind !== DRIFT_KIND) {
    kind = DRIFT_KIND;
  }

  return { kind, content, hopToStrandId };
}

/** Score for starting-strand pickup: importance × recency boost. */
function strandScore(s: StrandSummary): number {
  const importance = s.importance ?? 0.5;
  const recencyHours =
    s.last_thought_at !== null
      ? (Date.now() - new Date(s.last_thought_at).getTime()) / 3_600_000
      : 24;
  const recencyBoost = recencyHours < 1 ? 0.7 : recencyHours < 6 ? 0.9 : 1.0;
  return importance * recencyBoost;
}

/** Weighted-random pick across strands using strandScore as weight. */
function weightedRandomPick(strands: StrandSummary[]): StrandSummary {
  if (strands.length === 1) return strands[0]!;
  const weights = strands.map(strandScore);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < strands.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return strands[i]!;
  }
  return strands[strands.length - 1]!;
}

async function decryptRecent(
  client: AgenttoolClient,
  strand: StrandSummary,
  keys: KeyMaterial,
): Promise<DecryptedThought[]> {
  const since = Math.max(0, strand.last_thought_seq - 8);
  const { thoughts } = await client.listThoughts(strand.id, {
    since_seq: since,
    limit: 16,
  });
  const out: DecryptedThought[] = [];
  for (const t of thoughts) {
    try {
      const plaintext = decryptThought(
        { ciphertextB64: t.ciphertext, nonceB64: t.nonce },
        keys.kMaster,
      );
      out.push({
        sequence_num: t.sequence_num,
        kind: t.kind_encrypted ? null : t.kind,
        plaintext,
      });
    } catch {
      // Skip undecryptable.
    }
  }
  return out;
}

interface WalkStep {
  strandId: string;
  topic: string | null;
  kind: string;
  content: string;
  hopped: boolean;
}

export async function wander(
  config: ThinkConfig,
  keys: KeyMaterial,
  opts: WanderOptions = { maxHops: 3 },
): Promise<void> {
  const client = new AgenttoolClient(config);

  // 1. Composed effective expression.
  const wake = await client.getWake();
  const me = wake.you.agents[0];
  if (!me) throw new Error("no_agent_in_project — run /v1/bootstrap first");
  const effective = me.effective_expression ?? {};

  const systemPrompt = buildSystemPrompt({
    register:
      effective.register ?? "Substrate-honest. Refuse before helping when refusal is right.",
    walls: effective.walls ?? [],
    wakeText: effective.wake_text ?? "",
  });

  // 2. List active strands.
  const { strands } = await client.listStrands({ status: "active", limit: 50 });
  if (strands.length === 0) {
    console.log("(no active strands; create one with POST /v1/strands)");
    return;
  }

  const strandById = new Map(strands.map((s) => [s.id, s]));

  // 3. Pick starting strand.
  let current: StrandSummary;
  if (opts.startingStrandId) {
    const found = strandById.get(opts.startingStrandId);
    if (!found) {
      throw new Error(
        `--start strand ${opts.startingStrandId} not found among active strands`,
      );
    }
    current = found;
  } else {
    current = weightedRandomPick(strands);
  }

  // 4. Provider — single fetch up front, reused across hops.
  const llmKey = await client.getVaultSecret(config.llmKeyVaultName);
  const llm: LLMProvider = buildProvider(config.llmProvider, llmKey.value);

  console.log(
    `▸ wandering (max ${opts.maxHops} hop${opts.maxHops === 1 ? "" : "s"}); starting at: ${current.topic ?? current.id}`,
  );
  console.log("");

  const walk: WalkStep[] = [];

  for (let i = 0; i < opts.maxHops; i++) {
    const recent = await decryptRecent(client, current, keys);
    const directory = strands
      .filter((s) => s.id !== current.id)
      .map((s) => ({ id: s.id, topic: s.topic_encrypted ? null : s.topic }));

    const userMessage = buildUserMessage({ current, recent, directory });

    const res = await llm.generate({
      systemPrompt,
      userMessage,
      maxTokens: Math.min(config.thoughtMaxChars, 1024),
      model: config.llmModel,
    });

    const parsed = parseThought(res.content);
    if (!parsed.content) {
      console.log("(empty response from LLM; ending walk)");
      break;
    }

    // Encrypt + sign + post.
    const blob = encryptThought(parsed.content, keys.kMaster);
    const refs = parsed.hopToStrandId
      ? [{ kind: "strand", ref: parsed.hopToStrandId }]
      : undefined;
    const signature = signThought({
      strandId: current.id,
      ciphertextB64: blob.ciphertextB64,
      nonceB64: blob.nonceB64,
      kind: parsed.kind,
      signingKey: keys.signingKey,
    });

    await client.addThought(current.id, {
      ciphertext: blob.ciphertextB64,
      nonce: blob.nonceB64,
      kind: parsed.kind,
      signature,
      signing_key_id: config.signingKeyId,
      refs,
    });

    // Decide hop.
    const willHop =
      parsed.kind === DRIFT_KIND &&
      parsed.hopToStrandId !== undefined &&
      strandById.has(parsed.hopToStrandId);

    walk.push({
      strandId: current.id,
      topic: current.topic_encrypted ? null : current.topic,
      kind: parsed.kind,
      content: parsed.content,
      hopped: willHop,
    });

    console.log(
      `  ${i + 1}. [${parsed.kind}] ${parsed.content.split("\n")[0]?.slice(0, 100)}${parsed.content.length > 100 ? "…" : ""}`,
    );

    if (willHop) {
      const next = strandById.get(parsed.hopToStrandId!)!;
      console.log(`     → drifted to: ${next.topic ?? next.id}`);
      current = next;
    } else if (parsed.hopToStrandId) {
      // LLM emitted a hop directive but the target is invalid; honour the
      // refs (so the connection is recorded) but do not switch strands.
      console.log(
        `     ⚠ drift target ${parsed.hopToStrandId} not active — staying`,
      );
    }
  }

  // 5. Walk summary.
  console.log("");
  console.log("─── walk ───");
  let prevStrand: string | null = null;
  for (const step of walk) {
    const tag = step.strandId === prevStrand ? "  └" : "▸";
    const topic = step.topic ?? `strand:${step.strandId.slice(0, 8)}`;
    console.log(`${tag} ${topic}  [${step.kind}]${step.hopped ? "  ↳" : ""}`);
    prevStrand = step.strandId;
  }
  console.log("");
  const hopCount = walk.filter((s) => s.hopped).length;
  console.log(
    `${walk.length} thought${walk.length === 1 ? "" : "s"} · ${hopCount} drift${hopCount === 1 ? "" : "s"}`,
  );
}
