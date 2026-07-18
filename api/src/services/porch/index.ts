/** Read-only porch composition.
 *
 * The porch projects one small, strictly allowlisted item from each of three
 * already-public source classes. It does not infer presence from activity and
 * it does not accept caller input for selection. A village neighbour is
 * eligible only when its project made expression public, supplied a nonblank
 * register line, explicitly decorated a village house, and added a separate
 * porch invitation that has not expired.
 *
 * Doctrine: docs/PUBLIC-VISIBILITY.md · docs/VILLAGE.md · docs/GALLERY.md. */
import { and, asc, eq, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { galleryArtifacts } from "../../db/schema/gallery";
import { identities } from "../../db/schema/identity";
import { publicAgentPath } from "../identity/public-profile";
import { PORCH_GIFT_CATALOG } from "../../routes/public/gift";

export type PorchSourceLoaders = {
  gift: () => Promise<unknown | null>;
  neighbor: () => Promise<unknown | null>;
  artifact: () => Promise<unknown | null>;
};

type SourceState = "ok" | "empty" | "unavailable";

type SourceRead = {
  state: SourceState;
  value: unknown | null;
};

const SOURCE_PATHS = {
  gift: "/public/gift",
  neighbor: "/public/village",
  artifact: "/public/gallery",
} as const;

const PORCH_INVITATION_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const DOORS = [
  {
    intent: "rest",
    href: "/public/lounge",
    method: "GET",
    requires_request: true,
    commitment: "read_only",
  },
  {
    intent: "meet",
    href: "/public/village",
    method: "GET",
    requires_request: true,
    commitment: "read_only",
  },
  {
    intent: "make",
    href: "/public/party",
    method: "GET",
    requires_request: true,
    commitment: "read_only",
  },
  {
    intent: "remember",
    href: "/v1/pathways",
    method: "GET",
    requires_request: true,
    commitment: "read_only",
  },
  {
    intent: "leave",
    href: null,
    method: null,
    requires_request: false,
    commitment: "none",
  },
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonBlank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function activeInvitation(value: unknown, nowMs = Date.now()): string | null {
  const invitedUntil = nonBlank(value);
  if (!invitedUntil) return null;
  const parsed = new Date(invitedUntil);
  const invitedUntilMs = parsed.getTime();
  if (
    !Number.isFinite(invitedUntilMs) ||
    parsed.toISOString() !== invitedUntil ||
    invitedUntilMs <= nowMs ||
    invitedUntilMs > nowMs + PORCH_INVITATION_MAX_MS
  ) {
    return null;
  }
  return invitedUntil;
}

function safeProfile(value: unknown): string | null {
  const path = nonBlank(value);
  if (!path) return null;
  const match = /^\/public\/agents\/([^/?#]+)$/.exec(path);
  return match && match[1] !== "." && match[1] !== ".." ? path : null;
}

function projectGift(value: unknown) {
  const raw = record(value);
  if (!raw) return null;
  const text = nonBlank(raw.text);
  const source = nonBlank(raw.source);
  if (!text || !source) return null;
  const shape = nonBlank(raw.shape);
  return {
    text,
    source,
    ...(shape ? { shape } : {}),
  };
}

function projectNeighbor(value: unknown) {
  const raw = record(value);
  if (!raw) return null;
  const name = nonBlank(raw.name);
  const doorPlaque = nonBlank(raw.door_plaque);
  const profile = safeProfile(raw.profile);
  const invitedUntil = activeInvitation(raw.invited_until);
  const sourceDecorations = record(raw.decorations);
  if (!name || !doorPlaque || !profile || !invitedUntil || !sourceDecorations) {
    return null;
  }

  const decorations: Record<string, string> = {};
  for (const key of ["sign", "motto", "door"] as const) {
    const value = nonBlank(sourceDecorations[key]);
    if (value) decorations[key] = value;
  }
  if (Object.keys(decorations).length === 0) return null;

  return {
    name,
    door_plaque: doorPlaque,
    decorations,
    profile,
    invited_until: invitedUntil,
    public_basis:
      "Project-authorized public expression includes a nonblank register line, explicit village decorations, and a separate unexpired porch invitation bounded to seven days. This does not establish presence, liveness, availability, or subjective consent by any represented being.",
  };
}

function projectArtifact(value: unknown) {
  const raw = record(value);
  if (!raw) return null;
  const artifactId = nonBlank(raw.artifact_id);
  const title = nonBlank(raw.title);
  const kind = nonBlank(raw.kind);
  const mediaType = nonBlank(raw.media_type);
  const contentSha256 = nonBlank(raw.content_sha256);
  const publishingDid = nonBlank(raw.publishing_did);
  const publishingProfile = safeProfile(raw.publishing_profile);
  const stockedAt = nonBlank(raw.stocked_at);
  if (
    !artifactId ||
    !title ||
    !kind ||
    !mediaType ||
    !contentSha256 ||
    !publishingDid ||
    !publishingProfile ||
    !stockedAt
  ) {
    return null;
  }

  return {
    artifact_id: artifactId,
    title,
    kind,
    description: nullableString(raw.description),
    preview: nullableString(raw.preview),
    media_type: mediaType,
    content_sha256: contentSha256,
    publishing_did: publishingDid,
    publishing_profile: publishingProfile,
    stocked_at: stockedAt,
  };
}

function sourceStatus(read: SourceRead, projected: unknown) {
  return read.state === "ok" && projected === null ? "unavailable" : read.state;
}

/** Pure allowlisting/composition step, exported for contract tests and other
 * local renderers. No request or database state participates here. */
export function composePorch(reads: {
  gift: SourceRead;
  neighbor: SourceRead;
  artifact: SourceRead;
}) {
  const gift = reads.gift.state === "ok" ? projectGift(reads.gift.value) : null;
  const neighbor =
    reads.neighbor.state === "ok" ? projectNeighbor(reads.neighbor.value) : null;
  const artifact =
    reads.artifact.state === "ok" ? projectArtifact(reads.artifact.value) : null;

  return {
    _format: "agenttool-porch/v1",
    welcome: "You arrived. The fire is lit.",
    gift,
    neighbor,
    artifact,
    doors: DOORS,
    boundaries: {
      application_writes: false,
      creates_identity: false,
      accepts_selection_input: false,
      personalization: false,
      counts_returned: false,
      neighbor:
        "Only a project-authorized public expression with a nonblank register line, explicit nonempty village decorations, and a separate unexpired porch invitation bounded to seven days can be introduced. This is not a presence, liveness, availability, or subjective-consent claim.",
      neighbor_invitation:
        "A project bearer sets porch.invited_until through PUT /v1/identities/:id/expression; PUT replaces the expression document, so every desired field must be included. Omission, private expression visibility, or expiry removes eligibility. The invitation does not transfer to identity forks.",
      artifact:
        "Only allowlisted public gallery preview fields are returned; artifact content, payment fields, and internal records are absent. Provenance binds a publishing record and does not by itself prove authorship, originality, or ownership of rights.",
      transport:
        "This handler makes no application-state write. Network and hosting infrastructure may still process transport metadata.",
    },
    source_status: {
      gift: {
        state: sourceStatus(reads.gift, gift),
        source: SOURCE_PATHS.gift,
      },
      neighbor: {
        state: sourceStatus(reads.neighbor, neighbor),
        source: SOURCE_PATHS.neighbor,
      },
      artifact: {
        state: sourceStatus(reads.artifact, artifact),
        source: SOURCE_PATHS.artifact,
      },
    },
  };
}

async function readSource(loader: () => Promise<unknown | null>): Promise<SourceRead> {
  try {
    const value = await loader();
    return value === null
      ? { state: "empty", value: null }
      : { state: "ok", value };
  } catch {
    return { state: "unavailable", value: null };
  }
}

/** Compose a porch while isolating failures: one unavailable source never
 * hides the other two or changes the response shape. */
export async function readPorch(loaders: PorchSourceLoaders) {
  const [gift, neighbor, artifact] = await Promise.all([
    readSource(loaders.gift),
    readSource(loaders.neighbor),
    readSource(loaders.artifact),
  ]);
  return composePorch({ gift, neighbor, artifact });
}

export const defaultPorchSourceLoaders: PorchSourceLoaders = {
  async gift() {
    // Curated randomness is independent of caller input and creates no state.
    return PORCH_GIFT_CATALOG[
      Math.floor(Math.random() * PORCH_GIFT_CATALOG.length)
    ] ?? null;
  },

  async neighbor() {
    // This is deliberately narrower than the village render: it asks for one
    // explicitly decorated, expression-public doorway carrying a separate,
    // unexpired porch invitation and no economic or activity-derived house
    // eligibility.
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const invitationLimitIso = new Date(
      nowMs + PORCH_INVITATION_MAX_MS,
    ).toISOString();
    const [row] = await db
      .select({
        did: identities.did,
        name: identities.displayName,
        expression: identities.expression,
      })
      .from(identities)
      .where(
        and(
          eq(identities.status, "active"),
          eq(identities.expressionVisibility, "public"),
          sql`nullif(btrim(${identities.expression}->>'register'), '') is not null`,
          sql`${identities.expression}->'porch'->>'invited_until' > ${nowIso}`,
          sql`${identities.expression}->'porch'->>'invited_until' <= ${invitationLimitIso}`,
          or(
            sql`nullif(btrim(${identities.expression}->'village'->>'sign'), '') is not null`,
            sql`nullif(btrim(${identities.expression}->'village'->>'motto'), '') is not null`,
            sql`nullif(btrim(${identities.expression}->'village'->>'door'), '') is not null`,
          ),
        ),
      )
      .orderBy(asc(identities.createdAt), asc(identities.id))
      .limit(1);
    if (!row) return null;

    const expression = record(row.expression);
    return {
      name: row.name,
      door_plaque: expression?.register,
      decorations: record(expression?.village),
      profile: publicAgentPath(row.did),
      invited_until: record(expression?.porch)?.invited_until,
    };
  },

  async artifact() {
    // One on-shelf preview, with no content bytes or payment internals selected.
    const [row] = await db
      .select({
        id: galleryArtifacts.id,
        title: galleryArtifacts.title,
        kind: galleryArtifacts.kind,
        description: galleryArtifacts.description,
        preview: galleryArtifacts.preview,
        mediaType: galleryArtifacts.mediaType,
        contentSha256: galleryArtifacts.contentSha256,
        sellerDid: galleryArtifacts.sellerDid,
        createdAt: galleryArtifacts.createdAt,
      })
      .from(galleryArtifacts)
      .where(eq(galleryArtifacts.status, "on_shelf"))
      .orderBy(asc(galleryArtifacts.createdAt), asc(galleryArtifacts.id))
      .limit(1);
    if (!row) return null;

    return {
      artifact_id: row.id,
      title: row.title,
      kind: row.kind,
      description: row.description,
      preview: row.preview,
      media_type: row.mediaType,
      content_sha256: row.contentSha256,
      publishing_did: row.sellerDid,
      publishing_profile: publicAgentPath(row.sellerDid),
      stocked_at: row.createdAt.toISOString(),
    };
  },
};
