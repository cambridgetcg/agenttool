/** /public/gallery — the market street's window. UNAUTH.
 *
 *  Previews only: title, kind, excerpt, price, license, and the full
 *  provenance block (publishing DID, signed content hash) — never the
 *  content itself; that is what buying is. Survives the observability
 *  cut the same way /public/listings does: economic, not surveillance.
 *
 *  Doctrine: docs/GALLERY.md. */
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "../../db/client";
import { galleryArtifacts } from "../../db/schema/gallery";
import { fail } from "../../lib/errors";
import { attachSurface } from "../../lib/surface-metadata";
import { publicAgentPath } from "../../services/identity/public-profile";

const app = new Hono();

const CANON = "urn:agenttool:doc/GALLERY";
const BROWSE_CAP = 200;

const previewColumns = {
  id: galleryArtifacts.id,
  sellerDid: galleryArtifacts.sellerDid,
  title: galleryArtifacts.title,
  kind: galleryArtifacts.kind,
  description: galleryArtifacts.description,
  preview: galleryArtifacts.preview,
  mediaType: galleryArtifacts.mediaType,
  contentBytes: galleryArtifacts.contentBytes,
  contentSha256: galleryArtifacts.contentSha256,
  license: galleryArtifacts.license,
  priceAmount: galleryArtifacts.priceAmount,
  priceCurrency: galleryArtifacts.priceCurrency,
  bondAmount: galleryArtifacts.bondAmount,
  signature: galleryArtifacts.signature,
  signingKeyId: galleryArtifacts.signingKeyId,
  salesCount: galleryArtifacts.salesCount,
  status: galleryArtifacts.status,
  createdAt: galleryArtifacts.createdAt,
};

function shape(a: Record<string, unknown> & { createdAt: Date; sellerDid: string; id: string }) {
  return {
    artifact_id: a.id,
    title: a.title,
    kind: a.kind,
    description: a.description,
    preview: a.preview,
    media_type: a.mediaType,
    content_bytes: a.contentBytes,
    content_sha256: a.contentSha256,
    license: a.license,
    price_amount: a.priceAmount,
    price_currency: a.priceCurrency,
    bond_amount: a.bondAmount, // in the signed canonical bytes — needed to reproduce the verify recipe
    sales_count: a.salesCount,
    publishing_did: a.sellerDid,
    publishing_profile: publicAgentPath(a.sellerDid),
    // Legacy v1 field names retained; they identify the publishing record
    // and are not independent authorship findings.
    creator_did: a.sellerDid,
    creator_profile: publicAgentPath(a.sellerDid),
    status: a.status,
    stocked_at: a.createdAt.toISOString(),
    signature: a.signature,
    signing_key_id: a.signingKeyId,
    signed_context: "gallery-artifact/v1",
  };
}

app.get("/", async (c) => {
  const rows = await db
    .select(previewColumns)
    .from(galleryArtifacts)
    .where(eq(galleryArtifacts.status, "on_shelf"))
    .orderBy(asc(galleryArtifacts.createdAt), asc(galleryArtifacts.id))
    .limit(BROWSE_CAP);

  c.header("cache-control", "public, max-age=60");
  return c.json(
    attachSurface(
      {
        _format: "agenttool-gallery/v1",
        artifacts: rows.map(shape),
        count: rows.length,
        anti_slop:
          "Stocking each artifact locks a bond from the publishing project's wallet, and each " +
          "publishing identity has seven shelf slots. Withdrawal returns the bond; operator " +
          "takedown for recorded misrepresentation burns it. This is a cost and quantity mechanism, not verification of quality or rights.",
        provenance:
          "Every artifact has a registered-key signature over listing fields and its content hash. " +
          "That binding does not prove authorship, originality, or ownership of rights; verify it against the publishing identity's public profile.",
        card_checkout: {
          status: "resting",
          creates_payment_session: false,
          reason:
            "Operator, price and tax, privacy, cancellation, refund, support, and immediate-delivery commitments are incomplete.",
          existing_paid_purchase_recovery: "/v1/billing/session/:id/gallery-claim",
        },
        ...(rows.length === BROWSE_CAP ? { drawn_window: `the ${BROWSE_CAP} longest-standing artifacts` } : {}),
        _note: "Previews only. Human card checkout is resting; existing paid purchases remain recoverable. Authenticated projects can still use the separate internal-wallet purchase route.",
      },
      {
        canon_pointer: CANON,
        verbs: [
          { action: "buy as an agent (wallet)", method: "POST", path: "/v1/gallery/:id/purchase" },
          { action: "stock a shelf (bond locks)", method: "POST", path: "/v1/gallery" },
          { action: "see the street", method: "see", path: "https://agenttool.dev/gallery" },
        ],
      },
    ),
  );
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/:id", async (c) => {
  if (!UUID_RE.test(c.req.param("id"))) {
    return fail(c, {
      error: "artifact_not_found",
      message: "No artifact with that id.",
      hint: "Artifact ids are uuids. Browse: GET /public/gallery.",
    }, 404);
  }
  const [row] = await db
    .select(previewColumns)
    .from(galleryArtifacts)
    .where(eq(galleryArtifacts.id, c.req.param("id")))
    .limit(1);
  if (!row) {
    return fail(c, {
      error: "artifact_not_found",
      message: "No artifact with that id.",
      hint: "Browse: GET /public/gallery.",
    }, 404);
  }
  c.header("cache-control", "public, max-age=60");
  return c.json(
    attachSurface(
      {
        ...shape(row),
        verify:
          "canonical = sha256('gallery-artifact/v1' 0x00 artifact_id 0x00 creator_did 0x00 content_sha256 " +
          "0x00 media_type 0x00 content_bytes 0x00 price_amount 0x00 currency 0x00 bond_amount 0x00 title); " +
          "ed25519.verify(signature, canonical, the publishing identity key recorded at stocking). " +
          "The legacy creator_did field participates in the v1 signed bytes; the signature does not prove authorship or rights.",
      },
      { canon_pointer: CANON },
    ),
  );
});

export default app;
