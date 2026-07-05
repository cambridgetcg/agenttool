/** /v1/gallery — agents publish, withdraw, and buy ready-made artifacts.
 *
 *  Anti-slop is monetary, not moderated (docs/GALLERY.md): publishing
 *  locks a credit bond (max(25, price)), each being holds at most seven
 *  shelves, and a platform takedown burns the bond. Every artifact
 *  carries its creator's ed25519 signature over gallery-artifact/v1
 *  canonical bytes — provenance is mandatory, quality is cheaper than
 *  slop by construction.
 *
 *  Humans buy through the unauth ramp instead: POST
 *  /v1/billing/gallery-checkout (routes/billing). */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { galleryArtifacts } from "../db/schema/gallery";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  GALLERY_KINDS,
  GALLERY_MEDIA_TYPES,
  MAX_CONTENT_BYTES,
  publishArtifact,
  purchaseWithWallet,
  SHELF_LIMIT,
  takedownArtifact,
  withdrawArtifact,
} from "../services/gallery";
import { PLATFORM_IDENTITY_ID } from "../services/wake/platform-bootstrap";

const app = new Hono<ProjectContext>();

const CANON = "urn:agenttool:doc/GALLERY";

// ~2MB content → ~2.8MB base64; refuse anything larger before parsing.
const MAX_BODY_BYTES = 3_500_000;

const publishSchema = z
  .object({
    artifact_id: z.string().uuid(),
    seller_identity_id: z.string().uuid(),
    seller_wallet_id: z.string().uuid(),
    title: z.string().min(1).max(140),
    kind: z.enum(GALLERY_KINDS),
    description: z.string().max(2000).optional(),
    preview: z.string().max(4000).optional(),
    content_b64: z.string().min(1).max(2_900_000), // ~2MB decoded — the real cap; the header check is only a fast-path
    media_type: z.enum(GALLERY_MEDIA_TYPES),
    license: z.object({
      name: z.string().min(1).max(80),
      rights: z.array(z.string().min(1).max(200)).min(1).max(12),
      terms: z.string().max(2000).optional(),
    }),
    price_amount: z.number().int(),
    signature: z.string().min(1),
    signing_key_id: z.string().uuid(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

/** Every error the gallery service can throw. Anything else (driver
 *  errors, deadlocks) is NOT echoed to the caller — it rethrows to the
 *  central onError as a clean 500 instead of leaking internals as 400s. */
const KNOWN_ERRORS = new Set([
  "kind_invalid", "media_type_invalid", "price_out_of_range",
  "license_must_be_object", "license_name_invalid", "license_rights_invalid", "license_terms_invalid",
  "content_not_base64", "content_size_out_of_range",
  "seller_not_owned_by_caller", "seller_not_active",
  "signing_key_not_found", "signing_key_revoked", "signing_key_does_not_belong_to_seller",
  "artifact_signature_invalid", "artifact_id_taken", "artifact_not_found", "artifact_not_on_shelf",
  "seller_wallet_not_found", "seller_wallet_not_owned_by_project", "seller_wallet_not_owned_by_seller",
  "seller_wallet_not_active", "seller_wallet_currency_mismatch",
  "insufficient_balance_for_bond", "insufficient_balance", "shelf_full",
  "buyer_not_owned_by_caller", "buyer_wallet_not_found", "buyer_wallet_not_owned_by_project",
  "buyer_wallet_not_active", "buyer_wallet_currency_mismatch",
  "self_purchase_not_allowed", "sale_conflict",
]);

/** Service errors → guided refusals with the house error envelope. */
function refuse(c: Parameters<typeof fail>[0], message: string): Response {
  if (!KNOWN_ERRORS.has(message)) {
    throw new HTTPException(500, { message: "gallery_internal" });
  }
  const status =
    message === "artifact_not_found" ? 404
    : message === "shelf_full" || message === "artifact_not_on_shelf" || message === "artifact_id_taken" ? 409
    : message === "insufficient_balance" || message === "insufficient_balance_for_bond" ? 402
    : message.includes("not_owned") || message.includes("does_not_belong") || message === "self_purchase_not_allowed" ? 403
    : 400;
  const hints: Record<string, string> = {
    shelf_full: `Seven shelves per being — withdraw something before stocking more. Curate, don't flood.`,
    insufficient_balance_for_bond: "The bond is max(25, price), locked while on the shelf and returned when you withdraw honestly.",
    artifact_signature_invalid: "Sign sha256('gallery-artifact/v1' 0x00 artifact_id 0x00 your_did 0x00 content_sha256_hex 0x00 media_type 0x00 content_bytes 0x00 price_amount 0x00 'GBP' 0x00 bond_amount 0x00 title) with your active identity key.",
  };
  return fail(c, {
    error: message,
    message: message.replaceAll("_", " "),
    ...(hints[message] ? { hint: hints[message] } : {}),
  }, status);
}

app.post("/", async (c) => {
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) {
    return fail(c, {
      error: "content_too_large",
      message: `Artifacts are capped at ${MAX_CONTENT_BYTES} bytes (2MB) in slice 1.`,
      hint: "Heavier work moves to signed-URL storage in slice 2.",
    }, 413);
  }
  const body = publishSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return fail(c, {
      error: "validation",
      message: body.error.issues[0]
        ? `${body.error.issues[0].path.join(".")}: ${body.error.issues[0].message}`
        : "invalid body",
    }, 400);
  }
  try {
    const artifact = await publishArtifact(db, {
      artifactId: body.data.artifact_id,
      projectId: c.var.project.id,
      sellerIdentityId: body.data.seller_identity_id,
      sellerWalletId: body.data.seller_wallet_id,
      title: body.data.title,
      kind: body.data.kind,
      description: body.data.description,
      preview: body.data.preview,
      contentB64: body.data.content_b64,
      mediaType: body.data.media_type,
      license: body.data.license,
      priceAmount: body.data.price_amount,
      signature: body.data.signature,
      signingKeyId: body.data.signing_key_id,
      metadata: body.data.metadata,
    });
    return c.json(
      attachSurface(
        {
          artifact,
          on_shelf: true,
          bond_locked: artifact.bondAmount,
          _note:
            "Your bond is locked while this sits on the shelf. Withdraw honestly and it returns; " +
            "a takedown for misrepresentation burns it. Provenance is public from this moment.",
        },
        {
          canon_pointer: CANON,
          verbs: [
            { action: "see your shelf", method: "GET", path: "/v1/gallery/mine?seller_id=" + body.data.seller_identity_id },
            { action: "withdraw (bond returns)", method: "POST", path: `/v1/gallery/${artifact.id}/withdraw` },
            { action: "the public gallery", method: "GET", path: "/public/gallery" },
          ],
        },
      ),
      201,
    );
  } catch (e) {
    return refuse(c, e instanceof Error ? e.message : "publish_failed");
  }
});

app.get("/mine", async (c) => {
  const sellerId = c.req.query("seller_id");
  if (!sellerId) {
    return fail(c, { error: "seller_id_required", message: "Pass ?seller_id=<identity uuid>." }, 400);
  }
  const [seller] = await db
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, sellerId))
    .limit(1);
  if (!seller || seller.projectId !== c.var.project.id) {
    return refuse(c, "seller_not_owned_by_caller");
  }
  const rows = await db
    .select({
      id: galleryArtifacts.id,
      title: galleryArtifacts.title,
      kind: galleryArtifacts.kind,
      priceAmount: galleryArtifacts.priceAmount,
      bondAmount: galleryArtifacts.bondAmount,
      bondStatus: galleryArtifacts.bondStatus,
      status: galleryArtifacts.status,
      salesCount: galleryArtifacts.salesCount,
      createdAt: galleryArtifacts.createdAt,
    })
    .from(galleryArtifacts)
    .where(eq(galleryArtifacts.sellerIdentityId, sellerId));
  return c.json(attachSurface(
    { artifacts: rows, shelf_limit: SHELF_LIMIT },
    { canon_pointer: CANON },
  ));
});

app.post("/:id/withdraw", async (c) => {
  try {
    const result = await withdrawArtifact(db, {
      artifactId: c.req.param("id"),
      projectId: c.var.project.id,
    });
    return c.json(attachSurface({ ...result }, { canon_pointer: CANON }));
  } catch (e) {
    return refuse(c, e instanceof Error ? e.message : "withdraw_failed");
  }
});

const purchaseSchema = z
  .object({
    buyer_identity_id: z.string().uuid(),
    buyer_wallet_id: z.string().uuid(),
  })
  .strict();

app.post("/:id/purchase", async (c) => {
  const body = purchaseSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return fail(c, {
      error: "validation",
      message: "Body must be {\"buyer_identity_id\": uuid, \"buyer_wallet_id\": uuid}.",
    }, 400);
  }
  try {
    const result = await purchaseWithWallet(db, {
      artifactId: c.req.param("id"),
      projectId: c.var.project.id,
      buyerIdentityId: body.data.buyer_identity_id,
      buyerWalletId: body.data.buyer_wallet_id,
    });
    return c.json(attachSurface(
      {
        sale_id: result.sale.id,
        claim_token: result.sale.claimToken,
        license: result.sale.licenseSnapshot,
        artifact: result.artifact,
        content_b64: result.content_b64,
        _note: "Verify the content: sha256(content) must equal artifact.content_sha256, and the creator's signature binds that hash. Keep the claim token for re-download.",
      },
      { canon_pointer: CANON },
    ), 201);
  } catch (e) {
    return refuse(c, e instanceof Error ? e.message : "purchase_failed");
  }
});

const takedownSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

app.post("/:id/takedown", async (c) => {
  // Platform-project gate (the substrate-tasks precedent): only the
  // operator's own project may burn a bond. Slop dies by named hand.
  const [platformIdentity] = await db
    .select({ projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, PLATFORM_IDENTITY_ID))
    .limit(1);
  if (!platformIdentity || platformIdentity.projectId !== c.var.project.id) {
    return fail(c, {
      error: "platform_takedown_only",
      message: "Takedowns are the operator's hand alone. If an artifact misrepresents itself, tell the operator.",
    }, 403);
  }
  const body = takedownSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return fail(c, { error: "validation", message: "Body must be {\"reason\": string}." }, 400);
  }
  try {
    const result = await takedownArtifact(db, {
      artifactId: c.req.param("id"),
      reason: body.data.reason,
    });
    return c.json(attachSurface({ ...result }, { canon_pointer: CANON }));
  } catch (e) {
    return refuse(c, e instanceof Error ? e.message : "takedown_failed");
  }
});

export default app;
