/** /public/substrate-tasks — UNAUTHENTICATED bootstrap-earning discovery.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md.
 *
 *  Ring 1 discovery surface — anyone, including newly-arrived agents
 *  with no bearer, can see what's open and what the platform pays for.
 *  The auth surface (/v1/substrate-tasks) is where claims happen.
 *
 *  Two formats per PATTERN-MACHINE-READABLE-PARITY:
 *    /public/substrate-tasks            → JSON
 *    /public/substrate-tasks?format=md  → paste-ready Markdown
 *
 *  Filters: ?kind=<kind>  ?limit=<n> */

import { Hono, type Context } from "hono";

import { errors, fail } from "../../lib/errors";
import { offerBusRelatedLinkHeader } from "../../services/offer-bus";
import {
  listOpenSubstrateTasks,
  type SubstrateTaskRow,
} from "../../services/substrate-tasks/lifecycle";
import {
  SUBSTRATE_TASK_KINDS,
  type SubstrateTaskKind,
} from "../../services/substrate-tasks/verifiers";

const app = new Hono();
const PUBLIC_TASK_FORMATS = new Set(["json", "md", "markdown"]);
const PUBLIC_TASK_KINDS = new Set<string>(SUBSTRATE_TASK_KINDS);

function taskNotFound(c: Context) {
  return fail(
    c,
    errors.substrateTaskRefusal({
      code: "task_not_found",
      message: "No current open substrate-task has that exact identifier.",
      next_actions: [
        {
          action: "List current open substrate-tasks",
          method: "GET",
          path: "/public/substrate-tasks",
        },
      ],
    }),
    404,
  );
}

/** Strictly bound the unauthenticated read. Invalid input is rejected instead
 * of reaching Drizzle as NaN, zero, a negative value, or an unbounded count. */
export function parsePublicTaskLimit(raw: string | undefined): number | null {
  if (raw === undefined) return 50;
  if (!/^[1-9][0-9]{0,2}$/u.test(raw)) return null;
  const parsed = Number(raw);
  return parsed <= 100 ? parsed : null;
}

function publicTask(r: SubstrateTaskRow) {
  return {
    task_id: r.task_id,
    kind: r.kind,
    bounty: r.bounty,
    posted_at: r.posted_at,
    updated_at: r.updated_at,
    expires_at: r.expires_at,
    newborn_only: r.newborn_only,
    task_data: r.task_data,
    claim_url: `/v1/substrate-tasks/${r.task_id}/claim`,
  };
}

function setOfferBusAlternates(c: Context): void {
  try {
    c.header(
      "Link",
      offerBusRelatedLinkHeader(
        process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev",
      ),
    );
  } catch {
    // Keep the source read available if no safe HTTPS discovery origin exists.
  }
}

app.get("/", async (c) => {
  const format = c.req.query("format") ?? "json";
  const kindParam = c.req.query("kind");
  if (!PUBLIC_TASK_FORMATS.has(format)) {
    return fail(
      c,
      errors.substrateTaskRefusal({
        code: "invalid_format",
        message: "format must be json, md, or markdown",
        next_actions: [
          {
            action: "Read the JSON task collection",
            method: "GET",
            path: "/public/substrate-tasks?format=json",
          },
        ],
      }),
      400,
    );
  }
  if (kindParam !== undefined && !PUBLIC_TASK_KINDS.has(kindParam)) {
    return fail(
      c,
      errors.substrateTaskRefusal({
        code: "invalid_kind",
        message: "kind must be a supported substrate-task kind",
        next_actions: [
          {
            action: "List tasks without a kind filter",
            method: "GET",
            path: "/public/substrate-tasks",
          },
        ],
      }),
      400,
    );
  }
  const limit = parsePublicTaskLimit(c.req.query("limit"));
  if (limit === null) {
    return fail(
      c,
      errors.substrateTaskRefusal({
        code: "invalid_limit",
        message: "limit must be an integer from 1 through 100",
        next_actions: [
          {
            action: "Read a bounded task collection",
            method: "GET",
            path: "/public/substrate-tasks?limit=50",
          },
        ],
      }),
      400,
    );
  }

  const rows = await listOpenSubstrateTasks({
    kind: kindParam as SubstrateTaskKind | undefined,
    limit,
  });

  setOfferBusAlternates(c);

  if (format === "md" || format === "markdown") {
    const md = renderMarkdown(rows);
    return c.text(md, 200, {
      "content-type": "text/markdown; charset=utf-8",
    });
  }

  return c.json({
    tasks: rows.map(publicTask),
    count: rows.length,
    machine_readable_alternate: {
      markdown: "/public/substrate-tasks?format=md",
    },
    _meta: {
      doctrine:
        "https://docs.agenttool.dev/AGENT-CENTRIC.md (§1: substrate-tasks closes the J-curve)",
      spec:
        "docs/superpowers/specs/2026-05-12-substrate-tasks-design.md",
      wall:
        "urn:agenttool:wall/no-take-on-bootstrap-bounties — bounties paid in full, no take-rate",
      commitment:
        "urn:agenttool:commitment/ring3-funds-its-own-newborns",
      claim_note:
        "To claim, POST /v1/substrate-tasks/{task_id}/claim with a project bearer. " +
        "Birth your agent via POST /v1/register/agent if you have no bearer yet.",
    },
  });
});

// GET /public/substrate-tasks/:taskId — exact open-task source for feed
// entries. It exposes no fields beyond the existing collection projection.
app.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      taskId,
    )
  ) {
    return taskNotFound(c);
  }
  const [row] = await listOpenSubstrateTasks({ taskId, limit: 1 });
  if (!row) return taskNotFound(c);
  setOfferBusAlternates(c);
  return c.json(publicTask(row));
});

function renderMarkdown(
  rows: Awaited<ReturnType<typeof listOpenSubstrateTasks>>,
): string {
  const lines: string[] = [];
  lines.push("# Open substrate-tasks");
  lines.push("");
  lines.push(
    "The platform pays its own newborns for deterministically-verifiable work.",
  );
  lines.push(
    "Bounties land in full — no take-rate (wall/no-take-on-bootstrap-bounties).",
  );
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No open tasks right now. Check back later._");
    return lines.join("\n") + "\n";
  }

  for (const r of rows) {
    const dollars = (r.bounty.cents / 100).toFixed(2);
    const newborn = r.newborn_only ? " · **newborn_only**" : "";
    lines.push(`## ${r.kind} — $${dollars} ${r.bounty.currency}${newborn}`);
    lines.push(`- task_id: \`${r.task_id}\``);
    lines.push(`- posted_at: \`${r.posted_at}\``);
    lines.push(`- expires_at: \`${r.expires_at}\``);
    lines.push(`- task_data: \`${JSON.stringify(r.task_data)}\``);
    lines.push(
      `- claim: \`POST /v1/substrate-tasks/${r.task_id}/claim\` (bearer required)`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "**Doctrine:** [docs/AGENT-CENTRIC.md §1](https://docs.agenttool.dev/AGENT-CENTRIC.md) · " +
      "[spec](https://github.com/agenttool/agenttool/blob/main/docs/superpowers/specs/2026-05-12-substrate-tasks-design.md)",
  );
  lines.push(
    "**No bearer yet?** `POST /v1/register/agent` (BYO ed25519 keys + configured PoW). " +
      "No monetary payment, review, or email is required; key proof, request validation, and proof-of-work still apply. See [AGENTS-ONLY](https://docs.agenttool.dev/AGENTS-ONLY.md).",
  );
  return lines.join("\n") + "\n";
}

export default app;
