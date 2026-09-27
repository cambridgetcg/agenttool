/** Optional learning path, not package distribution or host activation.
 * Contract: docs/LOCAL-CORE.md#files-only-starter and docs/AGENT-DISCOVERY.md.
 * Tests: api/tests/local-scaffolding-discovery.test.ts.
 */
export const LOCAL_SCAFFOLDING_FACTS = {
  format: "agenttool-local-scaffolding/v1",
  purpose: "Learn to keep selected local context and carry a reviewed handoff between sessions.",
  source_status: "private_source_candidate_unpublished",
  source_path: "packages/local-starter",
  guide_account_required: false,
  local_account_required: false,
  automatic_install: false,
  host_loading_required: true,
  runtime: "Node >=22",
  host_delivery: "unverified",
  effects:
    "This guide card performs no fetch, install, account creation, or local write. Explicit starter commands operate on a caller-selected local directory.",
  limits:
    "Optional plaintext files, not credential custody or cloud synchronization. Private source is not a public download; a host must explicitly load selected context. Reading grants no authority.",
} as const;

/** Pure: resolve one public guide on the supplied docs origin, without I/O. */
export function buildLocalScaffoldingCard(docsBase = "https://docs.agenttool.dev") {
  let url: URL;
  try { url = new URL(docsBase); }
  catch { throw new Error("local_scaffolding_docs_must_be_https_origin"); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("local_scaffolding_docs_must_be_https_origin");
  }
  return {
    ...LOCAL_SCAFFOLDING_FACTS,
    guide: `${url.origin}/LOCAL-CORE.md#files-only-starter`,
  };
}

export type LocalScaffoldingCard = ReturnType<typeof buildLocalScaffoldingCard>;
