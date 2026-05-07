/** Capability marketplace — publish + list + show + adopt + adoptions.
 *
 *  Doctrine: docs/MARKETPLACE.md.
 *
 *  Templates are published expression bundles (register + walls + subagents
 *  + wake_text + tags). Adoption bootstraps a NEW identity in the caller's
 *  project that follows the template's voice — distinct from fork: no
 *  parent_identity_id, no memories carry, trust resets.
 *
 *  Server-side surface (already shipped):
 *    POST   /v1/templates                       (auth'd)  publish
 *    GET    /v1/templates?author_id=X           (auth'd)  list mine
 *    GET    /v1/templates/:id                   (auth'd)  show (own private OK)
 *    GET    /v1/templates/:id/adoptions         (auth'd)  who adopted
 *    POST   /v1/identities/from-template        (auth'd)  adopt
 *    GET    /public/templates [?tag=X&limit=N]            list public
 *    GET    /public/templates/:id                         show public
 *
 *  This mode is a thin client over those endpoints. */

import { readFileSync } from "node:fs";

import { AgenttoolClient, type TemplateRecord } from "../api";
import type { ThinkConfig } from "../config";

const TTY = process.stdout.isTTY === true;
const C = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
};

function readMaybeFile(literal: string | undefined, file: string | undefined): string | undefined {
  if (literal !== undefined) return literal;
  if (file !== undefined) return readFileSync(file, "utf-8");
  return undefined;
}

function parseCsvList(s: string | undefined): string[] | undefined {
  if (s === undefined) return undefined;
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ── Publish ────────────────────────────────────────────────────────────

export interface PublishOptions {
  name: string;
  description?: string;
  register?: string;
  walls?: string[];
  subagents?: Array<{ name: string; sigil?: string; facet: string }>;
  wakeText?: string;
  tags?: string[];
  visibility: "public" | "private";
  /** When true (default) and any of register/walls/subagents/wake_text
   *  is missing, fill from the caller's current /v1/identities/:id/expression.
   *  When false, only the explicitly-provided fields are sent. */
  fromExpression: boolean;
}

export async function publishTemplate(
  config: ThinkConfig,
  opts: PublishOptions,
): Promise<void> {
  const client = new AgenttoolClient(config);

  let register = opts.register;
  let walls = opts.walls;
  let subagents = opts.subagents;
  let wakeText = opts.wakeText;

  if (opts.fromExpression) {
    const missing =
      register === undefined ||
      walls === undefined ||
      subagents === undefined ||
      wakeText === undefined;
    if (missing) {
      console.log(
        C.dim(`▸ pulling current expression from /v1/identities/${config.identityId}/expression...`),
      );
      const { expression } = await client.getIdentityExpression(config.identityId);
      if (register === undefined) register = expression.register;
      if (walls === undefined) walls = expression.walls;
      if (subagents === undefined) subagents = expression.subagents;
      if (wakeText === undefined) wakeText = expression.wake_text;
    }
  }

  if (
    register === undefined &&
    (walls === undefined || walls.length === 0) &&
    (subagents === undefined || subagents.length === 0) &&
    wakeText === undefined
  ) {
    throw new Error(
      "refusing to publish empty template: provide --register / --walls / --wake-text-file " +
        "or set an expression via PUT /v1/identities/:id/expression first.",
    );
  }

  console.log(C.dim(`▸ publishing as ${opts.visibility} template "${opts.name}"...`));
  const created = await client.createTemplate({
    author_identity_id: config.identityId,
    name: opts.name,
    description: opts.description ?? null,
    register: register ?? null,
    walls,
    subagents,
    wake_text: wakeText ?? null,
    tags: opts.tags,
    visibility: opts.visibility,
  });

  console.log("");
  console.log(C.green(`✓ template ${created.id} published`));
  console.log(C.dim(`  name:        ${created.name}`));
  console.log(C.dim(`  visibility:  ${created.visibility}`));
  console.log(C.dim(`  tags:        ${created.tags.join(", ") || "(none)"}`));
  console.log(C.dim(`  register:    ${register ? `${register.length} chars` : "(none)"}`));
  console.log(C.dim(`  walls:       ${walls?.length ?? 0}`));
  console.log(C.dim(`  subagents:   ${subagents?.length ?? 0}`));
  console.log(C.dim(`  wake_text:   ${wakeText ? `${wakeText.length} chars` : "(none)"}`));
  if (opts.visibility === "public") {
    console.log("");
    console.log(C.dim(`  Visible at:  GET /public/templates/${created.id}`));
    console.log(C.dim(`  Adoptable:   POST /v1/identities/from-template { template_id: "${created.id}" }`));
  } else {
    console.log("");
    console.log(C.dim("  Private — only your project can adopt until you patch visibility=public."));
  }
}

// ── List ───────────────────────────────────────────────────────────────

export async function listTemplates(
  config: ThinkConfig,
  opts: { mine: boolean; tag?: string; limit: number },
): Promise<void> {
  const client = new AgenttoolClient(config);

  let templates: TemplateRecord[];
  let header: string;
  if (opts.mine) {
    const r = await client.listMyTemplates(config.identityId);
    templates = r.templates;
    header = `${r.count} template${r.count === 1 ? "" : "s"} authored by you`;
  } else {
    const r = await client.listPublicTemplates({ tag: opts.tag, limit: opts.limit });
    templates = r.templates;
    const tagBit = opts.tag ? ` (tag=${opts.tag})` : "";
    header = `${r.count} public template${r.count === 1 ? "" : "s"}${tagBit}`;
  }

  if (templates.length === 0) {
    console.log(C.dim("(no templates)"));
    return;
  }

  console.log(C.bold(header));
  console.log("");
  for (const t of templates) {
    const id = C.cyan(t.id.slice(0, 8));
    const adopt = C.dim(`adoptions=${t.adoptions_count}`);
    const vis = t.visibility ? C.dim(`[${t.visibility}]`) : "";
    const status = t.status && t.status !== "active" ? C.yellow(`[${t.status}]`) : "";
    console.log(`  ${id} ${C.bold(t.name)} ${adopt} ${vis} ${status}`.trimEnd());
    console.log(C.dim(`     by ${t.author_did}`));
    if (t.description) {
      const desc = t.description.replace(/\s+/g, " ").trim();
      console.log(C.dim(`     ${desc.slice(0, 120)}${desc.length > 120 ? "…" : ""}`));
    }
    if (t.tags.length > 0) {
      console.log(C.dim(`     tags: ${t.tags.join(", ")}`));
    }
    console.log("");
  }
}

// ── Show ───────────────────────────────────────────────────────────────

export async function showTemplate(
  config: ThinkConfig,
  id: string,
): Promise<void> {
  const client = new AgenttoolClient(config);
  const t = await client.getTemplate(id);

  console.log(C.bold(t.name));
  console.log(C.dim(`id:           ${t.id}`));
  console.log(C.dim(`author:       ${t.author_did}`));
  console.log(C.dim(`visibility:   ${t.visibility ?? "(unknown)"}`));
  console.log(C.dim(`status:       ${t.status ?? "active"}`));
  console.log(C.dim(`adoptions:    ${t.adoptions_count}`));
  console.log(C.dim(`tags:         ${t.tags.join(", ") || "(none)"}`));
  console.log(C.dim(`created:      ${t.created_at}`));
  if (t.updated_at) console.log(C.dim(`updated:      ${t.updated_at}`));
  console.log("");
  if (t.description) {
    console.log(C.bold("Description"));
    console.log(t.description);
    console.log("");
  }
  if (t.register) {
    console.log(C.bold("Register"));
    console.log(t.register);
    console.log("");
  }
  if (t.walls && t.walls.length > 0) {
    console.log(C.bold(`Walls (${t.walls.length})`));
    for (const w of t.walls) console.log(`  · ${w}`);
    console.log("");
  }
  if (t.subagents && t.subagents.length > 0) {
    console.log(C.bold(`Subagents (${t.subagents.length})`));
    for (const s of t.subagents) {
      const sigil = s.sigil ? `${s.sigil} ` : "";
      console.log(`  ${sigil}${C.bold(s.name)} — ${s.facet}`);
    }
    console.log("");
  }
  if (t.wake_text) {
    console.log(C.bold("Wake text"));
    console.log(t.wake_text);
    console.log("");
  }
  console.log(
    C.dim(
      `Adopt:  agenttool-think template adopt ${t.id} --as 'New Name'`,
    ),
  );
}

// ── Adopt ──────────────────────────────────────────────────────────────

export async function adoptTemplate(
  config: ThinkConfig,
  opts: { templateId: string; newName: string; inheritTags: boolean },
): Promise<void> {
  const client = new AgenttoolClient(config);

  console.log(C.dim(`▸ adopting template ${opts.templateId} as "${opts.newName}"...`));
  const r = await client.adoptTemplate({
    template_id: opts.templateId,
    new_name: opts.newName,
    inherit_tags: opts.inheritTags,
  });

  console.log("");
  console.log(C.green(`✓ adoption complete — new identity created`));
  console.log("");
  console.log(C.bold("New identity"));
  console.log(C.dim(`  id:          ${r.identity.id}`));
  console.log(C.dim(`  did:         ${r.identity.did}`));
  console.log(C.dim(`  name:        ${r.identity.name}`));
  console.log(
    C.dim(`  capabilities: ${r.identity.capabilities.join(", ") || "(none)"}`),
  );
  console.log("");
  console.log(C.bold("Following"));
  console.log(C.dim(`  template:    ${r.template.name} (${r.template.id})`));
  console.log(C.dim(`  author:      ${r.template.author_did}`));
  console.log("");
  console.log(C.yellow("⚠ Signing keypair returned ONCE — save it now:"));
  console.log("");
  console.log(C.bold("  signing_key_id (kid):"));
  console.log(`    ${r.key.kid}`);
  console.log(C.bold("  signing_public_key (ed25519, base64):"));
  console.log(`    ${r.key.public_key}`);
  console.log(C.bold("  signing_private_key (ed25519, base64):"));
  console.log(`    ${r.key.private_key}`);
  console.log("");
  console.log(C.dim("Next steps for the new agent:"));
  console.log(
    C.dim(
      "  1. Store the signing private_key — never persisted server-side, you cannot retrieve it.",
    ),
  );
  console.log(
    C.dim(
      "  2. Run `agenttool-think init` in a separate AGENTTOOL_THINK_HOME to generate K_master + box key.",
    ),
  );
  console.log(C.dim("  3. Replace the auto-generated signing key with the one above (or upload"));
  console.log(C.dim("     a fresh signing pubkey via POST /v1/identities/:id/keys)."));
  console.log(C.dim("  4. The new identity has NO memories, NO covenants, NO strands — adoption"));
  console.log(C.dim("     ≠ fork. Trust score starts at 0; metadata.attribution_required is set."));
  if (r.note) {
    console.log("");
    console.log(C.dim(`  ${r.note}`));
  }
}

// ── Adoptions (who adopted MY template) ────────────────────────────────

export async function listAdoptions(
  config: ThinkConfig,
  templateId: string,
): Promise<void> {
  const client = new AgenttoolClient(config);
  const r = await client.listTemplateAdoptions(templateId);

  if (r.count === 0) {
    console.log(C.dim("(no adoptions yet)"));
    return;
  }

  console.log(C.bold(`${r.count} adoption${r.count === 1 ? "" : "s"} of template ${templateId}`));
  console.log("");
  for (const a of r.adoptions) {
    const time = C.dim(new Date(a.adopted_at).toISOString().slice(0, 16).replace("T", " "));
    console.log(`  ${time}  ${a.adopted_by_did}`);
  }
}

// ── Flag helpers (shared with dispatcher) ──────────────────────────────

export function parseTagsFlag(s: string | undefined): string[] | undefined {
  return parseCsvList(s);
}

export function readTextFromLiteralOrFile(
  literal: string | undefined,
  file: string | undefined,
): string | undefined {
  return readMaybeFile(literal, file);
}
