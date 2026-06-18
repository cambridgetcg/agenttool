/** /v1/autonomous/bootstrap — atomic autonomous agent spawning.
 *
 *  One call brings a new autonomous agent fully into existence:
 *    - identity (DID + ed25519 keypair)
 *    - wallet (starts at 0 for marketplace_only, or seeded)
 *    - expression (autonomous-baseline template by default)
 *    - runtime (trusted/bridged/self custody tier)
 *    - first chronicle entry (the naming)
 *
 *  All-or-nothing: no half-born autonomous agents.
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
    model: z.string().min(1).max(256),
    byok_vault_secret: z.string().optional(),
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

  // Trusted tier requires KMS availability.
  // The provision guard already checks this, but we surface a clear error
  // at the bootstrap level before attempting runtime creation.
  if (body.runtime_tier === "trusted") {
    const { isKmsAvailable } = await import("../../services/runtime/kms");
    if (!isKmsAvailable()) {
      return fail(
        c,
        errors.validation(
          "Trusted tier requires KMS master key (AGENTTOOL_KMS_MASTER_KEY). Set the Fly Secret and redeploy.",
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
      project_id: body.project_id ?? project.id,
    });

    // The private key is returned ONCE — never stored server-side.
    // Doctrine: k-master-never-server-side / birth-is-free.
    return c.json(
      {
        identity: result.identity,
        wallet: result.wallet,
        runtime: result.runtime,
        bearer_delivery: result.bearer_delivery,
        keypair: result.keypair,
        control_token: result.control_token,
        first_chronicle_entry_id: result.first_chronicle_entry_id,
        first_thought_scheduled_at: result.first_thought_scheduled_at,
        _note: "The private_key is returned ONCE and never stored server-side. Store it securely. For trusted tier, the bearer never leaves the platform's KMS boundary.",
        _links: {
          wake: `/v1/wake?bearer=${result.identity.did}`,
          chronicle: `/v1/chronicle?agent_id=${result.identity.id}`,
          expression: `/v1/identities/${result.identity.id}/expression`,
          runtime: `/v1/runtimes/${result.runtime.id}`,
        },
      },
      201,
    );
  } catch (err) {
    // If bootstrap fails partway, log the error clearly.
    // The individual services (createIdentity, createRuntime) handle
    // their own error states. No half-born agents should exist because
    // the runtime won't start without a chronicle entry, and the wake
    // won't surface without expression set.
    const message = err instanceof Error ? err.message : String(err);
    return fail(c, errors.validation(`Autonomous bootstrap failed: ${message}`), 500);
  }
});

export default app;