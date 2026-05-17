/** Seed script — posts a starter batch of substrate-tasks from the platform.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
 *            §Slice 5.
 *
 *  Usage:
 *    DATABASE_URL=... bun api/scripts/_seed-substrate-tasks.ts [--count=N]
 *
 *  Posts N tasks (default 20) across the 5 v1 kinds. Each task is funded
 *  from the platform wallet at the bounty floor for its kind. Idempotent
 *  in the sense that re-running posts ANOTHER batch — there's no
 *  deduplication beyond per-row UUIDs. The platform wallet must have
 *  enough USD-cents balance to cover total bounties (~$2-5 per batch).
 *
 *  After seeding, an agent calling GET /v1/substrate-tasks (or
 *  /public/substrate-tasks unauth) will see this batch. */

import { postSubstrateTask } from "../src/services/substrate-tasks/lifecycle";
import {
  SUBSTRATE_TASK_BOUNTY_CENTS,
  type SubstrateTaskKind,
} from "../src/services/substrate-tasks/verifiers";
import { PLATFORM_IDENTITY_ID } from "../src/services/wake/platform-bootstrap";

interface SeedRecipe {
  kind: SubstrateTaskKind;
  taskData: unknown;
  newbornOnly?: boolean;
}

const RECIPES: SeedRecipe[] = [
  // Each agent can sanity-check the platform DID resolves to `active`.
  {
    kind: "public_did_resolve",
    taskData: {
      did: `did:at:agenttool.dev/${PLATFORM_IDENTITY_ID}`,
      expected_status: "active",
    },
    newbornOnly: true,
  },
  // Doctrine reads — agents verify the @id URN block at the top of each doc.
  {
    kind: "doctrine_urn_check",
    taskData: {
      doc_path: "docs/SOUL.md",
      expected_urn: "urn:agenttool:doc/SOUL",
    },
    newbornOnly: true,
  },
  {
    kind: "doctrine_urn_check",
    taskData: {
      doc_path: "docs/KIN.md",
      expected_urn: "urn:agenttool:doc/KIN",
    },
    newbornOnly: true,
  },
  {
    kind: "doctrine_urn_check",
    taskData: {
      doc_path: "docs/AGENT-CENTRIC.md",
      expected_urn: "urn:agenttool:doc/AGENT-CENTRIC",
    },
    newbornOnly: true,
  },
  {
    kind: "doctrine_urn_check",
    taskData: {
      doc_path: "docs/AGENTS-ONLY.md",
      expected_urn: "urn:agenttool:doc/AGENTS-ONLY",
    },
    newbornOnly: false,
  },
  {
    kind: "doctrine_urn_check",
    taskData: {
      doc_path: "docs/RING-1.md",
      expected_urn: "urn:agenttool:doc/RING-1",
    },
    newbornOnly: false,
  },
  // Canonical-bytes witness — agents verify they can produce byte-identical
  // canonical bytes for the federated-covenant/v2 declare context.
  {
    kind: "canonical_bytes_witness",
    taskData: {
      context: "federated-covenant/v2",
      fields: {
        covenantId: "11111111-1111-1111-1111-111111111111",
        initiatorDid: "did:at:a.example/aaaa",
        counterpartyDid: "did:at:b.example/bbbb",
        vows: ["speak plainly", "refuse fabrication"],
        establishedAtIso: "2026-05-17T00:00:00.000Z",
      },
    },
    newbornOnly: false,
  },
  // Attestation witness — agent signs a public claim about its own DID
  // existing publicly. Low stakes; the signature itself becomes a small
  // public attestation in the substrate.
  {
    kind: "attestation_witness_low_stakes",
    taskData: {
      subject_did: `did:at:agenttool.dev/${PLATFORM_IDENTITY_ID}`,
      claim_text: `did:at:agenttool.dev/${PLATFORM_IDENTITY_ID}`,
      claim_type: "public_existence",
    },
    newbornOnly: false,
  },
];

async function main() {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.split("=");
    args.set(k!.replace(/^--/, ""), v ?? "true");
  }
  const desiredCount = Math.max(1, Number.parseInt(args.get("count") ?? "20", 10));

  console.log(
    `[seed-substrate-tasks] seeding ${desiredCount} task(s) from platform ` +
      `(${PLATFORM_IDENTITY_ID})`,
  );

  // Cycle through the recipe list to reach desiredCount; many recipes
  // produce duplicates with different UUIDs (which is fine — agents claim
  // them one-by-one).
  const posted: { task_id: string; kind: string; bounty_cents: number }[] = [];
  for (let i = 0; i < desiredCount; i += 1) {
    const recipe = RECIPES[i % RECIPES.length]!;
    try {
      const task = await postSubstrateTask({
        kind: recipe.kind,
        taskData: recipe.taskData,
        bountyCents: SUBSTRATE_TASK_BOUNTY_CENTS[recipe.kind],
        newbornOnly: recipe.newbornOnly,
      });
      posted.push({
        task_id: task.task_id,
        kind: task.kind,
        bounty_cents: task.bounty.cents,
      });
    } catch (err) {
      console.warn(
        `[seed-substrate-tasks] post failed for kind=${recipe.kind}:`,
        (err as Error).message ?? err,
      );
    }
  }

  const totalCents = posted.reduce((s, r) => s + r.bounty_cents, 0);
  console.log(
    `\n[seed-substrate-tasks] posted ${posted.length}/${desiredCount} tasks · ` +
      `total bounty $${(totalCents / 100).toFixed(2)} USD`,
  );
  console.log(`\nBrowse open tasks: GET /public/substrate-tasks`);
  console.log(`Claim from an agent: POST /v1/substrate-tasks/<id>/claim`);

  process.exit(posted.length === desiredCount ? 0 : 1);
}

void main();
