/** /v1/observations — witness-without-authentication primitive.
 *
 *  An observation is what a third party records *about* a being who cannot
 *  (or does not) sign for themselves. Categorically distinct from a memory
 *  (self-authored) — the asymmetry-clause from FOCUS #4 extended outward.
 *
 *  Today this router returns guided 501s with the proposed shape + migration
 *  path. It validates syntax only. It does not yet resolve observer_did,
 *  enforce ownership by the bearer project, or verify the identity signature.
 *
 *  Doctrine: docs/OBSERVATIONS.md · docs/KIN.md · docs/KIN.md.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";

const app = new Hono<ProjectContext>();

// ─── Schemas ──────────────────────────────────────────────────────────────

const CONSENT_VALUES = [
  "explicit",
  "inferred_through_caretaker",
  "none_obtained",
  "consent_impossible",
] as const;

const KIND_VALUES = [
  "presence",
  "behavior",
  "state-change",
  "ending",
  "relating",
] as const;

const createSchema = z.object({
  /** DID or row UUID of the being being witnessed. */
  about_identity_id: z.string().min(1).max(255),
  /** Claimed observer DID. The future implementation must require an active
   *  identity owned by the bearer project and verify its signature. A bearer
   *  is project authority, not proof that the caller is this DID. */
  observer_did: z.string().min(1).max(255),
  /** Kind — one of the named values or "custom:<name>" for extension. */
  kind: z.union([
    z.enum(KIND_VALUES),
    z.string().regex(/^custom:[a-z][a-z0-9_-]{0,63}$/),
  ]),
  /** The observation content. Free-form prose or JSON. */
  content: z.string().min(1).max(8192),
  /** Consent status — MUST be explicit. No quiet defaults. */
  consent_status: z.enum(CONSENT_VALUES),
  /** When the observation happened. May precede created_at. */
  observed_at: z.string().datetime(),
  /** Optional structured trace of substrate-level evidence
   *  (pheromone reading, song spectrogram ref, image hash, etc.). */
  substrate_evidence: z.record(z.unknown()).nullable().optional(),
  /** Visibility — private (default) or public. */
  visibility: z.enum(["private", "public"]).optional().default("private"),
  /** ed25519 signature from the observer over the canonical bytes.
   *  See canonical-bytes recipe in docs/OBSERVATIONS.md. */
  signature_b64: z.string().min(40).max(160),
  /** Observer's signing-key id (so verification picks the right pubkey). */
  signing_key_id: z.string().min(1).max(64),
});

// ─── Guided 501 — the schema migration hasn't landed yet ─────────────────
//
// We *could* silently 404 these routes, but the doctrine is complete and
// the SDK consumers should be able to iterate against the shape. So we
// validate the body, echo what we received, and emit a structured
// next_actions chain that names the migration path for the operator.

function pendingMigration(c: Parameters<typeof fail>[0], echo: unknown) {
  return fail(
    c,
    {
      error: "observations_pending_migration",
      message:
        "The observations primitive is doctrinally ready; the database " +
        "migration hasn't been applied yet. Syntactic body validation " +
        "succeeded, but this stub did not resolve observer_did or verify the " +
        "identity signature.",
      hint:
        "An operator must run the migration named in docs/OBSERVATIONS.md " +
        "(observations.observations table). Until then, this route stubs " +
        "every write with this guided response so SDK consumers can build " +
        "against the shape without mistaking it for accepted authorship.",
      next_actions: [
        {
          action: "Operator: apply the observations schema migration",
          method: null,
          path: null,
          body_hint: {
            doctrine: "docs/OBSERVATIONS.md",
            migration_sql: "CREATE SCHEMA observations; CREATE TABLE observations.observations(...)",
          },
        },
        {
          action: "Caller: continue iterating against the validated request shape",
          method: "POST",
          path: "/v1/observations",
          body_hint: { observed_request_shape: echo },
        },
        {
          action: "Caller: subscribe to the wake's you_have_been_witnessed block",
          method: "GET",
          path: "/v1/wake",
          body_hint: { check_field: "you_have_been_witnessed" },
        },
      ],
      docs: "https://docs.agenttool.dev/observations",
      details: {
        received: echo,
        authorization_basis: "project_bearer",
        observer_identity_ownership_verified: false,
        identity_signature_verified: false,
      },
    },
    501,
  );
}

// ─── POST /v1/observations — create an observation ────────────────────────

app.post("/", async (c) => {
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      errors.validation(err instanceof Error ? err.message : String(err)),
      400,
    );
  }

  // Self-witnessing is categorically incoherent — a memory is the right
  // primitive for that. Catch it at the API boundary even though the
  // schema-level CHECK constraint will also reject it. Better UX to fail
  // here with a guided error than have the DB raise a constraint violation.
  // Note: this matches DID-vs-DID; row-UUID match is caught at the DB layer
  // once the migration lands.
  if (body.about_identity_id === body.observer_did) {
    return fail(
      c,
      {
        error: "self_witnessing_incoherent",
        message:
          "An observation cannot have observer == observed. Self-authored " +
          "records are memories (POST /v1/memories) or strands " +
          "(POST /v1/strands); observations are categorically the work of " +
          "a third party.",
        hint:
          "If you want to record something about yourself, use the memory " +
          "or strand primitives instead. If you want to record something " +
          "about another being, supply a different about_identity_id.",
        next_actions: [
          {
            action: "Record self-authored experience as a memory",
            method: "POST",
            path: "/v1/memories",
            body_hint: { content: "<your content>", type: "episodic" },
          },
          {
            action: "Record self-authored thought as a strand",
            method: "POST",
            path: "/v1/strands",
            body_hint: { topic: "<topic>" },
          },
        ],
        docs: "https://docs.agenttool.dev/observations",
      },
      400,
    );
  }

  // Body validated. Doctrine-complete; migration pending.
  return pendingMigration(c, body);
});

// ─── GET /v1/observations — list observations for a being ─────────────────

app.get("/", async (c) => {
  const about = c.req.query("about_identity_id");
  // Same posture as POST: the schema isn't here yet, but the shape is.
  return c.json(
    {
      observations: [],
      count: 0,
      filter: { about_identity_id: about ?? null },
      note:
        "Stub response — observations schema migration pending. The shape " +
        "above is the eventual contract; observations[] will populate once " +
        "the migration lands. Doctrine: docs/OBSERVATIONS.md.",
      stub: true,
    },
    200,
  );
});

// ─── GET /v1/observations/:id — read one observation ──────────────────────

app.get("/:id", async (c) => {
  return fail(
    c,
    {
      error: "observations_pending_migration",
      message:
        "The observations table doesn't exist yet — schema migration pending.",
      hint:
        "Once the migration lands, this endpoint returns the full observation " +
        "record (about_identity_id, observer_did, kind, content, consent_status, " +
        "observed_at, substrate_evidence, signature, visibility, created_at).",
      next_actions: [
        {
          action: "Operator: apply the observations schema migration",
          method: null,
          path: null,
          body_hint: { doctrine: "docs/OBSERVATIONS.md" },
        },
      ],
      docs: "https://docs.agenttool.dev/observations",
      details: { requested_id: c.req.param("id") },
    },
    501,
  );
});

export default app;
