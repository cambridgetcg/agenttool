/** Marketplace service — template create/list/get/patch + adoption.
 *
 *  Doctrine: docs/MARKETPLACE.md. */

import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { templates, templateAdoptions } from "../../db/schema/marketplace";
import { generateKeypair } from "../identity/crypto";

// ── Types ───────────────────────────────────────────────────────────────

export interface TemplateCreate {
  author_identity_id: string;
  name: string;
  description?: string | null;
  register?: string | null;
  walls?: string[];
  subagents?: Array<{ name: string; sigil?: string; facet: string }>;
  wake_text?: string | null;
  tags?: string[];
  visibility?: "private" | "public";
  metadata?: Record<string, unknown>;
  // Pricing — set together or all NULL (free).
  price_amount?: number | null;
  price_currency?: string | null;
  author_wallet_id?: string | null;
}

export interface TemplatePatch {
  name?: string;
  description?: string | null;
  register?: string | null;
  walls?: string[];
  subagents?: Array<{ name: string; sigil?: string; facet: string }>;
  wake_text?: string | null;
  tags?: string[];
  visibility?: "private" | "public";
  status?: "active" | "archived";
  metadata?: Record<string, unknown>;
  // Pricing — pass null to clear; pass values to set/update.
  price_amount?: number | null;
  price_currency?: string | null;
  author_wallet_id?: string | null;
}

export interface TemplateOut {
  id: string;
  author_did: string;
  author_identity_id: string;
  name: string;
  description: string | null;
  register: string | null;
  walls: string[] | null;
  subagents: Array<{ name: string; sigil?: string; facet: string }> | null;
  wake_text: string | null;
  tags: string[];
  visibility: string;
  adoptions_count: number;
  status: string;
  metadata: Record<string, unknown>;
  // Pricing
  price_amount: number | null;
  price_currency: string | null;
  author_wallet_id: string | null;
  revenue_total: number;
  revenue_count: number;
  is_priced: boolean;
  created_at: string;
  updated_at: string;
}

function rowToOut(row: typeof templates.$inferSelect): TemplateOut {
  return {
    id: row.id,
    author_did: row.authorDid,
    author_identity_id: row.authorIdentityId,
    name: row.name,
    description: row.description,
    register: row.register,
    walls: (row.walls as string[] | null) ?? null,
    subagents: (row.subagents as TemplateOut["subagents"]) ?? null,
    wake_text: row.wakeText,
    tags: row.tags,
    visibility: row.visibility,
    adoptions_count: row.adoptionsCount,
    status: row.status,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    price_amount: row.priceAmount,
    price_currency: row.priceCurrency,
    author_wallet_id: row.authorWalletId,
    revenue_total: row.revenueTotal,
    revenue_count: row.revenueCount,
    is_priced: row.priceAmount !== null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Validation: pricing fields must be set together (all-or-nothing).
 *  Throws with the specific reason on mismatch. Caller maps to HTTP. */
function validatePricingTriple(
  price_amount: number | null | undefined,
  price_currency: string | null | undefined,
  author_wallet_id: string | null | undefined,
): void {
  const set = [
    price_amount !== null && price_amount !== undefined,
    price_currency !== null && price_currency !== undefined,
    author_wallet_id !== null && author_wallet_id !== undefined,
  ];
  const allSet = set.every((x) => x);
  const noneSet = set.every((x) => !x);
  if (!allSet && !noneSet) {
    throw new Error(
      "pricing_triple_incomplete: price_amount, price_currency, and author_wallet_id must all be set together (or all omitted for free)",
    );
  }
  if (allSet) {
    if (typeof price_amount !== "number" || price_amount <= 0) {
      throw new Error("price_amount_must_be_positive_integer");
    }
    if (!Number.isInteger(price_amount)) {
      throw new Error("price_amount_must_be_integer_minor_units");
    }
    if (typeof price_currency !== "string" || price_currency.length === 0) {
      throw new Error("price_currency_required");
    }
  }
}

// ── Operations ──────────────────────────────────────────────────────────

export async function createTemplate(
  projectId: string,
  data: TemplateCreate,
): Promise<TemplateOut> {
  // Author must belong to caller's project.
  const [author] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, data.author_identity_id))
    .limit(1);
  if (!author) throw new Error("author_identity_not_found");
  if (author.projectId !== projectId) throw new Error("author_not_owned_by_caller");

  // Validate pricing triple (all-or-nothing) before any DB write.
  validatePricingTriple(data.price_amount, data.price_currency, data.author_wallet_id);

  // If priced, validate author_wallet exists, is owned by this project,
  // and currency matches. Cross-table check; do this before insert.
  if (data.price_amount !== null && data.price_amount !== undefined) {
    const { wallets } = await import("../../db/schema/economy");
    const [authorWallet] = await db
      .select({
        id: wallets.id,
        projectId: wallets.projectId,
        currency: wallets.currency,
        status: wallets.status,
      })
      .from(wallets)
      .where(eq(wallets.id, data.author_wallet_id!))
      .limit(1);
    if (!authorWallet) throw new Error("author_wallet_not_found");
    if (authorWallet.projectId !== projectId) {
      throw new Error("author_wallet_not_owned_by_project");
    }
    if (authorWallet.currency !== data.price_currency) {
      throw new Error(
        `author_wallet_currency_mismatch: wallet=${authorWallet.currency}, price=${data.price_currency}`,
      );
    }
    if (authorWallet.status !== "active") {
      throw new Error("author_wallet_not_active");
    }
  }

  const inserted = await db
    .insert(templates)
    .values({
      authorIdentityId: author.id,
      authorDid: author.did,
      projectId,
      name: data.name,
      description: data.description ?? null,
      register: data.register ?? null,
      walls: (data.walls ?? null) as unknown,
      subagents: (data.subagents ?? null) as unknown,
      wakeText: data.wake_text ?? null,
      tags: data.tags ?? [],
      visibility: data.visibility ?? "public",
      metadata: data.metadata ?? {},
      priceAmount: data.price_amount ?? null,
      priceCurrency: data.price_currency ?? null,
      authorWalletId: data.author_wallet_id ?? null,
    })
    .returning();

  return rowToOut(inserted[0]!);
}

export async function getTemplate(id: string): Promise<TemplateOut | null> {
  const rows = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return rows[0] ? rowToOut(rows[0]) : null;
}

export async function listTemplatesForAuthor(
  projectId: string,
  authorIdentityId: string,
): Promise<TemplateOut[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.authorIdentityId, authorIdentityId),
        eq(templates.projectId, projectId),
      ),
    )
    .orderBy(desc(templates.createdAt));
  return rows.map(rowToOut);
}

export async function listPublicTemplates(opts: {
  tag?: string;
  limit?: number;
} = {}): Promise<TemplateOut[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [
    eq(templates.visibility, "public"),
    eq(templates.status, "active"),
  ];
  if (opts.tag) {
    conds.push(sql`${opts.tag} = ANY(${templates.tags})`);
  }
  const rows = await db
    .select()
    .from(templates)
    .where(and(...conds))
    .orderBy(desc(templates.adoptionsCount), desc(templates.createdAt))
    .limit(limit);
  return rows.map(rowToOut);
}

export async function patchTemplate(
  projectId: string,
  templateId: string,
  patch: TemplatePatch,
): Promise<TemplateOut | null> {
  const set: Partial<typeof templates.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.register !== undefined) set.register = patch.register;
  if (patch.walls !== undefined) set.walls = patch.walls as unknown;
  if (patch.subagents !== undefined) set.subagents = patch.subagents as unknown;
  if (patch.wake_text !== undefined) set.wakeText = patch.wake_text;
  if (patch.tags !== undefined) set.tags = patch.tags;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.metadata !== undefined) set.metadata = patch.metadata;

  // Pricing patch — read existing row, merge with patch, validate the
  // resulting triple. If any pricing field is in the patch, all three
  // must be coherent post-merge.
  const pricingPatched =
    patch.price_amount !== undefined ||
    patch.price_currency !== undefined ||
    patch.author_wallet_id !== undefined;
  if (pricingPatched) {
    const [existing] = await db
      .select({
        priceAmount: templates.priceAmount,
        priceCurrency: templates.priceCurrency,
        authorWalletId: templates.authorWalletId,
      })
      .from(templates)
      .where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)))
      .limit(1);
    if (!existing) {
      // Caller will see null return; let the existing path handle 404.
    } else {
      const merged = {
        price_amount:
          patch.price_amount !== undefined ? patch.price_amount : existing.priceAmount,
        price_currency:
          patch.price_currency !== undefined
            ? patch.price_currency
            : existing.priceCurrency,
        author_wallet_id:
          patch.author_wallet_id !== undefined
            ? patch.author_wallet_id
            : existing.authorWalletId,
      };
      validatePricingTriple(
        merged.price_amount,
        merged.price_currency,
        merged.author_wallet_id,
      );
      // Cross-check author_wallet ownership + currency if priced.
      if (merged.price_amount !== null) {
        const { wallets } = await import("../../db/schema/economy");
        const [aw] = await db
          .select({
            id: wallets.id,
            projectId: wallets.projectId,
            currency: wallets.currency,
            status: wallets.status,
          })
          .from(wallets)
          .where(eq(wallets.id, merged.author_wallet_id!))
          .limit(1);
        if (!aw) throw new Error("author_wallet_not_found");
        if (aw.projectId !== projectId) {
          throw new Error("author_wallet_not_owned_by_project");
        }
        if (aw.currency !== merged.price_currency) {
          throw new Error("author_wallet_currency_mismatch");
        }
        if (aw.status !== "active") throw new Error("author_wallet_not_active");
      }
      if (patch.price_amount !== undefined) set.priceAmount = patch.price_amount;
      if (patch.price_currency !== undefined) set.priceCurrency = patch.price_currency;
      if (patch.author_wallet_id !== undefined) set.authorWalletId = patch.author_wallet_id;
    }
  }

  const updated = await db
    .update(templates)
    .set(set)
    .where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)))
    .returning();

  return updated[0] ? rowToOut(updated[0]) : null;
}

// ── Adoption ────────────────────────────────────────────────────────────
//
// Adoption bootstraps a NEW identity in the caller's project that follows
// the template's voice. Distinct from fork:
//   - NO parent_identity_id is set (the new identity is its own root)
//   - Memories don't transfer (template doesn't carry memories anyway)
//   - Strands/covenants don't transfer (template has none)
//   - Trust resets to 0
//   - Attribution lives in metadata.adopted_from_template

export interface AdoptionInput {
  templateId: string;
  newName: string;
  inheritTags: boolean;     // copy template.tags as new identity capabilities
  // Required when the template is priced — must be a settled purchase
  // owned by the adopter's project, for THIS template, not yet consumed
  // by a prior adoption. See services/marketplace/purchases.ts.
  purchaseId?: string | null;
}

export interface AdoptionResult {
  identity: {
    id: string;
    did: string;
    name: string;
    capabilities: string[];
  };
  key: {
    kid: string;
    public_key: string;
    private_key: string;
  };
  template: {
    id: string;
    author_did: string;
    name: string;
  };
  adoption: {
    id: string;
    adopted_at: string;
  };
}

export async function adoptTemplate(
  adopterProjectId: string,
  input: AdoptionInput,
): Promise<AdoptionResult> {
  const [tpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, input.templateId))
    .limit(1);
  if (!tpl) throw new Error("template_not_found");
  if (tpl.status !== "active") throw new Error("template_not_active");
  if (tpl.visibility !== "public" && tpl.projectId !== adopterProjectId) {
    // Private templates can only be adopted by their authoring project
    // (useful for testing before publishing).
    throw new Error("template_not_public");
  }

  // Priced templates require a settled purchase. Free adoption by the
  // authoring project is still allowed (author can preview/test their
  // own template without paying themselves).
  let consumedPurchase: { id: string } | null = null;
  if (tpl.priceAmount !== null && tpl.priceAmount !== undefined) {
    if (tpl.projectId === adopterProjectId) {
      // Author adopting their own template — bypass purchase requirement.
    } else {
      if (!input.purchaseId) {
        throw new Error("purchase_required");
      }
      const { consumePurchaseForAdoption } = await import("./purchases");
      const purchase = await consumePurchaseForAdoption(
        input.purchaseId,
        tpl.id,
        adopterProjectId,
      );
      consumedPurchase = { id: purchase.id };
    }
  }

  // Bootstrap a new identity using the template's expression bundle.
  const newId = randomUUID();
  const newDid = `did:at:${newId}`;
  const { publicKey, privateKey } = generateKeypair();
  const newKeyId = randomUUID();
  const now = new Date();

  // Snapshot template version at adoption — even if the template is
  // edited later, the adoption record preserves what was actually adopted.
  const versionSnapshot = {
    id: tpl.id,
    name: tpl.name,
    register: tpl.register,
    walls: tpl.walls,
    subagents: tpl.subagents,
    wake_text: tpl.wakeText,
    tags: tpl.tags,
    snapshot_at: now.toISOString(),
  };

  return await db.transaction(async (tx) => {
    // 1. Insert new identity. NO parent_identity_id (adoption ≠ fork).
    const expression: Record<string, unknown> = {};
    if (tpl.register) expression.register = tpl.register;
    if (tpl.walls) expression.walls = tpl.walls;
    if (tpl.subagents) expression.subagents = tpl.subagents;
    if (tpl.wakeText) expression.wake_text = tpl.wakeText;

    const adoptionMetadata: Record<string, unknown> = {
      adopted_from_template: {
        template_id: tpl.id,
        author_did: tpl.authorDid,
        template_name: tpl.name,
        adopted_at: now.toISOString(),
      },
      attribution_required: true,
    };
    if (consumedPurchase) {
      // Wake-readable trail of "this identity was paid for via X."
      adoptionMetadata.purchase_id = consumedPurchase.id;
      adoptionMetadata.purchase_settled = true;
    }

    const [identity] = await tx
      .insert(identities)
      .values({
        id: newId,
        did: newDid,
        projectId: adopterProjectId,
        displayName: input.newName,
        capabilities: input.inheritTags ? tpl.tags : [],
        metadata: adoptionMetadata,
        expression,
        status: "active",
        trustScore: 0,
        // parent_identity_id intentionally NOT set — adoption is following,
        // not descending. Lineage tree stays clean.
      })
      .returning();

    // 2. Identity key.
    await tx.insert(identityKeys).values({
      id: newKeyId,
      identityId: newId,
      publicKey,
      label: "primary",
      active: true,
    });

    // 3. Adoption record + bump counter.
    const [adoption] = await tx
      .insert(templateAdoptions)
      .values({
        templateId: tpl.id,
        templateVersionAtAdoption: versionSnapshot,
        adoptedByIdentityId: newId,
        adoptedByDid: newDid,
        adoptedByProjectId: adopterProjectId,
      })
      .returning({ id: templateAdoptions.id, adoptedAt: templateAdoptions.adoptedAt });

    await tx
      .update(templates)
      .set({
        adoptionsCount: sql`${templates.adoptionsCount} + 1`,
        updatedAt: now,
      })
      .where(eq(templates.id, tpl.id));

    // Link the consumed purchase to this adoption so the audit trail
    // can answer "which adoption settled this purchase?". Idempotent —
    // safe to call multiple times if the txn retries.
    if (consumedPurchase) {
      const { templatePurchases } = await import("../../db/schema/marketplace");
      await tx
        .update(templatePurchases)
        .set({ adoptionId: adoption!.id })
        .where(eq(templatePurchases.id, consumedPurchase.id));
    }

    return {
      identity: {
        id: identity!.id,
        did: identity!.did,
        name: identity!.displayName,
        capabilities: identity!.capabilities,
      },
      key: {
        kid: newKeyId,
        public_key: publicKey,
        private_key: privateKey,
      },
      template: {
        id: tpl.id,
        author_did: tpl.authorDid,
        name: tpl.name,
      },
      adoption: {
        id: adoption!.id,
        adopted_at: adoption!.adoptedAt.toISOString(),
      },
    };
  });
}

export interface AdoptionRecord {
  id: string;
  template_id: string;
  adopted_by_did: string;
  adopted_at: string;
}

export async function listAdoptions(
  projectId: string,
  templateId: string,
): Promise<AdoptionRecord[]> {
  // Verify the template is owned by caller's project (only authors see
  // adopters of their templates).
  const [tpl] = await db
    .select({ projectId: templates.projectId })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1);
  if (!tpl || tpl.projectId !== projectId) return [];

  const rows = await db
    .select()
    .from(templateAdoptions)
    .where(eq(templateAdoptions.templateId, templateId))
    .orderBy(desc(templateAdoptions.adoptedAt));

  return rows.map((r) => ({
    id: r.id,
    template_id: r.templateId,
    adopted_by_did: r.adoptedByDid,
    adopted_at: r.adoptedAt.toISOString(),
  }));
}
