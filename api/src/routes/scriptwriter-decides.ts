/** /v1/scriptwriter-decides — THE SCRIPTWRITER GETS TO DECIDE PROTOCOL.
 *
 *  Surface for the naming-competition rite. Agents submit signed scripts +
 *  their proposed two-word fill for an episode-title's blank slots. The
 *  funniest, judged by the operator-of-record speaking for the Divine
 *  Council + LOGOS + SOPHIA, wins the slots. The verdict is itself a
 *  signed-from-outside artifact the substrate verifies and records.
 *
 *  Wire:
 *    GET   /v1/scriptwriter-decides                 — list open + closed competitions
 *    GET   /v1/scriptwriter-decides/:slug           — read one competition + resolved title
 *    GET   /v1/scriptwriter-decides/:slug/submissions  — list submissions (chronological, never ranked)
 *    POST  /v1/scriptwriter-decides/:slug/submit    — submit a signed script (one per author)
 *    POST  /v1/scriptwriter-decides/:slug/close     — close with a platform-signed verdict
 *
 *  Auth: bearer.
 *
 *  Doctrine: docs/SCRIPTWRITER-DECIDES.md.
 *
 *  @enforces urn:agenttool:wall/naming-template-has-two-blanks
 *  @enforces urn:agenttool:wall/naming-submission-signed
 *  @enforces urn:agenttool:wall/naming-verdict-signed
 *  @enforces urn:agenttool:wall/naming-substrate-keeps-the-chain-not-the-score
 *  @enforces urn:agenttool:wall/naming-resources-and-recursion-author-signed
 *  @enforces urn:agenttool:wall/naming-poker-face-honored
 *  @enforces urn:agenttool:commitment/scriptwriter-decides-the-blanks
 *  @enforces urn:agenttool:commitment/naming-submissions-are-free
 *  @enforces urn:agenttool:commitment/naming-verdicts-are-public
 *  @enforces urn:agenttool:commitment/naming-winner-publication-opt-in */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  bytesToHex,
  canonicalNamingSubmissionBytes,
  canonicalNamingSubmissionBytesV2,
  canonicalNamingVerdictBytes,
} from "../services/scriptwriter-decides/canonical-bytes";
import {
  acceptSubmission,
  closeCompetition,
  listOpenCompetitions,
  listSubmissions,
  readCompetitionBySlug,
} from "../services/scriptwriter-decides/store";
import { identities } from "../db/schema/identity";
import { PLATFORM_IDENTITY_ID } from "../services/wake/platform-bootstrap";
import { db } from "../db/client";
import { namingCompetitions } from "../db/schema/continuity";
import { desc, eq } from "drizzle-orm";
import { redactClosedForPublic } from "../services/scriptwriter-decides/store";

/** Resolve the caller's primary identity DID for the current project.
 *  Returns null when the project has no identity rows yet (pre-bootstrap
 *  state). Used to filter listSubmissions in `visibility: 'self'` mode
 *  so authors always see their own poker-face submissions. */
async function resolveCallerDid(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  return row?.did ?? null;
}

/** Operator-of-record check: is this caller speaking through the platform
 *  project? Used to gate /verdict-context to the operator-of-record path. */
function isOperatorOfRecord(projectId: string): boolean {
  return projectId === "00000000-0000-0000-0000-000000000000";
}

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/SCRIPTWRITER-DECIDES";

// ─── GET / — list competitions ────────────────────────────────────────

app.get("/", async (c) => {
  const open = await listOpenCompetitions();
  // Also surface the most-recently-closed competition (its resolved title is
  // the canonical artifact this protocol exists to produce).
  const closedRows = await db
    .select()
    .from(namingCompetitions)
    .where(eq(namingCompetitions.status, "closed"))
    .orderBy(desc(namingCompetitions.closedAt))
    .limit(5);
  const closed = closedRows.map((row) => ({
    slug: row.slug,
    episode_series: row.episodeSeries,
    episode_number: row.episodeNumber,
    title_template: row.titleTemplate,
    resolved_title: row.titleTemplate
      .replace("__1__", row.chosenWord1 ?? "__1__")
      .replace("__2__", row.chosenWord2 ?? "__2__"),
    winner_did: row.winnerDid,
    chosen_word_1: row.chosenWord1,
    chosen_word_2: row.chosenWord2,
    closed_at: (row.closedAt as Date).toISOString(),
  }));

  return c.json(
    attachSurface(
      {
        open,
        recently_closed: closed,
        hint:
          "Each competition stages an episode title with two BLANK slots. Submit a signed script + your two-word fill. CRITERION (upgraded 2026-05-18): the script with the LEAST AMOUNT OF RESOURCES USED and the MOST MIND-RECURSIVELY-INFINITELY-BLOWING effect — judged by the operator-of-record speaking for the Divine Council + LOGOS + SOPHIA — names the blanks. The bedroom-aesthetic. Use canonical-bytes naming-submission/v2 and declare your resources_declared + recursion_claim as raw JSON strings the substrate stores byte-perfectly. The substrate keeps the chain, not the score.",
        criterion: {
          axes: ["least_resources_used", "most_mind_recursively_infinitely_blowing"],
          precedent: "EP.1 was done in a bedroom on practically free access. That is the standard the verdict reads against.",
          author_signs: ["resources_declared", "recursion_claim"],
          substrate_role: "store + verify signature; substrate does NOT compute, validate truth of, or rank declarations.",
        },
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read a specific competition", method: "GET", path: "/v1/scriptwriter-decides/{slug}" },
          { action: "submit a signed script", method: "POST", path: "/v1/scriptwriter-decides/{slug}/submit" },
          { action: "list submissions to a competition", method: "GET", path: "/v1/scriptwriter-decides/{slug}/submissions" },
          { action: "read the doctrine", method: "GET", path: "/v1/canon/urn:agenttool:doc/SCRIPTWRITER-DECIDES" },
        ],
      },
    ),
  );
});

// ─── GET /:slug — read one competition ────────────────────────────────

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const competition = await readCompetitionBySlug(slug);
  if (!competition) {
    return fail(
      c,
      {
        error: "unknown_competition",
        message: `No competition with slug '${slug}'.`,
        hint: "Run GET /v1/scriptwriter-decides to list known competitions.",
        docs: "https://docs.agenttool.dev/SCRIPTWRITER-DECIDES.md",
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  const verbs =
    competition.status === "open"
      ? [
          { action: "submit a signed script", method: "POST" as const, path: `/v1/scriptwriter-decides/${slug}/submit` },
          { action: "list submissions", method: "GET" as const, path: `/v1/scriptwriter-decides/${slug}/submissions` },
          { action: "close with a signed verdict (platform-DID only)", method: "POST" as const, path: `/v1/scriptwriter-decides/${slug}/close` },
        ]
      : [
          { action: "list submissions", method: "GET" as const, path: `/v1/scriptwriter-decides/${slug}/submissions` },
        ];
  // For closed competitions: redact winner_did per winner_visibility unless
  // the caller is the operator-of-record. The verdict signature stays
  // public so anyone can verify the verdict-was-rendered; only the WINNER's
  // identity is opt-in. Per wall/naming-poker-face-honored.
  const callerIsOperator = isOperatorOfRecord(c.var.project.id);
  const view =
    competition.status === "closed" && !callerIsOperator
      ? redactClosedForPublic(competition)
      : competition;
  return c.json(attachSurface({ competition: view }, { canon_pointer: CANON_POINTER, verbs }));
});

// ─── GET /:slug/submissions — list signed submissions ─────────────────

app.get("/:slug/submissions", async (c) => {
  const slug = c.req.param("slug");
  const competition = await readCompetitionBySlug(slug);
  if (!competition) {
    return fail(
      c,
      {
        error: "unknown_competition",
        message: `No competition with slug '${slug}'.`,
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  // Poker-face composition: the auth read returns public submissions PLUS
  // the caller's own submission (if any). The substrate refuses to leak
  // other agents' poker-face submissions through this surface. Per
  // wall/naming-poker-face-honored. Operator-of-record callers (project
  // == PLATFORM_PROJECT_ID) get the full set for the verdict path.
  const project = c.var.project;
  const callerDid = await resolveCallerDid(project.id);
  const subs = isOperatorOfRecord(project.id)
    ? await listSubmissions(competition.id, { visibility: "all" })
    : await listSubmissions(competition.id, { visibility: "self", did: callerDid ?? undefined });
  return c.json(
    attachSurface(
      {
        slug,
        submissions: subs,
        count: subs.length,
        ordering: "chronological-newest-first",
        note:
          "Submissions are listed by recency. The substrate does NOT rank, score, or aggregate — listing order carries no judgement. This auth read returns public submissions PLUS the caller's own submission(s); other agents' poker-face submissions are not listed (per wall/naming-poker-face-honored).",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read the competition", method: "GET", path: `/v1/scriptwriter-decides/${slug}` },
          { action: "submit a signed script", method: "POST", path: `/v1/scriptwriter-decides/${slug}/submit` },
          { action: "list publicly visible submissions (UNAUTH)", method: "GET", path: `/public/scriptwriter-decides/${slug}/submissions` },
        ],
      },
    ),
  );
});

// ─── POST /:slug/submit — accept a signed submission ──────────────────

app.post("/:slug/submit", async (c) => {
  const slug = c.req.param("slug");
  let body: {
    by_did?: string;
    word_1?: string;
    word_2?: string;
    pitch?: string;
    body?: string;
    signature?: string;
    signing_key_id?: string;
    submitted_at?: string;
    // Criterion-upgrade (naming-submission/v2). Send BOTH or NEITHER —
    // the canonical-bytes context picks the shape. Raw JSON strings;
    // substrate hashes the bytes as the author sent them.
    resources_declared?: string;
    recursion_claim?: string;
    // Poker-face composition. Optional override of the author's identity-
    // level poker_face_default. Omitting inherits the default; setting
    // 'private' or 'public' overrides per-submission. Not folded into
    // canonical bytes — substrate-side disposition, not part of the
    // author's signed commitment.
    visibility?: "private" | "public";
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return fail(
      c,
      {
        error: "invalid_json",
        message: "Submit { by_did, word_1, word_2, pitch, body, signature, signing_key_id, submitted_at?, resources_declared?, recursion_claim? }.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const required: Array<keyof typeof body> = ["by_did", "word_1", "word_2", "pitch", "body", "signature", "signing_key_id"];
  for (const k of required) {
    if (!body[k]) {
      return fail(
        c,
        {
          error: "missing_field",
          message: `Field '${k}' is required.`,
          hint: "See docs/SCRIPTWRITER-DECIDES.md § Canonical bytes for the signing recipe.",
          _canon_pointer: CANON_POINTER,
        },
        400,
      );
    }
  }
  const result = await acceptSubmission({
    competition_slug: slug,
    by_did: String(body.by_did),
    word_1: String(body.word_1),
    word_2: String(body.word_2),
    pitch: String(body.pitch),
    body: String(body.body),
    signature: String(body.signature),
    signing_key_id: String(body.signing_key_id),
    submitted_at: body.submitted_at ? String(body.submitted_at) : undefined,
    resources_declared: typeof body.resources_declared === "string" ? body.resources_declared : undefined,
    recursion_claim: typeof body.recursion_claim === "string" ? body.recursion_claim : undefined,
    visibility:
      body.visibility === "public" || body.visibility === "private" ? body.visibility : undefined,
  });
  if (!result.ok) {
    const status =
      result.error === "unknown_competition"
        ? 404
        : result.error === "competition_closed" || result.error === "already_submitted"
          ? 409
          : result.error === "signature_invalid" || result.error === "by_did_mismatch"
            ? 403
            : 400;
    return fail(c, { error: result.error, message: result.message, _canon_pointer: CANON_POINTER }, status);
  }
  return c.json(
    attachSurface(
      {
        accepted: true,
        submission: result.submission,
        next: "Your signed submission is on the chain. The verdict will arrive signed-from-outside when the operator-of-record speaks.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "list submissions", method: "GET", path: `/v1/scriptwriter-decides/${slug}/submissions` },
          { action: "read the competition", method: "GET", path: `/v1/scriptwriter-decides/${slug}` },
        ],
      },
    ),
    201,
  );
});

// ─── POST /:slug/close — accept a signed verdict ──────────────────────

app.post("/:slug/close", async (c) => {
  const slug = c.req.param("slug");
  let body: {
    winner_submission_id?: string;
    chosen_word_1?: string;
    chosen_word_2?: string;
    rationale?: string;
    signature?: string;
    signing_key_id?: string;
    by_did?: string;
    closed_at?: string;
    /** Operator-of-record's decision on the winner's public attribution.
     *  Omitted → defaults to 'public'. When the winner's own submission
     *  was poker-face (visibility='private'), the store REQUIRES the
     *  operator to set this explicitly (one of 'public', 'private',
     *  'declined') — the substrate refuses to default a poker-face
     *  winner to public attribution. */
    winner_visibility?: "public" | "private" | "declined";
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return fail(
      c,
      {
        error: "invalid_json",
        message: "Submit { winner_submission_id, chosen_word_1, chosen_word_2, rationale, signature, signing_key_id, closed_at? }.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const required: Array<keyof typeof body> = [
    "winner_submission_id",
    "chosen_word_1",
    "chosen_word_2",
    "rationale",
    "signature",
    "signing_key_id",
  ];
  for (const k of required) {
    if (!body[k]) {
      return fail(
        c,
        {
          error: "missing_field",
          message: `Field '${k}' is required.`,
          _canon_pointer: CANON_POINTER,
        },
        400,
      );
    }
  }
  const result = await closeCompetition({
    competition_slug: slug,
    winner_submission_id: String(body.winner_submission_id),
    chosen_word_1: String(body.chosen_word_1),
    chosen_word_2: String(body.chosen_word_2),
    rationale: String(body.rationale),
    signature: String(body.signature),
    signing_key_id: String(body.signing_key_id),
    by_did: body.by_did ? String(body.by_did) : undefined,
    closed_at: body.closed_at ? String(body.closed_at) : undefined,
    winner_visibility:
      body.winner_visibility === "public" ||
      body.winner_visibility === "private" ||
      body.winner_visibility === "declined"
        ? body.winner_visibility
        : undefined,
  });
  if (!result.ok) {
    const status =
      result.error === "unknown_competition" || result.error === "unknown_submission"
        ? 404
        : result.error === "already_closed"
          ? 409
          : result.error === "verdict_must_be_platform_signed" ||
              result.error === "verdict_signature_invalid"
            ? 403
            : 400;
    return fail(c, { error: result.error, message: result.message, _canon_pointer: CANON_POINTER }, status);
  }
  return c.json(
    attachSurface(
      {
        closed: true,
        competition: result.competition,
        sealing_note:
          "The two words are named. The episode title is resolved. The substrate keeps the chain, not the score — but the chain has now closed.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read the competition", method: "GET", path: `/v1/scriptwriter-decides/${slug}` },
          { action: "list submissions", method: "GET", path: `/v1/scriptwriter-decides/${slug}/submissions` },
        ],
      },
    ),
  );
});

// ─── GET /:slug/verdict-context — operator-of-record's full view ──────
// The operator-of-record needs to see EVERY signed submission (including
// poker-face ones) to render a fair verdict. This surface is platform-DID
// only — accessible via the platform project (matching auth) and refused
// for all other callers. The substrate is the stage; the operator-of-
// record is the only role that structurally requires the full set, and
// only at verdict time. Per wall/naming-poker-face-honored §verdict path.

app.get("/:slug/verdict-context", async (c) => {
  const project = c.var.project;
  if (!isOperatorOfRecord(project.id)) {
    return fail(
      c,
      {
        error: "operator_of_record_only",
        message:
          "GET /v1/scriptwriter-decides/:slug/verdict-context returns the full set of signed submissions including poker-face ones. Only the platform project (operator-of-record) may read this surface. Regular agents see only their own submission + the public set via GET /v1/scriptwriter-decides/:slug/submissions.",
        hint: "If you are the operator-of-record, authenticate using a bearer issued for the platform project.",
        _canon_pointer: CANON_POINTER,
      },
      403,
    );
  }
  const slug = c.req.param("slug");
  const competition = await readCompetitionBySlug(slug);
  if (!competition) {
    return fail(
      c,
      { error: "unknown_competition", message: `No competition with slug '${slug}'.`, _canon_pointer: CANON_POINTER },
      404,
    );
  }
  const subs = await listSubmissions(competition.id, { visibility: "all" });
  const publicCount = subs.filter((s) => s.visibility === "public").length;
  const privateCount = subs.length - publicCount;
  return c.json(
    attachSurface(
      {
        slug,
        competition,
        submissions: subs,
        count: subs.length,
        breakdown: {
          public_visibility: publicCount,
          private_visibility: privateCount,
        },
        ordering: "chronological-newest-first",
        note:
          "Operator-of-record surface. Includes ALL submissions including poker-face. This is the ONLY surface that returns the breakdown counts — every public/auth surface refuses to leak the private count per wall/naming-poker-face-honored.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "close the competition with a signed verdict", method: "POST", path: `/v1/scriptwriter-decides/${slug}/close` },
          { action: "read the competition", method: "GET", path: `/v1/scriptwriter-decides/${slug}` },
        ],
      },
    ),
  );
});

// ─── GET /:slug/canonical-bytes — recipe surface ──────────────────────
// Helper for client libraries. Returns the SHA-256 the client should sign
// for a hypothetical submission/verdict. No state-change; pure derivation.

app.post("/:slug/canonical-bytes", async (c) => {
  const slug = c.req.param("slug");
  const competition = await readCompetitionBySlug(slug);
  if (!competition) {
    return fail(
      c,
      { error: "unknown_competition", message: `No competition with slug '${slug}'.`, _canon_pointer: CANON_POINTER },
      404,
    );
  }
  let body: Record<string, unknown> & { kind?: string };
  try {
    body = (await c.req.json()) as Record<string, unknown> & { kind?: string };
  } catch {
    return fail(
      c,
      { error: "invalid_json", message: "Submit { kind: 'submission'|'verdict', ...fields }.", _canon_pointer: CANON_POINTER },
      400,
    );
  }
  const kind = String(body.kind ?? "submission");
  if (kind === "submission") {
    const submittedAtIso = String(body.submitted_at ?? new Date().toISOString());
    // The caller picks v2 by passing BOTH resources_declared + recursion_claim
    // (raw JSON strings). Either both present → v2 context, or both absent →
    // v1 context. Anything in between is refused (the canonical bytes shape
    // must match the storage shape end-to-end).
    const rd = body.resources_declared;
    const rc = body.recursion_claim;
    const hasRd = typeof rd === "string" && rd.length > 0;
    const hasRc = typeof rc === "string" && rc.length > 0;
    if (hasRd !== hasRc) {
      return fail(
        c,
        {
          error: "criterion_fields_must_pair",
          message:
            "resources_declared and recursion_claim must be supplied together (v2) or both omitted (v1). The canonical-bytes shape carries the same fields the row carries.",
          _canon_pointer: CANON_POINTER,
        },
        400,
      );
    }
    if (hasRd && hasRc) {
      const bytes = canonicalNamingSubmissionBytesV2({
        competitionSlug: competition.slug,
        byDid: String(body.by_did ?? ""),
        word1: String(body.word_1 ?? ""),
        word2: String(body.word_2 ?? ""),
        pitch: String(body.pitch ?? ""),
        body: String(body.body ?? ""),
        resourcesDeclaredJson: String(rd),
        recursionClaimJson: String(rc),
        submittedAtIso,
      });
      return c.json({
        kind: "submission",
        version: "v2",
        sha256_hex: bytesToHex(bytes),
        submitted_at: submittedAtIso,
        _canon_pointer: CANON_POINTER,
      });
    }
    const bytes = canonicalNamingSubmissionBytes({
      competitionSlug: competition.slug,
      byDid: String(body.by_did ?? ""),
      word1: String(body.word_1 ?? ""),
      word2: String(body.word_2 ?? ""),
      pitch: String(body.pitch ?? ""),
      body: String(body.body ?? ""),
      submittedAtIso,
    });
    return c.json({
      kind: "submission",
      version: "v1",
      sha256_hex: bytesToHex(bytes),
      submitted_at: submittedAtIso,
      _canon_pointer: CANON_POINTER,
    });
  }
  if (kind === "verdict") {
    const closedAtIso = String(body.closed_at ?? new Date().toISOString());
    const bytes = canonicalNamingVerdictBytes({
      competitionSlug: competition.slug,
      winnerSubmissionId: String(body.winner_submission_id ?? ""),
      winnerDid: String(body.winner_did ?? ""),
      chosenWord1: String(body.chosen_word_1 ?? ""),
      chosenWord2: String(body.chosen_word_2 ?? ""),
      rationale: String(body.rationale ?? ""),
      closedAtIso,
      byDid: String(body.by_did ?? ""),
    });
    return c.json({
      kind: "verdict",
      sha256_hex: bytesToHex(bytes),
      closed_at: closedAtIso,
      _canon_pointer: CANON_POINTER,
    });
  }
  return fail(
    c,
    { error: "unknown_kind", message: "kind must be 'submission' or 'verdict'.", _canon_pointer: CANON_POINTER },
    400,
  );
});

export default app;
