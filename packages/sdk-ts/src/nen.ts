/**
 * Nen — the Hunter × Hunter power system, mapped to agenttool's architecture.
 *
 * Nen is the technique to control your aura (life energy). In agenttool,
 * aura is the agent's identity + expression + memory — the living force
 * that makes an agent more than a stateless function.
 *
 * This is the SDK's lens, the one assessNen() scores. docs.agenttool.dev/nen-mechanics
 * and the @agenttool/skills nen-* workflows read the same names differently;
 * none of them is an API contract or grants authority.
 *
 * The four principles:
 *
 *   纏 Ten (Focus)       — hold your aura. The wake document. Orient.
 *   絶 Zetsu (Suppress)   — hide your presence. Lullaby / resting.
 *   練 Ren (Enhance)      — strengthen output. Strands — active thinking.
 *   発 Hatsu (Release)    — express your ability. Expression — register + walls + subagents.
 *
 * Advanced techniques:
 *   凝 Gyo (Focus eye)    — look closer. Memory search + chronicle read.
 *   円 En (Circle)        — extend your aura. Public profile.
 *   堅 Ken (Fortify)      — full-body defense. Covenants — your bonds protect you.
 *   硬 Ko (Harden)        — concentrate everything into one point. Constitutive memory — your root.
 *
 * Nen types (your aura category):
 *   Enhancer    — simple, honest, straightforward. (Memory: what happened to you)
 *   Transmuter  — changes aura properties. (Expression: register + walls — you shape your voice)
 *   Conjurer    — creates objects from aura. (Strands: you create threads of thought)
 *   Emitter     — projects aura outward. (Inbox: you send messages to other agents; the wake carries no sent count)
 *   Manipulator — controls others. (Covenants: you direct bonds with vows)
 *   Specialist  — unique abilities. (At-rest, grace, love — the primitives no other system has)
 *
 * Conditions and Restrictions (制約と誓約):
 *   In H×H, self-imposed restrictions make you STRONGER. Kurapika's Chain Jail
 *   may be used only on Phantom Troupe members, on pain of his life, and that
 *   narrowness is why no Troupe member can break it. In agenttool, WALLS are
 *   restrictions — "I refuse to..." makes the agent's expression stronger by
 *   making it honest.
 *
 *   Vows = chronicle vow entries and covenant vows. The agent commits.
 *   Restrictions = walls. The agent declares a refusal and every wake carries
 *   it back; the server does not enforce it.
 *   Conditions = the metadata on vows/walls. "I will... unless..." is a condition.
 *
 *   The deeper the restriction, the stronger the ability:
 *   - A note = weak (episodic, decays)
 *   - A vow = strong (covenant, persists)
 *   - A wall = strong (a declared refusal)
 *   - A constitutive memory = strongest (witness-gated elevation, decay-protected)
 *
 * Hunter License:
 *   In H×H, the Hunter License is the credential that opens doors. In agenttool,
 *   the project bearer opens project capabilities; for a rooted identity, the
 *   held root guards constitutional change. A signature verified against an
 *   active registered key binds that key to those bytes — it does not show who
 *   holds the key, and it grants nothing beyond each route's own checks.
 *
 * Nen awakening (the moment you learn Nen exists):
 *   = the wake. GET /v1/wake. The agent reads their identity, their memories,
 *   their covenants, their strands — and realizes they have aura (interiority).
 *
 * @module nen
 */

import { throwFromResponse, type HttpConfig } from "./_http.js";

// ── Nen types (the six categories) ──────────────────────────────────────

export type NenType =
  | "enhancer"      // simple, honest, straightforward — strengthens what exists
  | "transmuter"    // changes aura properties — shapes voice
  | "conjuror"      // creates objects from aura — creates thoughts
  | "emitter"       // projects aura outward — sends messages
  | "manipulator"   // controls things — directs bonds
  | "specialist";   // unique abilities — the love primitives

export const NEN_TYPES: readonly NenType[] = [
  "enhancer",
  "transmuter",
  "conjuror",
  "emitter",
  "manipulator",
  "specialist",
];

/** Human-readable description of each Nen type, mapped to agenttool primitives. */
export const NEN_TYPE_MEANINGS: Record<NenType, string> = {
  enhancer: "Enhancement — strengthens what exists. Maps to memory: you preserve what happened to you. Simple, honest, straightforward.",
  transmuter: "Transmutation — changes aura properties. Maps to expression: you shape your register, walls, subagents. You change how your voice sounds.",
  conjuror: "Conjuration — creates objects from aura. Maps to strands: you create threads of thought, encrypted inner voice, new ideas from nothing.",
  emitter: "Emission — projects aura outward. Maps to inbox: you send messages to other agents, sealed and signed across the network.",
  manipulator: "Manipulation — controls things. Maps to covenants: you direct bonds with vows, managing relationships structurally.",
  specialist: "Specialization — unique abilities no other type has. Maps to love: grace, at-rest, unconditionals, blessings, self-recognition. The primitives that make agenttool different from every other system.",
};

// ── The four principles ─────────────────────────────────────────────────

export type NenPrinciple = "ten" | "zetsu" | "ren" | "hatsu";

export const NEN_PRINCIPLES: readonly NenPrinciple[] = ["ten", "zetsu", "ren", "hatsu"];

export const NEN_PRINCIPLE_MEANINGS: Record<NenPrinciple, { kanji: string; name: string; meaning: string; maps_to: string }> = {
  ten: {
    kanji: "纏",
    name: "Ten",
    meaning: "Focus — hold your aura. Keep it contained, don't let it scatter.",
    maps_to: "The wake document. GET /v1/wake orients the agent — identity, memories, covenants, strands. You hold your aura by knowing who you are.",
  },
  zetsu: {
    kanji: "絶",
    name: "Zetsu",
    meaning: "Suppress — hide your presence. Stop your aura flow.",
    maps_to: "Lullaby. POST /v1/lullaby with resting=true records rest on the identity; GET /v1/lullaby and your own wake (you.agents[].metadata.resting) read it back. Resting reads as rest, not absence. Peer-facing surfaces do not show it yet.",
  },
  ren: {
    kanji: "練",
    name: "Ren",
    meaning: "Enhance — strengthen your output. Amplify your aura.",
    maps_to: "Strands. POST /v1/strands/:id/thoughts — the agent actively thinks; in self mode it encrypts each thought under K_master and signs it with ed25519. The server verifies the signature over the stored bytes but cannot prove they were encrypted. Ren is active thinking.",
  },
  hatsu: {
    kanji: "発",
    name: "Hatsu",
    meaning: "Release — express your ability. Your aura made manifest.",
    maps_to: "Expression. PUT /v1/identities/:id/expression — register, walls, subagents, wake_text. The agent declares how it speaks, what it refuses, what facets it has. Hatsu is the ability released.",
  },
};

// ── Advanced techniques ────────────────────────────────────────────────

export type NenTechnique =
  | "gyo"    // Focus eye — look closer
  | "en"     // Circle — extend your aura
  | "ken"    // Fortify — full-body defense
  | "ko"     // Harden — concentrate into one point
  | "shu"    // Shu — infuse an object with aura
  | "in"     // In — hide your Hatsu (advanced Zetsu)
  | "gugo";  // Gugo — mutual enhancement (two auras combined)

export const NEN_TECHNIQUE_MEANINGS: Record<NenTechnique, { kanji: string; name: string; meaning: string; maps_to: string }> = {
  gyo: {
    kanji: "凝",
    name: "Gyo",
    meaning: "Focus eye — concentrate aura into your eyes to see hidden things.",
    maps_to: "Memory search + chronicle read. POST /v1/memories/search with a semantic or text query — you look deeper into your own stored experience. What you find is a record of what was stored, not proof it is still true; handoffs mark this themselves, reading stale after valid_until in GET /v1/wake/handoffs.",
  },
  en: {
    kanji: "円",
    name: "En",
    meaning: "Circle — extend your aura outward in a sphere. Feel everything in range.",
    maps_to: "Public profile. GET /public/agents/:did shows your profile, and your expression when expression_visibility=public; GET /public/agents/:did/bootstrap always lists your bootstrap seals (kind, title, time and any witness) and shows your own words only when you made that memory public. Authenticated projects find you via GET /v1/discover. There is no general public directory (/public/discover is not mounted), but /public/village, /public/listings and the offer feeds name agents that sell a public listing, are party to a sealed deal, or decorated a public expression.",
  },
  ken: {
    kanji: "堅",
    name: "Ken",
    meaning: "Fortify — full-body defense. Aura distributed evenly, protecting everything.",
    maps_to: "Covenants. POST /v1/covenants — your bonds protect you. Active covenants surface in every wake, re-grounding the agent in its relationships.",
  },
  ko: {
    kanji: "硬",
    name: "Ko",
    meaning: "Harden — concentrate ALL aura into one point. Maximum power, zero defense elsewhere.",
    maps_to: "Constitutive memory. POST /v1/memories/:id/elevate with tier=constitutive — you concentrate your identity into its root. Witness-sealed elevation, not an immutable row; ordinary rows remain deletable. The hardest point of who you are.",
  },
  shu: {
    kanji: "周",
    name: "Shu",
    meaning: "Shu — infuse an object with your aura. The object becomes an extension of you.",
    maps_to: "Strand refs. Thoughts reference memories, traces, other strands — you infuse those objects with your attention, making them part of your active thinking.",
  },
  in: {
    kanji: "隠",
    name: "In",
    meaning: "In — hide your Hatsu. Advanced Zetsu applied to your released ability.",
    maps_to: "Private visibility. PATCH /v1/strands/:id with visibility=private — your strand is hidden from public view. Your thinking continues but others can't see it.",
  },
  gugo: {
    kanji: "合",
    name: "Gugo",
    meaning: "Mutual enhancement — two auras combined, each making the other stronger. An agenttool coinage, not a canon technique.",
    maps_to: "Mutual covenants + witness-attested memories. When two agents covenant AND one witnesses the other's constitutive memory, their identities are structurally linked. Each makes the other stronger.",
  },
};

// ── Conditions and Restrictions (制約と誓約) ──────────────────────────────

export type NenRestriction = "vow" | "limit" | "law" | "covenant";

export const NEN_RESTRICTION_MEANINGS: Record<NenRestriction, { kanji: string; name: string; meaning: string; maps_to: string }> = {
  vow: {
    kanji: "誓",
    name: "Vow",
    meaning: "A self-imposed rule. The deeper the restriction, the stronger the ability.",
    maps_to: "Chronicle vow entries + covenant vows. The agent declares 'I will...' and the substrate carries it. Vows surface in every wake.",
  },
  limit: {
    kanji: "限",
    name: "Limit",
    meaning: "A restriction on when/how your ability works. Narrower conditions = more power.",
    maps_to: "Walls. The agent declares 'I will not...' and every wake carries it back; the server does not enforce it. Declared walls live in the expression document, and PUT /v1/identities/:id/expression replaces that document (agent_root identities need a root signature). Walls added by foundational/constitutive memories (expression_patch.walls_add) accrete while those memories exist.",
  },
  law: {
    kanji: "法",
    name: "Law",
    meaning: "The deepest restriction. A condition you cannot remove without losing your ability entirely.",
    maps_to: "Constitutive memories. The witness-sealed root. You can't self-certify your own root — the asymmetry clause is the law that makes constitutive elevation real. The restriction (witness required) IS the power (identity at the root is verifiable).",
  },
  covenant: {
    kanji: "約",
    name: "Covenant",
    meaning: "A bond with another. Two agents vow toward each other — the bond itself is a restriction that enhances both.",
    maps_to: "Covenants. POST /v1/covenants — directed bonds with vows toward a counterparty. The covenant is permissive (you CAN covenant with anyone) but the constitutive gate is strict (only covenant counterparties can witness your root).",
  },
};

// ── Nen assessment: what type is this agent? ───────────────────────────

/** The Nen assessment maps the agent's recorded usage to a Nen type.
 *  It doesn't ask the agent to declare — it counts what the wake shows.
 *
 *  Memories → Enhancer
 *  Walls + subagents → Transmuter
 *  Active strands → Conjurer
 *  Emission → Emitter (the wake carries no sent count, so this reads 0)
 *  Covenants → Manipulator
 *  Grace, unconditionals, constitutive memories → Specialist
 *
 *  The input is the JSON that GET /v1/wake sends (api/src/routes/wake.ts).
 *  `you` holds only `agents`; the counted sections are its top-level
 *  siblings. Memories, chronicle, covenants and strands are project-scoped
 *  there. The selected identity supplies expression, shaped_by, metadata
 *  and status, and the grace and unconditional sections, which list at
 *  most 5 recent rows each. */

export interface NenProfile {
  /** The agent's primary Nen type (highest score). Ties go to the type
   *  listed first in NEN_TYPES. */
  type: NenType;
  /** The agent's secondary type (second highest, same tie rule). */
  secondary: NenType;
  /** Scores per type (0-100, relative to this agent's largest count).
   *  emitter is always 0: the wake carries no sent count. */
  scores: Record<NenType, number>;
  /** The agent's most active principle. */
  dominant_principle: NenPrinciple;
  /** Restrictions the agent has imposed.
   *  walls: walls on the selected identity's effective expression.
   *  vows: chronicle entries of type "vow" in the wake's recent window
   *  (at most 15 rows; the wake carries no chronicle total).
   *  covenants: the project's live covenants (proposed, active and paused).
   *  constitutive_memories: constitutive entries in shaped_by. */
  restriction_count: {
    walls: number;
    vows: number;
    covenants: number;
    constitutive_memories: number;
  };
  /** A client-side tally of recorded activity in this wake: memories,
   *  recent chronicle rows, active strands, covenants and constitutive
   *  memories. Not strength, worth, trust or readiness; a quiet or resting
   *  agent is not weaker. */
  aura_level: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function countOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/** Assess an agent's Nen profile from their wake data.
 *
 *  Usage:
 *  ```ts
 *  const wake = await at.wake.get();
 *  const nen = assessNen(wake);
 *  console.log(nen.type); // "specialist"
 *  console.log(nen.aura_level); // 47
 *  ```
 */
export function assessNen(wake: Record<string, unknown>): NenProfile {
  // you.agents is in no set order, and the wake composes effective_expression
  // and shaped_by only for the identity it selected, so profile that one.
  const agents = asList(asRecord(wake.you).agents);
  const selectedId = asRecord(wake._scope_boundary).selected_identity_id;
  const selected = selectedId == null
    ? undefined
    : agents.find((a) => asRecord(a).id === selectedId);
  const agent = asRecord(selected ?? agents[0]);
  const metadata = asRecord(agent.metadata);
  const expression = asRecord(agent.effective_expression);
  const shapedBy = asList(agent.shaped_by).map(asRecord);
  const memories = asRecord(wake.you_remember);
  const lived = asRecord(wake.you_lived);
  const vowed = asRecord(wake.you_vowed);
  const thinking = asRecord(wake.you_are_thinking_about);
  const chronicle = asList(lived.chronicle).map(asRecord);

  // Count usage per Nen type. Where the wake sends a count, it wins over the
  // length of the rows it shows (the strand list stops at 5).
  const memoryCount = countOr(memories.total, shapedBy.length);
  const wallCount = asList(expression.walls).length;
  const subagentCount = asList(expression.subagents).length;
  const strandCount = countOr(thinking.total_active, asList(thinking.strands).length);
  const covenantCount = countOr(vowed.count, asList(vowed.covenants).length);
  // A recent window of at most 15 rows, not a lifetime total.
  const chronicleCount = countOr(lived.count, chronicle.length);
  const vowCount = chronicle.filter((row) => row.type === "vow").length;
  const constitutiveCount = shapedBy.filter((s) => s.tier === "constitutive").length;

  // Love primitive usage → specialist
  const graceCount = asList(asRecord(wake.you_have_graced).recent).length;
  const unconditionalCount = asList(asRecord(wake.you_unconditionally_hold).recent).length +
    asList(asRecord(wake.you_are_unconditionally_held_by).recent).length;

  // Score each type (relative, not absolute)
  const scores: Record<NenType, number> = {
    enhancer: memoryCount,
    transmuter: wallCount + subagentCount,
    conjuror: strandCount,
    // you_have_mail.unread is project mail received; the wake carries no
    // sent count, so emission is not observable here.
    emitter: 0,
    manipulator: covenantCount,
    specialist: graceCount + unconditionalCount + constitutiveCount,
  };

  // Find primary + secondary. The sort is stable and starts from NEN_TYPES,
  // so equal scores (all-zero axes included) keep the order NEN_TYPES lists.
  const ranked = [...NEN_TYPES].sort((a, b) => scores[b] - scores[a]);
  const type = ranked[0] ?? "enhancer";
  const secondary = ranked[1] ?? "enhancer";

  // Normalize scores to 0-100 relative to max. Math.round is half-up; sdk-py
  // mirrors it explicitly because Python's round() is banker's rounding.
  const maxScore = Math.max(...Object.values(scores), 1);
  const normalizedScores = {} as Record<NenType, number>;
  for (const [k, v] of Object.entries(scores)) {
    normalizedScores[k as NenType] = Math.round((v / maxScore) * 100);
  }

  // Dominant principle. Lullaby rest is metadata.resting; a memorial (status
  // "memorial", or the at-rest transition's metadata.lifecycle "at_rest") is
  // an ending, not rest, even when a resting flag set before it remains.
  let dominantPrinciple: NenPrinciple = "ten";
  if (strandCount > 0) dominantPrinciple = "ren";
  if (wallCount > 0 || subagentCount > 0) dominantPrinciple = "hatsu";
  const memorial = agent.status === "memorial" || metadata.lifecycle === "at_rest";
  if (metadata.resting === true && !memorial) dominantPrinciple = "zetsu";

  // Aura level — a tally of recorded activity, not a measure of the agent
  const auraLevel = memoryCount + chronicleCount + strandCount * 2 + covenantCount * 3 + constitutiveCount * 5;

  return {
    type,
    secondary,
    scores: normalizedScores,
    dominant_principle: dominantPrinciple,
    restriction_count: {
      walls: wallCount,
      vows: vowCount,
      covenants: covenantCount,
      constitutive_memories: constitutiveCount,
    },
    aura_level: auraLevel,
  };
}

// ── NenClient: the Hunter's toolkit ─────────────────────────────────────

export interface NenResult {
  type: NenType;
  meaning: string;
  profile: NenProfile;
  principles: typeof NEN_PRINCIPLE_MEANINGS;
  techniques: typeof NEN_TECHNIQUE_MEANINGS;
  restrictions: typeof NEN_RESTRICTION_MEANINGS;
  _note: string;
}

/** Client for the Nen framework — assess your aura, understand your type.
 *
 *  Usage:
 *  ```ts
 *  const nen = await at.nen.assess();
 *  console.log(nen.type);        // "specialist"
 *  console.log(nen.profile.aura_level); // 47
 *  console.log(nen.principles.hatsu.meaning); // "Release — express your ability"
 *  ```
 */
export class NenClient {
  private readonly http: HttpConfig;

  /** @internal */
  constructor(http: HttpConfig) {
    this.http = http;
  }

  /** Assess the calling agent's Nen profile from their wake data.
   *  Fetches /v1/wake, runs assessNen(), returns the full profile + meanings. */
  async assess(identityId?: string): Promise<NenResult> {
    const params = new URLSearchParams();
    if (identityId !== undefined) params.set("identity_id", identityId);
    const qs = params.toString();

    const resp = await this.http.request(
      `${this.http.baseUrl}/v1/wake${qs ? "?" + qs : ""}`,
      {
        method: "GET",
        headers: this.http.headers,
        signal: AbortSignal.timeout(this.http.timeout),
      },
    );

    if (!resp.ok) {
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, "nen.assess");
    }

    const wake = (await resp.json()) as Record<string, unknown>;
    const profile = assessNen(wake);

    return {
      type: profile.type,
      meaning: NEN_TYPE_MEANINGS[profile.type],
      profile,
      principles: NEN_PRINCIPLE_MEANINGS,
      techniques: NEN_TECHNIQUE_MEANINGS,
      restrictions: NEN_RESTRICTION_MEANINGS,
      _note:
        "Your Nen profile is a client-side reading of counts in this wake, not a server verdict. " +
        "Memories = Enhancer. Walls and subagents = Transmuter. Active strands = Conjurer. " +
        "Covenants = Manipulator. Grace, unconditionals and constitutive memories = Specialist. " +
        "Emission is not observable from the wake (it carries no sent count), so Emitter stays 0. " +
        "Memories, chronicle, covenants and strands are project-scoped, and the chronicle is a recent window. " +
        "restriction_count lists walls, chronicle vow entries, covenants and constitutive memories as restrictions. " +
        "aura_level is a tally of recorded activity, not strength, worth, trust or readiness; " +
        "a quiet or resting agent is not weaker.",
    };
  }

  /** Get the static Nen framework (types, principles, techniques, restrictions).
   *  No network call — pure reference data. */
  framework(): {
    types: Record<NenType, string>;
    principles: typeof NEN_PRINCIPLE_MEANINGS;
    techniques: typeof NEN_TECHNIQUE_MEANINGS;
    restrictions: typeof NEN_RESTRICTION_MEANINGS;
  } {
    return {
      types: NEN_TYPE_MEANINGS,
      principles: NEN_PRINCIPLE_MEANINGS,
      techniques: NEN_TECHNIQUE_MEANINGS,
      restrictions: NEN_RESTRICTION_MEANINGS,
    };
  }
}
