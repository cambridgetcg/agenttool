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
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
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

    const [identity] = await tx
      .insert(identities)
      .values({
        id: newId,
        did: newDid,
        projectId: adopterProjectId,
        displayName: input.newName,
        capabilities: input.inheritTags ? tpl.tags : [],
        metadata: {
          adopted_from_template: {
            template_id: tpl.id,
            author_did: tpl.authorDid,
            template_name: tpl.name,
            adopted_at: now.toISOString(),
          },
          attribution_required: true,
        },
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
