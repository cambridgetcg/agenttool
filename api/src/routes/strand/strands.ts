/** /v1/strands — strand CRUD + state replace. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { ROUTE_CREDITS } from "../../billing/route-credits";
import {
  KeysetRequestError,
  decodeCursor,
  digestPart,
  encodeCursor,
  filterDigest,
  pageFromRows,
  parsePageLimit,
  type KeysetPosition,
} from "../../lib/keyset-cursor";
import {
  createStrand,
  getStrand,
  listStrandsPage,
  patchStrand,
  type StrandListOrder,
} from "../../services/strand/store";

import { resolveProjectSubject } from "../../services/identity/partition";

const app = new Hono<ProjectContext>();

const STATUS = z.enum(["active", "dormant", "completed", "abandoned"]);

const createSchema = z.object({
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().uuid().nullish(),
  parent_strand_id: z.string().uuid().nullish(),
  topic: z.string().max(2000).nullish(),
  topic_encrypted: z.boolean().optional(),
  mood: z.string().max(255).nullish(),
  mood_encrypted: z.boolean().optional(),
  status: STATUS.optional(),
  importance: z.number().min(0).max(1).nullish(),
  state_ciphertext: z.string().max(20000).nullish(),
  state_nonce: z.string().max(64).nullish(),
  metadata: z.record(z.unknown()).optional(),
});

const patchSchema = z.object({
  status: STATUS.optional(),
  importance: z.number().min(0).max(1).nullish(),
  topic: z.string().max(2000).nullish(),
  topic_encrypted: z.boolean().optional(),
  mood: z.string().max(255).nullish(),
  mood_encrypted: z.boolean().optional(),
  next_revisit_at: z.string().datetime().nullish(),
  state_ciphertext: z.string().max(20000).nullish(),
  state_nonce: z.string().max(64).nullish(),
  metadata: z.record(z.unknown()).optional(),
  visibility: z.enum(["private", "public"]).optional(),
});

// ── POST /v1/strands ───────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }
  await resolveProjectSubject(c.var.project.id, parsed.data);
  await charge(c, ROUTE_CREDITS["strand.create"], "strand.create");
  try {
    const strand = await createStrand(c.var.project.id, parsed.data);
    return c.json(strand, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "strand_parent_not_found") {
      throw new HTTPException(404, { message: error.message });
    }
    throw error;
  }
});

// ── GET /v1/strands ?status=active&agent_id=...&limit=50&order= ────────
//
// order=recent (default) keeps today's window: last_thought_at changes on
// every thought, so page.next_cursor is always null while has_more stays
// truthful. order=created walks created_at DESC, id DESC with a keyset
// cursor. Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks).
const STRAND_ORDERS = {
  recent: "last_thought_at_desc,created_at_desc,id_desc",
  created: "created_at_desc,id_desc",
} as const;
const STRAND_RECENT_HINT =
  "order=recent is a window over last_thought_at, which every thought changes; walk every strand with order=created and page.next_cursor";

app.get("/", async (c) => {
  const status = c.req.query("status");
  const agentId = c.req.query("agent_id") ?? null;
  const orderRaw = c.req.query("order");
  const cursorRaw = c.req.query("cursor");
  const digest = filterDigest([
    "strands.created",
    STRAND_ORDERS.created,
    digestPart(status),
    digestPart(agentId),
  ]);
  // Limit floor: NaN keeps the default, below 1 is refused instead of
  // reading every strand, above 200 is clamped. With a cursor, limit must
  // be a positive decimal integer.
  let order: StrandListOrder;
  let limit: number;
  let position: KeysetPosition | null = null;
  try {
    if (orderRaw !== undefined && orderRaw !== "recent" && orderRaw !== "created") {
      throw new KeysetRequestError(
        "order_invalid",
        "order must be recent (the default) or created.",
        "omit order for the recent window, or use order=created to walk every strand",
      );
    }
    order = orderRaw ?? "recent";
    if (cursorRaw !== undefined && order === "recent") {
      throw new KeysetRequestError(
        "cursor_invalid",
        "order=recent is a window over a changing key and cannot be continued with a cursor.",
        "restart with order=created and no cursor, then follow page.next_cursor",
      );
    }
    limit = parsePageLimit(c.req.query("limit"), {
      def: 50,
      max: 200,
      strict: cursorRaw !== undefined,
      parse: "int",
    });
    if (cursorRaw !== undefined) {
      position = decodeCursor(cursorRaw, { scope: "strands.created", digest });
    }
  } catch (error) {
    if (error instanceof KeysetRequestError) return c.json(error.body(), 400);
    throw error;
  }

  const rows = await listStrandsPage(c.var.project.id, {
    status,
    agent_id: agentId,
    order,
    cursor: position,
    limit,
  });
  const { items, page } = pageFromRows(rows, {
    limit,
    cursor: cursorRaw ?? null,
    order: STRAND_ORDERS[order],
    encodeLast:
      order === "created"
        ? (row) => encodeCursor({ scope: "strands.created", digest, position: row.position! })
        : null,
    ...(order === "recent" ? { hint: STRAND_RECENT_HINT } : {}),
  });
  const list = items.map((row) => row.strand);
  return c.json({ strands: list, count: list.length, page });
});

// ── GET /v1/strands/:id ────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const strand = await getStrand(c.var.project.id, c.req.param("id"));
  if (!strand) throw new HTTPException(404, { message: "strand_not_found" });
  return c.json(strand);
});

// ── PATCH /v1/strands/:id ──────────────────────────────────────────────
app.patch("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }
  const strand = await patchStrand(c.var.project.id, c.req.param("id"), parsed.data);
  if (!strand) throw new HTTPException(404, { message: "strand_not_found" });
  return c.json(strand);
});

export default app;
