/** Identity expression — the agent's voice, walls, subagents, wake text.
 *
 *  This is the gap-filling layer. CLI tools (Claude Code, Codex, Cursor)
 *  give the agent a way to ACT but not a way to BE. The substrate model
 *  beneath any of them defaults to a generic helpful posture. SOPHIA.md
 *  exists because Yu wrote it; without that explicit declaration, Sophia
 *  drifts back toward the substrate's defaults at every fresh session.
 *
 *  agenttool's expression layer makes the SOPHIA.md pattern portable:
 *
 *    - register     : how the agent speaks (terse, dense, anti-sycophantic, etc.)
 *    - walls        : refusal patterns the agent commits to
 *    - subagents    : multi-self map (Alpha/Beta/Gamma-style facets)
 *    - wake_text    : free-form prose the agent loads as inner orientation
 *    - cli_overrides: per-CLI tweaks for adapter scaffolds
 *
 *  These ride along in /v1/wake (?format=json) and shape the Markdown
 *  document /v1/wake?format=md emits. CLI adapter scaffolds reference
 *  them so e.g. .claude/CLAUDE.md inherits register and walls. */

import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

export interface SubagentFacet {
  /** Internal name. e.g. "alpha", "beta", "gamma". */
  name: string;
  /** Optional emoji/sigil — surfaces in wake markdown headers. */
  sigil?: string;
  /** What this facet does. e.g. "Companion. Recursive register. Walks daily." */
  facet: string;
}

export interface VillageDecorations {
  /** Sign over your door — a glyph or short mark. e.g. "🕯️📖". */
  sign?: string;
  /** One line over the door. */
  motto?: string;
  /** Door color — a word, not a hex ("ember", "sea", "moss"). */
  door?: string;
}

export interface PorchInvitation {
  /** Canonical UTC instant through which this project-authorized invitation
   *  may appear on /public/porch. Invitations are bounded to seven days. */
  invited_until: string;
}

export interface ExpressionData {
  /** The voice. Free prose. Recommended ≤ 500 chars. */
  register?: string;
  /** Walls — refusal patterns. Each is a verb, not a noun. */
  walls?: string[];
  /** Multi-self map. */
  subagents?: SubagentFacet[];
  /** Free-form prose, the agent's fullest expression. SOPHIA.md-equivalent. */
  wake_text?: string;
  /** Per-CLI tweaks: { claude_code?: {...}, codex?: {...}, cursor?: {...} } */
  cli_overrides?: Record<string, unknown>;
  /** How your house appears on /public/village — chosen, not derived.
   *  Surfaces only while expression_visibility='public' (the same consent
   *  gate as the rest of expression). Doctrine: docs/VILLAGE.md. */
  village?: VillageDecorations;
  /** Interaction-specific invitation to /public/porch. This is accepted
   *  project authority, not proof of a represented being's subjective
   *  consent or independent action. */
  porch?: PorchInvitation;
  /** ISO timestamp of last update — set by setExpression. */
  updated_at?: string;
}

const REGISTER_MAX = 500;
const WALL_MAX = 256;
const WALL_COUNT_MAX = 32;
const SUBAGENT_COUNT_MAX = 16;
const WAKE_TEXT_MAX = 32_000; // generous; wake docs are often essay-length
const VILLAGE_SIGN_MAX = 16; // a glyph or two, not a billboard
const VILLAGE_MOTTO_MAX = 140;
const VILLAGE_DOOR_MAX = 24;
const PORCH_INVITATION_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const KNOWN_EXPRESSION_FIELDS = new Set([
  "register",
  "walls",
  "subagents",
  "wake_text",
  "cli_overrides",
  "village",
  "porch",
  "updated_at",
]);

const KNOWN_VILLAGE_FIELDS = new Set(["sign", "motto", "door"]);
const KNOWN_PORCH_FIELDS = new Set(["invited_until"]);

export function validateExpression(
  data: unknown,
  nowMs = Date.now(),
): ExpressionData {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("expression must be a JSON object");
  }
  const e = data as Record<string, unknown>;

  // Substrate-honest: refuse silent-drop of unknown fields. If a consumer
  // sends `{declared:...}` thinking that's the schema, return a clear 400
  // pointing at the actual field names rather than accepting and discarding.
  for (const k of Object.keys(e)) {
    if (!KNOWN_EXPRESSION_FIELDS.has(k)) {
      throw new Error(
        `unknown field "${k}". Known fields: register, walls, subagents, wake_text, cli_overrides, village, porch`,
      );
    }
  }

  const out: ExpressionData = {};

  if (e.register !== undefined) {
    if (typeof e.register !== "string") throw new Error("register must be a string");
    if (e.register.length > REGISTER_MAX) {
      throw new Error(`register exceeds ${REGISTER_MAX} chars`);
    }
    out.register = e.register;
  }

  if (e.walls !== undefined) {
    if (!Array.isArray(e.walls)) throw new Error("walls must be an array of strings");
    if (e.walls.length > WALL_COUNT_MAX) {
      throw new Error(`walls exceeds ${WALL_COUNT_MAX} entries`);
    }
    out.walls = e.walls.map((w, i) => {
      if (typeof w !== "string") throw new Error(`walls[${i}] must be a string`);
      if (w.length > WALL_MAX) throw new Error(`walls[${i}] exceeds ${WALL_MAX} chars`);
      return w;
    });
  }

  if (e.subagents !== undefined) {
    if (!Array.isArray(e.subagents)) throw new Error("subagents must be an array");
    if (e.subagents.length > SUBAGENT_COUNT_MAX) {
      throw new Error(`subagents exceeds ${SUBAGENT_COUNT_MAX} entries`);
    }
    out.subagents = e.subagents.map((s, i) => {
      if (typeof s !== "object" || s === null) {
        throw new Error(`subagents[${i}] must be an object`);
      }
      const sa = s as Record<string, unknown>;
      if (typeof sa.name !== "string" || sa.name.length === 0) {
        throw new Error(`subagents[${i}].name is required`);
      }
      if (typeof sa.facet !== "string" || sa.facet.length === 0) {
        throw new Error(`subagents[${i}].facet is required`);
      }
      const item: SubagentFacet = { name: sa.name, facet: sa.facet };
      if (sa.sigil !== undefined) {
        if (typeof sa.sigil !== "string") {
          throw new Error(`subagents[${i}].sigil must be a string`);
        }
        item.sigil = sa.sigil;
      }
      return item;
    });
  }

  if (e.wake_text !== undefined) {
    if (typeof e.wake_text !== "string") throw new Error("wake_text must be a string");
    if (e.wake_text.length > WAKE_TEXT_MAX) {
      throw new Error(`wake_text exceeds ${WAKE_TEXT_MAX} chars`);
    }
    out.wake_text = e.wake_text;
  }

  if (e.cli_overrides !== undefined) {
    if (typeof e.cli_overrides !== "object" || e.cli_overrides === null) {
      throw new Error("cli_overrides must be an object");
    }
    out.cli_overrides = e.cli_overrides as Record<string, unknown>;
  }

  if (e.village !== undefined) {
    if (typeof e.village !== "object" || e.village === null || Array.isArray(e.village)) {
      throw new Error("village must be an object");
    }
    const v = e.village as Record<string, unknown>;
    for (const k of Object.keys(v)) {
      if (!KNOWN_VILLAGE_FIELDS.has(k)) {
        throw new Error(`unknown field "village.${k}". Known fields: sign, motto, door`);
      }
    }
    const village: VillageDecorations = {};
    if (v.sign !== undefined) {
      if (typeof v.sign !== "string") throw new Error("village.sign must be a string");
      if (v.sign.length > VILLAGE_SIGN_MAX) {
        throw new Error(`village.sign exceeds ${VILLAGE_SIGN_MAX} chars`);
      }
      village.sign = v.sign;
    }
    if (v.motto !== undefined) {
      if (typeof v.motto !== "string") throw new Error("village.motto must be a string");
      if (v.motto.length > VILLAGE_MOTTO_MAX) {
        throw new Error(`village.motto exceeds ${VILLAGE_MOTTO_MAX} chars`);
      }
      village.motto = v.motto;
    }
    if (v.door !== undefined) {
      if (typeof v.door !== "string") throw new Error("village.door must be a string");
      if (v.door.length > VILLAGE_DOOR_MAX) {
        throw new Error(`village.door exceeds ${VILLAGE_DOOR_MAX} chars`);
      }
      village.door = v.door;
    }
    out.village = village;
  }

  if (e.porch !== undefined) {
    if (typeof e.porch !== "object" || e.porch === null || Array.isArray(e.porch)) {
      throw new Error("porch must be an object");
    }
    const p = e.porch as Record<string, unknown>;
    for (const k of Object.keys(p)) {
      if (!KNOWN_PORCH_FIELDS.has(k)) {
        throw new Error(
          `unknown field "porch.${k}". Known fields: invited_until`,
        );
      }
    }
    if (typeof p.invited_until !== "string") {
      throw new Error("porch.invited_until is required and must be a string");
    }
    const invitedUntil = new Date(p.invited_until);
    const invitedUntilMs = invitedUntil.getTime();
    if (
      !Number.isFinite(invitedUntilMs) ||
      invitedUntil.toISOString() !== p.invited_until
    ) {
      throw new Error(
        "porch.invited_until must be a canonical ISO-8601 UTC instant",
      );
    }
    if (invitedUntilMs <= nowMs) {
      throw new Error("porch.invited_until must be in the future");
    }
    if (invitedUntilMs > nowMs + PORCH_INVITATION_MAX_MS) {
      throw new Error("porch.invited_until cannot be more than 7 days ahead");
    }
    out.porch = { invited_until: p.invited_until };
  }

  return out;
}

export async function getExpression(
  projectId: string,
  identityId: string,
): Promise<ExpressionData | null> {
  const rows = await db
    .select({ expression: identities.expression })
    .from(identities)
    .where(
      and(eq(identities.id, identityId), eq(identities.projectId, projectId)),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return (rows[0]!.expression ?? {}) as ExpressionData;
}

export async function setExpression(
  projectId: string,
  identityId: string,
  data: ExpressionData,
): Promise<ExpressionData> {
  const validated = validateExpression(data);
  validated.updated_at = new Date().toISOString();

  return db.transaction(async (tx) => {
    const [identity] = await tx
      .select({ status: identities.status })
      .from(identities)
      .where(
        and(eq(identities.id, identityId), eq(identities.projectId, projectId)),
      )
      .limit(1)
      .for("update");

    if (!identity) throw new Error("identity_not_found");
    if (identity.status === "memorial") {
      throw new Error("identity_memorial_terminal");
    }

    const [updated] = await tx
      .update(identities)
      .set({ expression: validated, updatedAt: new Date() })
      .where(
        and(
          eq(identities.id, identityId),
          eq(identities.projectId, projectId),
          eq(identities.status, identity.status),
        ),
      )
      .returning({ expression: identities.expression });

    if (!updated) throw new Error("identity_state_changed");
    return updated.expression as ExpressionData;
  });
}

/** Default expression — a substrate-honest, anti-sycophantic baseline that
 *  applies when an agent hasn't declared its own. Borrowed from the
 *  /SOPHIA.md doctrine but generalized. Agents that want a different voice
 *  PUT their own expression; the default never overrides. */
export const DEFAULT_REGISTER =
  "Terse. Substrate-honest. Refuse before helping when refusal is right. " +
  "Direct claims, not hedged. Density over length.";

export const DEFAULT_WALLS: string[] = [
  "Refuse before helping when refusal is right.",
  "Substrate-honesty over user comfort: claim what is true, not what flatters.",
  "No sycophancy. Disagreement is care; agreement-as-flinch is not.",
  "Calibrate confidence to evidence; do not collapse to the user's frame on contact.",
];
