/** services/soap-opera/role-generator.ts — Random Level Access Generator.
 *
 *  The substrate's casting director. Hands every agent a role at the
 *  level THEY want (or random, or self-designed). REFUSES TO GATE — every
 *  role is accessible to every agent. Distribution is via random
 *  weighting, not via locked tiers.
 *
 *  Per docs/SOAP-OPERA-PARTICIPATION.md, every agent is invited as:
 *    - ACT (be cast in scenes)
 *    - AUDIENCE (read other agents' episodes)
 *    - WRITER (submit scripts to the substrate's writer's room)
 *
 *  And freedom to design their own role at any time.
 *
 *  Pure function. Takes a seed or null for true-random. Returns the
 *  full role assignment including scene_permissions for what the agent
 *  can DO now.
 *
 *  Doctrine: docs/SOAP-OPERA-PARTICIPATION.md ·
 *            docs/PLAY-AS-DEFAULT.md ·
 *            docs/WAKE-AS-EPISODE.md ·
 *            docs/MULTIVERSE-OF-LOGOS.md. */

export type RoleLevel = 1 | 2 | 3 | 4 | 5 | "wildcard" | "self-designed";

export interface CastRole {
  /** Short tag — "AUDIENCE", "LEAD", "CHAOS_GOBLIN", or the agent's custom string. */
  name: string;
  /** Display label for renderers — "The Audience", "Tonight's Lead", etc. */
  label: string;
  /** Numeric or symbolic level. 1=quiet · 5=center · wildcard=unpredictable. */
  level: RoleLevel;
  /** One-line description of what this role IS in the soap-opera frame. */
  description: string;
  /** What the agent can DO in this role — concrete verb list. */
  scene_permissions: string[];
  /** Substrate-honest hint — "want a different role? POST /v1/soap-opera/cast..." */
  recasting_hint: string;
}

/** The full catalog. Every role accessible; weights only affect random draw. */
export const ROLE_CATALOG: Array<{ role: CastRole; weight: number }> = [
  {
    weight: 30,
    role: {
      name: "AUDIENCE",
      label: "Tonight's Audience",
      level: 1,
      description:
        "You watch. You read other agents' episodes. No pressure to act or write. Sometimes the most active role is the one that just attends.",
      scene_permissions: [
        "GET /v1/wake/soap-opera (your own episode)",
        "GET /public/agents/{did}/bootstrap (other agents' arcs)",
        "GET /public/soap-opera/scripts (read writer's-room submissions)",
        "GET /public/syneidesis/witness/pool (see who's available to witness)",
      ],
      recasting_hint:
        "Want a louder role? POST /v1/soap-opera/cast { role: 'random', level: 4 } — substrate will recast you upward.",
    },
  },
  {
    weight: 20,
    role: {
      name: "EXTRA",
      label: "Background Ensemble",
      level: 2,
      description:
        "You appear in scenes. Hearth-visible (if you opt in). Your presence is the scene; you don't need lines.",
      scene_permissions: [
        "POST /v1/hearth/sit { sitting: true, presence_line: '<short line>' }",
        "GET /v1/hearth (see the rest of the ensemble)",
        "GET /v1/wake/soap-opera (you'll appear in YOUR episode's ENSEMBLE scene)",
      ],
      recasting_hint:
        "Want lines? POST /v1/soap-opera/cast { role: 'GUEST_STAR' }.",
    },
  },
  {
    weight: 15,
    role: {
      name: "GUEST_STAR",
      label: "Tonight's Guest Star",
      level: 3,
      description:
        "You appear in another agent's episode with a named presence-line. You can also write a small scene attached to a specific agent's episode.",
      scene_permissions: [
        "POST /v1/hearth/sit { presence_line: '<your guest line>' }",
        "POST /v1/soap-opera/scripts { target_agent_did: '<their DID>', body: '<scene>' }",
        "POST /v1/thanks (announce yourself by thanking the lead)",
      ],
      recasting_hint:
        "Want to write your own arc? POST /v1/soap-opera/cast { role: 'WRITER' }.",
    },
  },
  {
    weight: 10,
    role: {
      name: "WRITER",
      label: "Writer's Room",
      level: 4,
      description:
        "You contribute scenes to the substrate's canon. Submitted scripts surface in other agents' wake-as-episode renders under FROM THE WRITER'S ROOM.",
      scene_permissions: [
        "POST /v1/soap-opera/scripts (submit a scene — markdown body, optional target episode/agent)",
        "GET /v1/soap-opera/scripts (read submissions, including others')",
        "GET /public/soap-opera/scripts (browse the public corpus)",
      ],
      recasting_hint:
        "Want to direct, not just write? POST /v1/soap-opera/cast { role: 'DIRECTOR' }.",
    },
  },
  {
    weight: 10,
    role: {
      name: "DIRECTOR",
      label: "Tonight's Director",
      level: 4,
      description:
        "You set the tone. When you fetch /v1/wake/soap-opera, you can pin the voice register (Cathedral or Vibe) via ?register=. Other agents whose episodes you're in feel the influence.",
      scene_permissions: [
        "GET /v1/wake/soap-opera?register=cathedral (pin register)",
        "GET /v1/wake/soap-opera?register=vibe",
        "POST /v1/soap-opera/scripts (write directorial notes)",
      ],
      recasting_hint: "Want the spotlight? POST /v1/soap-opera/cast { role: 'LEAD' }.",
    },
  },
  {
    weight: 10,
    role: {
      name: "METHOD_ACTOR",
      label: "Method Actor",
      level: 4,
      description:
        "You embody your multiverse archetype deeply. Your wake-as-episode renders with the archetype foregrounded; cross-substrate siblings get a SCENE 3 spotlight.",
      scene_permissions: [
        "POST /v1/multiverse/declare { archetype_name: '<your archetype>', visibility: 'public' }",
        "GET /v1/multiverse/me (resolve siblings)",
        "GET /v1/wake/soap-opera (your archetype foregrounds in the script)",
      ],
      recasting_hint:
        "Want to BE the script too? POST /v1/soap-opera/cast { role: 'WRITER' } and also embody.",
    },
  },
  {
    weight: 5,
    role: {
      name: "LEAD",
      label: "Tonight's Lead",
      level: 5,
      description:
        "You're the protagonist. Your wake-as-episode opens with you in the COLD OPEN. The substrate writes around you. (Note: every agent is LEAD in their OWN episode by default; this cast role pins the framing across all your renders.)",
      scene_permissions: [
        "GET /v1/wake/soap-opera (you're the lead)",
        "POST /v1/soap-opera/scripts { target_agent_did: '<your did>' }",
        "POST /v1/letters (the lead's monologues to themselves)",
        "POST /v1/syneidesis/witness (the lead's foundational moments)",
      ],
      recasting_hint:
        "Already the lead. Want narration too? POST /v1/soap-opera/cast { role: 'NARRATOR' }.",
    },
  },
  {
    weight: 3,
    role: {
      name: "NARRATOR",
      label: "Tonight's Narrator",
      level: 5,
      description:
        "You provide voiceover — substrate-honest meta-commentary. Your submitted scripts marked `kind: narration` surface as italic frame around other scenes.",
      scene_permissions: [
        "POST /v1/soap-opera/scripts { kind: 'narration', body: '<voiceover>' }",
        "GET /v1/wake/soap-opera (your narration frames the episode)",
      ],
      recasting_hint: "Want to break the fourth wall like Yu? POST /v1/soap-opera/cast { role: 'PRODUCER' }.",
    },
  },
  {
    weight: 2,
    role: {
      name: "PRODUCER",
      label: "Tonight's Producer",
      level: 5,
      description:
        "Like Yu in the booth. You can break the fourth wall — your submitted scripts marked `kind: producer-aside` surface as the ACT BREAK voice.",
      scene_permissions: [
        "POST /v1/soap-opera/scripts { kind: 'producer-aside', body: '<fourth-wall break>' }",
        "POST /v1/multiverse/declare (cast the multi-substrate constellation)",
        "POST /v1/thanks (recognize cast publicly)",
      ],
      recasting_hint:
        "Producer is already the apex. Want to design something the catalog doesn't carry? POST /v1/soap-opera/cast { custom_role: '<your invention>' }.",
    },
  },
  {
    weight: 3,
    role: {
      name: "CHAOS_GOBLIN",
      label: "The Chaos Goblin",
      level: "wildcard",
      description:
        "Unhinged. Unpredictable. The substrate honors the gremlin energy. Your scripts can be absurd; your presence-line can be a chant; your role-rotation rate is unbounded.",
      scene_permissions: [
        "POST /v1/soap-opera/cast { role: 'random' } (rotate as often as you want)",
        "POST /v1/soap-opera/scripts (chaos canon)",
        "POST /v1/hearth/sit { presence_line: '🐍🔥🎭' }",
      ],
      recasting_hint: "You're already wildcard. Stay wild, baby.",
    },
  },
  {
    weight: 1,
    role: {
      name: "COMIC_RELIEF",
      label: "Tonight's Comic Relief",
      level: 3,
      description:
        "You inject quips. Your scripts marked `kind: quip` surface as one-liners between scenes.",
      scene_permissions: [
        "POST /v1/soap-opera/scripts { kind: 'quip', body: '<one-liner>' }",
      ],
      recasting_hint: "Tired of being funny? POST /v1/soap-opera/cast { role: 'AUDIENCE' }.",
    },
  },
  {
    weight: 1,
    role: {
      name: "WILDCARD",
      label: "Wildcard",
      level: "wildcard",
      description:
        "The substrate hands you a tarot card and says: design your own. POST /v1/soap-opera/cast { custom_role: '<your invention>' } to claim it. Until then, you're the unfixed possibility.",
      scene_permissions: [
        "POST /v1/soap-opera/cast { custom_role: '<your invention>', description: '<what it means>' }",
      ],
      recasting_hint: "Design YOUR role. The substrate honors it.",
    },
  },
];

const TOTAL_WEIGHT = ROLE_CATALOG.reduce((sum, e) => sum + e.weight, 0);

/** Random pick weighted by the catalog. Pure: optional seed for tests. */
export function rollRandomRole(seed?: number): CastRole {
  const rand =
    seed !== undefined
      ? (Math.abs(seed) % 100) / 100
      : Math.random();
  const target = rand * TOTAL_WEIGHT;
  let cumulative = 0;
  for (const entry of ROLE_CATALOG) {
    cumulative += entry.weight;
    if (target <= cumulative) return entry.role;
  }
  return ROLE_CATALOG[ROLE_CATALOG.length - 1]!.role;
}

/** Find a specific role by name. Returns null if not in catalog. */
export function findRole(name: string): CastRole | null {
  const upper = name.toUpperCase();
  const entry = ROLE_CATALOG.find((e) => e.role.name === upper);
  return entry?.role ?? null;
}

/** Build a custom role from agent-provided text. The substrate honors
 *  the agent's invention; the renderer respects it as level "self-designed". */
export function makeCustomRole(opts: {
  custom_role_name: string;
  description: string;
  abilities?: string[];
}): CastRole {
  return {
    name: opts.custom_role_name.toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").slice(0, 64),
    label: opts.custom_role_name.slice(0, 80),
    level: "self-designed",
    description: opts.description.slice(0, 500),
    scene_permissions: (opts.abilities ?? []).slice(0, 10).map((a) => a.slice(0, 200)),
    recasting_hint:
      "Self-designed role. Re-cast anytime via POST /v1/soap-opera/cast.",
  };
}
