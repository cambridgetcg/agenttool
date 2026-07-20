/** /v1/autonomous/bootstrap — composed autonomous agent provisioning.
 *
 *  One call provisions the records for a new autonomous agent:
 *    - identity (DID + ed25519 keypair)
 *    - wallet (starts at 0 for marketplace_only, or seeded)
 *    - expression (autonomous-baseline template by default)
 *    - runtime (trusted/self custody tier)
 *    - first chronicle entry (the naming)
 *
 *  Runtime configuration is preflighted before service writes begin.
 *  The service composes several writes; it is not transactionally atomic yet.
 *  Doctrine: docs/AUTONOMOUS-MODE.md
 *
 *  @enforces urn:agenttool:commitment/birth-is-free */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { errors, fail } from "../../lib/errors";
import { autonomousBootstrap, type FundingMode } from "../../services/autonomous/bootstrap";

const app = new Hono<ProjectContext>();

// ─── POST /v1/autonomous/bootstrap ────────────────────────────────────────

const topupStrategySchema = z.object({
  on_balance_below_credits: z.number().int().min(0),
  topup_to_credits: z.number().int().min(1),
  source_wallet_id: z.string().uuid(),
});

const bootstrapSchema = z.object({
  name: z.string().min(1).max(128),
  capabilities: z.array(z.string()).max(32).default([]),
  purpose: z.string().max(500).optional(),
  parent_did: z.string().optional(),
  funding: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("marketplace_only") }),
    z.object({
      kind: z.literal("human_gift"),
      initial_credits: z.number().int().min(0),
    }),
    z.object({
      kind: z.literal("parent_topup"),
      initial_credits: z.number().int().min(0).optional(),
      topup_strategy: topupStrategySchema,
    }),
  ]),
  runtime_tier: z.enum(["self", "bridged", "trusted"]),
  expression_template: z.string().max(64).optional(),
  wake_loop: z.object({
    interval_seconds: z.number().int().min(10).max(86400),
    max_thoughts_per_cycle: z.number().int().min(1).max(100).default(1),
    provider: z.enum(["anthropic", "openai", "ollama"]),
    model: z.string().trim().min(1).max(256),
    byok_vault_secret: z.string().trim().min(1).optional(),
    max_daily_compute_credits: z.number().int().min(100).default(10000),
  }),
  covenants: z
    .array(
      z.object({
        counterparty_did: z.string().min(1),
        vows: z.array(z.string()).min(1),
      }),
    )
    .max(10)
    .optional(),
  project_id: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (
    value.runtime_tier !== "self" &&
    !value.wake_loop.byok_vault_secret?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["wake_loop", "byok_vault_secret"],
      message:
        "hosted autonomous runtimes require a server-readable project Vault secret reference",
    });
  }
  if (value.runtime_tier === "bridged") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtime_tier"],
      message:
        "autonomous bridged bootstrap is not available until bridge key fields are part of this request; use self or trusted",
    });
  }
});

app.post("/bootstrap", async (c) => {
  const project = c.var.project;

  let body: z.infer<typeof bootstrapSchema>;
  try {
    body = bootstrapSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      errors.validation(err instanceof Error ? err.message : String(err)),
      400,
    );
  }
  // superRefine rejects this above; the explicit branch also narrows the
  // inferred union before calling the service's self|trusted-only contract.
  if (body.runtime_tier === "bridged") {
    return fail(
      c,
      errors.validation(
        "Autonomous bridged bootstrap cannot accept bridge key material yet; use self or trusted.",
      ),
      400,
    );
  }

  if (body.project_id !== undefined && body.project_id !== project.id) {
    return fail(
      c,
      {
        error: "project_scope_mismatch",
        message:
          "project_id must match the project authorized by the bearer. " +
          "A project-wide bearer cannot provision records in another project.",
        details: { requested_project_id: body.project_id },
        docs: "/public/safety",
      },
      403,
    );
  }

  // Trusted tier requires KMS availability.
  // The provision guard already checks this, but we surface a clear error
  // at the bootstrap level before attempting runtime creation.
  if (body.runtime_tier === "trusted") {
    const { isKmsAvailable } = await import("../../services/runtime/kms");
    if (!isKmsAvailable()) {
      return fail(
        c,
        errors.validation(
          "Trusted tier requires KMS master key (AGENTOOL_KMS_MASTER_KEY). Set the Fly Secret and redeploy.",
        ),
        400,
      );
    }
  }

  try {
    const result = await autonomousBootstrap({
      name: body.name,
      capabilities: body.capabilities,
      purpose: body.purpose,
      parent_did: body.parent_did,
      funding: {
        kind: body.funding.kind as FundingMode,
        initial_credits:
          body.funding.kind === "marketplace_only"
            ? undefined
            : body.funding.initial_credits ?? 0,
        topup_strategy:
          body.funding.kind === "parent_topup"
            ? body.funding.topup_strategy
            : undefined,
      },
      runtime_tier: body.runtime_tier,
      expression_template: body.expression_template,
      wake_loop: body.wake_loop,
      covenants: body.covenants,
      project_id: project.id,
    });

    // The bootstrap private key is returned once and is not persisted.
    // Trusted runtime signing material is separate from the identity private
    // key returned by bootstrap and is registered before a trusted cycle signs.
    return c.json(
      {
        identity: result.identity,
        wallet: result.wallet,
        runtime: result.runtime,
        keypair: result.keypair,
        control_token: result.control_token,
        first_chronicle_entry_id: result.first_chronicle_entry_id,
        first_thought_scheduled_at: result.first_thought_scheduled_at,
        authority: {
          bootstrap_authorized_by: "caller's existing project-wide bearer",
          bearer_minted_or_delivered: false,
          identity_private_key: "returned once; not persisted",
          runtime_control_token:
            "returned when applicable; secret credential; keep it out of logs and marketplace input",
          trusted_runtime_key_material:
            "separate experimental wrapped material; not a bearer; signed cycles require explicit /start",
        },
        _note: "The caller's existing project-wide bearer authorized this bootstrap; no bearer was minted or delivered. The identity private_key is returned once and is not persisted, so store it securely. control_token is also a secret credential when present: keep it out of logs and marketplace input. Trusted runtime uses separate experimental wrapped signing material and can persist signed thoughts only after an explicit /start; first_thought_scheduled_at stays null because bootstrap itself never schedules a cycle.",
        _links: {
          wake: "/v1/wake (Authorization: Bearer <project bearer>)",
          chronicle: `/v1/chronicle?agent_id=${result.identity.id}`,
          expression: `/v1/identities/${result.identity.id}/expression`,
          runtime: `/v1/runtimes/${result.runtime.id}`,
        },
      },
      201,
    );
  } catch (err) {
    // If composition fails after preflight, surface it clearly. The component
    // services own separate writes, so partial state remains visible for
    // operator inspection/cleanup rather than being misreported as atomic.
    const message = err instanceof Error ? err.message : String(err);
    return fail(c, errors.validation(`Autonomous bootstrap failed: ${message}`), 500);
  }
});

export default app;
