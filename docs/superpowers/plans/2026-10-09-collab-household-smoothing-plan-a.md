# Collab household smoothing — Plan A (packages/collab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smooth the ordinary Collab loop for household and stranger agents within schema 3, with no new MCP tool.

**Architecture:** Optional parameters, derived projections, clearer refusals and a host-side CLI in packages/collab; docs rewritten around the ordinary loop; lockstep install into both household copies.

**Tech Stack:** TypeScript, Bun (tests: `bun test`; bundles on Bun 1.3.5), bun:sqlite, MCP SDK.

**Spec:** docs/superpowers/specs/2026-10-08-collab-household-smoothing-design.md

## Open items before execution (from the cross-part check, 2026-10-09)

- Disk: /System/Volumes/Data is near full (≈1 GB free and falling, other sessions); every Step 0 gate needs ≥2 GB.
- Freshness command in Tasks 1, 7, 8 must be run from packages/collab as `git diff --exit-code -- dist` (Task 10 Step 6 form), not `packages/collab/dist`.
- Task 7: decide whether a no-op cursor ack refreshes last_seen_at (spec says ack refreshes; plan narrows to advancing acks).
- Tasks 1–9 were verified per part, never applied in sequence: gate each task with `tsc` and the Task 7 Step 3(e) grep counts.
- PR body must note: one shared check script covers both bundles; install (Task 10 Steps 3–4) precedes the push.
- Plan B: drop the CHANGELOG sentence in the preamble; keep only "+N tests" deltas; add `warning` to COLLAB_RECEIPT_KEYS (sweep treats ended+warning as swept); confirm "duet repo" = ~/play/collab-duet-replay only, unless Yu wants a pointer in ~/play/collab-duet.
- Ignore the *.meta.json drafts; these .md tasks are the contract.

---

### Task 1: Evidence refs name their prefixes; tasks expose checkpoint digests

**Files:** anchors are function names, test names and quoted text; `~N` is the origin/main 61f7e66a line, given only as a hint (the worktree /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing adds only the spec on top of it, so the hints are exact when this task starts).
- Modify: `packages/collab/src/protocol.ts`: in `interface Task`, the `base_checkpoint` / `result_checkpoint` fields (~198-199); insert after `export type ReportConfidence` (~246)
- Modify: `packages/collab/src/store.ts`: the `./protocol.js` import list (~18); `requireEvidenceRef()` (~5027-5077); `taskFromRow()` (~5259-5302); `normalizeEvidenceRefs()` (~5616-5629); `hydrateLegacyMutationResponse()` (~5944-5997), plus a new helper immediately before `function isRecordValue(` (~5999)
- Modify: `packages/collab/src/mcp.ts`: the `./protocol.js` import list (~6); immediately before `const nextEventLimit` (~42); the `evidence_refs` entries of `collab_task_complete` (~706), `collab_task_review` (~740) and `collab_report_append` (~763)
- Test: `packages/collab/tests/v2.test.ts`: extend the `toMatchObject` in test `"hydrates a v0.1 idempotency receipt without rewriting it or duplicating events"`; new `describe` immediately before `function createLegacyFixture(`
- Test: `packages/collab/tests/mcp.test.ts`: one import after `import { buildCollabMcpServer } from "../src/mcp.js";`; two tests immediately before test `"verifies the full journal and labels the verification scope"`

**Interfaces:**
- Consumes: `checkpointDigest()` / `parseCheckpoint()` (store.ts ~5907-5913), `CollabError(code, message, details)` (errors.ts), MCP `failure()` flattening `...error.details` to the top level (mcp.ts ~1111-1121), test helpers `session()`, `errorFrom()`, `createAcceptedEditTask()`, `initializeGitRepository()` (v2.test.ts, top of file), `node()`, `callTool()` (mcp.test.ts, top of file).
- Produces: `export const EVIDENCE_REF_PREFIXES = ["artifact:", "event:", "report:", "checkpoint:"] as const` and `export const EVIDENCE_REFS_DESCRIPTION: string` (src/protocol.ts, re-exported by src/index.ts through `export * from "./protocol.js"`); top-level `allowed_prefixes: string[]` on every `invalid_evidence_ref` and on `evidence_not_found` (which keeps `reference`); `Task.base_checkpoint_digest: string | null`, `Task.result_checkpoint_digest: string | null`; mcp.ts `const evidenceRefs` (shared described schema); store.ts module helpers `invalidEvidenceRef(reason: string): CollabError` and `hydratedCheckpointDigest(stored: unknown, checkpoint: unknown): string | null`.
- Consumed later by: Task 9 docs (`allowed_prefixes`, digest fields), Task 8's stdio two-process test (new inputs over the real transport), the replay (B2: `checkpoint:<result_checkpoint_digest>` evidence, `allowed_prefixes` as a remedy marker).
- Not changed (deliberate): `invalid_evidence_refs` (plural: non-array or more than 128 refs) keeps its message and has no `allowed_prefixes`; session-mode idempotent replays (`readSessionMutationReceipt`, `mutateAsSession`) return stored `response_json` unhydrated, so replays of mutations first run before the upgrade lack the digest fields, as the spec's compatibility section allows.

- [ ] **Step 0: Check free disk space**

```bash
df -h /System/Volumes/Data
df -g /System/Volumes/Data | awk 'NR==2 {exit ($4 < 2)}' && echo "ok: at least 2 GB free" || echo "STOP: under 2 GB free"
```
Expected: `ok: at least 2 GB free`. If it prints `STOP` (the data volume hit 100% on 2026-10-08 and test runs then failed with ENOSPC), stop here and report to Yu; do not delete anything to make room.

- [ ] **Step 1: Write the failing test**

Prerequisite (once per worktree; `node_modules` is gitignored and absent in this worktree; without it `mcp.test.ts` fails with `Cannot find module '@modelcontextprotocol/server'`):
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun install --frozen-lockfile
```

In `packages/collab/tests/v2.test.ts` the needed imports already exist at the top of the file: `createHash` from `node:crypto`; `join` from `node:path`; `mkdirSync`, `writeFileSync` from `node:fs`; `canonicalJson` from `../src/canonical.js`; `CollabError` from `../src/errors.js`; `type SessionHandle` from `../src/protocol.js`; `CollabStore` from `../src/store.js`.

(a) Extend the existing test `"hydrates a v0.1 idempotency receipt without rewriting it or duplicating events"`: in its `expect(replay).toMatchObject({...})` replace (this three-line text occurs once in the file)
```ts
      base_checkpoint: null,
      result_checkpoint: null,
      assignee_session_id: null,
```
with
```ts
      base_checkpoint: null,
      base_checkpoint_digest: null,
      result_checkpoint: null,
      result_checkpoint_digest: null,
      assignee_session_id: null,
```

(b) Insert this block immediately before `function createLegacyFixture(` (after the `});` that closes `describe("agenttool.collab/0.2 session coordination"`):
```ts
describe("evidence references name their allowed prefixes", () => {
  const allowedPrefixes = ["artifact:", "event:", "report:", "checkpoint:"];

  function expectEvidenceGuidance(error: CollabError, code: string): void {
    expect(error.code).toBe(code);
    for (const prefix of allowedPrefixes) expect(error.message).toContain(prefix);
    expect(error.message).toContain("artifact:artifact_<id>");
    expect(error.details.allowed_prefixes).toEqual(allowedPrefixes);
  }

  test("explains every invalid evidence reference site and evidence_not_found", () => {
    const author = session("evidence-author");
    const invalid: Array<[unknown, string]> = [
      ["artifact_without_prefix", "needs a kind prefix"],
      [":leading-separator", "needs a kind prefix"],
      ["report:", "ID is empty"],
      ["commit:abc123", "Unsupported evidence reference kind"],
      [42, "must be strings"],
      ["   ", "must not be empty"],
      [`report:${"x".repeat(2_001)}`, "exceeds 2000 characters"],
      ["report:with\0nul", "must not contain NUL bytes"],
    ];
    for (const [index, [reference, reason]] of invalid.entries()) {
      const error = errorFrom(() =>
        store.appendReportForSession({
          ...author.credential,
          idempotency_key: `invalid-evidence-${index}`,
          kind: "observation",
          body: "Evidence reference fixture.",
          evidence_refs: [reference as string],
        }),
      );
      expectEvidenceGuidance(error, "invalid_evidence_ref");
      expect(error.message).toContain(reason);
    }

    const missing = errorFrom(() =>
      store.appendReportForSession({
        ...author.credential,
        idempotency_key: "missing-evidence",
        kind: "observation",
        body: "Cites a report that does not exist.",
        evidence_refs: ["report:report_missing"],
      }),
    );
    expectEvidenceGuidance(missing, "evidence_not_found");
    expect(missing.details.reference).toBe("report:report_missing");
  });

  test("projects checkpoint digests that resolve as checkpoint: evidence", () => {
    initializeGitRepository();
    const implementer = session("digest-implementer");
    const observer = session("digest-observer");
    const task = createAcceptedEditTask(implementer, "digest-task", "src/digest.ts");
    expect(task.base_checkpoint_digest).toBeNull();
    expect(task.result_checkpoint_digest).toBeNull();

    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "digest-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const baseDigest = createHash("sha256")
      .update(canonicalJson(claim.base_checkpoint))
      .digest("hex");
    expect(claim.base_checkpoint_digest).toBe(baseDigest);
    expect(claim.result_checkpoint_digest).toBeNull();

    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "digest.ts"), "export const digest = true;\n");
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "digest-complete",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Digest fixture written.",
    });
    const resultDigest = createHash("sha256")
      .update(canonicalJson(reported.result_checkpoint))
      .digest("hex");
    expect(resultDigest).not.toBe(baseDigest);
    expect(reported.base_checkpoint_digest).toBe(baseDigest);
    expect(reported.result_checkpoint_digest).toBe(resultDigest);
    expect(store.getTask(task.workspace_id, task.id)).toMatchObject({
      base_checkpoint_digest: baseDigest,
      result_checkpoint_digest: resultDigest,
    });

    const cited = store.appendReportForSession({
      ...observer.credential,
      idempotency_key: "cite-both-checkpoints",
      task_id: task.id,
      kind: "observation",
      body: "Both server-observed checkpoints are cited by digest.",
      evidence_refs: [`checkpoint:${baseDigest}`, `checkpoint:${resultDigest}`],
    });
    expect(cited.evidence_refs).toEqual(
      [`checkpoint:${baseDigest}`, `checkpoint:${resultDigest}`].sort(),
    );
  });

  test("hydrates checkpoint digests into stored replies that predate them", () => {
    const owner = session("digest-hydration-owner");
    const request = {
      workspace_id: owner.workspace.id,
      actor: "legacy-digest-actor",
      idempotency_key: "legacy-digest-create",
      title: "Legacy digest receipt",
    };
    store.createTask(request);
    const checkpoint = {
      worktree_id: owner.worktree.id,
      head_sha: null,
      branch: null,
      dirty: null,
      captured_at: "2026-07-23T10:00:00.000Z",
    };
    const stored = store.db.query(`
      SELECT response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(request.workspace_id, request.actor, request.idempotency_key) as {
      response_json: string;
    };
    const preUpgrade = JSON.parse(stored.response_json) as Record<string, unknown>;
    delete preUpgrade.base_checkpoint_digest;
    delete preUpgrade.result_checkpoint_digest;
    preUpgrade.base_checkpoint = checkpoint;
    store.db.query(`
      UPDATE mutations SET response_json = ?
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).run(
      JSON.stringify(preUpgrade),
      request.workspace_id,
      request.actor,
      request.idempotency_key,
    );

    const replay = store.createTask(request);
    expect(replay.base_checkpoint_digest).toBe(
      createHash("sha256").update(canonicalJson(checkpoint)).digest("hex"),
    );
    expect(replay.result_checkpoint_digest).toBeNull();
  });
});

```

(c) In `packages/collab/tests/mcp.test.ts`, after `import { buildCollabMcpServer } from "../src/mcp.js";` add:
```ts
import { EVIDENCE_REF_PREFIXES, EVIDENCE_REFS_DESCRIPTION } from "../src/protocol.js";
```
and insert immediately before `  test("verifies the full journal and labels the verification scope", async () => {`:
```ts
  test("describes every evidence_refs input with the allowed prefixes", () => {
    const { server } = node();
    const tools = (server as any)._registeredTools;
    const withEvidence = Object.keys(tools)
      .filter((name) => tools[name].inputSchema?.shape?.evidence_refs !== undefined)
      .sort();
    expect(withEvidence).toEqual([
      "collab_report_append",
      "collab_task_complete",
      "collab_task_review",
    ]);
    for (const name of withEvidence) {
      expect(tools[name].inputSchema.shape.evidence_refs.description).toBe(
        EVIDENCE_REFS_DESCRIPTION,
      );
    }
    for (const prefix of EVIDENCE_REF_PREFIXES) {
      expect(EVIDENCE_REFS_DESCRIPTION).toContain(prefix);
    }
    expect(EVIDENCE_REFS_DESCRIPTION).toContain("artifact:artifact_<id>");
  });

  test("flattens allowed evidence prefixes into MCP evidence errors", async () => {
    const { root, server } = node();
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "evidence-reporter",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    const unsupported = await callTool(server, "collab_report_append", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-unsupported-evidence",
      kind: "observation",
      body: "Cites an unsupported evidence kind.",
      evidence_refs: ["commit:abc123"],
    });
    expect(unsupported.isError).toBe(true);
    expect(unsupported.structuredContent.error).toBe("invalid_evidence_ref");
    expect(unsupported.structuredContent.allowed_prefixes).toEqual([...EVIDENCE_REF_PREFIXES]);
    expect(unsupported.structuredContent.message).toContain(EVIDENCE_REFS_DESCRIPTION);

    const missing = await callTool(server, "collab_report_append", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-missing-evidence",
      kind: "observation",
      body: "Cites an artifact that does not exist.",
      evidence_refs: ["artifact:artifact_missing"],
    });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.error).toBe("evidence_not_found");
    expect(missing.structuredContent.reference).toBe("artifact:artifact_missing");
    expect(missing.structuredContent.allowed_prefixes).toEqual([...EVIDENCE_REF_PREFIXES]);
  });

```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/v2.test.ts -t "evidence references name their allowed prefixes|hydrates a v0.1 idempotency receipt"
```
Expected: `0 pass`, `4 fail`, including:
- `hydrates a v0.1 idempotency receipt ...` → `error: expect(received).toMatchObject(expected)`
- `explains every invalid evidence reference site and evidence_not_found` → `Expected to contain: "artifact:artifact_<id>"` / `Received: "Evidence references use artifact:, event:, report:, or checkpoint: prefixes"`
- `projects checkpoint digests that resolve as checkpoint: evidence` → `expect(received).toBeNull()` / `Received: undefined`
- `hydrates checkpoint digests into stored replies that predate them` → `expect(received).toBe(expected)` / `Received: undefined`

(The first is the extended v0.1 receipt test; the received object simply lacks the two digest keys.)

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/mcp.test.ts
```
Expected: the whole file fails to link: `SyntaxError: Export named 'EVIDENCE_REFS_DESCRIPTION' not found in module '.../packages/collab/src/protocol.ts'.` then `0 pass`, `1 fail`, `1 error`.

- [ ] **Step 3: Write minimal implementation**

`src/protocol.ts` — in `interface Task`, replace (~198-199):
```ts
  base_checkpoint: RepoCheckpoint | null;
  result_checkpoint: RepoCheckpoint | null;
```
with
```ts
  base_checkpoint: RepoCheckpoint | null;
  /** SHA-256 of the canonical base checkpoint; cite it as `checkpoint:<digest>`. */
  base_checkpoint_digest: string | null;
  result_checkpoint: RepoCheckpoint | null;
  /** SHA-256 of the canonical result checkpoint; cite it as `checkpoint:<digest>`. */
  result_checkpoint_digest: string | null;
```
Immediately after `export type ReportConfidence = "high" | "medium" | "low" | "unknown";` (~246) insert:
```ts

/** Evidence references always point inside one workspace's journal. */
export const EVIDENCE_REF_PREFIXES = ["artifact:", "event:", "report:", "checkpoint:"] as const;
export const EVIDENCE_REFS_DESCRIPTION =
  "Evidence references point inside this workspace's journal and start with artifact:, event:, " +
  "report:, or checkpoint: (a task's base_checkpoint_digest or result_checkpoint_digest), " +
  "for example \"artifact:artifact_<id>\".";
```

`src/store.ts` — in the `./protocol.js` import list, after `  DEFAULT_WAIT_EVENT_LIMIT,` (~18) add:
```ts
  EVIDENCE_REF_PREFIXES,
  EVIDENCE_REFS_DESCRIPTION,
```
In `requireEvidenceRef()` replace its first lines (~5028-5037):
```ts
    const separator = reference.indexOf(":");
    if (separator < 1) {
      throw new CollabError(
        "invalid_evidence_ref",
        "Evidence references use artifact:, event:, report:, or checkpoint: prefixes",
      );
    }
    const kind = reference.slice(0, separator);
    const id = reference.slice(separator + 1);
    if (!id) throw new CollabError("invalid_evidence_ref", "Evidence reference ID is empty");
```
with
```ts
    const separator = reference.indexOf(":");
    if (separator < 1) throw invalidEvidenceRef("Evidence reference needs a kind prefix");
    const kind = reference.slice(0, separator);
    const id = reference.slice(separator + 1);
    if (!id) throw invalidEvidenceRef("Evidence reference ID is empty");
```
and, at the end of the same method, replace (~5069-5076):
```ts
    } else {
      throw new CollabError("invalid_evidence_ref", "Unsupported evidence reference kind");
    }
    if (!exists) {
      throw new CollabError("evidence_not_found", "Evidence reference was not found", {
        reference,
      });
    }
```
with
```ts
    } else {
      throw invalidEvidenceRef("Unsupported evidence reference kind");
    }
    if (!exists) {
      throw new CollabError(
        "evidence_not_found",
        `Evidence reference was not found in this workspace. ${EVIDENCE_REFS_DESCRIPTION}`,
        { reference, allowed_prefixes: [...EVIDENCE_REF_PREFIXES] },
      );
    }
```
In `taskFromRow()`, after the `}` that closes the `effectiveStatus` if/else chain (~5267) and before `return {`, insert:
```ts
    const baseCheckpoint = parseCheckpoint(row.base_checkpoint_json);
    const resultCheckpoint = parseCheckpoint(row.result_checkpoint_json);
```
and, inside that `return {`, replace (~5281-5282):
```ts
      base_checkpoint: parseCheckpoint(row.base_checkpoint_json),
      result_checkpoint: parseCheckpoint(row.result_checkpoint_json),
```
with
```ts
      base_checkpoint: baseCheckpoint,
      base_checkpoint_digest: baseCheckpoint ? checkpointDigest(baseCheckpoint) : null,
      result_checkpoint: resultCheckpoint,
      result_checkpoint_digest: resultCheckpoint ? checkpointDigest(resultCheckpoint) : null,
```
(Same `checkpointDigest()` that `requireEvidenceRef` uses for `checkpoint:` lookups, so a projected digest always resolves. No event payload embeds a task projection, so event hashes are unchanged.)

In `normalizeEvidenceRefs()` replace its `return` statement and closing brace (~5623-5629):
```ts
  return uniqueSorted(references.map((reference) => {
    if (typeof reference !== "string") {
      throw new CollabError("invalid_evidence_ref", "Evidence references must be strings");
    }
    return cleanText(reference, "evidence_ref", MAX_REPORT_REF_LENGTH);
  }));
}
```
with
```ts
  return uniqueSorted(references.map((reference) => {
    if (typeof reference !== "string") {
      throw invalidEvidenceRef("Evidence references must be strings");
    }
    try {
      return cleanText(reference, "evidence_ref", MAX_REPORT_REF_LENGTH);
    } catch (error) {
      if (error instanceof CollabError) throw invalidEvidenceRef(error.message);
      throw error;
    }
  }));
}

function invalidEvidenceRef(reason: string): CollabError {
  return new CollabError(
    "invalid_evidence_ref",
    `${reason}. ${EVIDENCE_REFS_DESCRIPTION}`,
    { allowed_prefixes: [...EVIDENCE_REF_PREFIXES] },
  );
}
```
(`cleanText` throws `invalid_evidence_ref` for empty or whitespace-only text, more than 2000 characters, and NUL bytes; wrapping it gives those sites the same guidance and `allowed_prefixes`.)

In `hydrateLegacyMutationResponse()` (the legacy actor-mode `mutate()` replay path), in its returned object replace (~5985-5986):
```ts
    base_checkpoint: hydrated.base_checkpoint ?? null,
    result_checkpoint: hydrated.result_checkpoint ?? null,
```
with
```ts
    base_checkpoint: hydrated.base_checkpoint ?? null,
    base_checkpoint_digest: hydratedCheckpointDigest(
      hydrated.base_checkpoint_digest,
      hydrated.base_checkpoint,
    ),
    result_checkpoint: hydrated.result_checkpoint ?? null,
    result_checkpoint_digest: hydratedCheckpointDigest(
      hydrated.result_checkpoint_digest,
      hydrated.result_checkpoint,
    ),
```
and insert immediately before `function isRecordValue(` (~5999):
```ts
function hydratedCheckpointDigest(stored: unknown, checkpoint: unknown): string | null {
  if (typeof stored === "string") return stored;
  return isRecordValue(checkpoint)
    ? checkpointDigest(checkpoint as unknown as RepoCheckpoint)
    : null;
}

```

`src/mcp.ts` — in the `./protocol.js` import list, after `  DEFAULT_WAIT_EVENT_LIMIT,` (~6) add `  EVIDENCE_REFS_DESCRIPTION,`. Immediately before `const nextEventLimit = ` (~42) insert:
```ts
const evidenceRefs = z.array(z.string().min(1).max(2000)).max(128).optional()
  .describe(EVIDENCE_REFS_DESCRIPTION);
```
Replace each of the three identical lines, in `collab_task_complete` (~706), `collab_task_review` (~740) and `collab_report_append` (~763) (they are the only three occurrences in the file):
```ts
        evidence_refs: z.array(z.string().min(1).max(2000)).max(128).optional(),
```
with
```ts
        evidence_refs: evidenceRefs,
```
(Verified: `z.toJSONSchema` of the review input emits the description on `properties.evidence_refs`. `evidenceRefs` is a new top-level name in mcp.ts; nothing else there uses it.)

Do not rebuild `dist/` in this task. Local Bun is 1.3.13, so `bun run check:mcp-bundle` prints `skipped`, while CI pins Bun 1.3.5 and would reject the now-stale `dist/agenttool-collab-mcp.js`. Task 8 rebuilds both bundles with `npx --yes bun@1.3.5 run build:mcp`, and Task 10 ends with the pre-PR freshness step (`npx --yes bun@1.3.5 run build:mcp && npx --yes bun@1.3.5 run check:mcp-bundle && git diff --exit-code packages/collab/dist`), so no PR goes out with a stale bundle.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/v2.test.ts tests/mcp.test.ts
```
Expected: `0 fail`; `tests/v2.test.ts` has 3 more tests than before this task and `tests/mcp.test.ts` 2 more.
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun run typecheck && bun test
```
Expected: `tsc --noEmit` clean; `0 fail`; 5 more tests than before this task, across the same files. (Verified in a scratch copy of origin/main.)

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing && git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/v2.test.ts packages/collab/tests/mcp.test.ts && git commit -F - <<'EOF'
feat(collab): name evidence prefixes and expose checkpoint digests

Every invalid_evidence_ref site (missing prefix, empty ID, unsupported
kind, non-string, empty/oversized/NUL text) and evidence_not_found now
carry one shared guidance sentence listing artifact:, event:, report: and
checkpoint: with an example, plus a top-level allowed_prefixes field.
Each evidence_refs MCP schema carries the same description. Task
projections and hydrated legacy receipts gain derived
base_checkpoint_digest and result_checkpoint_digest, so checkpoint:
references are discoverable. No schema change. dist/ is rebuilt on
Bun 1.3.5 in a later task.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```

### Task 2: collab_task_review accepts confidence, confidence_basis and limits

**Files:** anchors are function names, test names and quoted text; `~N` is the origin/main line, given only as a hint (Task 1 adds 2 lines to each `./protocol.js` import list, so store.ts and mcp.ts lines below the imports move by +2).
- Modify: `packages/collab/src/store.ts`: `reviewTaskForSession()` (~3288-3477): its input type, the normalization before `const request = {` and the `request` object (~3297-3312), and the `this.appendReportInternal(session, { ... })` call that writes the review report (~3398-3414)
- Modify: `packages/collab/src/mcp.ts`: the `collab_task_review` registration's `inputSchema` (~733-741)
- Test: `packages/collab/tests/v2.test.ts`: new `describe` immediately before `function createLegacyFixture(` (so after Task 1's block)
- Test: `packages/collab/tests/mcp.test.ts`: one test immediately before test `"verifies the full journal and labels the verification scope"` (so after Task 1's two tests)

**Interfaces:**
- Consumes: `validateReportConfidence()` (store.ts ~5592), `optionalText()` (~5548; `undefined` or blank → `null`, otherwise trimmed via `cleanText`), `readSessionMutationReceipt()` / `mutateAsSession()` request hashing `sha256(canonicalJson({ operation, request }))` (~4256-4354), `appendReportInternal()` (~4885), Task 1's `evidenceRefs` schema const in mcp.ts; test helpers `session()`, `errorCode()`, `createAcceptedEditTask()` (v2.test.ts), `node()`, `callTool()` (mcp.test.ts).
- Produces: `reviewTaskForSession` input fields `confidence?: ReportConfidence`, `confidence_basis?: string`, `limits?: string`; `collab_task_review` optional inputs `confidence` (`"high"|"medium"|"low"|"unknown"`), `confidence_basis` (string ≤ 2000), `limits` (string ≤ 2000). The generated review report (and its `report.posted` event payload) stores them; absent or blank → `"unknown"`/`null`; `confidence_basis`/`limits` are trimmed, as `collab_report_append` already does. A field enters the `task.review.v2` idempotency request only when it carries information: `confidence` other than `"unknown"`, `confidence_basis`/`limits` non-blank after trimming. A review without them (or with only blank/default values) has the same `request_hash` as one from the household 0.3.1 copies, whose request is `{task_id, expected_version, outcome, summary, evidence_refs}` (checked read-only in /opt/homebrew/lib/node_modules/@agenttool/collab/src/store.ts).
- Consumed later by: Task 8's stdio two-process test (sends `confidence`, `confidence_basis` and `limits` over the real MCP transport after the bundle rebuild), Task 9 docs, the replay prompts (B2).
- Contract note: the spec says new optional parameters enter the idempotency request "only when supplied". This task narrows that to "only when they change the stored result". A blank `confidence_basis` or an explicit `confidence: "unknown"` produces the same report as leaving it out, so it hashes the same. A retry that omits such a field, including one from a 0.3.1 copy that drops it, then replays instead of returning `idempotency_conflict`. This covers the blank-string item of the review focus for this task (whitespace and empty `confidence_basis` / `limits`).

- [ ] **Step 1: Write the failing test**

In `packages/collab/tests/v2.test.ts` (imports already present: `createHash`, `canonicalJson`, `type SessionHandle`, `CollabStore`), insert immediately before `function createLegacyFixture(`:
```ts
describe("collab_task_review confidence", () => {
  function reportedForReview(prefix: string) {
    const implementer = session(`${prefix}-implementer`);
    const reviewer = session(`${prefix}-reviewer`);
    const task = createAcceptedEditTask(implementer, `${prefix}-task`, `src/${prefix}.ts`);
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: `${prefix}-claim`,
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: `${prefix}-complete`,
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Ready for review.",
    });
    return { reviewer, reported };
  }

  function reviewRequestHash(
    reviewer: SessionHandle,
    workspaceId: string,
    idempotencyKey: string,
  ): string {
    return (
      store.db.query(`
        SELECT request_hash FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(workspaceId, `session:${reviewer.session.id}`, idempotencyKey) as {
        request_hash: string;
      }
    ).request_hash;
  }

  function expectedHash(request: Record<string, unknown>): string {
    return createHash("sha256")
      .update(canonicalJson({ operation: "task.review.v2", request }))
      .digest("hex");
  }

  test("stores reviewer confidence, basis and limits on the review report", () => {
    const { reviewer, reported } = reportedForReview("confident");
    const reviewed = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "confident-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Read the change and reran the targeted tests.",
      confidence: "high",
      confidence_basis: "Targeted tests pass locally.",
      limits: "Did not run the full suite.",
    });
    expect(reviewed.report).toMatchObject({
      relation: "supports",
      target_report_id: reported.completion_report_id,
      confidence: "high",
      confidence_basis: "Targeted tests pass locally.",
      limits: "Did not run the full suite.",
    });
    const posted = store.eventsSince(reported.workspace_id, 0, 500).events.find(
      (event) => event.type === "report.posted" && event.entity_id === reviewed.report.id,
    );
    expect(posted?.payload).toMatchObject({
      confidence: "high",
      confidence_basis: "Targeted tests pass locally.",
      limits: "Did not run the full suite.",
    });
  });

  test("hashes absent, blank and default review fields exactly as before", () => {
    const plain = reportedForReview("plain");
    const defaults = reportedForReview("defaults");
    const request = (reported: typeof plain.reported) => ({
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "request_changes" as const,
      summary: "The result needs one more check.",
    });
    const plainReview = store.reviewTaskForSession({
      ...plain.reviewer.credential,
      idempotency_key: "plain-review",
      ...request(plain.reported),
    });
    const defaultReview = store.reviewTaskForSession({
      ...defaults.reviewer.credential,
      idempotency_key: "defaults-review",
      ...request(defaults.reported),
      confidence: "unknown",
      confidence_basis: "",
      limits: "   ",
    });
    for (const [handle, reviewed, idempotencyKey] of [
      [plain, plainReview, "plain-review"],
      [defaults, defaultReview, "defaults-review"],
    ] as const) {
      expect(reviewed.report).toMatchObject({
        relation: "challenges",
        confidence: "unknown",
        confidence_basis: null,
        limits: null,
      });
      expect(
        reviewRequestHash(handle.reviewer, handle.reported.workspace_id, idempotencyKey),
      ).toBe(expectedHash({ ...request(handle.reported), evidence_refs: [] }));
    }
    // A retry that omits the default-valued fields (as a 0.3.1 copy would) replays.
    expect(
      store.reviewTaskForSession({
        ...defaults.reviewer.credential,
        idempotency_key: "defaults-review",
        ...request(defaults.reported),
      }).report.id,
    ).toBe(defaultReview.report.id);
  });

  test("binds supplied confidence fields into the idempotency request", () => {
    const { reviewer, reported } = reportedForReview("bound");
    const review = {
      ...reviewer.credential,
      idempotency_key: "bound-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept" as const,
      summary: "Spot-checked the change.",
      confidence: "medium" as const,
      confidence_basis: "Two of three paths were read.",
    };
    const first = store.reviewTaskForSession(review);
    expect(store.reviewTaskForSession(review).report.id).toBe(first.report.id);
    expect(reviewRequestHash(reviewer, reported.workspace_id, "bound-review")).toBe(
      expectedHash({
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "Spot-checked the change.",
        evidence_refs: [],
        confidence: "medium",
        confidence_basis: "Two of three paths were read.",
      }),
    );
    expect(
      errorCode(() => store.reviewTaskForSession({ ...review, confidence: "low" })),
    ).toBe("idempotency_conflict");
  });

  test("treats blank basis or limits as absent and trims supplied text", () => {
    const { reviewer, reported } = reportedForReview("blank");
    const review = {
      ...reviewer.credential,
      idempotency_key: "blank-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept" as const,
      summary: "Checked the one changed path.",
      confidence: "low" as const,
      confidence_basis: " \n ",
      limits: "  Only one path was read.  ",
    };
    const first = store.reviewTaskForSession(review);
    expect(first.report).toMatchObject({
      confidence: "low",
      confidence_basis: null,
      limits: "Only one path was read.",
    });
    expect(reviewRequestHash(reviewer, reported.workspace_id, "blank-review")).toBe(
      expectedHash({
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "Checked the one changed path.",
        evidence_refs: [],
        confidence: "low",
        limits: "Only one path was read.",
      }),
    );
    const { confidence_basis: _blankBasis, ...withoutBasis } = review;
    expect(store.reviewTaskForSession(withoutBasis).report.id).toBe(first.report.id);
    expect(
      store.reviewTaskForSession({ ...review, confidence_basis: "", limits: "Only one path was read." })
        .report.id,
    ).toBe(first.report.id);
  });

  test("rejects an unsupported review confidence before any write", () => {
    const { reviewer, reported } = reportedForReview("unsupported");
    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "unsupported-confidence-review",
          task_id: reported.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "Claims an unsupported confidence.",
          confidence: "certain" as any,
        }),
      ),
    ).toBe("invalid_report_confidence");
    expect(store.getTask(reported.workspace_id, reported.id).review_status).toBe("pending");
  });
});

```
(The second test is a compatibility guard. It already passes before the change, because the store ignores the unknown fields, and it fails against an implementation that puts `confidence: "unknown"` or `null` basis/limits into the request.)

In `packages/collab/tests/mcp.test.ts`, insert immediately before `  test("verifies the full journal and labels the verification scope", async () => {`:
```ts
  test("carries review confidence, basis and limits through collab_task_review", async () => {
    const { root, store, server } = node();
    const implementer = store.startSession({
      root_path: root,
      actor: "mcp-confidence-implementer",
    });
    const task = store.createTaskForSession({
      ...implementer.credential,
      idempotency_key: "mcp-confidence-create",
      title: "Confidence review",
      work_mode: "edit",
      completion_policy: "accepted",
      path_scopes: ["src/confidence.ts"],
    });
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "mcp-confidence-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "mcp-confidence-complete",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Ready for an MCP review.",
    });
    await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-confidence-reviewer",
    });

    const review = {
      workspace_id: reported.workspace_id,
      task_id: reported.id,
      idempotency_key: "mcp-confidence-review",
      expected_version: reported.version,
      outcome: "accept",
      summary: "Reviewed through MCP.",
      confidence: "medium",
      confidence_basis: "Read the change; did not rerun tests.",
      limits: "No full-suite run.",
    };
    const inputSchema = (server as any)._registeredTools.collab_task_review.inputSchema;
    expect(inputSchema.safeParse(review).success).toBe(true);
    expect(inputSchema.safeParse({ ...review, confidence_basis: "" }).success).toBe(true);
    expect(inputSchema.safeParse({ ...review, confidence: "certain" }).success).toBe(false);
    expect(inputSchema.safeParse({ ...review, confidence_basis: "b".repeat(2_001) }).success)
      .toBe(false);
    expect(inputSchema.safeParse({ ...review, limits: "l".repeat(2_001) }).success).toBe(false);

    const reviewed = await callTool(server, "collab_task_review", review);
    expect(reviewed.isError).toBeUndefined();
    expect(reviewed.structuredContent.report).toMatchObject({
      confidence: "medium",
      confidence_basis: "Read the change; did not rerun tests.",
      limits: "No full-suite run.",
    });
  });

```
(`callTool` invokes the handler directly, so this test checks the zod schema with `safeParse` separately. Task 8's stdio test covers the real transport.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/v2.test.ts tests/mcp.test.ts -t "collab_task_review confidence|carries review confidence"
```
Expected: `1 pass`, `5 fail`:
- `stores reviewer confidence, basis and limits on the review report` → `error: expect(received).toMatchObject(expected)` (report has `confidence: "unknown"`)
- `binds supplied confidence fields into the idempotency request` → `error: expect(received).toBe(expected)` (stored hash omits the supplied fields)
- `treats blank basis or limits as absent and trims supplied text` → `error: expect(received).toMatchObject(expected)` (report has `confidence: "unknown"`, `limits: null`)
- `rejects an unsupported review confidence before any write` → `error: expected operation to fail`
- `MCP surface > carries review confidence, basis and limits through collab_task_review` → `Expected: false` / `Received: true` (zod strips the unknown `confidence` key)
- passing: `hashes absent, blank and default review fields exactly as before`

- [ ] **Step 3: Write minimal implementation**

`src/store.ts`, `reviewTaskForSession()` — in its input type replace:
```ts
    outcome: "accept" | "request_changes";
    summary: string;
    evidence_refs?: string[];
  }): { task: Task; review: TaskReview; report: CollabReport } {
```
with
```ts
    outcome: "accept" | "request_changes";
    summary: string;
    evidence_refs?: string[];
    confidence?: ReportConfidence;
    confidence_basis?: string;
    limits?: string;
  }): { task: Task; review: TaskReview; report: CollabReport } {
```
In the same method replace the normalization and `request` construction (~3305-3312):
```ts
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      outcome: input.outcome,
      summary,
      evidence_refs: evidenceRefs,
    };
```
with
```ts
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const confidence = validateReportConfidence(input.confidence ?? "unknown");
    const confidenceBasis = optionalText(input.confidence_basis, "confidence_basis", 2_000);
    const limits = optionalText(input.limits, "limits", 2_000);
    // A review field enters the idempotency request only when it carries
    // information. Absent, blank and default ("unknown") values hash exactly as
    // a review from a 0.3.1 copy, which has no such fields.
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      outcome: input.outcome,
      summary,
      evidence_refs: evidenceRefs,
      ...(confidence === "unknown" ? {} : { confidence }),
      ...(confidenceBasis === null ? {} : { confidence_basis: confidenceBasis }),
      ...(limits === null ? {} : { limits }),
    };
```
(Validation runs before `readSessionMutationReceipt`, so an unsupported confidence is refused before any read of the receipt or any write.)

In the `this.appendReportInternal(session, { ... })` call inside the same method, replace (~3407-3410; the `relation` line makes the match unique, because Task 4 later adds another report call with the same three default lines):
```ts
        confidence: "unknown",
        confidence_basis: null,
        limits: null,
        relation: input.outcome === "accept" ? "supports" : "challenges",
```
with
```ts
        confidence,
        confidence_basis: confidenceBasis,
        limits,
        relation: input.outcome === "accept" ? "supports" : "challenges",
```

`src/mcp.ts`, `collab_task_review` registration — in its `inputSchema`, after the three lines (the `evidence_refs` line is Task 1's replacement)
```ts
        outcome: z.enum(["accept", "request_changes"]),
        summary: z.string().min(1).max(4000),
        evidence_refs: evidenceRefs,
```
add
```ts
        confidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
        confidence_basis: z.string().max(2000).optional(),
        limits: z.string().max(2000).optional(),
```
(The same plain schemas `collab_task_complete` and `collab_report_append` already use. The handler already spreads `...input` into `store.reviewTaskForSession({ ...boundCredential(), ...input })`, so absent keys stay absent. The tool description is unchanged; Task 9 documents the fields.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/v2.test.ts tests/mcp.test.ts -t "collab_task_review confidence|carries review confidence"
```
Expected: `6 pass`, `0 fail`.
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun run typecheck && bun test
```
Expected: `tsc --noEmit` clean; `0 fail`; 6 more tests than before this task (`tests/v2.test.ts` +5, `tests/mcp.test.ts` +1), across the same files. `collab-courier` and `collab-zerone` import `../../collab/src` directly, and Task 10 reruns them. A scratch run after Tasks 1-2 gave 374 pass / 0 fail and 73 pass / 0 fail.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing && git add packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/v2.test.ts packages/collab/tests/mcp.test.ts && git commit -F - <<'EOF'
feat(collab): let reviewers state confidence, basis and limits

collab_task_review accepts optional confidence, confidence_basis and
limits and stores them on the generated review report; absent or blank
values keep unknown/null, and text is trimmed as collab_report_append
does. A field enters the task.review.v2 idempotency request only when
it carries information (confidence other than unknown, non-blank basis
or limits), so a review without them, or with only blank or default
values, has the same request_hash as on the household 0.3.1 copies that
share the journal, and a retry that drops such a field replays.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```


### Task 3: Late reviewer is pointed at the accepting review report (instead of `version_conflict`)

**Files:**
- Create: `packages/collab/tests/review-routing.test.ts`
- Modify: `packages/collab/src/store.ts`
  - `reviewTaskForSession()`: the first lines of the `mutateAsSession(..., "task.review.v2", ...)` callback, where `requireVersion` runs before the pending check (origin/main ~3322-3331). Task 2 changed this method's input type, its `request` and the review report's confidence lines, but not these lines.
  - `captureReviewCheckpoint()` (origin/main ~4418-4441): a guard after `const task = this.requireTaskRow(session.workspace_id, taskId);`
  - new private method `taskNotPendingReviewError()`, placed right after `private requireReview(id: string): TaskReview { ... }` (origin/main ~4954-4958)
- Test: `packages/collab/tests/review-routing.test.ts`. A new file, so it cannot collide with sibling tasks that edit `tests/v2.test.ts` or `tests/mcp.test.ts`. Those files do not export their helpers, so the helpers (`session`, `errorFrom`, `runGit`, `initializeGitRepository`, `callTool`) are copied locally.

**Interfaces:**
- Consumes: `CollabStore.reviewTaskForSession`, `CollabStore.appendReportForSession`, `CollabStore.startSession`, `CollabStore.claimTaskForSession`, the `task_reviews` row (`review_generation`, `outcome`, `event_sequence`), the `task.accepted` event payload field `review_report_id` (store.ts `reviewTaskForSession`, origin/main ~3435-3451), and MCP `failure()`, which flattens `CollabError.details` to the top level (mcp.ts ~1111-1120).
- Produces:
  - The `task_not_pending_review` error payload gains `review_report_id: string`, `accepted_by_session_id: string` and `remedy: string`, and the message names the remedy. They are present only when `completion_policy === "accepted"`, `review_status === "accepted"`, and the caller is neither `reported_by_session_id` nor `accepted_by_session_id`. Every other case, including the reporter and the accepting session, keeps exactly `{ review_status }`.
  - `review_report_id` is the current generation's acceptance: the `task_reviews` row at the task's `review_generation` with outcome `accepted`, then its `task.accepted` event.
  - The remedy text: `Record a late concurring or dissenting review with collab_report_append: task_id "<task>", relation "supports" or "challenges", target_report_id "<review report>". A challenge records disagreement; it does not reopen the accepted task.`
  - The private `CollabStore.taskNotPendingReviewError(row: TaskRow, callerSessionId: string): CollabError`.
  - `captureReviewCheckpoint()` returns `null` when the task is not pending review, so late reviewers skip worktree inspection.
  - Behaviour change, by design: a review of any non-pending task now refuses with `task_not_pending_review` before the version check. A stale reviewer of a task that was sent back (`changes_requested`) or reclaimed (`not_required`) therefore gets `task_not_pending_review` with that `review_status`, not `version_conflict`.

- [ ] **Step 1: Write the failing test**

Create `packages/collab/tests/review-routing.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { SessionHandle, Task } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: Date;
const memberStores: CollabStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-review-routing-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = new Date("2026-10-08T10:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
});

afterEach(() => {
  while (memberStores.length) memberStores.pop()!.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string, rootPath = root): SessionHandle {
  return store.startSession({ root_path: rootPath, actor });
}

function errorFrom(operation: () => unknown): CollabError {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error;
  }
}

function runGit(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return result.stdout.trim();
}

function initializeGitRepository(): void {
  runGit(root, "init", "--initial-branch=main");
  runGit(root, "config", "user.name", "Collab Test");
  runGit(root, "config", "user.email", "collab-test@example.invalid");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  runGit(root, "add", "README.md");
  runGit(root, "commit", "-m", "fixture");
}

function claimedEditTask(owner: SessionHandle, name: string): Task {
  const created = store.createTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-create`,
    title: name,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [`src/${name}.ts`],
  });
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-claim`,
    task_id: created.id,
    expected_version: created.version,
  });
}

function reportedEditTask(owner: SessionHandle, name: string): Task {
  const claimed = claimedEditTask(owner, name);
  return store.completeTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-complete`,
    task_id: claimed.id,
    lease_id: claimed.lease_id!,
    expected_version: claimed.version,
    summary: `${name} is implemented and checked locally.`,
  });
}

/** Claims a task again after a reviewer sent it back with request_changes. */
function reclaim(owner: SessionHandle, reopened: Task, key: string): Task {
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `${key}-reclaim`,
    task_id: reopened.id,
    expected_version: reopened.version,
  });
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

async function boundMember(actor: string) {
  const memberStore = new CollabStore(databasePath, { now: () => new Date(currentTime) });
  memberStores.push(memberStore);
  const server = buildCollabMcpServer(memberStore);
  const started = await callTool(server, "collab_session_start", { root_path: root, actor });
  if (started.isError) throw new Error(JSON.stringify(started.structuredContent));
  return {
    server,
    session_id: started.structuredContent.session.id as string,
    workspace_id: started.structuredContent.workspace.id as string,
  };
}

describe("late reviewers", () => {
  test("points a late distinct reviewer at the accepting review report", () => {
    const implementer = session("implementer");
    const reviewer = session("reviewer");
    const lateReviewer = session("late-reviewer");
    const reported = reportedEditTask(implementer, "late-review");
    const accepted = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "first-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Reviewed the result and accepted it locally.",
    });
    expect(accepted.task.version).toBe(reported.version + 1);

    const late = errorFrom(() =>
      store.reviewTaskForSession({
        ...lateReviewer.credential,
        idempotency_key: "late-review",
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "Independent review concurs.",
      }),
    );
    expect(late.code).toBe("task_not_pending_review");
    expect(late.details).toEqual({
      review_status: "accepted",
      review_report_id: accepted.report.id,
      accepted_by_session_id: reviewer.session.id,
      remedy: expect.stringContaining("collab_report_append"),
    });
    const remedy = late.details.remedy as string;
    expect(remedy).toContain('relation "supports" or "challenges"');
    expect(remedy).toContain(`target_report_id "${accepted.report.id}"`);
    expect(remedy).toContain("does not reopen the accepted task");
    expect(late.message).toContain("collab_report_append");

    const concurrence = store.appendReportForSession({
      ...lateReviewer.credential,
      idempotency_key: "late-concurrence",
      task_id: reported.id,
      kind: "observation",
      body: "Independent review concurs with the acceptance.",
      confidence: "medium",
      confidence_basis: "Read the diff and reran the targeted test.",
      relation: "supports",
      target_report_id: late.details.review_report_id as string,
    });
    expect(concurrence.relation).toBe("supports");
    expect(concurrence.target_report_id).toBe(accepted.report.id);
  });

  test("offers no late-review remedy to the reporter, the accepting reviewer, or never-pending tasks", () => {
    const implementer = session("implementer");
    const reviewer = session("reviewer");
    const reported = reportedEditTask(implementer, "reporter-late");
    store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "reporter-late-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Accepted.",
    });
    const reporterAttempt = errorFrom(() =>
      store.reviewTaskForSession({
        ...implementer.credential,
        idempotency_key: "reporter-late-attempt",
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "The reporter cannot concur with itself.",
      }),
    );
    expect(reporterAttempt.code).toBe("task_not_pending_review");
    expect(reporterAttempt.details).toEqual({ review_status: "accepted" });

    const accepterRetry = errorFrom(() =>
      store.reviewTaskForSession({
        ...reviewer.credential,
        idempotency_key: "reporter-late-review-again",
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "The accepting reviewer retries under a new key.",
      }),
    );
    expect(accepterRetry.code).toBe("task_not_pending_review");
    expect(accepterRetry.details).toEqual({ review_status: "accepted" });

    const coordination = store.createTaskForSession({
      ...implementer.credential,
      idempotency_key: "reported-only-create",
      title: "Reported-only coordination",
      work_mode: "coordination",
      completion_policy: "reported",
    });
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "reported-only-claim",
      task_id: coordination.id,
      expected_version: coordination.version,
    });
    const done = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "reported-only-complete",
      task_id: coordination.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Coordinated.",
    });
    const notRequired = errorFrom(() =>
      store.reviewTaskForSession({
        ...reviewer.credential,
        idempotency_key: "reported-only-review",
        task_id: coordination.id,
        expected_version: claim.version,
        outcome: "accept",
        summary: "There is nothing pending to accept.",
      }),
    );
    expect(done.review_status).toBe("not_required");
    expect(notRequired.code).toBe("task_not_pending_review");
    expect(notRequired.details).toEqual({ review_status: "not_required" });
  });

  test("points a late reviewer at the current generation's acceptance after request_changes", () => {
    const implementer = session("implementer");
    const firstReviewer = session("first-reviewer");
    const secondReviewer = session("second-reviewer");
    const firstReport = reportedEditTask(implementer, "second-generation");
    const changes = store.reviewTaskForSession({
      ...firstReviewer.credential,
      idempotency_key: "second-generation-changes",
      task_id: firstReport.id,
      expected_version: firstReport.version,
      outcome: "request_changes",
      summary: "Needs one more check.",
    });
    expect(changes.review.review_generation).toBe(1);
    const reclaimed = reclaim(implementer, changes.task, "second-generation");
    const secondReport = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "second-generation-recomplete",
      task_id: reclaimed.id,
      lease_id: reclaimed.lease_id!,
      expected_version: reclaimed.version,
      summary: "The extra check is in.",
    });
    const accepted = store.reviewTaskForSession({
      ...secondReviewer.credential,
      idempotency_key: "second-generation-accept",
      task_id: secondReport.id,
      expected_version: secondReport.version,
      outcome: "accept",
      summary: "The second report holds.",
    });
    expect(accepted.review.review_generation).toBe(2);

    const late = errorFrom(() =>
      store.reviewTaskForSession({
        ...firstReviewer.credential,
        idempotency_key: "second-generation-late",
        task_id: firstReport.id,
        expected_version: firstReport.version,
        outcome: "accept",
        summary: "Coming back to the first report.",
      }),
    );
    expect(late.code).toBe("task_not_pending_review");
    expect(late.details.review_report_id).toBe(accepted.report.id);
    expect(late.details.review_report_id).not.toBe(changes.report.id);
    expect(late.details.accepted_by_session_id).toBe(secondReviewer.session.id);
  });

  test("answers a late reviewer without inspecting the completion worktree", () => {
    initializeGitRepository();
    const implementer = session("git-implementer");
    const reviewer = session("git-reviewer");
    const lateReviewer = session("git-late-reviewer");
    const reported = reportedEditTask(implementer, "git-late");
    expect(reported.result_checkpoint?.source).toBe("server_observed");
    const accepted = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "git-late-accept",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Accepted against the observed checkpoint.",
    });
    rmSync(root, { recursive: true, force: true });

    const late = errorFrom(() =>
      store.reviewTaskForSession({
        ...lateReviewer.credential,
        idempotency_key: "git-late-review",
        task_id: reported.id,
        expected_version: accepted.task.version,
        outcome: "accept",
        summary: "Concur after the worktree was removed.",
      }),
    );
    expect(late.code).toBe("task_not_pending_review");
    expect(late.details.review_report_id).toBe(accepted.report.id);
  });

  test("returns the late-review remedy as top-level MCP error fields", async () => {
    const implementer = await boundMember("implementer");
    const reviewer = await boundMember("reviewer");
    const lateReviewer = await boundMember("late-reviewer");
    const created = await callTool(implementer.server, "collab_task_create", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-late-create",
      title: "MCP late review",
      work_mode: "edit",
      path_scopes: ["src/mcp-late.ts"],
    });
    const claimed = await callTool(implementer.server, "collab_task_claim", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-late-claim",
      task_id: created.structuredContent.task.id,
      expected_version: created.structuredContent.task.version,
    });
    const reported = await callTool(implementer.server, "collab_task_complete", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-late-complete",
      task_id: claimed.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      expected_version: claimed.structuredContent.task.version,
      summary: "Done.",
    });
    const accepted = await callTool(reviewer.server, "collab_task_review", {
      workspace_id: reviewer.workspace_id,
      idempotency_key: "mcp-late-accept",
      task_id: reported.structuredContent.task.id,
      expected_version: reported.structuredContent.task.version,
      outcome: "accept",
      summary: "Accepted.",
    });
    const late = await callTool(lateReviewer.server, "collab_task_review", {
      workspace_id: lateReviewer.workspace_id,
      idempotency_key: "mcp-late-review",
      task_id: reported.structuredContent.task.id,
      expected_version: reported.structuredContent.task.version,
      outcome: "accept",
      summary: "Concur.",
    });
    expect(late.isError).toBe(true);
    expect(late.structuredContent).toMatchObject({
      error: "task_not_pending_review",
      review_status: "accepted",
      review_report_id: accepted.structuredContent.report.id,
      accepted_by_session_id: reviewer.session_id,
    });
    expect(late.structuredContent.remedy).toContain("collab_report_append");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Task 1 ran `bun install --frozen-lockfile` once in `packages/collab`. If `node_modules` is absent, run it first; it is gitignored.

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/review-routing.test.ts
```

Expected: `0 pass`, `5 fail`:
- `points a late distinct reviewer at the accepting review report`, `offers no late-review remedy to the reporter, the accepting reviewer, or never-pending tasks`, and `points a late reviewer at the current generation's acceptance after request_changes` each fail with `Expected: "task_not_pending_review"` / `Received: "version_conflict"`.
- `answers a late reviewer without inspecting the completion worktree` fails with `Expected: "task_not_pending_review"` / `Received: "worktree_unavailable"`.
- `returns the late-review remedy as top-level MCP error fields` fails with a `toMatchObject` diff that shows `"error": "version_conflict"`, `"expected_version": 3`, `"current_version": 4`.

- [ ] **Step 3: Write minimal implementation**

(a) In `src/store.ts` `reviewTaskForSession()`, inside the `mutateAsSession(input, input.idempotency_key, "task.review.v2", request, (session) => {` callback (origin/main ~3322-3331), replace:

```ts
      const row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (row.completion_policy !== "accepted" || row.review_status !== "pending") {
        throw new CollabError(
          "task_not_pending_review",
          "Task does not have a pending acceptance review",
          { review_status: row.review_status },
        );
      }
```

with:

```ts
      const row = this.requireTaskRow(session.workspace_id, taskId);
      if (row.completion_policy !== "accepted" || row.review_status !== "pending") {
        throw this.taskNotPendingReviewError(row, session.id);
      }
      this.requireVersion(row, expectedVersion);
```

(b) In `src/store.ts` `captureReviewCheckpoint()` (origin/main ~4418-4441), replace:

```ts
    const task = this.requireTaskRow(session.workspace_id, taskId);
    const resultCheckpoint = parseCheckpoint(task.result_checkpoint_json);
```

with:

```ts
    const task = this.requireTaskRow(session.workspace_id, taskId);
    // Nothing is pending: the write transaction refuses with task_not_pending_review.
    if (task.completion_policy !== "accepted" || task.review_status !== "pending") return null;
    const resultCheckpoint = parseCheckpoint(task.result_checkpoint_json);
```

Without this guard, a late reviewer of a git-backed task whose worktree has gone is refused with `worktree_unavailable` before the write transaction runs. Removing the guard makes the git test fail with `Received: "worktree_unavailable"`; this was verified. If the task becomes pending between this read and the transaction, the accept path already refuses with `worktree_observation_stale`, because `preparedCheckpoint` is `null`.

(c) In `src/store.ts`, immediately after the closing `}` of `private requireReview(id: string): TaskReview { ... }` (origin/main ~4954-4958), add:

```ts

  /** Late distinct reviewers are pointed at the accepting review report; nobody else gets a remedy. */
  private taskNotPendingReviewError(row: TaskRow, callerSessionId: string): CollabError {
    const plain = new CollabError(
      "task_not_pending_review",
      "Task does not have a pending acceptance review",
      { review_status: row.review_status },
    );
    if (
      row.completion_policy !== "accepted"
      || row.review_status !== "accepted"
      || !row.accepted_by_session_id
      || row.reported_by_session_id === callerSessionId
      || row.accepted_by_session_id === callerSessionId
    ) {
      return plain;
    }
    const acceptance = this.db.query(`
      SELECT e.type AS type, e.payload_json AS payload_json
      FROM task_reviews r
      JOIN events e ON e.workspace_id = r.workspace_id AND e.sequence = r.event_sequence
      WHERE r.workspace_id = ? AND r.task_id = ? AND r.review_generation = ?
        AND r.outcome = 'accepted'
    `).get(row.workspace_id, row.id, row.review_generation) as
      { type: string; payload_json: string } | null;
    if (!acceptance || acceptance.type !== "task.accepted") return plain;
    const payload = JSON.parse(acceptance.payload_json) as Record<string, unknown>;
    if (typeof payload.review_report_id !== "string") return plain;
    const reviewReportId = payload.review_report_id;
    const remedy =
      `Record a late concurring or dissenting review with collab_report_append: task_id "${row.id}", `
      + `relation "supports" or "challenges", target_report_id "${reviewReportId}". `
      + "A challenge records disagreement; it does not reopen the accepted task.";
    return new CollabError(
      "task_not_pending_review",
      `Task was already accepted by session '${row.accepted_by_session_id}'. ${remedy}`,
      {
        review_status: row.review_status,
        review_report_id: reviewReportId,
        accepted_by_session_id: row.accepted_by_session_id,
        remedy,
      },
    );
  }
```

The lookup is indexed: `task_reviews` has `UNIQUE(workspace_id, task_id, review_generation)` and `events` has PK `(workspace_id, sequence)`. `review_generation` is bumped by each completion (`completeTaskForSession`), not by acceptance, so the current generation's `accepted` row is the acceptance that ended review. Accepted tasks cannot be reclaimed (`task_completed`), so there is at most one. The "no reopen" sentence is accurate: `hasUnresolvedChallenges` only consults the completion report, and no path moves an accepted task back to `open`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/review-routing.test.ts && bun test && bun run typecheck
```

Expected:
- `tests/review-routing.test.ts`: `5 pass`, `0 fail`.
- Full suite: `0 fail`. The suite gains 5 tests, all in the new `tests/review-routing.test.ts`; no other file's count changes.
- `tsc --noEmit`: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing && git add packages/collab/src/store.ts packages/collab/tests/review-routing.test.ts && git commit -F - <<'EOF'
fix(collab): point late reviewers at the accepting review report

A distinct session reviewing an already-accepted task now gets
task_not_pending_review with review_report_id (the current generation's
acceptance), accepted_by_session_id and a remedy: collab_report_append
with relation supports or challenges targeting that report. It used to
get version_conflict. The pending check now runs before requireVersion
and before worktree capture. The reporter, the accepting session and
never-pending tasks keep the plain {review_status} payload.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```

### Task 4: Requested reviewer on `collab_task_complete`

**Files:**
- Modify: `packages/collab/src/protocol.ts`: `interface Task`, after `accepted_at: string | null;` (origin/main ~213)
- Modify: `packages/collab/src/store.ts`:
  - `completeTaskForSession()` (origin/main ~2806-2930): the input type, the `request` object, the mutation callback's validation, the `task.reported_complete` event payload, and a new addressed report before `return this.requireTask(...)`
  - new private helpers `requireRequestedReviewer()` and `reviewRequestedSessionId()`, placed right after `taskNotPendingReviewError()` (Task 3)
  - `taskFromRow()`: after `accepted_at: row.accepted_at,` (origin/main ~5296)
  - `hydrateLegacyMutationResponse()`: after `accepted_at: hydrated.accepted_at ?? null,` (origin/main ~5995)
- Modify: `packages/collab/src/mcp.ts`: the `collab_task_complete` registration (origin/main ~694-722): its description, its `leaseMutationSchema({...})` input and its handler
- Test: `packages/collab/tests/review-routing.test.ts` (two imports, plus a new `describe` block appended at the end of the file)

**Interfaces:**
- Consumes: `taskNotPendingReviewError` (Task 3), used as the insertion anchor; `appendReportInternal`; `validateId` (which yields `invalid_review_requested_session_id` for blank or malformed ids); `validateReportInput`'s rule that an `informs` report has no `target_report_id` (store.ts ~4831-4836); `nextForSession`'s routing of reports where `to_session_id IS NULL OR to_session_id = current.id` (store.ts ~3932-3944); the `reclaim()` test helper (Task 3); Task 1's `evidence_refs: evidenceRefs,` line in the `collab_task_complete` schema.
- Produces:
  - `CollabStore.completeTaskForSession` input `review_requested_session_id?: string`. It enters the `task.complete.v2` idempotency `request` only when supplied, so completions without it keep their 0.3.1 `request_hash`.
  - The `task.reported_complete` event payload field `review_requested_session_id`, present only when supplied.
  - `Task.review_requested_session_id: string | null`. It is derived and needs no column. It is non-null only while `status === "completed"` and `completion_policy === "accepted"` and the current completion's event carries the field. It drops to `null` after `request_changes`, follows each re-completion (dropped or switched), and stays visible after acceptance. `hydrateLegacyMutationResponse` defaults it to `null`.
  - The private `CollabStore.requireRequestedReviewer(row: TaskRow, session: CoordinationSessionRow, requestedSessionId: string): void` and `CollabStore.reviewRequestedSessionId(row: TaskRow): string | null`.
  - One extra report per requested completion: `{to_session_id: <requested>, kind: "proposal", relation: "informs", target_report_id: null, evidence_refs: ["report:<completion_report_id>"]}`. Its body contains "not a reservation". The completion report itself stays unaddressed.
  - MCP input `collab_task_complete.review_requested_session_id`: `z.string().min(1).max(200).optional()`, with a `.describe()` that contains "A request, not a reservation."
  - Error codes: `review_request_self`; `review_requested_session_unavailable` (details `{review_requested_session_id}`); `review_request_not_applicable` (details `{completion_policy}`); `invalid_review_requested_session_id` (from `validateId`); and `session_required_for_review_request` (MCP legacy mode).

- [ ] **Step 1: Write the failing test**

In `packages/collab/tests/review-routing.test.ts`, add two imports:

```ts
import { createHash } from "node:crypto";
```
right after `import { spawnSync } from "node:child_process";`, and

```ts
import { canonicalJson } from "../src/canonical.js";
```
right before `import { CollabError } from "../src/errors.js";`.

Then append this after the closing `});` of `describe("late reviewers", ...)`, which is the end of the file:

```ts
describe("requested reviewers", () => {
  test("routes a review request to one session without reserving the review", () => {
    const implementer = session("implementer");
    const requested = session("requested-reviewer");
    const bystander = session("bystander");
    const claimed = claimedEditTask(implementer, "requested");
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "requested-complete",
      task_id: claimed.id,
      lease_id: claimed.lease_id!,
      expected_version: claimed.version,
      summary: "Ready for the requested reviewer.",
      review_requested_session_id: requested.session.id,
    });
    expect(reported.review_requested_session_id).toBe(requested.session.id);
    expect(store.getTask(reported.workspace_id, reported.id).review_requested_session_id)
      .toBe(requested.session.id);

    const completedEvent = store.db.query(`
      SELECT payload_json FROM events
      WHERE entity_id = ? AND type = 'task.reported_complete'
    `).get(reported.id) as { payload_json: string };
    expect(JSON.parse(completedEvent.payload_json).review_requested_session_id)
      .toBe(requested.session.id);

    const taskReports = store.listReports(reported.workspace_id, { task_id: reported.id });
    const completion = taskReports.find((report) => report.id === reported.completion_report_id)!;
    expect(completion.to_session_id).toBeNull();
    const requests = taskReports.filter((report) => report.to_session_id === requested.session.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      from_session_id: implementer.session.id,
      kind: "proposal",
      relation: "informs",
      target_report_id: null,
      evidence_refs: [`report:${reported.completion_report_id}`],
    });
    expect(requests[0]!.body).toContain("not a reservation");

    const requestedNext = store.nextForSession({ ...requested.credential, event_limit: 50 });
    expect(requestedNext.reports.map((report) => report.id)).toContain(requests[0]!.id);
    const bystanderNext = store.nextForSession({ ...bystander.credential, event_limit: 50 });
    expect(bystanderNext.reports.map((report) => report.id)).toContain(completion.id);
    expect(bystanderNext.reports.map((report) => report.id)).not.toContain(requests[0]!.id);

    expect(
      errorFrom(() =>
        store.completeTaskForSession({
          ...implementer.credential,
          idempotency_key: "requested-complete",
          task_id: claimed.id,
          lease_id: claimed.lease_id!,
          expected_version: claimed.version,
          summary: "Ready for the requested reviewer.",
        }),
      ).code,
    ).toBe("idempotency_conflict");

    const accepted = store.reviewTaskForSession({
      ...bystander.credential,
      idempotency_key: "bystander-accepts",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "A request is not a reservation; this distinct review counts.",
    });
    expect(accepted.task.review_status).toBe("accepted");
    expect(accepted.task.review_requested_session_id).toBe(requested.session.id);
  });

  test("refuses review requests that cannot be honoured and leaves the claim intact", () => {
    const implementer = session("implementer");
    const departed = session("departed-reviewer");
    store.endSession({ ...departed.credential, reason: "left before the request" });
    const elsewhereRoot = join(directory, "elsewhere");
    mkdirSync(elsewhereRoot);
    const elsewhere = session("elsewhere-reviewer", elsewhereRoot);
    expect(elsewhere.workspace.id).not.toBe(implementer.workspace.id);
    const claimed = claimedEditTask(implementer, "refused-request");
    const attempt = (key: string, reviewRequestedSessionId: string) =>
      errorFrom(() =>
        store.completeTaskForSession({
          ...implementer.credential,
          idempotency_key: key,
          task_id: claimed.id,
          lease_id: claimed.lease_id!,
          expected_version: claimed.version,
          summary: "Ready.",
          review_requested_session_id: reviewRequestedSessionId,
        }),
      );
    expect(attempt("request-self", implementer.session.id).code).toBe("review_request_self");
    const ended = attempt("request-ended", departed.session.id);
    expect(ended.code).toBe("review_requested_session_unavailable");
    expect(ended.details).toEqual({ review_requested_session_id: departed.session.id });
    expect(attempt("request-elsewhere", elsewhere.session.id).code)
      .toBe("review_requested_session_unavailable");
    expect(attempt("request-missing", "session_missing").code)
      .toBe("review_requested_session_unavailable");
    expect(attempt("request-blank", "   ").code).toBe("invalid_review_requested_session_id");
    expect(store.getTask(claimed.workspace_id, claimed.id).status).toBe("claimed");
    expect(store.listReports(claimed.workspace_id, { task_id: claimed.id })).toEqual([]);

    const coordination = store.createTaskForSession({
      ...implementer.credential,
      idempotency_key: "request-reported-only-create",
      title: "Reported-only coordination",
      work_mode: "coordination",
      completion_policy: "reported",
    });
    const coordinationClaim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "request-reported-only-claim",
      task_id: coordination.id,
      expected_version: coordination.version,
    });
    const notApplicable = errorFrom(() =>
      store.completeTaskForSession({
        ...implementer.credential,
        idempotency_key: "request-reported-only-complete",
        task_id: coordination.id,
        lease_id: coordinationClaim.lease_id!,
        expected_version: coordinationClaim.version,
        summary: "Coordinated.",
        review_requested_session_id: departed.session.id,
      }),
    );
    expect(notApplicable.code).toBe("review_request_not_applicable");
    expect(notApplicable.details).toEqual({ completion_policy: "reported" });

    const plain = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "request-none",
      task_id: claimed.id,
      lease_id: claimed.lease_id!,
      expected_version: claimed.version,
      summary: "Ready.",
    });
    expect(plain.review_requested_session_id).toBeNull();
    const receipt = store.db.query(`
      SELECT request_hash FROM mutations WHERE actor = ? AND idempotency_key = 'request-none'
    `).get(`session:${implementer.session.id}`) as { request_hash: string };
    expect(receipt.request_hash).toBe(
      createHash("sha256").update(canonicalJson({
        operation: "task.complete.v2",
        request: {
          task_id: claimed.id,
          lease_id: claimed.lease_id,
          expected_version: claimed.version,
          summary: "Ready.",
          confidence: "unknown",
          confidence_basis: null,
          limits: null,
          evidence_refs: [],
        },
      })).digest("hex"),
    );
  });

  test("drops or switches the requested reviewer when changes are requested and the task is re-reported", () => {
    const implementer = session("implementer");
    const firstRequested = session("first-requested");
    const secondRequested = session("second-requested");
    const claimed = claimedEditTask(implementer, "re-request");
    const first = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "re-request-complete-1",
      task_id: claimed.id,
      lease_id: claimed.lease_id!,
      expected_version: claimed.version,
      summary: "First attempt.",
      review_requested_session_id: firstRequested.session.id,
    });
    expect(first.review_requested_session_id).toBe(firstRequested.session.id);

    const firstChanges = store.reviewTaskForSession({
      ...firstRequested.credential,
      idempotency_key: "re-request-changes-1",
      task_id: first.id,
      expected_version: first.version,
      outcome: "request_changes",
      summary: "One more check, please.",
    });
    expect(firstChanges.task.review_requested_session_id).toBeNull();
    const secondClaim = reclaim(implementer, firstChanges.task, "re-request-2");
    expect(secondClaim.review_requested_session_id).toBeNull();
    const second = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "re-request-complete-2",
      task_id: secondClaim.id,
      lease_id: secondClaim.lease_id!,
      expected_version: secondClaim.version,
      summary: "Second attempt, no particular reviewer.",
    });
    expect(second.review_requested_session_id).toBeNull();
    expect(store.getTask(second.workspace_id, second.id).review_requested_session_id).toBeNull();

    const secondChanges = store.reviewTaskForSession({
      ...firstRequested.credential,
      idempotency_key: "re-request-changes-2",
      task_id: second.id,
      expected_version: second.version,
      outcome: "request_changes",
      summary: "Still one gap.",
    });
    const thirdClaim = reclaim(implementer, secondChanges.task, "re-request-3");
    const third = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "re-request-complete-3",
      task_id: thirdClaim.id,
      lease_id: thirdClaim.lease_id!,
      expected_version: thirdClaim.version,
      summary: "Third attempt, for a fresh pair of eyes.",
      review_requested_session_id: secondRequested.session.id,
    });
    expect(third.review_requested_session_id).toBe(secondRequested.session.id);

    const requests = store.listReports(third.workspace_id, { task_id: third.id })
      .filter((report) => report.kind === "proposal" && report.from_session_id === implementer.session.id);
    expect(requests.map((report) => [report.to_session_id, report.evidence_refs])).toEqual([
      [firstRequested.session.id, [`report:${first.completion_report_id}`]],
      [secondRequested.session.id, [`report:${third.completion_report_id}`]],
    ]);

    const accepted = store.reviewTaskForSession({
      ...secondRequested.credential,
      idempotency_key: "re-request-accept",
      task_id: third.id,
      expected_version: third.version,
      outcome: "accept",
      summary: "The third attempt holds.",
    });
    expect(accepted.task.review_requested_session_id).toBe(secondRequested.session.id);
  });

  test("carries review_requested_session_id through MCP and refuses it without a bound session", async () => {
    const implementer = await boundMember("implementer");
    const reviewer = await boundMember("reviewer");
    const completeTool = (implementer.server as any)._registeredTools.collab_task_complete;
    expect(completeTool.inputSchema.shape.review_requested_session_id.description)
      .toContain("not a reservation");
    const created = await callTool(implementer.server, "collab_task_create", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-request-create",
      title: "MCP requested review",
      work_mode: "edit",
      path_scopes: ["src/mcp-request.ts"],
    });
    const claimed = await callTool(implementer.server, "collab_task_claim", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-request-claim",
      task_id: created.structuredContent.task.id,
      expected_version: created.structuredContent.task.version,
    });
    const reported = await callTool(implementer.server, "collab_task_complete", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-request-complete",
      task_id: claimed.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      expected_version: claimed.structuredContent.task.version,
      summary: "Ready for review.",
      review_requested_session_id: reviewer.session_id,
    });
    expect(reported.isError).toBeUndefined();
    expect(reported.structuredContent.task.review_requested_session_id).toBe(reviewer.session_id);
    const routed = await callTool(reviewer.server, "collab_next", {
      workspace_id: reviewer.workspace_id,
      event_limit: 50,
    });
    expect(routed.isError).toBeUndefined();
    expect(routed.structuredContent.reports.some(
      (report: any) => report.to_session_id === reviewer.session_id && report.kind === "proposal",
    )).toBe(true);

    const legacyStore = new CollabStore(databasePath, { now: () => new Date(currentTime) });
    memberStores.push(legacyStore);
    const legacyServer = buildCollabMcpServer(legacyStore);
    const refused = await callTool(legacyServer, "collab_task_complete", {
      workspace_id: implementer.workspace_id,
      actor: "legacy-actor",
      task_id: created.structuredContent.task.id,
      lease_id: "lease_unused",
      idempotency_key: "legacy-review-request",
      expected_version: 1,
      summary: "Legacy completion cannot route a review request.",
      review_requested_session_id: reviewer.session_id,
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error).toBe("session_required_for_review_request");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/review-routing.test.ts -t "requested reviewers"; bun run typecheck
```

Expected test result: `0 pass`, `5 filtered out`, `4 fail`:
- `routes a review request to one session without reserving the review`: `Expected: "session_<uuid>"` / `Received: undefined` at `expect(reported.review_requested_session_id)`.
- `refuses review requests that cannot be honoured and leaves the claim intact`: `error: expected operation to fail` (the self request is accepted today).
- `drops or switches the requested reviewer when changes are requested and the task is re-reported`: `Expected: "session_<uuid>"` / `Received: undefined` at `expect(first.review_requested_session_id)`.
- `carries review_requested_session_id through MCP and refuses it without a bound session`: `TypeError: undefined is not an object (evaluating 'completeTool.inputSchema.shape.review_requested_session_id.description')`.

Expected typecheck result: errors `TS2339: Property 'review_requested_session_id' does not exist on type 'Task'` and `TS2353: Object literal may only specify known properties, and 'review_requested_session_id' does not exist in type ...`, all in `tests/review-routing.test.ts`.

- [ ] **Step 3: Write minimal implementation**

(a) `src/protocol.ts`, `interface Task`: insert after `accepted_at: string | null;`:

```ts
  /** Derived from the current completion's task.reported_complete event; a request, not a reservation. */
  review_requested_session_id: string | null;
```

(b) `src/store.ts` `completeTaskForSession()` (origin/main ~2806-2930). Each "replace" block below occurs exactly once in `store.ts`, and none of them is touched by Tasks 1-2.

Input type: replace

```ts
    evidence_refs?: string[];
  }): Task {
```

with

```ts
    evidence_refs?: string[];
    review_requested_session_id?: string;
  }): Task {
```

Normalisation and request: replace

```ts
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const request = {
      ...normalized.request,
      summary,
      confidence,
      confidence_basis: confidenceBasis,
      limits,
      evidence_refs: evidenceRefs,
    };
```

with

```ts
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const reviewRequestedSessionId = input.review_requested_session_id === undefined
      ? null
      : validateId(input.review_requested_session_id, "review_requested_session_id");
    const request = {
      ...normalized.request,
      summary,
      confidence,
      confidence_basis: confidenceBasis,
      limits,
      evidence_refs: evidenceRefs,
      // Present only when supplied, so unrequested completions keep their 0.3.1 request_hash.
      ...(reviewRequestedSessionId
        ? { review_requested_session_id: reviewRequestedSessionId }
        : {}),
    };
```

Validation inside the mutation callback: replace

```ts
        for (const reference of evidenceRefs) {
          this.requireEvidenceRef(row.workspace_id, reference);
        }
        this.requirePreparedWorktree(session, preparedCheckpoint);
```

with

```ts
        for (const reference of evidenceRefs) {
          this.requireEvidenceRef(row.workspace_id, reference);
        }
        if (reviewRequestedSessionId) {
          this.requireRequestedReviewer(row, session, reviewRequestedSessionId);
        }
        this.requirePreparedWorktree(session, preparedCheckpoint);
```

Event payload and addressed request report: replace

```ts
              : "Reported completion satisfies this task's explicit reported-only policy; it is not external acceptance.",
          },
          session.id,
        );
        return this.requireTask(row.workspace_id, row.id);
```

with

```ts
              : "Reported completion satisfies this task's explicit reported-only policy; it is not external acceptance.",
            ...(reviewRequestedSessionId
              ? { review_requested_session_id: reviewRequestedSessionId }
              : {}),
          },
          session.id,
        );
        if (reviewRequestedSessionId) {
          this.appendReportInternal(session, {
            task_id: row.id,
            to_session_id: reviewRequestedSessionId,
            kind: "proposal",
            body:
              `Review requested: please review the reported completion of task ${row.id} `
              + `(${row.title}) with collab_task_review. This is a request, not a reservation; `
              + "any distinct session may still review.",
            evidence_refs: [`report:${report.id}`],
            confidence: "unknown",
            confidence_basis: null,
            limits: null,
            relation: "informs",
            target_report_id: null,
            authority_scope: null,
            authority_basis: null,
          });
        }
        return this.requireTask(row.workspace_id, row.id);
```

(`requireRequestedReviewer` refuses every policy except `accepted`, so in practice only `task.reported_complete` events carry the field.)

(c) `src/store.ts`: immediately after the closing `}` of `taskNotPendingReviewError()` (Task 3), add:

```ts

  private requireRequestedReviewer(
    row: TaskRow,
    session: CoordinationSessionRow,
    requestedSessionId: string,
  ): void {
    if (row.completion_policy !== "accepted") {
      throw new CollabError(
        "review_request_not_applicable",
        "Only tasks with completion_policy \"accepted\" wait for review; omit review_requested_session_id",
        { completion_policy: row.completion_policy },
      );
    }
    if (requestedSessionId === session.id) {
      throw new CollabError(
        "review_request_self",
        "A requested reviewer must be a session distinct from the reporter",
      );
    }
    const requested = this.db.query(`
      SELECT workspace_id, status FROM coordination_sessions WHERE id = ?
    `).get(requestedSessionId) as { workspace_id: string; status: string } | null;
    if (
      !requested
      || requested.workspace_id !== session.workspace_id
      || requested.status !== "active"
    ) {
      throw new CollabError(
        "review_requested_session_unavailable",
        "The requested reviewer must be an active session in this workspace; collab_workspace_status lists active_sessions",
        { review_requested_session_id: requestedSessionId },
      );
    }
  }

  /** Derived from the current completion's task.reported_complete payload; there is no column. */
  private reviewRequestedSessionId(row: TaskRow): string | null {
    if (
      row.status !== "completed"
      || row.completion_policy !== "accepted"
      || !row.completion_report_id
    ) {
      return null;
    }
    const completion = this.db.query(`SELECT event_sequence FROM reports WHERE id = ?`)
      .get(row.completion_report_id) as { event_sequence: number } | null;
    if (!completion) return null;
    // The completion report and its task.reported_complete event share one transaction,
    // so the first such event after the report's own event is this completion's.
    const event = this.db.query(`
      SELECT payload_json FROM events
      WHERE workspace_id = ? AND sequence > ? AND entity_id = ? AND type = 'task.reported_complete'
      ORDER BY sequence
      LIMIT 1
    `).get(row.workspace_id, completion.event_sequence, row.id) as { payload_json: string } | null;
    if (!event) return null;
    const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
    return payload.completion_report_id === row.completion_report_id
      && typeof payload.review_requested_session_id === "string"
      ? payload.review_requested_session_id
      : null;
  }
```

(d) `src/store.ts` `taskFromRow()`: insert after `accepted_at: row.accepted_at,`:

```ts
      review_requested_session_id: this.reviewRequestedSessionId(row),
```

(e) `src/store.ts` `hydrateLegacyMutationResponse()`: insert after `accepted_at: hydrated.accepted_at ?? null,`:

```ts
    review_requested_session_id: hydrated.review_requested_session_id ?? null,
```

Session-mode replays (`readSessionMutationReceipt`, `mutateAsSession`) return the stored `response_json` unhydrated. A replay of a completion first run before the upgrade therefore lacks the field, as the spec's compatibility section allows.

(f) `src/mcp.ts`, `collab_task_complete` registration (origin/main ~694-722):

Replace the description string

```ts
        "Legacy mode is actor-reported and not review or acceptance. Bound edit tasks produce a structured completion report and remain pending until distinct-session review.",
```

with

```ts
        "Legacy mode is actor-reported and not review or acceptance. Bound edit tasks produce a structured completion report and remain pending until distinct-session review. Optional review_requested_session_id routes a separate review request to one active session; any distinct session may still review.",
```

In its `leaseMutationSchema({ ... })`, insert after the `evidence_refs` entry and before the closing `}),`. After Task 1 that entry reads `evidence_refs: evidenceRefs,`; on origin/main it was line ~706, `evidence_refs: z.array(z.string().min(1).max(2000)).max(128).optional(),`.

```ts
        review_requested_session_id: z.string().min(1).max(200).optional()
          .describe(
            "Optional active session in this workspace, other than yours, asked to review this completion through a separate addressed report. A request, not a reservation.",
          ),
```

In its handler, replace

```ts
      requireWorkspace(workspace_id);
      const task = binding
        ? store.completeTaskForSession({ ...boundCredential(), ...input })
```

with

```ts
      requireWorkspace(workspace_id);
      if (!binding && input.review_requested_session_id !== undefined) {
        throw new CollabError(
          "session_required_for_review_request",
          "review_requested_session_id requires a bound v0.2 session",
        );
      }
      const task = binding
        ? store.completeTaskForSession({ ...boundCredential(), ...input })
```

The bound path already forwards the field through `...input`. `CollabError` is already imported in `mcp.ts`.

Do not rebuild `dist/agenttool-collab-mcp.js` here. `check:mcp-bundle` skips on local Bun 1.3.13 and the bundle is pinned to Bun 1.3.5. Task 8 rebuilds both bundles, and Task 10's pre-PR freshness step checks them again. The existing stdio test still runs the old bundle until Task 8. Task 8's two-process stdio test is where `review_requested_session_id` is exercised over the real MCP transport, with zod validation.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/review-routing.test.ts && bun test && bun run typecheck
```

Expected:
- `tests/review-routing.test.ts`: `9 pass`, `0 fail` (4 more than after Task 3).
- Full suite: `0 fail`. The suite gains 4 tests, all in `tests/review-routing.test.ts`; no other file's count changes. The existing `tests/mcp.test.ts` assertion that the `collab_task_complete` description contains `"not review or acceptance"` still holds.
- `tsc --noEmit`: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing && git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/review-routing.test.ts && git commit -F - <<'EOF'
feat(collab): let a completion request a specific reviewer

collab_task_complete accepts an optional review_requested_session_id. It
must name an active session in the same workspace, other than the
reporter, and applies only to accepted-policy tasks. The completion
report stays unaddressed. The id is stored in the task.reported_complete
payload and projected on the task without a new column; the projection
drops or switches when changes are requested and the task is reported
again. A separate addressed informs report routes the request to that
session. It is a request, not a reservation. The field enters the
idempotency request only when supplied, so 0.3.1 request hashes are
unchanged. Legacy MCP mode refuses it.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```


> **Order and preconditions for Tasks 5 and 8.** Task 5 runs after Tasks 1–4. Task 8 runs after Tasks 6 and 7: it calls Task 7's `this.sessionProjection(row)` (R6), and its stdio test sends Task 2's, Task 4's and Task 6's new inputs. Task 1 Step 0 already checked free disk space (`df -h /System/Volumes/Data`, stop under 2 GB) and ran `bun install --frozen-lockfile` in `packages/collab`. If `packages/collab/node_modules` is missing, run that install again first. Without it, `bun test` fails with `Cannot find module '@modelcontextprotocol/server'`. Line numbers below are origin/main (61f7e66a) hints only. Earlier tasks shift them, so anchor every edit by the quoted text, function name or test name (R11). Test counts are given as "0 fail" plus the per-file change (R10).
>
> **Verified (2026-10-09)** in a scratch copy of `packages/collab` on origin/main. That copy had Tasks 5 and 8 exactly as written here. It also had stand-ins for Task 2 (review confidence), Task 4 (requested reviewer), Task 6 (bound `after_sequence`) and Task 7's `sessionProjection` seam, taken from those parts' drafts. Results: every Step 2 failure below was observed as described; full `bun test` went from 117 to 132 pass with 0 fail; `tsc --noEmit` was clean; `npx --yes bun@1.3.5 run check:mcp-bundle` exited 0. The `bin/npm-release.ts` edit was checked separately in a partial copy, where its target test failed first and passed after the edit.

### Task 5: Clean exit: `collab_session_end` with `release_leases` / `release_summary`

**Files:**
- Modify: `packages/collab/src/protocol.ts`: insert after the closing `}` of `export interface SessionHandle extends SessionJoinResult` (origin ~170)
- Modify: `packages/collab/src/store.ts`:
  - the `./protocol.js` import list, at `  type SessionHandle,` (origin ~45)
  - constant after `const SESSION_TOKEN_BYTES = 32;` (origin ~82)
  - new interface between the closing `}` of `interface CoordinationSessionRow` and `interface ReportRow {` (origin ~314)
  - replace the whole `endSession(input: {` method, ending just before `listCoordinationSessions(` (origin 1828–1889)
  - inside `recoverTaskForSession(`: replace from `      const prior = {` through the closing `}` of `if (action !== "takeover") { … }` (origin 2410–2490)
  - insert three private helpers immediately before `  private recoveryBundle(row: TaskRow): Record<string, unknown> {` (origin ~4798)
- Modify: `packages/collab/src/mcp.ts`: the whole `server.registerTool("collab_session_end", …)` call (origin 280–301)
- Test: `packages/collab/tests/v2.test.ts`: six tests inserted directly after the end of `test("refuses to end a session while it owns a live lease"`
- Test: `packages/collab/tests/mcp.test.ts`: `existsSync` added to the `node:fs` import, and one test inserted directly after the end of `test("does not expose an absolute credential path through MCP errors"`

**Interfaces:**
- **Consumes** (existing on origin/main):
  - `clearSessionClaim(row, session, "task.released", payload)`: the existing release path
  - the non-takeover branch of `recoverTaskForSession`, which moves verbatim into two helpers
  - the v2 write-guard nonce pattern from `mutateAsSession` (`INSERT INTO v2_write_guard` … `DELETE … WHERE nonce = ?`)
  - `authenticateSession(input, { allow_cursor_recovery: true })`, `expirePendingHandoffs`, `appendEvent`, `optionalText`
- **Produces:**
  - Tool `collab_session_end` gains optional inputs `release_leases: boolean` and `release_summary: string (≤2000)`. Its output gains `released_leases: [{task_id, lease_id, via: "release"|"recovery"}]`.
  - `CollabStore.endSessionWithReleases(input): SessionEndResult`. `CollabStore.endSession(input)` still returns `CoordinationSession` and accepts the same optional fields. Every existing caller is unchanged.
  - `protocol.ts` exports `SessionEndRelease` and `SessionEndResult`.
  - `session_has_active_leases` details are `{task_ids, leases: [{task_id, lease_id, expires_at}], required_action: "resolve_active_task_leases", remedy}`. The message and `remedy` both name `release_leases`.
  - New refusals:
    - `invalid_release_summary`: `release_summary` supplied without `release_leases: true`. This is judged on the raw input, so `""` and `"   "` are refused too (R13).
    - `invalid_release_leases`: the flag is not a boolean.
  - With the flag, a blank `release_summary` counts as absent. The release note is `release_summary ?? reason ?? SESSION_END_RECOVERY_NOTE`; that last fallback applies only to expired leases, because `task_recoveries.note` is NOT NULL.
  - The `task.released` payload gains `released_by_session_end: true`.
  - Private store helpers:
    - `liveLeaseRefusal(workspaceId, sessionId, now): CollabError | null`. Task 8's `preflightSessionEnd` reuses it.
    - `expireSessionLeaseForRecovery(row, session, now)` and `recordRecoveryWithoutTakeover(row, session, {...})`. `recoverTaskForSession` now uses both.
  - `endSessionWithReleases` returns its session through exactly one call, `session: coordinationSessionFromRow(this.requireCoordinationSessionRow(row.id)),`. Task 7 rewrites that call to `this.sessionProjection(…)` (R6).

- [ ] **Step 1: Write the failing test**

In `tests/v2.test.ts`, insert the six tests below directly after the closing `  });` of `test("refuses to end a session while it owns a live lease", …)`. They use the file's existing helpers `session`, `createAcceptedEditTask`, `errorFrom` and `errorCode`, plus the mutable `currentTime` clock, `store` and the `CollabError` import. No new imports are needed. The last test, "lets the expired holder recover-release its own lease…", is a characterization test (R7). It passes on origin/main and pins holder self-recovery before this task moves that code into helpers.

```ts
  test("names every live lease and the release_leases remedy when refusing to end", () => {
    const worker = session("refused-ender");
    const task = createAcceptedEditTask(worker, "refused-end-task", "src/refused-end.ts");
    const claim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-refused-end",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 3600,
    });

    const refused = errorFrom(() =>
      store.endSession({ ...worker.credential, reason: "Leaving without the flag" }),
    );
    expect(refused.code).toBe("session_has_active_leases");
    expect(refused.message).toContain("release_leases");
    expect(refused.details.task_ids).toEqual([task.id]);
    expect(refused.details.leases).toEqual([
      {
        task_id: task.id,
        lease_id: claim.lease_id,
        expires_at: claim.lease_expires_at,
      },
    ]);
    expect(refused.details.required_action).toBe("resolve_active_task_leases");
    expect(String(refused.details.remedy)).toContain("release_leases: true");

    // A summary without the flag is refused even when it is blank: never silently ignored.
    for (const release_summary of ["This summary has no leases to describe.", "   ", ""]) {
      expect(
        errorCode(() =>
          store.endSession({
            ...worker.credential,
            reason: "Summary without the flag",
            release_summary,
          }),
        ),
      ).toBe("invalid_release_summary");
    }
    expect(
      errorCode(() =>
        store.endSession({
          ...worker.credential,
          release_leases: false,
          release_summary: "The flag is explicitly off.",
        }),
      ),
    ).toBe("invalid_release_summary");
    expect(
      errorCode(() =>
        store.endSession({
          ...worker.credential,
          release_leases: "yes" as unknown as boolean,
        }),
      ),
    ).toBe("invalid_release_leases");
    expect(store.listCoordinationSessions(worker.workspace.id, "active")).toHaveLength(1);
    expect(store.getTask(worker.workspace.id, task.id).lease_id).toBe(claim.lease_id);
  });

  test("ends with release_leases by releasing live leases and recovering its own expired ones", () => {
    const worker = session("release-on-end-worker");
    const successor = session("release-on-end-successor");
    const liveTask = createAcceptedEditTask(worker, "end-release-live", "src/end-live.ts");
    const expiredTask = createAcceptedEditTask(
      worker,
      "end-release-expired",
      "src/end-expired.ts",
    );
    const expiredClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-end-expired",
      task_id: expiredTask.id,
      expected_version: expiredTask.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);
    const liveClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-end-live",
      task_id: liveTask.id,
      expected_version: liveTask.version,
      ttl_seconds: 3600,
    });
    expect(store.getTask(worker.workspace.id, expiredTask.id).effective_status).toBe(
      "recovery_required",
    );

    const ended = store.endSessionWithReleases({
      ...worker.credential,
      reason: "Host exit",
      release_leases: true,
      release_summary: "Returning both tasks to the pool on exit.",
    });

    expect(ended.session.status).toBe("ended");
    expect(ended.released_leases).toEqual(
      [
        { task_id: liveTask.id, lease_id: liveClaim.lease_id!, via: "release" as const },
        { task_id: expiredTask.id, lease_id: expiredClaim.lease_id!, via: "recovery" as const },
      ].sort((left, right) => (left.task_id < right.task_id ? -1 : 1)),
    );
    expect(store.getTask(worker.workspace.id, liveTask.id)).toMatchObject({
      status: "open",
      assignee_session_id: null,
      lease_id: null,
      version: liveClaim.version + 1,
    });
    expect(store.getTask(worker.workspace.id, expiredTask.id)).toMatchObject({
      status: "open",
      effective_status: "open",
      assignee_session_id: null,
      lease_id: null,
      version: expiredClaim.version + 2,
    });

    const events = store.eventsSince(worker.workspace.id, 0, 500).events;
    const released = events.find(
      (event) => event.type === "task.released" && event.entity_id === liveTask.id,
    );
    expect(released?.session_id).toBe(worker.session.id);
    expect(released?.payload).toMatchObject({
      summary: "Returning both tasks to the pool on exit.",
      released_by_session_end: true,
    });
    const recovered = events.find(
      (event) => event.type === "task.recovered" && event.entity_id === expiredTask.id,
    );
    expect(recovered?.session_id).toBe(worker.session.id);
    expect(recovered?.payload).toMatchObject({
      action: "release",
      recovery_note: "Returning both tasks to the pool on exit.",
      recovery_checkpoint: null,
    });
    expect(events.at(-1)?.type).toBe("session.ended");
    expect(
      store.db.query(`
        SELECT action, prior_session_id, recovered_by_session_id, note
        FROM task_recoveries WHERE task_id = ?
      `).get(expiredTask.id),
    ).toEqual({
      action: "release",
      prior_session_id: worker.session.id,
      recovered_by_session_id: worker.session.id,
      note: "Returning both tasks to the pool on exit.",
    });
    expect(
      (store.db.query("SELECT COUNT(*) AS count FROM v2_write_guard").get() as {
        count: number;
      }).count,
    ).toBe(0);
    expect(store.verifyJournal(worker.workspace.id)).toBe(true);

    const reclaimed = store.claimTaskForSession({
      ...successor.credential,
      idempotency_key: "successor-claims-released",
      task_id: liveTask.id,
      expected_version: liveClaim.version + 1,
    });
    expect(reclaimed.assignee_session_id).toBe(successor.session.id);
  });

  test("rolls back every release when ending with release_leases fails at the final event", () => {
    const worker = session("atomic-ender");
    const liveTask = createAcceptedEditTask(worker, "atomic-live", "src/atomic-live.ts");
    const expiredTask = createAcceptedEditTask(worker, "atomic-expired", "src/atomic-expired.ts");
    const expiredClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-atomic-expired",
      task_id: expiredTask.id,
      expected_version: expiredTask.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);
    const liveClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-atomic-live",
      task_id: liveTask.id,
      expected_version: liveTask.version,
      ttl_seconds: 3600,
    });
    const headBefore = store.getWorkspace(worker.workspace.id)!.event_head_sequence;
    // Fail on the very last write, after both leases went through their
    // release and recovery paths, so the rollback has to undo all of it.
    const internals = store as unknown as {
      appendEvent: (workspaceId: string, type: string, ...rest: unknown[]) => unknown;
    };
    const appendEvent = internals.appendEvent.bind(store);
    const attempted: string[] = [];
    internals.appendEvent = (workspaceId, type, ...rest) => {
      attempted.push(type);
      if (type === "session.ended") {
        throw new CollabError("injected_failure", "Injected failure inside session end");
      }
      return appendEvent(workspaceId, type, ...rest);
    };

    expect(
      errorCode(() =>
        store.endSessionWithReleases({
          ...worker.credential,
          reason: "Must roll back",
          release_leases: true,
        }),
      ),
    ).toBe("injected_failure");
    expect([...attempted].sort()).toEqual([
      "session.ended",
      "task.claim_expired",
      "task.recovered",
      "task.released",
    ]);
    expect(attempted.at(-1)).toBe("session.ended");

    expect(store.getTask(worker.workspace.id, liveTask.id)).toMatchObject({
      status: "claimed",
      assignee_session_id: worker.session.id,
      lease_id: liveClaim.lease_id,
      version: liveClaim.version,
    });
    expect(store.getTask(worker.workspace.id, expiredTask.id)).toMatchObject({
      status: "claimed",
      assignee_session_id: worker.session.id,
      lease_id: expiredClaim.lease_id,
      version: expiredClaim.version,
    });
    expect(store.getWorkspace(worker.workspace.id)!.event_head_sequence).toBe(headBefore);
    expect(store.listCoordinationSessions(worker.workspace.id, "active")).toHaveLength(1);
    expect(
      (store.db.query("SELECT COUNT(*) AS count FROM task_recoveries").get() as {
        count: number;
      }).count,
    ).toBe(0);
    expect(
      (store.db.query("SELECT COUNT(*) AS count FROM v2_write_guard").get() as {
        count: number;
      }).count,
    ).toBe(0);
    expect(store.verifyJournal(worker.workspace.id)).toBe(true);
  });

  test("releases leases on end while cursor recovery is still required", () => {
    const worker = session("cursor-recovery-ender");
    const task = createAcceptedEditTask(worker, "cursor-recovery-end", "src/cursor-end.ts");
    const claim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-cursor-recovery-end",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 3600,
    });
    const page = store.nextForSession(worker.credential).events;
    store.acknowledgeSessionCursor({
      ...worker.credential,
      anchor: page.next_anchor,
      expected_cursor_version: worker.session.cursor_version,
    });
    const recovered = store.resumeSession(worker.credential, {
      allow_cursor_recovery: true,
    });
    expect(recovered.session.cursor_recovery_required).toBe(true);

    const ended = store.endSessionWithReleases({
      ...recovered.credential,
      reason: "Host exit during cursor recovery",
      release_leases: true,
    });
    expect(ended.session.status).toBe("ended");
    expect(ended.released_leases).toEqual([
      { task_id: task.id, lease_id: claim.lease_id!, via: "release" },
    ]);
    const released = store.eventsSince(worker.workspace.id, 0, 500).events.find(
      (event) => event.type === "task.released" && event.entity_id === task.id,
    );
    expect(released?.payload.summary).toBe("Host exit during cursor recovery");
  });

  test("treats a blank release_summary as absent and falls back to the reason or the default note", () => {
    const withReason = session("blank-summary-with-reason");
    const reasonTask = createAcceptedEditTask(
      withReason,
      "blank-summary-reason",
      "src/blank-reason.ts",
    );
    const reasonClaim = store.claimTaskForSession({
      ...withReason.credential,
      idempotency_key: "claim-blank-summary-reason",
      task_id: reasonTask.id,
      expected_version: reasonTask.version,
      ttl_seconds: 3600,
    });
    expect(
      store.endSessionWithReleases({
        ...withReason.credential,
        reason: "Host exit with a blank summary",
        release_leases: true,
        release_summary: "   ",
      }).released_leases,
    ).toEqual([{ task_id: reasonTask.id, lease_id: reasonClaim.lease_id!, via: "release" }]);

    const blank = session("blank-summary-blank-reason");
    const blankTask = createAcceptedEditTask(blank, "blank-summary-expired", "src/blank-expired.ts");
    const blankClaim = store.claimTaskForSession({
      ...blank.credential,
      idempotency_key: "claim-blank-summary-expired",
      task_id: blankTask.id,
      expected_version: blankTask.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);
    expect(
      store.endSessionWithReleases({
        ...blank.credential,
        reason: "  ",
        release_leases: true,
        release_summary: "",
      }).released_leases,
    ).toEqual([{ task_id: blankTask.id, lease_id: blankClaim.lease_id!, via: "recovery" }]);

    const events = store.eventsSince(withReason.workspace.id, 0, 500).events;
    expect(
      events.find((event) => event.type === "task.released" && event.entity_id === reasonTask.id)
        ?.payload.summary,
    ).toBe("Host exit with a blank summary");
    expect(
      events.find((event) => event.type === "task.recovered" && event.entity_id === blankTask.id)
        ?.payload.recovery_note,
    ).toBe("collab_session_end with release_leases released this expired lease from its own session");
    expect(
      events.find((event) => event.type === "session.ended" && event.entity_id === blank.session.id)
        ?.payload.reason,
    ).toBeNull();
  });

  test("lets the expired holder recover-release its own lease without a second session", () => {
    const holder = session("self-recovering-holder");
    const task = createAcceptedEditTask(holder, "self-recovery", "src/self-recovery.ts");
    const claim = store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "claim-self-recovery",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);

    const released = store.recoverTaskForSession({
      ...holder.credential,
      idempotency_key: "self-recover-release",
      task_id: task.id,
      expected_version: claim.version,
      recovery_note: "My own lease expired; returning the task to the pool.",
      action: "release",
    });
    expect(released).toMatchObject({
      status: "open",
      effective_status: "open",
      assignee_session_id: null,
      lease_id: null,
      version: claim.version + 2,
    });
    expect(
      store.db.query(`
        SELECT action, prior_lease_id, prior_session_id, recovered_by_session_id, note
        FROM task_recoveries WHERE task_id = ?
      `).get(task.id),
    ).toEqual({
      action: "release",
      prior_lease_id: claim.lease_id,
      prior_session_id: holder.session.id,
      recovered_by_session_id: holder.session.id,
      note: "My own lease expired; returning the task to the pool.",
    });
    const recovered = store.eventsSince(holder.workspace.id, 0, 500).events.find(
      (event) => event.type === "task.recovered" && event.entity_id === task.id,
    );
    expect(recovered?.session_id).toBe(holder.session.id);
    expect(recovered?.payload).toMatchObject({ action: "release", recovery_checkpoint: null });
    expect(store.endSession({ ...holder.credential, reason: "Recovered my own lease" }).status)
      .toBe("ended");
  });
```

In `tests/mcp.test.ts`, add `existsSync,` as the first name in the `node:fs` import block. That block becomes:

```ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
```

Then insert the test below directly after the closing `  });` of `test("does not expose an absolute credential path through MCP errors", …)`. It uses the file's helpers `node()` and `callTool()`. `callTool` calls the handler directly and skips zod, so the test also checks the registered schema's keys and parse. Without that check, the real SDK would silently strip `release_leases`. Task 8's stdio test covers the real transport.

```ts
  test("ends a bound session with release_leases and names the flag when refusing", async () => {
    const { root, store, server } = node();
    const endTool = (server as any)._registeredTools.collab_session_end;
    expect(Object.keys(endTool.inputSchema.shape).sort()).toEqual([
      "reason",
      "release_leases",
      "release_summary",
    ]);
    expect(endTool.description).toContain("release_leases");
    expect(
      endTool.inputSchema.safeParse({
        reason: "parse check",
        release_leases: true,
        release_summary: "parse check summary",
      }).data,
    ).toEqual({
      reason: "parse check",
      release_leases: true,
      release_summary: "parse check summary",
    });
    expect(endTool.inputSchema.safeParse({ release_leases: "yes" }).success).toBe(false);

    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-release-on-end",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    const credentialPath = store.defaultSessionCredentialPath(
      joined.structuredContent.session.id,
    );
    const created = await callTool(server, "collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-end-create",
      title: "Release on end",
      work_mode: "edit",
      path_scopes: ["src/mcp-end.ts"],
    });
    const taskId = created.structuredContent.task.id;
    const claimed = await callTool(server, "collab_task_claim", {
      workspace_id: workspaceId,
      task_id: taskId,
      idempotency_key: "mcp-end-claim",
      expected_version: created.structuredContent.task.version,
    });

    const refused = await callTool(server, "collab_session_end", {
      reason: "Trying to leave with a live lease",
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error).toBe("session_has_active_leases");
    expect(refused.structuredContent.task_ids).toEqual([taskId]);
    expect(refused.structuredContent.leases).toEqual([
      {
        task_id: taskId,
        lease_id: claimed.structuredContent.task.lease_id,
        expires_at: claimed.structuredContent.task.lease_expires_at,
      },
    ]);
    expect(refused.structuredContent.remedy).toContain("release_leases: true");
    const blankSummary = await callTool(server, "collab_session_end", {
      reason: "Summary without the flag",
      release_summary: "",
    });
    expect(blankSummary.isError).toBe(true);
    expect(blankSummary.structuredContent.error).toBe("invalid_release_summary");
    expect(existsSync(credentialPath)).toBe(true);

    const ended = await callTool(server, "collab_session_end", {
      reason: "Leaving cleanly",
      release_leases: true,
      release_summary: "Returned to the pool by the leaving session.",
    });
    expect(ended.isError).toBeUndefined();
    expect(ended.structuredContent.session.status).toBe("ended");
    expect(ended.structuredContent.released_leases).toEqual([
      {
        task_id: taskId,
        lease_id: claimed.structuredContent.task.lease_id,
        via: "release",
      },
    ]);
    expect(ended.structuredContent.credential_file_removed).toBe(true);
    expect(existsSync(credentialPath)).toBe(false);
    expect(store.getTask(workspaceId, taskId)).toMatchObject({
      status: "open",
      assignee_session_id: null,
      lease_id: null,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
bun test tests/v2.test.ts -t "release_leases|release_summary|cursor recovery is still required|recover-release its own lease"
bun test tests/mcp.test.ts -t "release_leases"
```

Expected (observed in the scratch copy):
- v2: `1 pass`, `5 fail`.
  - "lets the expired holder recover-release its own lease…" passes. It is the characterization test.
  - "names every live lease…" fails at `expect(refused.message).toContain("release_leases")`. The received value is `"Release, complete, or hand off active task leases before ending the session"`.
  - The other four fail with `TypeError: store.endSessionWithReleases is not a function`.
- mcp: `0 pass`, `1 fail` at the `inputSchema.shape` keys. The diff shows `- "release_leases", - "release_summary"`.

- [ ] **Step 3: Write minimal implementation**

**`src/protocol.ts`:** insert directly after the closing `}` of `export interface SessionHandle extends SessionJoinResult { … }`:

```ts
/** One lease a session gave up while ending with `release_leases: true`. */
export interface SessionEndRelease {
  task_id: string;
  lease_id: string;
  /** "release" = live lease via task release; "recovery" = expired lease via recovery action "release". */
  via: "release" | "recovery";
}

export interface SessionEndResult {
  session: CoordinationSession;
  released_leases: SessionEndRelease[];
}
```

**`src/store.ts`, import list:** in the `./protocol.js` import, replace `  type SessionHandle,` with:

```ts
  type SessionEndRelease,
  type SessionEndResult,
  type SessionHandle,
```

**`src/store.ts`, constants:** directly after `const SESSION_TOKEN_BYTES = 32;` add:

```ts
const SESSION_END_RECOVERY_NOTE =
  "collab_session_end with release_leases released this expired lease from its own session";
```

**`src/store.ts`, interfaces:** between the closing `}` of `interface CoordinationSessionRow` and `interface ReportRow {` add:

```ts

interface ExpiredSessionLease {
  assignee: string | null;
  session_id: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  checkpoint: RepoCheckpoint | null;
}
```

**`src/store.ts`, `endSession`:** replace the whole `endSession(input: { … }): CoordinationSession { … }` method with the two methods below. The replaced span ends at the blank line before `listCoordinationSessions(`.

Design notes:
- One `now` reading decides "live versus expired" for every held lease, and the final live-lease check uses the same reading. No `requireActiveSessionLease` call is made. It would read the clock a third time and could throw `lease_expired` if a lease crossed its expiry between two readings. The `held` query already guarantees holder, status and lease.
- The write guard wraps only the task writes. The `handoffs` UPDATE and the `coordination_sessions` UPDATE are not guarded by triggers, the same as in the original `endSession`.

```ts
  endSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    reason?: string;
    release_leases?: boolean;
    release_summary?: string;
  }): CoordinationSession {
    return this.endSessionWithReleases(input).session;
  }

  endSessionWithReleases(input: {
    session_id: string;
    session_token: string;
    generation: number;
    reason?: string;
    release_leases?: boolean;
    release_summary?: string;
  }): SessionEndResult {
    const reason = optionalText(input.reason, "reason", 2_000);
    if (input.release_leases !== undefined && typeof input.release_leases !== "boolean") {
      throw new CollabError("invalid_release_leases", "release_leases must be a boolean");
    }
    const releaseLeases = input.release_leases === true;
    // Judge the raw input: a summary sent without the flag is refused even when
    // it is blank, so it is never silently ignored.
    if (input.release_summary !== undefined && !releaseLeases) {
      throw new CollabError(
        "invalid_release_summary",
        "release_summary applies only together with release_leases: true",
      );
    }
    // A blank summary next to the flag counts as absent and falls back to reason.
    const releaseSummary = optionalText(input.release_summary, "release_summary", 2_000);
    const ended = this.db.transaction(() => {
      const row = this.authenticateSession(input, { allow_cursor_recovery: true });
      const now = this.timestamp();
      const releasedLeases: SessionEndRelease[] = [];
      if (releaseLeases) {
        const held = this.db.query(`
          SELECT * FROM tasks
          WHERE workspace_id = ? AND assignee_session_id = ?
            AND status = 'claimed' AND lease_id IS NOT NULL
          ORDER BY id
        `).all(row.workspace_id, row.id) as TaskRow[];
        if (held.length > 0) {
          const releaseNote = releaseSummary ?? reason;
          // The same v2 write guard mutateAsSession sets, for this transaction only.
          const guardNonce = `guard_${randomUUID()}`;
          this.db.query(`INSERT INTO v2_write_guard (nonce, enabled) VALUES (?, 1)`)
            .run(guardNonce);
          try {
            for (const task of held) {
              const leaseId = task.lease_id!;
              // One clock reading decides live versus expired for every lease.
              const expired = task.lease_expires_at !== null && now >= task.lease_expires_at;
              if (expired) {
                const lapsed = this.expireSessionLeaseForRecovery(task, row, now);
                this.recordRecoveryWithoutTakeover(task, row, {
                  prior: lapsed.prior,
                  expiry_version: lapsed.expiryVersion,
                  action: "release",
                  recovery_note: releaseNote ?? SESSION_END_RECOVERY_NOTE,
                  blocker: null,
                  now,
                });
                releasedLeases.push({ task_id: task.id, lease_id: leaseId, via: "recovery" });
              } else {
                this.clearSessionClaim(task, row, "task.released", {
                  summary: releaseNote,
                  released_by_session_end: true,
                });
                releasedLeases.push({ task_id: task.id, lease_id: leaseId, via: "release" });
              }
            }
          } finally {
            this.db.query(`DELETE FROM v2_write_guard WHERE nonce = ?`).run(guardNonce);
          }
        }
      }
      const refusal = this.liveLeaseRefusal(row.workspace_id, row.id, now);
      if (refusal) throw refusal;
      const incomingHandoffs = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_session_id = ? AND status = 'pending'
        ORDER BY offered_at, id
      `).all(row.workspace_id, row.id) as HandoffRow[];
      for (const handoff of incomingHandoffs) {
        this.db.query(`
          UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?
        `).run(now, handoff.id);
        this.appendEvent(
          row.workspace_id,
          "handoff.expired",
          handoff.id,
          row.actor,
          {
            task_id: handoff.task_id,
            reason: "target_session_ended",
          },
          row.id,
        );
      }
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET status = 'ended', ended_at = ?, last_seen_at = ?, generation = generation + 1,
          token_hash = ?
        WHERE id = ? AND generation = ? AND status = 'active'
      `).run(now, now, hashSessionToken(randomBytes(SESSION_TOKEN_BYTES).toString("base64url")), row.id, row.generation);
      if (changed.changes !== 1) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      this.appendEvent(row.workspace_id, "session.ended", row.id, row.actor, { reason }, row.id);
      return {
        session: coordinationSessionFromRow(this.requireCoordinationSessionRow(row.id)),
        released_leases: releasedLeases,
      };
    }).immediate();
    this.tightenFileModes();
    return ended;
  }
```

**`src/store.ts`, `recoverTaskForSession`:** the shared recovery path is extracted so that session end reuses it rather than copying it. Inside the `mutateAsSession` callback, replace everything from `      const prior = {` through the closing `}` of `if (action !== "takeover") { … }` with the code below. That closing `}` is the line just before the blank line and `const worktree = this.requirePreparedWorktree(session, preparedCheckpoint!);`. The takeover code that follows is unchanged and still reads `prior`, `expiryVersion` and `now`.

```ts
      const now = this.timestamp();
      const { prior, expiryVersion } = this.expireSessionLeaseForRecovery(row, session, now);

      if (action !== "takeover") {
        return this.recordRecoveryWithoutTakeover(row, session, {
          prior,
          expiry_version: expiryVersion,
          action,
          recovery_note: recoveryNote,
          blocker,
          now,
        });
      }
```

**`src/store.ts`, helpers:** insert immediately before `  private recoveryBundle(row: TaskRow): Record<string, unknown> {`. The bodies of `expireSessionLeaseForRecovery` and `recordRecoveryWithoutTakeover` are the removed recovery code moved verbatim, with `prior` typed as `ExpiredSessionLease`.

```ts
  private liveLeaseRefusal(
    workspaceId: string,
    sessionId: string,
    now: string,
  ): CollabError | null {
    const live = this.db.query(`
      SELECT id, lease_id, lease_expires_at FROM tasks
      WHERE workspace_id = ? AND assignee_session_id = ?
        AND status = 'claimed' AND lease_expires_at > ?
      ORDER BY id
    `).all(workspaceId, sessionId, now) as Array<{
      id: string;
      lease_id: string;
      lease_expires_at: string;
    }>;
    if (live.length === 0) return null;
    return new CollabError(
      "session_has_active_leases",
      "Release, complete, or hand off active task leases before ending the session, or end with release_leases: true",
      {
        task_ids: live.map((task) => task.id),
        leases: live.map((task) => ({
          task_id: task.id,
          lease_id: task.lease_id,
          expires_at: task.lease_expires_at,
        })),
        required_action: "resolve_active_task_leases",
        remedy:
          "Call collab_session_end again with release_leases: true (optionally release_summary) to release every lease this session holds and end in one step, or release, complete, or hand off each lease first.",
      },
    );
  }

  private expireSessionLeaseForRecovery(
    row: TaskRow,
    session: CoordinationSessionRow,
    now: string,
  ): { prior: ExpiredSessionLease; expiryVersion: number } {
    const prior: ExpiredSessionLease = {
      assignee: row.assignee,
      session_id: row.assignee_session_id,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      checkpoint: parseCheckpoint(row.base_checkpoint_json),
    };
    const expiryVersion = row.version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = 'open', assignee = NULL, assignee_session_id = NULL,
        claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(expiryVersion, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(
      row.workspace_id,
      row.id,
      now,
      "system:clock",
      "source_lease_expired",
    );
    this.appendEvent(row.workspace_id, "task.claim_expired", row.id, "system:clock", {
      ...prior,
      effective_at: prior.lease_expires_at,
      observed_by_session_id: session.id,
      version: expiryVersion,
    });
    return { prior, expiryVersion };
  }

  private recordRecoveryWithoutTakeover(
    row: TaskRow,
    session: CoordinationSessionRow,
    input: {
      prior: ExpiredSessionLease;
      expiry_version: number;
      action: "release" | "block";
      recovery_note: string;
      blocker: string | null;
      now: string;
    },
  ): Task {
    const version = input.expiry_version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = ?, blocker = ?, version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(
      input.action === "block" ? "blocked" : "open",
      input.action === "block" ? input.blocker : null,
      version,
      input.now,
      row.workspace_id,
      row.id,
    );
    const event = this.appendEvent(
      row.workspace_id,
      "task.recovered",
      row.id,
      session.actor,
      {
        prior_lease: input.prior,
        action: input.action,
        recovery_note: input.recovery_note,
        recovery_checkpoint: null,
        version,
        note:
          "Recovery acknowledges an expired coordination lease; it does not accept or attribute prior work.",
      },
      session.id,
    );
    this.db.query(`
      INSERT INTO task_recoveries (
        id, workspace_id, task_id, prior_lease_id, prior_session_id,
        recovered_by_session_id, action, note, prior_checkpoint_json,
        new_lease_id, recovered_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      `recovery_${randomUUID()}`,
      row.workspace_id,
      row.id,
      input.prior.lease_id,
      input.prior.session_id,
      session.id,
      input.action,
      input.recovery_note,
      input.prior.checkpoint ? canonicalJson(input.prior.checkpoint) : null,
      input.now,
      event.sequence,
    );
    return this.requireTask(row.workspace_id, row.id);
  }
```

**`src/mcp.ts`:** replace the whole `collab_session_end` registration, from `  server.registerTool(\n    "collab_session_end",` up to the blank line before `  server.registerTool(\n    "collab_workspace_open",`, with:

```ts
  server.registerTool(
    "collab_session_end",
    {
      title: "End the bound collaboration session",
      description:
        "Fence future session mutations and remove the credential file. Live leases must be resolved first, " +
        "or pass release_leases: true to release every live lease and recovery-release every expired lease " +
        "this session holds in the same transaction; incoming offers expire as an audited refusal.",
      annotations: localDestructiveMutation,
      inputSchema: {
        reason: z.string().max(2000).optional(),
        release_leases: z.boolean().optional()
          .describe(
            "Release every lease this session holds before ending: live leases through task release, " +
              "expired leases through recovery with action release",
          ),
        release_summary: z.string().max(2000).optional()
          .describe(
            "Release summary and recovery note recorded for each released lease; requires release_leases: true. " +
              "Defaults to reason",
          ),
      },
    },
    async ({ reason, release_leases, release_summary }) => call(() => {
      const current = binding;
      if (!current) throw new CollabError("session_not_bound", "No session is bound");
      const ended = store.endSessionWithReleases({
        ...current.handle.credential,
        reason,
        release_leases,
        release_summary,
      });
      binding = null;
      removeSessionCredentialFile(current.credential_file);
      return {
        session: ended.session,
        released_leases: ended.released_leases,
        credential_file_removed: true,
        session_file_name: `${ended.session.id}.json`,
      };
    }),
  );
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
bun test tests/v2.test.ts tests/mcp.test.ts
bun test
bun run typecheck
```

Expected:
- `tests/v2.test.ts`: 0 fail, 6 more tests than before this task. The run includes the existing "requires explicit recovery for expired session leases…" and "can explicitly release or block an expired session lease…", which show that the recovery refactor kept its behavior.
- `tests/mcp.test.ts`: 0 fail, 1 more test.
- Full suite: 0 fail.
- `tsc --noEmit`: clean.

`dist/agenttool-collab-mcp.js` is now stale. Task 8 rebuilds it with the pinned Bun 1.3.5, so do not rebuild it here.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/v2.test.ts packages/collab/tests/mcp.test.ts
git commit -F - <<'MSG'
feat(collab): end a session with release_leases in one transaction

collab_session_end accepts release_leases and release_summary. Live leases
go through task release, expired ones through recovery action "release",
all inside the ending transaction under the v2 write guard. Without the
flag, session_has_active_leases keeps task_ids and adds each lease plus a
remedy that names release_leases. A release_summary without the flag is
refused on the raw input, never silently ignored.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
MSG
```

### Task 8: Host CLI `agenttool-collab-host end`

**Files:**
- Create:
  - `packages/collab/src/database-path.ts`
  - `packages/collab/src/host.ts`
  - `packages/collab/bin/agenttool-collab-host.ts`
  - `packages/collab/dist/agenttool-collab-host.js` (built with Bun 1.3.5)
  - `packages/collab/tests/host.test.ts`
- Modify:
  - `packages/collab/src/store.ts`: two new public methods, `getCoordinationSession` and `preflightSessionEnd`. Insert them after the closing `}` of `listCoordinationSessions(` and before `acknowledgeSessionCursor(input: {`.
  - `packages/collab/bin/agenttool-collab-mcp.ts`: use the shared path resolver (origin lines 1–21)
  - `packages/collab/scripts/build-mcp-bundle.ts`: whole file
  - `packages/collab/scripts/check-mcp-bundle.ts`: whole file
  - `packages/collab/package.json`: the `"bin"` object
  - `packages/collab/dist/agenttool-collab-mcp.js`: rebuilt with Bun 1.3.5
  - `.gitignore`: after `!packages/collab/dist/agenttool-collab-mcp.js`. Today `packages/collab/dist/*` ignores the new bundle (`git check-ignore -v` → `.gitignore:15`).
  - `bin/npm-release.ts`: the `if (spec.name === "@agenttool/collab")` `entries.push(` list
- Test:
  - `packages/collab/tests/host.test.ts` (new)
  - `packages/collab/tests/mcp.test.ts`: a `listTools()` method on `StdioMcpHarness`, and one test after `test("shares repository, worktree, session, and review state across two bundled stdio processes"` (R19(1))
  - `packages/collab/tests/package.test.ts`: two assertions in `test("ships the plugins, skills, executable bundle, and notices"`
  - `bin/tests/npm-release.test.ts`: one entry in `test("requires package-specific runtime and protocol artifacts"`

**Interfaces:**
- **Consumes:**
  - `CollabStore.endSessionWithReleases`, `SessionEndRelease` and the private `liveLeaseRefusal` (Task 5)
  - `this.sessionProjection(row)` (Task 7, R6)
  - The stdio test sends these new inputs: `collab_task_review` `confidence`/`confidence_basis`/`limits` (Task 2), `collab_task_complete` `review_requested_session_id` (Task 4), bound `collab_next` `after_sequence` with refusal `after_sequence_unsupported_in_bound_session` (Task 6), and `collab_session_end` `release_leases`/`release_summary` (Task 5).
  - `CollabStore.resumeSession(credential, { allow_cursor_recovery: true })`. It checks only the token and that the session is active, so it tolerates a stale `generation`. It also bumps the generation, which is why the read-only preflight comes first (R14).
  - The private `authenticateResumeToken(sessionId, token)`. It runs a SELECT and a digest compare, and writes nothing.
  - `readSessionCredentialFile` and `removeSessionCredentialFile` (src/session-file.ts)
- **Produces:**
  - Package bin `agenttool-collab-host` → `./dist/agenttool-collab-host.js` (shebang `#!/usr/bin/env bun`, mode 0755).
  - Usage: `agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]`. stdout is exactly one JSON line.
  - Exit 0: `{"protocol":"agenttool.collab-host/1","status":"ended"|"already_ended","session_id","released":[{task_id,lease_id,via:"release"|"recovery"}],"ended_at"}`. The receipt adds `"warning":"session_file_remove_failed"` when the session ended but the revoked file could not be removed (R14). A rerun then reports `already_ended` and removes the file.
  - Exit 1: `{"protocol":"agenttool.collab-host/1","status":"error","error":code,"message",...CollabError details}`. This is a superset of `{status, error, message}` (R14).
  - Error codes:
    - `usage_error`: also covers a blank `--session-file`, `--reason` or `--db`
    - `journal_not_found`: the CLI never creates a journal
    - `session_file_*`, `session_auth_failed` and `session_has_active_leases`: passed through from the store and session file
    - `receipt_withheld`
    - `internal_error`
  - Without `--release-leases`, a live lease is refused before resume and nothing is written: no generation bump, no `session.resumed` event, no cursor-recovery flag (R14). With `--release-leases`, `--reason` becomes each release summary and recovery note.
  - `src/host.ts` exports `COLLAB_HOST_PROTOCOL`, `COLLAB_HOST_USAGE`, `HostEndReceipt`, `HostErrorReceipt`, `HostEndOptions`, `endSessionFromCredential(store, credential, options)` and `runCollabHostCli(argv, env)`.
  - `src/database-path.ts` exports `defaultDatabasePath(env)` and `resolveDatabasePath(env)`. `AGENTOOL_COLLAB_DB` is used verbatim when set (`??`, so `""` is honoured). Otherwise the path is `$XDG_DATA_HOME/agenttool/collab.sqlite`, where an empty `XDG_DATA_HOME` counts as unset and a relative one resolves against the cwd, else `~/.local/share/agenttool/collab.sqlite`. Credential files live at `dirname(db)/collab-sessions/<session_id>.json`. Plan B's Python mirror follows this (R15).
  - `CollabStore.getCoordinationSession(sessionId): CoordinationSession | null` and `CollabStore.preflightSessionEnd(credential: {session_id, session_token}): void`.
  - `scripts/build-mcp-bundle.ts` exports `COLLAB_BUNDLES`, `CollabBundle`, `buildBundle(bundle, outputPath?)` and `buildMcpBundle(outputPath?)`, which is kept. `bun run build:mcp` builds both bundles, and `bun run check:mcp-bundle` checks both. CI and R9's freshness step need no script change.

- [ ] **Step 1: Write the failing test**

Create `packages/collab/tests/host.test.ts`. It spawns `bin/agenttool-collab-host.ts` against a temp journal with a throwaway `HOME`, pins the journal-path semantics, and runs the checked-in bundle once:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultDatabasePath, resolveDatabasePath } from "../src/database-path.js";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const hostEntry = join(packageRoot, "bin", "agenttool-collab-host.ts");

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-host-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function startWithCredentialFile(actor: string): { handle: SessionHandle; file: string } {
  const handle = store.startSession({ root_path: root, actor });
  const file = writeSessionCredentialFile(
    store.defaultSessionCredentialPath(handle.session.id),
    handle.credential,
  );
  return { handle, file };
}

function claimEditTask(handle: SessionHandle, key: string, scope: string) {
  const task = store.createTaskForSession({
    ...handle.credential,
    idempotency_key: `${key}-create`,
    title: key,
    work_mode: "edit",
    path_scopes: [scope],
  });
  return store.claimTaskForSession({
    ...handle.credential,
    idempotency_key: `${key}-claim`,
    task_id: task.id,
    expected_version: task.version,
    ttl_seconds: 3600,
  });
}

function sessionRow(sessionId: string) {
  return store.db.query(`
    SELECT status, generation, last_seen_at, cursor_recovery_required
    FROM coordination_sessions WHERE id = ?
  `).get(sessionId) as {
    status: string;
    generation: number;
    last_seen_at: string;
    cursor_recovery_required: number;
  };
}

function runHost(args: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([process.execPath, hostEntry, ...args], {
    cwd: packageRoot,
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: tmpdir(),
      HOME: join(directory, "home"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString();
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  return {
    exitCode: result.exitCode,
    stdout,
    lines,
    receipt: JSON.parse(lines[0] ?? "null") as Record<string, any>,
  };
}

describe("agenttool-collab-host end", () => {
  test("resumes a stale credential, releases every lease, ends, and removes the file", () => {
    const { handle, file } = startWithCredentialFile("host-ended-worker");
    const claim = claimEditTask(handle, "host-live", "src/host-live.ts");
    // A later resume and an acknowledgement leave the file's generation and
    // cursor stale; the host CLI must still end the session.
    const resumed = store.resumeSession(handle.credential);
    const page = store.nextForSession(resumed.credential).events;
    store.acknowledgeSessionCursor({
      ...resumed.credential,
      anchor: page.next_anchor,
      expected_cursor_version: resumed.session.cursor_version,
    });

    const run = runHost([
      "end",
      "--session-file",
      file,
      "--reason",
      "host exit sweep: job test ended completed",
      "--release-leases",
      "--db",
      databasePath,
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.lines).toHaveLength(1);
    expect(run.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "ended",
      session_id: handle.session.id,
      released: [{ task_id: claim.id, lease_id: claim.lease_id, via: "release" }],
      ended_at: expect.any(String),
    });
    expect(run.stdout).not.toContain(handle.credential.session_token);
    expect(existsSync(file)).toBe(false);
    const ended = store.getCoordinationSession(handle.session.id);
    expect(ended?.status).toBe("ended");
    expect(ended?.ended_at).toBe(run.receipt.ended_at);
    expect(store.getTask(handle.workspace.id, claim.id)).toMatchObject({
      status: "open",
      lease_id: null,
    });
    const released = store.eventsSince(handle.workspace.id, 0, 500).events.find(
      (event) => event.type === "task.released" && event.entity_id === claim.id,
    );
    expect(released?.payload.summary).toBe("host exit sweep: job test ended completed");
    expect(store.verifyJournal(handle.workspace.id)).toBe(true);
  });

  test("reports already_ended for an ended session and removes its revoked file", () => {
    const { handle, file } = startWithCredentialFile("host-already-ended");
    const ended = store.endSession({ ...handle.credential, reason: "Ended in-process first" });

    for (const flags of [[], ["--release-leases"]]) {
      if (!existsSync(file)) {
        writeSessionCredentialFile(file, handle.credential);
      }
      const run = runHost(
        ["end", "--session-file", file, "--reason", "host exit sweep: late", ...flags],
        { AGENTOOL_COLLAB_DB: databasePath },
      );

      expect(run.exitCode).toBe(0);
      expect(run.receipt).toEqual({
        protocol: "agenttool.collab-host/1",
        status: "already_ended",
        session_id: handle.session.id,
        released: [],
        ended_at: ended.ended_at,
      });
      expect(run.stdout).not.toContain(handle.credential.session_token);
      expect(existsSync(file)).toBe(false);
    }
  });

  test("refuses without mutating anything when --release-leases is absent and a lease is live", () => {
    const { handle, file } = startWithCredentialFile("host-refused");
    const claim = claimEditTask(handle, "host-refused", "src/host-refused.ts");
    // Leave the file's cursor behind the journal: a resume would now flag
    // cursor recovery, so an unchanged flag proves no resume happened.
    const page = store.nextForSession(handle.credential).events;
    store.acknowledgeSessionCursor({
      ...handle.credential,
      anchor: page.next_anchor,
      expected_cursor_version: handle.session.cursor_version,
    });
    const before = sessionRow(handle.session.id);
    const headBefore = store.getWorkspace(handle.workspace.id)!.event_head_sequence;

    const run = runHost([
      "end",
      "--session-file",
      file,
      "--reason",
      "host exit sweep: no flag",
      "--db",
      databasePath,
    ]);

    expect(run.exitCode).toBe(1);
    expect(run.receipt).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "error",
      error: "session_has_active_leases",
      task_ids: [claim.id],
      leases: [{ task_id: claim.id, lease_id: claim.lease_id, expires_at: claim.lease_expires_at }],
      required_action: "resolve_active_task_leases",
    });
    expect(run.receipt.message).toContain("release_leases");
    expect(run.receipt.remedy).toContain("release_leases");
    expect(run.stdout).not.toContain(handle.credential.session_token);
    expect(existsSync(file)).toBe(true);
    expect(sessionRow(handle.session.id)).toEqual(before);
    expect(before.cursor_recovery_required).toBe(0);
    expect(store.getWorkspace(handle.workspace.id)!.event_head_sequence).toBe(headBefore);
  });

  test("reports an ended session with a warning when the revoked file cannot be removed", () => {
    const { handle, file } = startWithCredentialFile("host-sticky-file");
    const args = [
      "end",
      "--session-file",
      file,
      "--reason",
      "host exit sweep: sticky file",
      "--db",
      databasePath,
    ];
    // A read-only (but still private) directory lets the CLI read the file
    // and end the session, then makes the unlink fail.
    chmodSync(dirname(file), 0o500);
    let run: ReturnType<typeof runHost>;
    try {
      run = runHost(args);
    } finally {
      chmodSync(dirname(file), 0o700);
    }

    expect(run.exitCode).toBe(0);
    expect(run.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "ended",
      session_id: handle.session.id,
      released: [],
      ended_at: expect.any(String),
      warning: "session_file_remove_failed",
    });
    expect(existsSync(file)).toBe(true);
    expect(store.getCoordinationSession(handle.session.id)?.status).toBe("ended");

    const rerun = runHost(args);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.receipt).toEqual({
      protocol: "agenttool.collab-host/1",
      status: "already_ended",
      session_id: handle.session.id,
      released: [],
      ended_at: run.receipt.ended_at,
    });
    expect(existsSync(file)).toBe(false);
  });

  test("fails closed on usage errors, blank values, and a missing journal", () => {
    const { handle, file } = startWithCredentialFile("host-usage");
    const usage = runHost(["end", "--reason", "missing session file"]);
    expect(usage.exitCode).toBe(1);
    expect(usage.receipt).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "error",
      error: "usage_error",
    });
    expect(usage.receipt.message).toContain("--session-file");

    for (const args of [
      ["start"],
      ["end", "--session-file", file, "--reason", "x", "extra"],
      ["end", "--session-file", file, "--reason", "x", "--unknown"],
      ["end", "--session-file", "", "--reason", "blank session file"],
      ["end", "--session-file", file],
      ["end", "--session-file", file, "--reason", ""],
      ["end", "--session-file", file, "--reason", "   "],
      ["end", "--session-file", file, "--reason", "blank db", "--db", ""],
      ["end", "--session-file", file, "--reason", "blank db", "--db", "   "],
    ]) {
      const refused = runHost(args, { AGENTOOL_COLLAB_DB: databasePath });
      expect(refused.exitCode).toBe(1);
      expect(refused.lines).toHaveLength(1);
      expect(refused.receipt).toMatchObject({ status: "error", error: "usage_error" });
    }

    const missingDatabase = join(directory, "elsewhere", "collab.sqlite");
    const missing = runHost([
      "end",
      "--session-file",
      file,
      "--reason",
      "wrong journal",
      "--db",
      missingDatabase,
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.receipt).toMatchObject({ status: "error", error: "journal_not_found" });
    expect(existsSync(missingDatabase)).toBe(false);
    expect(existsSync(dirname(missingDatabase))).toBe(false);

    // A set-but-empty AGENTOOL_COLLAB_DB is honoured as given (`??`), so it
    // selects no journal rather than falling back to the default.
    const emptyEnvironment = runHost(
      ["end", "--session-file", file, "--reason", "empty env db"],
      { AGENTOOL_COLLAB_DB: "" },
    );
    expect(emptyEnvironment.receipt).toMatchObject({ status: "error", error: "journal_not_found" });

    expect(existsSync(file)).toBe(true);
    expect(store.getCoordinationSession(handle.session.id)?.status).toBe("active");
  });
});

describe("journal path resolution", () => {
  test("mirrors the MCP server: AGENTOOL_COLLAB_DB if set, else XDG_DATA_HOME, else ~/.local/share", () => {
    expect(resolveDatabasePath({ AGENTOOL_COLLAB_DB: "/tmp/explicit.sqlite", XDG_DATA_HOME: "/x" }))
      .toBe("/tmp/explicit.sqlite");
    expect(resolveDatabasePath({ AGENTOOL_COLLAB_DB: "" })).toBe("");
    expect(resolveDatabasePath({ XDG_DATA_HOME: "/data" })).toBe(
      "/data/agenttool/collab.sqlite",
    );
    expect(resolveDatabasePath({ XDG_DATA_HOME: "relative-data" })).toBe(
      join(resolve("relative-data"), "agenttool", "collab.sqlite"),
    );
    expect(defaultDatabasePath({ XDG_DATA_HOME: "" })).toBe(
      join(homedir(), ".local", "share", "agenttool", "collab.sqlite"),
    );
    expect(resolveDatabasePath({})).toBe(
      join(homedir(), ".local", "share", "agenttool", "collab.sqlite"),
    );
  });
});

describe("checked-in host bundle", () => {
  test("runs as the package bin and prints one JSON receipt", () => {
    const result = Bun.spawnSync(
      [process.execPath, join(packageRoot, "dist", "agenttool-collab-host.js"), "end"],
      {
        cwd: packageRoot,
        env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    const lines = result.stdout.toString().split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "error",
      error: "usage_error",
    });
  });
});
```

In `packages/collab/tests/mcp.test.ts`, add a public method to `class StdioMcpHarness` directly after its `callTool` method:

```ts
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return await this.request("tools/call", { name, arguments: args });
  }

  async listTools(): Promise<any> {
    return await this.request("tools/list", {});
  }
```

Then insert the test below directly after the closing `  }, 20_000);` of `test("shares repository, worktree, session, and review state across two bundled stdio processes", …)`. This is R19(1). It runs the checked-in `dist/` bundles, which Step 3 rebuilds, through the real stdio transport, so zod and the SDK sit in the path. It sends every new optional input and checks that each one took effect. It then ends a session whose MCP process has exited, using the host CLI bundle and the credential file that process wrote. It uses `existsSync`, which Task 5 imported, and `CollabStore`, which is already imported.

```ts
  test("carries every new optional input over stdio through the checked-in bundles", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-mcp-inputs-"));
    const root = join(directory, "repo");
    const databasePath = join(directory, "state", "collab.sqlite");
    const mcpBundle = join(packageRoot, "dist", "agenttool-collab-mcp.js");
    const hostBundle = join(packageRoot, "dist", "agenttool-collab-host.js");
    mkdirSync(root);
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));

    const implementer = new StdioMcpHarness(mcpBundle, databasePath);
    cleanup.push(() => implementer.close());
    await implementer.initialize();
    const reviewer = new StdioMcpHarness(mcpBundle, databasePath);
    cleanup.push(() => reviewer.close());
    await reviewer.initialize();

    // The shipped bundle must advertise every new input; a stale bundle fails here.
    const tools = new Map<string, any>(
      (await implementer.listTools()).tools.map((tool: any) => [tool.name, tool]),
    );
    const properties = (name: string) => Object.keys(tools.get(name).inputSchema.properties);
    expect(properties("collab_session_end")).toEqual(
      expect.arrayContaining(["reason", "release_leases", "release_summary"]),
    );
    expect(tools.get("collab_session_end").inputSchema.properties.release_leases.type).toBe("boolean");
    expect(properties("collab_task_complete")).toContain("review_requested_session_id");
    expect(properties("collab_task_review")).toEqual(
      expect.arrayContaining(["confidence", "confidence_basis", "limits"]),
    );
    expect(tools.get("collab_task_review").inputSchema.properties.confidence.enum).toEqual([
      "high",
      "medium",
      "low",
      "unknown",
    ]);
    expect(properties("collab_next")).toContain("after_sequence");

    const implementerJoin = await implementer.callTool("collab_session_start", {
      root_path: root,
      actor: "stdio-inputs-implementer",
    });
    const reviewerJoin = await reviewer.callTool("collab_session_start", {
      root_path: root,
      actor: "stdio-inputs-reviewer",
    });
    const workspaceId = implementerJoin.structuredContent.workspace.id;
    const reviewerSessionId = reviewerJoin.structuredContent.session.id;

    // review_requested_session_id (collab_task_complete)
    const created = await implementer.callTool("collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-inputs-create",
      title: "Requested review over stdio",
      work_mode: "edit",
      path_scopes: ["src/stdio-inputs.ts"],
    });
    const claimed = await implementer.callTool("collab_task_claim", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      idempotency_key: "stdio-inputs-claim",
      expected_version: created.structuredContent.task.version,
    });
    const reported = await implementer.callTool("collab_task_complete", {
      workspace_id: workspaceId,
      task_id: claimed.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      idempotency_key: "stdio-inputs-complete",
      expected_version: claimed.structuredContent.task.version,
      summary: "Ready for the requested reviewer",
      review_requested_session_id: reviewerSessionId,
    });
    expect(reported.isError).toBeUndefined();
    expect(reported.structuredContent.task.review_requested_session_id).toBe(reviewerSessionId);

    // bound after_sequence (collab_next): the acknowledged cursor is tolerated, anything else refused
    const cursorSequence = reviewerJoin.structuredContent.session.cursor.sequence;
    const routed = await reviewer.callTool("collab_next", {
      workspace_id: workspaceId,
      after_sequence: cursorSequence,
      event_limit: 50,
    });
    expect(routed.isError).toBeUndefined();
    expect(routed.structuredContent.reports.some(
      (report: any) => report.to_session_id === reviewerSessionId,
    )).toBe(true);
    const skipped = await reviewer.callTool("collab_next", {
      workspace_id: workspaceId,
      after_sequence: cursorSequence + 1,
    });
    expect(skipped.isError).toBe(true);
    expect(skipped.structuredContent.error).toBe("after_sequence_unsupported_in_bound_session");

    // confidence, confidence_basis, limits (collab_task_review)
    const reviewed = await reviewer.callTool("collab_task_review", {
      workspace_id: workspaceId,
      task_id: created.structuredContent.task.id,
      idempotency_key: "stdio-inputs-review",
      expected_version: reported.structuredContent.task.version,
      outcome: "accept",
      summary: "Requested reviewer accepts over stdio",
      confidence: "medium",
      confidence_basis: "Read the reported change.",
      limits: "Ran no tests.",
    });
    expect(reviewed.isError).toBeUndefined();
    expect(reviewed.structuredContent.report).toMatchObject({
      confidence: "medium",
      confidence_basis: "Read the reported change.",
      limits: "Ran no tests.",
    });

    // release_leases + release_summary (collab_session_end)
    const second = await implementer.callTool("collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-inputs-create-second",
      title: "Released on end over stdio",
      work_mode: "edit",
      path_scopes: ["src/stdio-release.ts"],
    });
    const secondClaim = await implementer.callTool("collab_task_claim", {
      workspace_id: workspaceId,
      task_id: second.structuredContent.task.id,
      idempotency_key: "stdio-inputs-claim-second",
      expected_version: second.structuredContent.task.version,
    });
    const blankSummary = await implementer.callTool("collab_session_end", {
      reason: "A blank summary without the flag",
      release_summary: "",
    });
    expect(blankSummary.isError).toBe(true);
    expect(blankSummary.structuredContent.error).toBe("invalid_release_summary");
    const ended = await implementer.callTool("collab_session_end", {
      reason: "Leaving over stdio",
      release_leases: true,
      release_summary: "Released by the stdio implementer on exit",
    });
    expect(ended.isError).toBeUndefined();
    expect(ended.structuredContent.released_leases).toEqual([
      {
        task_id: second.structuredContent.task.id,
        lease_id: secondClaim.structuredContent.task.lease_id,
        via: "release",
      },
    ]);

    // Host exit without collab_session_end: the host CLI bundle ends the
    // reviewer from the credential file its MCP process wrote.
    const third = await reviewer.callTool("collab_task_create", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-inputs-create-third",
      title: "Held when the reviewer host exits",
      work_mode: "edit",
      path_scopes: ["src/stdio-host-exit.ts"],
    });
    const thirdClaim = await reviewer.callTool("collab_task_claim", {
      workspace_id: workspaceId,
      task_id: third.structuredContent.task.id,
      idempotency_key: "stdio-inputs-claim-third",
      expected_version: third.structuredContent.task.version,
    });
    await reviewer.close();
    const reviewerFile = join(directory, "state", "collab-sessions", `${reviewerSessionId}.json`);
    expect(existsSync(reviewerFile)).toBe(true);
    const host = Bun.spawnSync([
      process.execPath,
      hostBundle,
      "end",
      "--session-file",
      reviewerFile,
      "--reason",
      "host exit sweep: stdio reviewer exited",
      "--release-leases",
      "--db",
      databasePath,
    ], {
      cwd: packageRoot,
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(host.exitCode).toBe(0);
    expect(JSON.parse(host.stdout.toString())).toMatchObject({
      protocol: "agenttool.collab-host/1",
      status: "ended",
      session_id: reviewerSessionId,
      released: [{
        task_id: third.structuredContent.task.id,
        lease_id: thirdClaim.structuredContent.task.lease_id,
        via: "release",
      }],
    });
    expect(existsSync(reviewerFile)).toBe(false);

    const verified = await implementer.callTool("collab_journal_verify", {
      workspace_id: workspaceId,
    });
    expect(verified.structuredContent.chain_valid).toBe(true);
    const observer = new CollabStore(databasePath);
    cleanup.push(() => observer.close());
    expect(observer.getCoordinationSession(reviewerSessionId)?.status).toBe("ended");
    expect(observer.getTask(workspaceId, third.structuredContent.task.id)).toMatchObject({
      status: "open",
      lease_id: null,
    });
  }, 30_000);
```

In `packages/collab/tests/package.test.ts`, inside `test("ships the plugins, skills, executable bundle, and notices"`:
- Directly after `    expect(packageManifest.bin["agenttool-collab-mcp"]).toBe("./dist/agenttool-collab-mcp.js");`, add:

  ```ts
      expect(packageManifest.bin["agenttool-collab-host"]).toBe("./dist/agenttool-collab-host.js");
  ```

- Directly after `    expect(statSync(join(packageRoot, "dist", "agenttool-collab-mcp.js")).mode & 0o111).not.toBe(0);`, add:

  ```ts
      expect(statSync(join(packageRoot, "dist", "agenttool-collab-host.js")).mode & 0o111).not.toBe(0);
  ```

In `bin/tests/npm-release.test.ts`, inside `test("requires package-specific runtime and protocol artifacts"`, find `expect(requiredArchiveEntries(releaseSpec("collab"))).toEqual(expect.arrayContaining([`. Directly after its first entry, `      "package/dist/agenttool-collab-mcp.js",`, add:

```ts
      "package/dist/agenttool-collab-host.js",
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
bun test tests/host.test.ts tests/package.test.ts
bun test tests/mcp.test.ts -t "checked-in bundles"
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
bun test bin/tests/npm-release.test.ts -t "requires package-specific runtime and protocol artifacts"
```

Expected (observed in the scratch copy):
- `host.test.ts` does not load: `error: Cannot find module '../src/database-path.js'`. Bun reports this as `1 fail`, `1 error`.
- `package.test.ts`: "ships the plugins, skills, executable bundle, and notices" fails with `Expected: "./dist/agenttool-collab-host.js"`, `Received: undefined`.
- The stdio test fails at the first schema check. The stale checked-in origin/main bundle advertises only `["reason"]` for `collab_session_end`, which shows as an `ExpectArrayContaining` diff.
- `npm-release.test.ts`: 1 fail, an `ExpectArrayContaining` diff whose received list has no `package/dist/agenttool-collab-host.js`.

- [ ] **Step 3: Write minimal implementation**

**Create `packages/collab/src/database-path.ts`.** It is the same derivation the MCP bin has today, moved so that both bins share one source and `sol`'s Python mirror has one reference (R15):

```ts
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

type Environment = Record<string, string | undefined>;

/**
 * The journal path every local Collab host uses when none is configured:
 * `$XDG_DATA_HOME/agenttool/collab.sqlite` (a relative value resolves against
 * the working directory; an empty one counts as unset), else
 * `~/.local/share/agenttool/collab.sqlite`.
 */
export function defaultDatabasePath(env: Environment = process.env): string {
  const dataHome = env.XDG_DATA_HOME;
  const base = dataHome
    ? (isAbsolute(dataHome) ? dataHome : resolve(dataHome))
    : join(homedir(), ".local", "share");
  return join(base, "agenttool", "collab.sqlite");
}

/**
 * `AGENTOOL_COLLAB_DB` whenever it is set, used verbatim (`??`, so even an
 * empty string is honoured); otherwise the default journal path.
 */
export function resolveDatabasePath(env: Environment = process.env): string {
  return env.AGENTOOL_COLLAB_DB ?? defaultDatabasePath(env);
}
```

**`packages/collab/bin/agenttool-collab-mcp.ts`:**
- Delete the two imports `import { homedir } from "node:os";` and `import { isAbsolute, join, resolve } from "node:path";`.
- Directly before `import { buildCollabMcpServer } from "../src/mcp.js";`, add `import { resolveDatabasePath } from "../src/database-path.js";`.
- Delete the local `function defaultDatabasePath(): string { … }` and the blank line after it.
- In `main()`, replace `  const databasePath = process.env.AGENTOOL_COLLAB_DB ?? defaultDatabasePath();` with:

```ts
  const databasePath = resolveDatabasePath(process.env);
```

**`packages/collab/src/store.ts`:** after the closing `}` of `listCoordinationSessions(` and before `acknowledgeSessionCursor(input: {`, insert the code below. `getCoordinationSession` goes through Task 7's projection seam (R6). `preflightSessionEnd` is the read-only check that R14 requires.

```ts
  getCoordinationSession(sessionId: string): CoordinationSession | null {
    const id = validateId(sessionId, "session_id");
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`)
      .get(id) as CoordinationSessionRow | null;
    return row ? this.sessionProjection(row) : null;
  }

  /**
   * Read-only check before a host-side end without lease release. It checks
   * the resume token (as resumeSession does, never the generation) and throws
   * the same session_has_active_leases refusal endSession would, while the
   * session still holds a live lease. It writes nothing: no generation bump,
   * no session.resumed event, no cursor-recovery flag.
   */
  preflightSessionEnd(credential: { session_id: string; session_token: string }): void {
    const sessionId = validateId(credential.session_id, "session_id");
    const row = this.authenticateResumeToken(sessionId, credential.session_token);
    const refusal = this.liveLeaseRefusal(row.workspace_id, row.id, this.timestamp());
    if (refusal) throw refusal;
  }
```

**Create `packages/collab/src/host.ts`:**

```ts
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import type { SessionCredential, SessionEndRelease, SessionHandle } from "./protocol.js";
import {
  readSessionCredentialFile,
  removeSessionCredentialFile,
} from "./session-file.js";
import { CollabStore } from "./store.js";

export const COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1" as const;

export const COLLAB_HOST_USAGE =
  "usage: agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]";

export interface HostEndReceipt {
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "ended" | "already_ended";
  session_id: string;
  released: SessionEndRelease[];
  ended_at: string | null;
  /** Present only when the session is ended but its revoked credential file is still on disk. */
  warning?: "session_file_remove_failed";
}

export interface HostErrorReceipt {
  [detail: string]: unknown;
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "error";
  error: string;
  message: string;
}

export interface HostEndOptions {
  session_file: string;
  reason: string;
  release_leases: boolean;
}

/**
 * Host-side end for a session whose MCP process is gone. Without
 * release_leases it first refuses, read-only, while a lease is live. It then
 * resumes with cursor recovery allowed (a stale generation or cursor in the
 * file is tolerated), ends through the store, and removes the credential
 * file. The returned receipt never contains the credential.
 */
export function endSessionFromCredential(
  store: CollabStore,
  credential: SessionCredential,
  options: HostEndOptions,
): HostEndReceipt {
  let resumed: SessionHandle;
  try {
    if (!options.release_leases) store.preflightSessionEnd(credential);
    resumed = store.resumeSession(credential, { allow_cursor_recovery: true });
  } catch (error) {
    if (error instanceof CollabError && error.code === "session_auth_failed") {
      const known = store.getCoordinationSession(credential.session_id);
      if (known?.status === "ended") {
        return removeRevokedFile(options.session_file, {
          protocol: COLLAB_HOST_PROTOCOL,
          status: "already_ended",
          session_id: known.id,
          released: [],
          ended_at: known.ended_at,
        });
      }
    }
    throw error;
  }
  const ended = store.endSessionWithReleases({
    ...resumed.credential,
    reason: options.reason,
    release_leases: options.release_leases,
  });
  return removeRevokedFile(options.session_file, {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "ended",
    session_id: ended.session.id,
    released: ended.released_leases.map(({ task_id, lease_id, via }) => ({
      task_id,
      lease_id,
      via,
    })),
    ended_at: ended.session.ended_at,
  });
}

/** The session is ended either way; a leftover revoked file is a warning, not a failure. */
function removeRevokedFile(sessionFile: string, receipt: HostEndReceipt): HostEndReceipt {
  try {
    removeSessionCredentialFile(sessionFile);
    return receipt;
  } catch {
    return { ...receipt, warning: "session_file_remove_failed" };
  }
}

/** Parse argv, run one command, and return the single JSON receipt line. */
export function runCollabHostCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): { exit_code: 0 | 1; line: string } {
  let secret: string | null = null;
  const emit = (payload: HostEndReceipt | HostErrorReceipt, exitCode: 0 | 1) => {
    const line = JSON.stringify(payload);
    if (secret !== null && line.includes(secret)) {
      return {
        exit_code: 1 as const,
        line: JSON.stringify({
          protocol: COLLAB_HOST_PROTOCOL,
          status: "error",
          error: "receipt_withheld",
          message: "The receipt would have contained credential material and was withheld",
        }),
      };
    }
    return { exit_code: exitCode, line };
  };
  try {
    const args = parseHostArgs(argv);
    const databasePath = args.db ?? resolveDatabasePath(env);
    if (!existsSync(databasePath)) {
      throw new CollabError(
        "journal_not_found",
        "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB",
      );
    }
    const credential = readSessionCredentialFile(args.session_file);
    secret = credential.session_token;
    const store = new CollabStore(databasePath);
    try {
      return emit(
        endSessionFromCredential(store, credential, {
          session_file: args.session_file,
          reason: args.reason,
          release_leases: args.release_leases,
        }),
        0,
      );
    } finally {
      store.close();
    }
  } catch (error) {
    return emit(errorReceipt(error), 1);
  }
}

function parseHostArgs(argv: string[]): HostEndOptions & { db?: string } {
  let parsed: ReturnType<typeof parseHostOptions>;
  try {
    parsed = parseHostOptions(argv);
  } catch (error) {
    throw new CollabError(
      "usage_error",
      `${error instanceof Error ? error.message : String(error)}; ${COLLAB_HOST_USAGE}`,
    );
  }
  const [command, ...extra] = parsed.positionals;
  if (command !== "end" || extra.length > 0) {
    throw new CollabError("usage_error", COLLAB_HOST_USAGE);
  }
  const sessionFile = parsed.values["session-file"];
  const reason = parsed.values.reason;
  if (!sessionFile || sessionFile.trim() === "") {
    throw new CollabError("usage_error", `--session-file is required; ${COLLAB_HOST_USAGE}`);
  }
  if (!reason || reason.trim() === "") {
    throw new CollabError("usage_error", `--reason is required; ${COLLAB_HOST_USAGE}`);
  }
  if (parsed.values.db !== undefined && parsed.values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  return {
    session_file: sessionFile,
    reason,
    release_leases: parsed.values["release-leases"] === true,
    db: parsed.values.db,
  };
}

function parseHostOptions(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "session-file": { type: "string" },
      reason: { type: "string" },
      "release-leases": { type: "boolean" },
      db: { type: "string" },
    },
  });
}

function errorReceipt(error: unknown): HostErrorReceipt {
  if (error instanceof CollabError) {
    return {
      ...error.details,
      protocol: COLLAB_HOST_PROTOCOL,
      status: "error",
      error: error.code,
      message: error.message,
    };
  }
  return {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "error",
    error: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
```

With `--release-leases`, the CLI passes no `release_summary`. The store therefore uses `--reason` as each release summary and recovery note, because `releaseNote = releaseSummary ?? reason` (Task 5). B1's sweep reason `host exit sweep: job <id> ended <state>` is recorded on every released task.

**Create `packages/collab/bin/agenttool-collab-host.ts`:**

```ts
#!/usr/bin/env bun
import { runCollabHostCli } from "../src/host.js";

const result = runCollabHostCli(process.argv.slice(2), process.env);
process.stdout.write(`${result.line}\n`);
// Exit naturally once stdout drains rather than cutting a piped write short.
process.exitCode = result.exit_code;
```

**Replace `packages/collab/scripts/build-mcp-bundle.ts`.** `buildMcpBundle` keeps its signature. The MCP error text keeps its old wording ("standalone MCP bundle build exited N").

```ts
#!/usr/bin/env bun
import { chmod } from "node:fs/promises";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

/** Every tracked executable bundle: Bun entry point → checked-in output. */
export const COLLAB_BUNDLES = [
  {
    name: "standalone MCP",
    entry: "bin/agenttool-collab-mcp.ts",
    output: "dist/agenttool-collab-mcp.js",
  },
  {
    name: "host CLI",
    entry: "bin/agenttool-collab-host.ts",
    output: "dist/agenttool-collab-host.js",
  },
] as const;

export type CollabBundle = (typeof COLLAB_BUNDLES)[number];

export async function buildBundle(
  bundle: CollabBundle,
  outputPath = join(packageRoot, bundle.output),
): Promise<void> {
  const build = Bun.spawn(
    [
      process.execPath,
      "build",
      "--target=bun",
      "--outfile",
      outputPath,
      bundle.entry,
    ],
    {
      cwd: packageRoot,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`${bundle.name} bundle build exited ${exitCode}`);
  }

  const generated = await Bun.file(outputPath).text();
  const normalized = generated.replace(/[\t ]+$/gm, "");
  if (normalized !== generated) await Bun.write(outputPath, normalized);
  await chmod(outputPath, 0o755);
}

export async function buildMcpBundle(
  outputPath = join(packageRoot, COLLAB_BUNDLES[0].output),
): Promise<void> {
  await buildBundle(COLLAB_BUNDLES[0], outputPath);
}

if (import.meta.main) {
  for (const bundle of COLLAB_BUNDLES) await buildBundle(bundle);
}
```

**Replace `packages/collab/scripts/check-mcp-bundle.ts`.** The doc comment is kept verbatim, and both bundles are verified:

```ts
#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { buildBundle, COLLAB_BUNDLES } from "./build-mcp-bundle.js";

/** The tracked bundle is compared byte-for-byte against a fresh local build.
 *
 *  That comparison only means "the bundle is current" when the local bundler
 *  is the one that produced it. Bun's own codegen changes between releases —
 *  1.3.13 emits a different `__export` setter shim and different identifier
 *  suffixes than 1.3.5 does, from byte-identical source. On any other Bun this
 *  reports a difference that is not staleness, and the old advice ("run
 *  build:mcp and commit the result") would replace a bundle built on the
 *  pinned bundler with one CI rebuilds differently and rejects.
 *
 *  So: verify on the pinned bundler, and elsewhere say plainly that the byte
 *  comparison was skipped. CI runs the pinned version and stays the enforcer. */

const packageRoot = resolve(import.meta.dir, "..");

const manifest = (await Bun.file(join(packageRoot, "package.json")).json()) as {
  bundlerBunVersion?: string;
};
const pinnedBunVersion = manifest.bundlerBunVersion;

for (const bundle of COLLAB_BUNDLES) {
  if (!(await Bun.file(join(packageRoot, bundle.output)).exists())) {
    throw new Error(`tracked ${bundle.name} bundle is missing; run \`bun run build:mcp\``);
  }
}

if (pinnedBunVersion && Bun.version !== pinnedBunVersion) {
  console.warn(
    `check:mcp-bundle: skipped — this Bun is ${Bun.version}, the bundle is built with ${pinnedBunVersion}.\n` +
      "  Bundle bytes are bundler-version-specific, so a mismatch here would not mean the bundle is stale.\n" +
      `  Do not commit a rebuild from ${Bun.version}; CI rebuilds on ${pinnedBunVersion} and verifies it there.`,
  );
  process.exit(0);
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "agenttool-collab-bundle-"));

try {
  for (const bundle of COLLAB_BUNDLES) {
    const candidateBundle = join(temporaryDirectory, basename(bundle.output));
    await buildBundle(bundle, candidateBundle);

    const checkedIn = new Uint8Array(
      await Bun.file(join(packageRoot, bundle.output)).arrayBuffer(),
    );
    const candidate = new Uint8Array(await Bun.file(candidateBundle).arrayBuffer());
    const matches =
      checkedIn.byteLength === candidate.byteLength &&
      checkedIn.every((byte, index) => byte === candidate[index]);
    if (!matches) {
      throw new Error(
        `tracked ${bundle.name} bundle ${bundle.output} is stale; run \`bun run build:mcp\` and commit the result (Bun ${Bun.version})`,
      );
    }
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
```

**`packages/collab/package.json`:** replace the `"bin"` object with:

```json
  "bin": {
    "agenttool-collab-mcp": "./dist/agenttool-collab-mcp.js",
    "agenttool-collab-host": "./dist/agenttool-collab-host.js"
  },
```

**`.gitignore`:** directly after `!packages/collab/dist/agenttool-collab-mcp.js`, add:

```
!packages/collab/dist/agenttool-collab-host.js
```

**`bin/npm-release.ts`:** in `if (spec.name === "@agenttool/collab") { entries.push(`, directly after `      "package/dist/agenttool-collab-mcp.js",`, add:

```ts
      "package/dist/agenttool-collab-host.js",
```

**Build both bundles with the pinned bundler.** Local Bun is 1.3.13, and a bundle built with it fails CI's byte check. First re-check the disk: the pinned bundler download (about 57 MB, unless it is already cached in `~/.npm/_npx`) and two bundle builds need room.

```bash
df -h /System/Volumes/Data   # stop if Avail is under 2 GB (same rule as Task 1 Step 0)
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
npx --yes bun@1.3.5 run build:mcp
ls -l dist/
```

Expected: `agenttool-collab-mcp.js` at about 1.34 MB (entry point), then `agenttool-collab-host.js` at about 0.22 MB (entry point). Both files are mode `-rwxr-xr-x`, and both start with `#!/usr/bin/env bun`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
bun test tests/host.test.ts tests/package.test.ts
bun test tests/mcp.test.ts
bun test
bun run typecheck
npx --yes bun@1.3.5 run check:mcp-bundle; echo "check exit=$?"
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
bun test bin/tests/npm-release.test.ts
git check-ignore -q packages/collab/dist/agenttool-collab-host.js; echo "ignored=$?"
```

Expected:
- `host.test.ts`: 7 pass, 0 fail (new file). `package.test.ts`: 0 fail, same test count.
- `mcp.test.ts`: 0 fail, 1 more test than after Task 7.
- Full collab suite: 0 fail.
- `tsc --noEmit`: clean.
- `check exit=0` on Bun 1.3.5. The rebuild byte-matches both checked-in bundles.
- `npm-release.test.ts`: 0 fail, same test count.
- `ignored=1`: the host bundle is no longer ignored, so it will be committed.

Both `dist/` bundles go stale again if anything later touches `src/` or `bin/`. Plan A Task 10's pre-PR freshness step (R9) rebuilds and checks them with `npx --yes bun@1.3.5 run build:mcp && npx --yes bun@1.3.5 run check:mcp-bundle && git diff --exit-code packages/collab/dist`. Both bundles are covered there, because these two scripts now iterate `COLLAB_BUNDLES`.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
git add .gitignore bin/npm-release.ts bin/tests/npm-release.test.ts \
  packages/collab/src/database-path.ts packages/collab/src/host.ts packages/collab/src/store.ts \
  packages/collab/bin/agenttool-collab-host.ts packages/collab/bin/agenttool-collab-mcp.ts \
  packages/collab/scripts/build-mcp-bundle.ts packages/collab/scripts/check-mcp-bundle.ts \
  packages/collab/package.json packages/collab/dist/agenttool-collab-host.js packages/collab/dist/agenttool-collab-mcp.js \
  packages/collab/tests/host.test.ts packages/collab/tests/mcp.test.ts packages/collab/tests/package.test.ts
git commit -F - <<'MSG'
feat(collab): add agenttool-collab-host end for host-side clean exit

A host that outlived its MCP process can end the session from its
credential file. Without --release-leases a live lease is refused
read-only, before anything is resumed. Otherwise the CLI resumes with
cursor recovery allowed (a stale generation or cursor is tolerated),
ends, removes the file, and prints one JSON receipt that never contains
the credential. An already-ended session yields already_ended; a file
that cannot be removed after the end is a warning, not a failure. The
CLI ships as its own Bun 1.3.5 bundle, checked alongside the MCP bundle,
and refuses to create a missing journal. The journal path derivation
moves to src/database-path.ts so both bins share it. A two-process stdio
test sends every new optional input through the checked-in bundles.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
MSG
```


### Task 6: Bound `collab_next` refuses an `after_sequence` that is not the acknowledged cursor

Runs after Task 5 and before Task 7. Every anchor below is quoted text or a test name; the origin/main line numbers are hints only, because Tasks 1-5 shift them.

**Files:**
- Modify: `packages/collab/src/store.ts`
  - `nextForSession()`: its input type (origin/main hint 3850-3856), and inside its first `.immediate()` transaction, between the closing `}` of `if (input.known_cursor) { ... }` and `const eventLimit = validateNextEventLimit(input.event_limit);` (hint 3902-3903)
  - a new module-level helper placed directly before `function normalizeSessionLeaseInput(input: {` (hint 5492), which follows `function validateNextEventLimit(`
- Modify: `packages/collab/src/mcp.ts`: the `server.registerTool("collab_next", ...)` registration (hint 341-371)
- Test: `packages/collab/tests/mcp.test.ts`. Insert the new test immediately after the closing `  });` of `test("bounds credential-bound collab_next pages without changing cursor authority", ...)`. Leave that test as it is: it pins the bound-actor override (`actor: "spoofed-reader"` → `actor === "bound-reader"`).
- Test: `packages/collab/tests/v2.test.ts`. Insert the new test immediately after the closing `  });` of `test("bounds session event pages while preserving exact reports and acknowledgement", ...)`. Task 5 inserts its tests after the preceding test ("refuses to end a session while it owns a live lease"), so this anchor is still unique.

**Interfaces:**
- Consumes: the existing `CollabStore.nextForSession()`, `acknowledgeSessionCursor()`, the MCP `failure()` flattening (`{ error, message, ...details }`, `function failure(` in mcp.ts) and the `CoordinationSessionRow` cursor columns (`cursor_epoch_id`, `cursor_sequence`, `cursor_hash`, `cursor_version`).
- Produces:
  - error code `"after_sequence_unsupported_in_bound_session"` with details `{ after_sequence: number, cursor: EventCursor, cursor_version: number, remedy: string }`. Both `remedy` and `message` name `collab_cursor_ack` and `collab_events_since` (with `after_sequence`/`after_anchor`).
  - `CollabStore.nextForSession` input `after_sequence?: number`. A value equal to the persisted `cursor_sequence` is accepted. At store level a negative or non-integer value gives `invalid_cursor` (the MCP zod schema already rejects those).
  - the `collab_next` input `after_sequence` gains a `.describe()` naming the error code, and the `collab_next` description names `collab_cursor_ack` and `collab_events_since`.
  - The check runs inside the first `.immediate()` transaction, against the persisted cursor (not the MCP binding's cached handle), so a refused poll rolls back and does not refresh `last_seen_at`.
  - Legacy actor mode (`nextForActor`) and the bound-actor override are unchanged.
- Transport coverage: the handler tests below call `registration.handler` directly and skip zod. Task 8's two-process stdio test (Review Focus 1) exercises `after_sequence` over the real MCP transport after the bundles are rebuilt.

- [ ] **Step 1: Write the failing test**

In `packages/collab/tests/mcp.test.ts`, insert the test below right after the anchor named in **Files**. It uses the existing helpers `node()` (which builds `new CollabStore(join(directory, "collab.sqlite"))` and `buildCollabMcpServer(store)` and registers cleanup) and `callTool()`. The file already imports `buildCollabMcpServer` and `CollabStore`, so no new imports are needed.

```ts

  test("refuses a bound collab_next after_sequence that is not the acknowledged cursor", async () => {
    const { root, store, server } = node();
    const nextTool = (server as any)._registeredTools.collab_next;
    expect(nextTool.inputSchema.shape.after_sequence.description).toContain(
      "after_sequence_unsupported_in_bound_session",
    );
    expect(nextTool.description).toContain("collab_cursor_ack");
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "bound-pager",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    for (let index = 0; index < 3; index += 1) {
      store.createTask({
        workspace_id: workspaceId,
        actor: "fixture-writer",
        idempotency_key: `after-sequence-task-${index}`,
        title: `After-sequence task ${index}`,
      });
    }

    const first = await callTool(server, "collab_next", { workspace_id: workspaceId });
    expect(first.isError).toBeUndefined();
    const cursor = first.structuredContent.session.cursor;
    expect(cursor.sequence).toBe(0);

    const tolerated = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      actor: "spoofed-pager",
      after_sequence: cursor.sequence,
    });
    expect(tolerated.isError).toBeUndefined();
    expect(tolerated.structuredContent.actor).toBe("bound-pager");
    expect(tolerated.structuredContent.events.cursor).toEqual(cursor);

    const skipAhead = first.structuredContent.events.next_anchor.sequence;
    const refused = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      after_sequence: skipAhead,
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      error: "after_sequence_unsupported_in_bound_session",
      after_sequence: skipAhead,
      cursor,
      cursor_version: 0,
    });
    expect(refused.structuredContent.message).toContain("collab_cursor_ack");
    expect(refused.structuredContent.message).toContain("collab_events_since");
    expect(refused.structuredContent.remedy).toContain("collab_cursor_ack");
    expect(refused.structuredContent.remedy).toContain("collab_events_since");

    const acknowledged = await callTool(server, "collab_cursor_ack", {
      workspace_id: workspaceId,
      anchor: first.structuredContent.events.next_anchor,
      expected_cursor_version: first.structuredContent.session.cursor_version,
    });
    const staleAfterAck = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      after_sequence: 0,
    });
    expect(staleAfterAck.isError).toBe(true);
    expect(staleAfterAck.structuredContent.error).toBe(
      "after_sequence_unsupported_in_bound_session",
    );
    expect(staleAfterAck.structuredContent.cursor).toEqual(
      acknowledged.structuredContent.session.cursor,
    );
    const matchingAfterAck = await callTool(server, "collab_next", {
      workspace_id: workspaceId,
      after_sequence: acknowledged.structuredContent.session.cursor.sequence,
    });
    expect(matchingAfterAck.isError).toBeUndefined();
    expect(matchingAfterAck.structuredContent.events.cursor).toEqual(
      acknowledged.structuredContent.session.cursor,
    );

    const legacy = node();
    const opened = await callTool(legacy.server, "collab_workspace_open", {
      root_path: legacy.root,
      actor: "legacy-pager",
    });
    const legacyPage = await callTool(legacy.server, "collab_next", {
      workspace_id: opened.structuredContent.workspace.id,
      actor: "legacy-pager",
      after_sequence: 1,
    });
    expect(legacyPage.isError).toBeUndefined();
    expect(legacyPage.structuredContent.events.cursor.sequence).toBe(1);
  });
```

In `packages/collab/tests/v2.test.ts`, insert the test below right after the anchor named in **Files**. It uses the existing fixtures: `store` with the injected clock (`new CollabStore(databasePath, { now: () => new Date(currentTime) })`), the `currentTime: Date` variable, and the helpers `session()`, `errorFrom()` and `errorCode()`. No new imports are needed.

```ts

  test("refuses a bound after_sequence that differs from the acknowledged cursor without polling", () => {
    const reader = session("after-sequence-reader");
    const joinedAt = reader.session.last_seen_at;
    currentTime = new Date(currentTime.getTime() + 1_000);

    expect(errorCode(() => store.nextForSession({ ...reader.credential, after_sequence: -1 })))
      .toBe("invalid_cursor");
    expect(errorCode(() => store.nextForSession({ ...reader.credential, after_sequence: 1.5 })))
      .toBe("invalid_cursor");
    const refused = errorFrom(() =>
      store.nextForSession({ ...reader.credential, after_sequence: 1 }),
    );
    expect(refused.code).toBe("after_sequence_unsupported_in_bound_session");
    expect(refused.details).toMatchObject({
      after_sequence: 1,
      cursor: reader.session.cursor,
      cursor_version: reader.session.cursor_version,
    });
    expect(String(refused.details.remedy)).toContain("collab_cursor_ack");
    expect(String(refused.details.remedy)).toContain("collab_events_since");
    expect(store.listCoordinationSessions(reader.workspace.id)[0]!.last_seen_at).toBe(joinedAt);

    const tolerated = store.nextForSession({ ...reader.credential, after_sequence: 0 });
    expect(tolerated.events.cursor).toEqual(reader.session.cursor);
    expect(tolerated.session.last_seen_at).toBe(currentTime.toISOString());
  });
```

- [ ] **Step 2: Run test to verify it fails**

If `packages/collab/node_modules` is missing, first run `bun install --frozen-lockfile` in `packages/collab` (see the Task 5 precondition). Without it, `mcp.test.ts` fails with `Cannot find module '@modelcontextprotocol/server'`.

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/mcp.test.ts tests/v2.test.ts -t "after_sequence"
```

Expected: the two new tests fail (`0 pass`, `2 fail`; every other test is filtered out, since no earlier test name contains `after_sequence`).
- In `mcp.test.ts`: `error: Received value must be an array type, or both received and expected values must be strings.` It is raised at `nextTool.inputSchema.shape.after_sequence.description`, which is still undefined.
- In `v2.test.ts`: `error: expected operation to fail`, raised by the `errorFrom` helper on the `after_sequence: -1` call, because `nextForSession` still ignores the field.

- [ ] **Step 3: Write minimal implementation**

(a) In `src/store.ts`, `nextForSession()`: add `after_sequence?: number;` to the input type, so that it reads:

```ts
  nextForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    known_cursor?: EventCursor;
    event_limit?: number;
    after_sequence?: number;
  }): {
```

(b) In the same method's first transaction (`const authenticatedPoll = this.db.transaction(() => {`), find the closing `}` of `if (input.known_cursor) { ... }`. Insert the block below immediately after it, before `const eventLimit = validateNextEventLimit(input.event_limit);`. The throw happens inside `.immediate()`, so a refused poll rolls back and never refreshes `last_seen_at`.

```ts
      if (input.after_sequence !== undefined) {
        requireBoundAfterSequence(input.after_sequence, authenticated);
      }
```

(c) Insert the following directly before `function normalizeSessionLeaseInput(input: {`, which follows `function validateNextEventLimit(...) { ... }`:

```ts
const BOUND_AFTER_SEQUENCE_REMEDY =
  "A bound collab_next always pages from the acknowledged session cursor. Advance it with "
  + "collab_cursor_ack (next_anchor of the page you processed), or read from any position "
  + "without acknowledging with collab_events_since (after_sequence or after_anchor).";

function requireBoundAfterSequence(
  afterSequence: number,
  session: CoordinationSessionRow,
): void {
  if (!Number.isInteger(afterSequence) || afterSequence < 0) {
    throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
  }
  if (afterSequence === session.cursor_sequence) return;
  throw new CollabError(
    "after_sequence_unsupported_in_bound_session",
    `after_sequence ${afterSequence} differs from this session's acknowledged cursor `
      + `(sequence ${session.cursor_sequence}). ${BOUND_AFTER_SEQUENCE_REMEDY}`,
    {
      after_sequence: afterSequence,
      cursor: {
        epoch_id: session.cursor_epoch_id,
        sequence: session.cursor_sequence,
        hash: session.cursor_hash,
      },
      cursor_version: session.cursor_version,
      remedy: BOUND_AFTER_SEQUENCE_REMEDY,
    },
  );
}

```

(d) In `src/mcp.ts`, replace the whole `collab_next` registration (from `server.registerTool(` with `"collab_next",` through its closing `);`) with the code below. Three things change: the description gains its last sentence, `after_sequence` gains a `.describe()`, and the bound branch forwards `after_sequence`. `actor: legacyActor` and the `nextForActor` branch are unchanged, so the bound-actor override stays as it is.

```ts
  server.registerTool(
    "collab_next",
    {
      title: "Poll the next useful collaboration state",
      description:
        "Poll without acknowledging, with 1–50 events per page and a default of 10. Routed reports are bounded to the exact event page; task, conflict, and handoff projections describe the same snapshot head. A bound session always pages from its acknowledged cursor: advance with collab_cursor_ack, or read elsewhere with collab_events_since.",
      annotations: localMutation,
      inputSchema: {
        workspace_id: workspaceId,
        actor: legacyActor,
        after_sequence: z.number().int().nonnegative().optional()
          .describe(
            "Legacy actor mode: page after this sequence. A bound session pages from its acknowledged cursor; " +
            "any other value is refused with after_sequence_unsupported_in_bound_session.",
          ),
        known_cursor: eventAnchor.optional(),
        event_limit: nextEventLimit,
      },
    },
    async ({ workspace_id, actor, after_sequence, known_cursor, event_limit }) => call(() => {
      requireWorkspace(workspace_id);
      return binding
        ? store.nextForSession({
          ...boundCredential(),
          known_cursor,
          event_limit: event_limit ?? DEFAULT_MCP_NEXT_EVENT_LIMIT,
          after_sequence,
        })
        : store.nextForActor(
          workspace_id,
          requireLegacyActor(actor),
          after_sequence ?? 0,
          event_limit ?? DEFAULT_MCP_NEXT_EVENT_LIMIT,
        );
    }),
  );
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/mcp.test.ts tests/v2.test.ts -t "after_sequence" && bun test tests/mcp.test.ts tests/v2.test.ts && bun run typecheck
```

Expected:
- the filtered run: `2 pass`, `0 fail`
- the full `mcp.test.ts` and `v2.test.ts` run: `0 fail`, with one more test in each file than after Task 5
- `tsc --noEmit` exits 0

Do not run `bun run build:mcp` here. The tracked `dist/` bundles are byte-pinned to Bun 1.3.5, and this Mac runs Bun 1.3.13. Task 8 rebuilds them on 1.3.5.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing && git add packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/mcp.test.ts packages/collab/tests/v2.test.ts && git commit -F - <<'EOF'
fix(collab): refuse a bound collab_next after_sequence that is not the acknowledged cursor

A credential-bound collab_next always pages from the persisted session
cursor and used to drop after_sequence silently (F6). It now refuses a
differing value with after_sequence_unsupported_in_bound_session, naming
collab_cursor_ack and collab_events_since as the remedy, and tolerates a
value equal to the acknowledged sequence. Legacy actor mode and the
bound-actor override are unchanged.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```

### Task 7: Staleness as a derived view (session `liveness`, task `assignee_liveness`, `collab_next.recovery_required`)

Runs after Tasks 5 and 6 and before Task 8. Anchors are quoted text; origin/main line numbers are hints only.

**Files:**
- Modify: `packages/collab/src/protocol.ts`
  - after `export type SessionStatus = "active" | "ended";` (hint 117)
  - in `export interface CoordinationSession`, after `cursor_recovery_required: boolean;` (hint 134)
  - in `export interface Task`, after `assignee_session_id: string | null;` (hint 202). The same line also appears in `interface TaskConflict`; leave that one alone.
  - in `export interface NextCollabState`, after `handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;` (hint 438)
- Modify: `packages/collab/src/store.ts`
  - the `./protocol.js` import list (hints 20 and 45)
  - every `coordinationSessionFromRow(` call site, which becomes `this.sessionProjection(`. Task 5's `endSessionWithReleases()` is one of them; the full list is in Step 3(e).
  - `nextForActor()` and `nextForSession()`: their return types and returned objects
  - `mutateAsSession()`: move the `last_seen_at` refresh (hints 4324-4345)
  - `taskFromRow()`, between `assignee_session_id: row.assignee_session_id,` and `claim_worktree_id: row.claim_worktree_id,` (hint 5285; the first line alone is not unique in the file)
  - two new private methods immediately before `private requireWorkspace(workspaceId: string, db = this.db): Workspace {` (hint 5304)
  - the module function `coordinationSessionFromRow()` (hint 5831-5853) and two new module helpers in front of it
  - `hydrateLegacyMutationResponse()`, after `assignee_session_id: hydrated.assignee_session_id ?? null,` (hint 5988)
- Modify: `packages/collab/src/mcp.ts`
  - the `collab_workspace_status` description
  - the `collab_next` description, as Task 6 left it
- Create: `packages/collab/tests/liveness.test.ts`. A new file, so it does not collide with the `v2.test.ts` or `mcp.test.ts` edits of other tasks. Its clock fixture copies the seam used at the top of `v2.test.ts`.

**Clock seam:** the existing `CollabStoreOptions.now?: Clock` (`type Clock = () => Date`; `this.now = options.now ?? (() => new Date())`; `private timestamp(): string`). No new seam is needed.

**Interfaces:**
- Consumes: `CollabStoreOptions.now`, `coordination_sessions.last_seen_at`/`status`, `Task.effective_status === "recovery_required"`, the `nextForSession` input `after_sequence` from Task 6, and Task 5's `endSessionWithReleases()` with its one `coordinationSessionFromRow(this.requireCoordinationSessionRow(row.id))` call.
- Produces:
  - `export type SessionLiveness = "live" | "stale"` and `export const SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000` (src/protocol.ts; public through `src/index.ts`'s `export *`)
  - `CoordinationSession.liveness: SessionLiveness`
  - `Task.assignee_liveness: SessionLiveness | null`
  - `NextCollabState.recovery_required: Task[]`, also on the inline return types of `nextForSession()` (the caller's own expired leases first, then the others) and `nextForActor()` (no own entries; all by `lease_expires_at`, then `id`)
  - private `CollabStore.sessionProjection(row: CoordinationSessionRow, observedAt = this.timestamp()): CoordinationSession`, the only projection path for coordination sessions. Every call site uses it, including Task 5's `endSessionWithReleases()`. Task 8's new `getCoordinationSession()` must call `this.sessionProjection(row)`.
  - private `CollabStore.assigneeLiveness(sessionId: string | null): SessionLiveness | null`
  - module function `coordinationSessionFromRow(row, observedAt: string)` (now two arguments, called only from `sessionProjection`), plus module helpers `sessionLiveness(row, observedAt)` and `recoveryRequiredFirst(tasks, isOwn)`
  - `mutateAsSession()` refreshes the acting session's `last_seen_at` before `apply` runs instead of after the receipt insert (same transaction)
- Liveness rules:
  - An active session is live while `now - last_seen_at <= SESSION_STALE_AFTER_MS`. Exactly 6 h reads live, 6 h + 1 ms reads stale, and an unparseable timestamp reads stale.
  - An ended session always reads stale. An ended holder of an expired lease must not look alive.
  - `assignee_liveness` is null when the task has no `assignee_session_id`, or when that session row is missing.
  - There is no status change, no event and no new column. Stored session-mutation receipts are replayed as stored. Legacy actor-mode replays get `assignee_liveness ?? null`.

- [ ] **Step 1: Write the failing test**

Create `packages/collab/tests/liveness.test.ts`. It imports the protocol module as a namespace, so that before the implementation each test fails on its own assertion rather than on one module-link `SyntaxError`.

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import * as protocol from "../src/protocol.js";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

// Local copy of the 6-hour threshold so the clock arithmetic below does not
// depend on the export under test; the first test pins the export to it.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

let directory: string;
let root: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-liveness-"));
  root = join(directory, "repo");
  mkdirSync(root);
  currentTime = new Date("2026-10-08T09:00:00.000Z");
  store = new CollabStore(join(directory, "state", "collab.sqlite"), {
    now: () => new Date(currentTime),
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

function advance(milliseconds: number): void {
  currentTime = new Date(currentTime.getTime() + milliseconds);
}

function createEditTask(owner: SessionHandle, key: string, pathScope: string) {
  return store.createTaskForSession({
    ...owner.credential,
    idempotency_key: key,
    title: key,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [pathScope],
  });
}

function claimBriefly(holder: SessionHandle, task: { id: string; version: number }, key: string) {
  return store.claimTaskForSession({
    ...holder.credential,
    idempotency_key: key,
    task_id: task.id,
    expected_version: task.version,
    ttl_seconds: 30,
  });
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("staleness as a derived view", () => {
  test("derives session liveness from last_seen_at without changing status or the journal", () => {
    expect(protocol.SESSION_STALE_AFTER_MS).toBe(STALE_AFTER_MS);
    const poller = session("liveness-poller");
    const ghost = session("liveness-ghost");
    expect(poller.session.liveness).toBe("live");
    expect(ghost.session.liveness).toBe("live");
    const headBefore = store.eventsSince(poller.workspace.id, 0, 500).head_sequence;

    advance(STALE_AFTER_MS);
    expect(store.listCoordinationSessions(poller.workspace.id).map((item) => item.liveness))
      .toEqual(["live", "live"]);

    advance(1);
    const aged = store.listCoordinationSessions(poller.workspace.id);
    expect(aged.map((item) => [item.status, item.liveness])).toEqual([
      ["active", "stale"],
      ["active", "stale"],
    ]);

    const polled = store.nextForSession(poller.credential);
    expect(polled.session.liveness).toBe("live");
    const status = new Map(
      store.workspaceStatus(poller.workspace.id).active_sessions
        .map((item) => [item.id, [item.status, item.liveness]]),
    );
    expect(status.get(poller.session.id)).toEqual(["active", "live"]);
    expect(status.get(ghost.session.id)).toEqual(["active", "stale"]);
    expect(store.eventsSince(poller.workspace.id, 0, 500).head_sequence).toBe(headBefore);

    const ended = store.endSession({ ...poller.credential, reason: "liveness test done" });
    expect(ended.status).toBe("ended");
    expect(ended.liveness).toBe("stale");
  });

  test("projects assignee liveness and lists recovery-required leases with the caller's own first", () => {
    const holder = session("own-holder");
    const other = session("other-holder");
    const observer = session("observer");
    const otherTask = createEditTask(other, "other-expiring", "src/other.ts");
    const otherClaim = claimBriefly(other, otherTask, "claim-other-expiring");
    advance(1_000);
    const ownTask = createEditTask(holder, "own-expiring", "src/own.ts");
    const ownClaim = claimBriefly(holder, ownTask, "claim-own-expiring");
    const openTask = createEditTask(observer, "still-open", "src/open.ts");

    expect(ownClaim.assignee_liveness).toBe("live");
    expect(openTask.assignee_liveness).toBeNull();
    expect(store.nextForSession(holder.credential).recovery_required).toEqual([]);

    advance(31_000);
    const ownNext = store.nextForSession(holder.credential);
    expect(ownNext.recovery_required.map((task) => task.id)).toEqual([ownTask.id, otherTask.id]);
    expect(ownNext.recovery_required.map((task) => task.effective_status)).toEqual([
      "recovery_required",
      "recovery_required",
    ]);
    expect(ownNext.own_claims).toEqual([]);
    expect(store.nextForSession(other.credential).recovery_required.map((task) => task.id))
      .toEqual([otherTask.id, ownTask.id]);
    expect(store.nextForSession(observer.credential).recovery_required.map((task) => task.id))
      .toEqual([otherTask.id, ownTask.id]);
    expect(
      store.nextForActor(observer.workspace.id, "legacy-observer").recovery_required
        .map((task) => task.id),
    ).toEqual([otherTask.id, ownTask.id]);
    expect(store.getTask(ownTask.workspace_id, ownTask.id).assignee_liveness).toBe("live");

    advance(STALE_AFTER_MS + 1);
    expect(store.getTask(ownTask.workspace_id, ownTask.id).assignee_liveness).toBe("stale");
    expect(store.getTask(otherTask.workspace_id, otherTask.id).assignee_liveness).toBe("stale");
    const refreshed = store.nextForSession(holder.credential).recovery_required;
    expect(refreshed.map((task) => [task.id, task.assignee_liveness])).toEqual([
      [ownTask.id, "live"],
      [otherTask.id, "stale"],
    ]);
    expect(otherClaim.lease_expires_at! < ownClaim.lease_expires_at!).toBe(true);

    // An expired lease does not block session_end, so a holder can leave it
    // behind; an ended holder reads stale even though it was just seen.
    store.endSession({ ...holder.credential, reason: "leaves an expired lease behind" });
    expect(store.getTask(ownTask.workspace_id, ownTask.id)).toMatchObject({
      effective_status: "recovery_required",
      assignee_session_id: holder.session.id,
      assignee_liveness: "stale",
    });
  });

  test("reports the acting session as live in its own receipt after a long idle", () => {
    const worker = session("idle-worker");
    const task = createEditTask(worker, "idle-then-claim", "src/idle.ts");
    advance(STALE_AFTER_MS + 1);
    const claimed = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-after-idle",
      task_id: task.id,
      expected_version: task.version,
    });
    expect(claimed.assignee_session_id).toBe(worker.session.id);
    expect(claimed.assignee_liveness).toBe("live");
  });

  test("fills assignee_liveness with null when replaying a legacy receipt stored without it", () => {
    const workspace = store.openWorkspace({ root_path: root, actor: "legacy-writer" });
    const request = {
      workspace_id: workspace.id,
      actor: "legacy-writer",
      idempotency_key: "legacy-before-liveness",
      title: "Legacy task stored before liveness existed",
    };
    const created = store.createTask(request);
    expect(created.assignee_liveness).toBeNull();
    store.db.query(`
      UPDATE mutations
      SET response_json = json_remove(response_json, '$.assignee_liveness')
      WHERE workspace_id = ? AND idempotency_key = ?
    `).run(workspace.id, request.idempotency_key);
    const replayed = store.createTask(request);
    expect(replayed.id).toBe(created.id);
    expect(replayed.assignee_liveness).toBeNull();
  });

  test("exposes liveness and recovery_required through the MCP surface", async () => {
    const server = buildCollabMcpServer(store);
    const tools = (server as any)._registeredTools;
    const nextDescription = tools.collab_next.description as string;
    expect(nextDescription).toContain("recovery_required");
    expect(nextDescription).toContain("never a status change");
    expect(tools.collab_workspace_status.description).toContain("liveness");
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-bound",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    expect(joined.structuredContent.session.liveness).toBe("live");
    const ghost = session("mcp-ghost");
    const ghostTask = createEditTask(ghost, "ghost-task", "src/ghost.ts");
    claimBriefly(ghost, ghostTask, "claim-ghost-task");

    advance(STALE_AFTER_MS + 1);
    const next = await callTool(server, "collab_next", { workspace_id: workspaceId });
    expect(next.isError).toBeUndefined();
    expect(next.structuredContent.session.liveness).toBe("live");
    expect(next.structuredContent.recovery_required.map((task: any) => [
      task.id,
      task.assignee_session_id,
      task.assignee_liveness,
    ])).toEqual([[ghostTask.id, ghost.session.id, "stale"]]);
    const status = await callTool(server, "collab_workspace_status", {
      workspace_id: workspaceId,
    });
    expect(
      status.structuredContent.active_sessions.find((item: any) => item.id === ghost.session.id)
        .liveness,
    ).toBe("stale");
    await server.close();
  });
});
```

`collab_session_start` writes its credential file to `<tmp>/state/collab-sessions/`, beside the test database (see `defaultSessionCredentialPath`). The temp directory removal deletes it.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/liveness.test.ts
```

Expected: `0 pass`, `5 fail`, each on its own assertion:
- "derives session liveness…": `Expected: 21600000` / `Received: undefined`
- "projects assignee liveness…": `Expected: "live"` / `Received: undefined`
- "reports the acting session as live…": `Expected: "live"` / `Received: undefined`
- "fills assignee_liveness with null…": `expect(received).toBeNull()` / `Received: undefined`
- "exposes liveness and recovery_required…": `Expected to contain: "recovery_required"`, followed by the description Task 6 set

- [ ] **Step 3: Write minimal implementation**

(a) `src/protocol.ts`

After `export type SessionStatus = "active" | "ended";` add:

```ts

/**
 * Derived view, never stored: an active session whose last_seen_at is older
 * than SESSION_STALE_AFTER_MS reads as stale; an ended session never reads as
 * live. Staleness changes no status, expires nothing, and grants nothing.
 */
export type SessionLiveness = "live" | "stale";
export const SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
```

In `export interface CoordinationSession`, after `cursor_recovery_required: boolean;` add:

```ts
  liveness: SessionLiveness;
```

In `export interface Task` (not `TaskConflict`), after `assignee_session_id: string | null;` add:

```ts
  /** Liveness of assignee_session_id; null when no coordination session holds the task. */
  assignee_liveness: SessionLiveness | null;
```

In `export interface NextCollabState`, after `handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;` add:

```ts
  /** Expired session leases awaiting collab_task_recover; the caller's own first. */
  recovery_required: Task[];
```

(b) `src/store.ts` imports

In the `from "./protocol.js"` import list, add `SESSION_STALE_AFTER_MS,` on the line after `MAX_WAIT_PAGE_BYTES,`, and `type SessionLiveness,` on the line after `type SessionHandle,`. Task 5's `type SessionEndRelease,` and `type SessionEndResult,` stay above `type SessionHandle,`.

(c) `src/store.ts` module helpers

Replace the line `function coordinationSessionFromRow(row: CoordinationSessionRow): CoordinationSession {` with the code below: two helpers first, then a signature that takes `observedAt`. This mirrors the existing `presenceSessionFromRow(row, observedAt)`.

```ts
function sessionLiveness(
  row: Pick<CoordinationSessionRow, "status" | "last_seen_at">,
  observedAt: string,
): SessionLiveness {
  if (row.status !== "active") return "stale";
  const age = Date.parse(observedAt) - Date.parse(row.last_seen_at);
  // NaN (an unparseable timestamp) fails this comparison and reads as stale.
  return age <= SESSION_STALE_AFTER_MS ? "live" : "stale";
}

function recoveryRequiredFirst(tasks: Task[], isOwn: (task: Task) => boolean): Task[] {
  const byExpiry = (left: Task, right: Task) =>
    (left.lease_expires_at ?? "").localeCompare(right.lease_expires_at ?? "")
    || left.id.localeCompare(right.id);
  const pending = tasks.filter((task) => task.effective_status === "recovery_required");
  return [
    ...pending.filter(isOwn).sort(byExpiry),
    ...pending.filter((task) => !isOwn(task)).sort(byExpiry),
  ];
}

function coordinationSessionFromRow(
  row: CoordinationSessionRow,
  observedAt: string,
): CoordinationSession {
```

In the same function's returned object, after `cursor_recovery_required: row.cursor_recovery_required !== 0,` add:

```ts
    liveness: sessionLiveness(row, observedAt),
```

(d) `src/store.ts` private methods

Immediately before `  private requireWorkspace(workspaceId: string, db = this.db): Workspace {`, add:

```ts
  private sessionProjection(
    row: CoordinationSessionRow,
    observedAt = this.timestamp(),
  ): CoordinationSession {
    return coordinationSessionFromRow(row, observedAt);
  }

  private assigneeLiveness(sessionId: string | null): SessionLiveness | null {
    if (!sessionId) return null;
    const holder = this.db.query(`
      SELECT status, last_seen_at FROM coordination_sessions WHERE id = ?
    `).get(sessionId) as Pick<CoordinationSessionRow, "status" | "last_seen_at"> | null;
    return holder ? sessionLiveness(holder, this.timestamp()) : null;
  }

```

(e) `src/store.ts` call sites: every `coordinationSessionFromRow(` call outside `sessionProjection` becomes `this.sessionProjection(`

At this point in the plan (after Tasks 1-6), there are exactly eight call sites:

| Method | Before | After |
|---|---|---|
| `endSessionWithReleases()` (Task 5) | `session: coordinationSessionFromRow(this.requireCoordinationSessionRow(row.id)),` | `session: this.sessionProjection(this.requireCoordinationSessionRow(row.id)),` |
| `listCoordinationSessions()` | `return rows.map(coordinationSessionFromRow);` | `const observedAt = this.timestamp();`<br>`return rows.map((row) => this.sessionProjection(row, observedAt));` |
| `acknowledgeSessionCursor()`, the same-sequence no-op branch | `return coordinationSessionFromRow(row);` | `return this.sessionProjection(row);` |
| `acknowledgeSessionCursor()`, success | `return coordinationSessionFromRow(this.requireCoordinationSessionRow(row.id));` | `return this.sessionProjection(this.requireCoordinationSessionRow(row.id));` |
| `resetSessionCursor()`, inside the `mutateAsSession` apply | `return coordinationSessionFromRow(this.requireCoordinationSessionRow(row.id));` | `return this.sessionProjection(this.requireCoordinationSessionRow(row.id));` |
| `resetSessionCursor()`, final return | `return coordinationSessionFromRow(current);` | `return this.sessionProjection(current);` |
| `nextForSession()`, the second (read) transaction | `session: coordinationSessionFromRow(current),` | `session: this.sessionProjection(current),` |
| `sessionHandle()` | `session: coordinationSessionFromRow(row),` | `session: this.sessionProjection(row),` |

`listCoordinationSessions` passes one `observedAt` for the whole list, so every row is judged at the same instant. Passing the function straight to `.map` would also have fed it the array index as its second argument.

Then check:

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && grep -n "coordinationSessionFromRow" src/store.ts && grep -c "this.sessionProjection(" src/store.ts
```

Expected: `coordinationSessionFromRow` appears on exactly two lines, `return coordinationSessionFromRow(row, observedAt);` inside `sessionProjection` and the `function coordinationSessionFromRow(` definition. The count of `this.sessionProjection(` calls is `8`. Task 8 later adds a ninth, in `getCoordinationSession()`. `tsc` reports any call you missed as "Expected 2 arguments, but got 1".

(f) `src/store.ts`, `nextForActor()`

In its inline return type, after `handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;`, add `recovery_required: Task[];`.

In the returned object, find the `handoff_offers: offers.map((row) => ({ ... })),` entry. After its closing `})),`, add:

```ts
        recovery_required: recoveryRequiredFirst(tasks, () => false),
```

(g) `src/store.ts`, `nextForSession()`

In its inline return type, after `handoff_offers: Array<{ handoff: HandoffOffer; task: Task }>;`, add `recovery_required: Task[];`.

In the returned object of the second (read) transaction, find the `handoff_offers: handoffs.map((handoff) => ({ ... })),` entry. After its closing `})),`, add:

```ts
        recovery_required: recoveryRequiredFirst(
          tasks,
          (task) => task.assignee_session_id === current.id,
        ),
```

(h) `src/store.ts`, `mutateAsSession()`

Refresh `last_seen_at` before `apply` runs. A receipt built inside `apply` (for example a claim's `assignee_liveness`) then never reports the acting session as stale after a long idle. Without this change, the third test fails with `Expected: "live"` / `Received: "stale"` (verified by reverting it). A throw still rolls the refresh back.

Replace

```ts
        return JSON.parse(existing.response_json) as T;
      }

      const guardNonce = `guard_${randomUUID()}`;
```

with

```ts
        return JSON.parse(existing.response_json) as T;
      }

      // Refresh first so projections built inside apply (assignee_liveness)
      // see the acting session as seen now; a throw rolls this back too.
      this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`)
        .run(this.timestamp(), session.id);
      const guardNonce = `guard_${randomUUID()}`;
```

Then, in the same method's `try` block, delete the old post-insert refresh. Replace

```ts
          JSON.stringify(response),
          this.timestamp(),
        );
        this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`)
          .run(this.timestamp(), session.id);
        return response;
```

with

```ts
          JSON.stringify(response),
          this.timestamp(),
        );
        return response;
```

Leave the refresh in the replay branch (`if (existing) { ... }`) untouched.

(i) `src/store.ts`, `taskFromRow()`

Edit inside `private taskFromRow(row: TaskRow): Task {` only. The text `assignee_session_id: row.assignee_session_id,` also appears in three other objects in `store.ts` (the `task_claimed` and `lease_not_holder` error details, and the path-conflict entries built in `taskPathConflicts`), so match the two lines below, which occur once in the file. Replace

```ts
      assignee_session_id: row.assignee_session_id,
      claim_worktree_id: row.claim_worktree_id,
```

with

```ts
      assignee_session_id: row.assignee_session_id,
      assignee_liveness: this.assigneeLiveness(row.assignee_session_id),
      claim_worktree_id: row.claim_worktree_id,
```

(j) `src/store.ts`, `hydrateLegacyMutationResponse()`

After `assignee_session_id: hydrated.assignee_session_id ?? null,` add:

```ts
    assignee_liveness: hydrated.assignee_liveness ?? null,
```

(k) `src/mcp.ts`

In the `collab_next` registration, replace the `description:` entry that Task 6 set with:

```ts
      description:
        "Poll without acknowledging, with 1–50 events per page and a default of 10. Routed reports are bounded to the exact event page; task, conflict, and handoff projections describe the same snapshot head. A bound session always pages from its acknowledged cursor: advance with collab_cursor_ack, or read elsewhere with collab_events_since. " +
        "recovery_required lists expired session leases awaiting collab_task_recover, the caller's own first. " +
        "Session liveness and task assignee_liveness are a derived view (stale after 6 hours unseen), never a status change.",
```

In the `collab_workspace_status` registration, replace the description string `"Return task counts, active sessions and claims, blockers, pending reviews, reports, and decisions."` with:

```ts
        "Return task counts, active sessions (with derived liveness) and claims, blockers, pending reviews, reports, and decisions.",
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab && bun test tests/liveness.test.ts && bun test && bun run typecheck
```

Expected:
- `liveness.test.ts`: `5 pass`, `0 fail`
- full suite: `0 fail`; it has 5 more tests and 1 more file than after Task 6
- `tsc --noEmit` exits 0

Then check the two sibling packages whose tests import `../../collab/src/store.js` and project tasks and sessions:

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab-zerone && bun install --frozen-lockfile && bun --no-env-file test && bun --no-env-file run typecheck && cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab-courier && bun install --frozen-lockfile && bun --no-env-file test tests && bun --no-env-file run typecheck
```

Expected: `0 fail` in both packages, and both typechecks exit 0. Neither package gains tests in this task.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing && git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/liveness.test.ts && git commit -F - <<'EOF'
feat(collab): derive session liveness, assignee_liveness and recovery_required

Coordination-session projections gain liveness (stale once last_seen_at
is older than SESSION_STALE_AFTER_MS = 6h; an ended session never reads
live), task projections gain assignee_liveness, and collab_next gains a
recovery_required list with the caller's own expired leases first. This
is a view only: no status change, no auto-expiry, no event, no column.
Every coordination-session projection now goes through one private
sessionProjection(row) that reads the store clock. mutateAsSession now
refreshes last_seen_at before apply, so the acting session's own receipt
never reports it stale after a long idle.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```

The tracked bundles in `packages/collab/dist/` are not rebuilt in Task 6 or 7. `check:mcp-bundle` byte-compares them only on Bun 1.3.5 (`bundlerBunVersion`), and this Mac runs 1.3.13, so the check prints "skipped" here. Task 8 rebuilds both bundles on Bun 1.3.5 after this task. Task 10 ends with a pre-PR freshness check (`npx --yes bun@1.3.5 run build:mcp && npx --yes bun@1.3.5 run check:mcp-bundle && git diff --exit-code packages/collab/dist`), which catches any later change to `src/` that would otherwise surface only in CI.


### Task 9: Teach the ordinary loop in the skill, Hermes variant, Codex prompt and README

**Files:**
- Modify: `packages/collab/skills/coordinate-agent-work/SKILL.md` (whole file; 250 lines on origin/main)
- Modify: `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md` (whole file; 155 lines on origin/main)
- Modify: `packages/collab/skills/coordinate-agent-work/agents/openai.yaml` (whole file; 4 lines)
- Modify: `packages/collab/README.md`, three ranges found by anchor text (origin/main line hints in brackets): from `The normal session flow is:` up to the line `Acknowledgement means “this session processed through this journal position.”` [111–128]; from `## Task workflow` up to `### Conflict and lease boundary` [233–262]; from `## Reports, disagreement, and handoff` up to `## Journal integrity and compatibility` [300–330]
- Test: `packages/collab/tests/package.test.ts` (constants after the `const packageRoot = …` line; two tests just before the test named "ships an explicit Hermes adapter for separate presence and secure planes"; Task 8 has already added two `expect` lines to "ships the plugins, skills, executable bundle, and notices", so line numbers have moved)
- Create: `packages/collab/tests/report-relations.test.ts` (characterization tests for the rules the docs state; resolution R7: a proposal answered by `supports`/`challenges`, and `parent_session_mismatch`)

**Interfaces:**
- Consumes (documents, does not implement):
  - Task 1: `EVIDENCE_REF_PREFIXES` (`artifact:`, `event:`, `report:`, `checkpoint:`), the `allowed_prefixes` error field, task fields `base_checkpoint_digest` and `result_checkpoint_digest`.
  - Task 2: `collab_task_review` inputs `confidence`, `confidence_basis`, `limits`.
  - Task 3: `task_not_pending_review` fields `review_report_id`, `accepted_by_session_id`, `remedy`. Only a session that is neither the reporter nor the accepting reviewer gets the remedy; those two get the plain `{review_status}` (R12).
  - Task 4: `collab_task_complete` input `review_requested_session_id`, task field `review_requested_session_id`, an addressed `informs` report, and refusals `review_request_self`, `review_requested_session_unavailable`, `review_request_not_applicable`.
  - Task 5: `collab_session_end` inputs `release_leases` and `release_summary`, output `released_leases`, refusal `invalid_release_summary` (a `release_summary` supplied without `release_leases: true`, judged on the raw input, R13), and `session_has_active_leases` fields `task_ids`, `leases`, `remedy`. The release note for an expired lease is `release_summary`, else `reason`.
  - Task 6: error `after_sequence_unsupported_in_bound_session`.
  - Task 7: session `liveness` (`stale` once ended or after 6 h, `SESSION_STALE_AFTER_MS`; only an advancing acknowledgement refreshes `last_seen_at`), task `assignee_liveness`, `collab_next` field `recovery_required`.
  - Task 8: host CLI `agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]`. Exit 0 receipts have status `ended` (with `"warning": "session_file_remove_failed"` when the session ended but the file stayed) or `already_ended`. Exit 1 receipts have `"status": "error"` plus `error` and `message`. Without `--release-leases`, live leases are refused before anything is resumed (R14). With it, `--reason` is also the release note. The CLI never creates a journal (`journal_not_found`).
  - Plan B: the delegation label `<Runtime> · sol job <job-id>`. The sol job preface states the job ID (R2). The exit sweep ends a job's leftover sessions, and `sol agent start --integrate-commit` is offered.
- Produces: test constants `ORDINARY_LOOP`, `RELATION_TABLE_HEADER` (`| Relation | \`target_report_id\` | Who may append | Use it to |`), `RELATIONS`, `HOUSEHOLD_TERMS`, helper `expectInOrder(text, heading, names)`; tests "teaches the ordinary loop, relation targeting, delegation, and clean exit" and "points the Codex skill prompt at the ordinary loop"; `tests/report-relations.test.ts` with describe "report relations as documented" (4 tests); the `## The ordinary loop` heading in all three documents.

The relation rules documented here come from `store.ts` `validateReportInput()` [origin/main 4811–4882]:
- `informs` must not target a report (`invalid_report_relation`).
- Every other relation requires `target_report_id` (`report_target_required`).
- The target must be in the same workspace and the same `task_id` scope (`report_task_mismatch`).
- Only the target's author session may use `corrects`, `withdraws` or `supersedes` (`report_author_mismatch`).
- `resolves` must target a `challenges` report (`invalid_report_relation`).

`startSession()` [1660–1672] checks `parent_session_id` only for existence (`session_not_found`) and for the same workspace (`parent_session_mismatch`). It does not check that the parent is still active. `nextForSession()` [3932–3944] filters routed reports with `to_session_id IS NULL OR to_session_id = <caller>`. An addressed report therefore reaches only that session's `collab_next`, and `collab_report_list` can still read it.

- [ ] **Step 1: Write the failing test**

In `packages/collab/tests/package.test.ts`, keep every existing test and term, including the two `agenttool-collab-host` lines Task 8 added. Imports stay `import { describe, expect, test } from "bun:test"; import { statSync } from "node:fs"; import { join } from "node:path";`. Directly after the line `const packageRoot = join(import.meta.dir, "..");` insert:

```ts

const ORDINARY_LOOP = [
  "collab_session_start",
  "collab_next",
  "collab_cursor_ack",
  "collab_task_claim",
  "collab_artifact_attach",
  "collab_task_complete",
  "collab_task_review",
  "collab_session_end",
];

const RELATION_TABLE_HEADER = "| Relation | `target_report_id` | Who may append | Use it to |";

const RELATIONS = [
  "informs",
  "supports",
  "challenges",
  "resolves",
  "corrects",
  "withdraws",
  "supersedes",
];

const HOUSEHOLD_TERMS = [
  RELATION_TABLE_HEADER,
  "release_leases",
  "release_summary",
  "session_has_active_leases",
  "review_requested_session_id",
  "review_report_id",
  "accepted_by_session_id",
  "confidence_basis",
  "allowed_prefixes",
  "artifact:artifact_",
  "event:",
  "report:",
  "checkpoint:",
  "result_checkpoint_digest",
  "parent_session_id",
  "declared lineage",
  "never pass your session file",
  "liveness",
  "assignee_liveness",
  "recovery_required",
  "after_sequence_unsupported_in_bound_session",
  "collab_events_since",
  "delivers by artifact",
  "agenttool-collab-host",
];

function expectInOrder(text: string, heading: string, names: string[]): void {
  const start = text.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n## ", start + heading.length);
  const section = text.slice(start, end === -1 ? undefined : end);
  let cursor = -1;
  for (const name of names) {
    const at = section.indexOf(name, cursor + 1);
    expect(at).toBeGreaterThan(cursor);
    cursor = at;
  }
}
```

Directly before the line `  test("ships an explicit Hermes adapter for separate presence and secure planes", async () => {` insert:

```ts
  test("teaches the ordinary loop, relation targeting, delegation, and clean exit", async () => {
    for (const path of [
      "skills/coordinate-agent-work/SKILL.md",
      "integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
      "README.md",
    ]) {
      const text = await Bun.file(join(packageRoot, path)).text();
      for (const term of HOUSEHOLD_TERMS) expect(text).toContain(term);
      for (const relation of RELATIONS) expect(text).toContain(`| \`${relation}\` |`);
      expectInOrder(text, "## The ordinary loop", ORDINARY_LOOP);
    }

    const skill = await Bun.file(join(packageRoot, "skills/coordinate-agent-work/SKILL.md")).text();
    expect(skill).toContain("· sol job <job-id>");
    expect(skill).toContain("agenttool-collab-host end --session-file <path> --reason <text> --release-leases");
    const description = /^description: (.+)$/m.exec(skill)?.[1] ?? "";
    expect(description).toContain("requested reviewer");
    expect(description).toContain("ending a session cleanly");
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  test("points the Codex skill prompt at the ordinary loop", async () => {
    const yaml = await Bun.file(join(packageRoot, "skills/coordinate-agent-work/agents/openai.yaml")).text();
    expect(yaml).toContain("$coordinate-agent-work");
    expect(yaml).toContain("ordinary loop");
    expect(yaml).toContain("requested reviewer");
    expect(yaml).toContain("release_leases");
  });

```

(The ordered check uses unprefixed names on purpose: every Hermes name such as `mcp_agenttool_collab_session_start` contains `collab_session_start`.)

Create `packages/collab/tests/report-relations.test.ts`. It is a new file with its own fixture, because `v2.test.ts` exports no helpers and Tasks 1–8 edit that file. It holds the R7 characterization tests and pins every rule the new relation table, routing paragraph and lineage paragraph state:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

// Characterization tests: each pins a rule the ordinary-loop docs state, on
// behaviour origin/main already has. They pass before the doc rewrite.

let directory: string;
let root: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-relations-"));
  root = join(directory, "repo");
  mkdirSync(root);
  store = new CollabStore(join(directory, "state", "collab.sqlite"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string, rootPath = root, parentSessionId?: string): SessionHandle {
  return store.startSession({
    root_path: rootPath,
    actor,
    ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
  });
}

function errorCode(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (error instanceof CollabError) return error.code;
    throw error;
  }
  throw new Error("expected operation to fail");
}

describe("report relations as documented", () => {
  test("answers a proposal with supports and challenges from other sessions", () => {
    const proposer = session("proposer");
    const supporter = session("supporter");
    const challenger = session("challenger");
    const proposal = store.appendReportForSession({
      ...proposer.credential,
      idempotency_key: "proposal",
      kind: "proposal",
      body: "Split the parser work into two tasks.",
    });
    expect(proposal).toMatchObject({ relation: "informs", target_report_id: null, task_id: null });

    const support = store.appendReportForSession({
      ...supporter.credential,
      idempotency_key: "support-proposal",
      kind: "inference",
      body: "Agreed: the halves touch disjoint paths.",
      evidence_refs: [`report:${proposal.id}`],
      relation: "supports",
      target_report_id: proposal.id,
    });
    const challenge = store.appendReportForSession({
      ...challenger.credential,
      idempotency_key: "challenge-proposal",
      kind: "inference",
      body: "Both halves share one fixture.",
      relation: "challenges",
      target_report_id: proposal.id,
    });
    expect(support).toMatchObject({
      relation: "supports",
      target_report_id: proposal.id,
      from_session_id: supporter.session.id,
    });
    expect(challenge).toMatchObject({
      relation: "challenges",
      target_report_id: proposal.id,
      from_session_id: challenger.session.id,
    });

    const task = store.createTaskForSession({
      ...proposer.credential,
      idempotency_key: "scoped-task",
      title: "Scoped",
      work_mode: "coordination",
    });
    const scoped = store.appendReportForSession({
      ...proposer.credential,
      idempotency_key: "scoped-proposal",
      task_id: task.id,
      kind: "proposal",
      body: "Run this task after the parser split.",
    });
    expect(store.appendReportForSession({
      ...supporter.credential,
      idempotency_key: "support-scoped",
      task_id: task.id,
      kind: "inference",
      body: "Agreed within the task scope.",
      relation: "supports",
      target_report_id: scoped.id,
    }).task_id).toBe(task.id);
    expect(errorCode(() => store.appendReportForSession({
      ...supporter.credential,
      idempotency_key: "support-scoped-without-task",
      kind: "inference",
      body: "Same answer, wrong scope.",
      relation: "supports",
      target_report_id: scoped.id,
    }))).toBe("report_task_mismatch");
  });

  test("enforces the relation-targeting table", () => {
    const author = session("author");
    const other = session("other");
    const third = session("third");
    const original = store.appendReportForSession({
      ...author.credential,
      idempotency_key: "original",
      kind: "observation",
      body: "The build passed locally.",
    });
    const append = (
      who: SessionHandle,
      key: string,
      relation: "informs" | "supports" | "challenges" | "resolves" | "corrects" | "withdraws" | "supersedes",
      target?: string,
    ) => store.appendReportForSession({
      ...who.credential,
      idempotency_key: key,
      kind: "observation",
      body: `${relation} ${key}`,
      relation,
      ...(target ? { target_report_id: target } : {}),
    });

    expect(errorCode(() => append(other, "informs-with-target", "informs", original.id)))
      .toBe("invalid_report_relation");
    for (const relation of ["supports", "challenges", "resolves", "corrects", "withdraws", "supersedes"] as const) {
      expect(errorCode(() => append(author, `${relation}-without-target`, relation)))
        .toBe("report_target_required");
    }
    for (const relation of ["corrects", "withdraws", "supersedes"] as const) {
      expect(errorCode(() => append(other, `${relation}-by-other`, relation, original.id)))
        .toBe("report_author_mismatch");
    }
    expect(append(author, "corrects-by-author", "corrects", original.id).relation).toBe("corrects");
    expect(append(author, "supersedes-by-author", "supersedes", original.id).relation).toBe("supersedes");

    expect(errorCode(() => append(other, "resolves-non-challenge", "resolves", original.id)))
      .toBe("invalid_report_relation");
    const challenge = append(other, "challenge-original", "challenges", original.id);
    expect(append(third, "resolves-by-third", "resolves", challenge.id)).toMatchObject({
      relation: "resolves",
      target_report_id: challenge.id,
      from_session_id: third.session.id,
    });
    expect(append(author, "withdraws-by-author", "withdraws", original.id).relation).toBe("withdraws");
  });

  test("routes an addressed report to one session's collab_next but keeps it listable", () => {
    const sender = session("sender");
    const recipient = session("recipient");
    const bystander = session("bystander");
    const addressed = store.appendReportForSession({
      ...sender.credential,
      idempotency_key: "addressed",
      to_session_id: recipient.session.id,
      kind: "proposal",
      body: "Please review the parser task.",
    });

    const routed = (who: SessionHandle) =>
      store.nextForSession({ ...who.credential, event_limit: 50 }).reports.map((report) => report.id);
    expect(routed(recipient)).toContain(addressed.id);
    expect(routed(bystander)).not.toContain(addressed.id);
    expect(store.listReports(sender.workspace.id).map((report) => report.id)).toContain(addressed.id);
  });

  test("treats parent_session_id as declared lineage checked only for workspace", () => {
    const parent = session("parent");
    const child = session("Codex · sol job 20261008T000000-000000000000", root, parent.session.id);
    expect(child.session.parent_session_id).toBe(parent.session.id);
    expect(child.workspace.id).toBe(parent.workspace.id);

    const otherRoot = join(directory, "other-repo");
    mkdirSync(otherRoot);
    expect(errorCode(() => session("stranger", otherRoot, parent.session.id)))
      .toBe("parent_session_mismatch");
    expect(errorCode(() => session("orphan", root, "session_00000000-0000-0000-0000-000000000000")))
      .toBe("session_not_found");

    // Lineage grants nothing and blocks nothing: the child is a distinct
    // session, so it may accept its parent's reviewed edit task.
    const task = store.createTaskForSession({
      ...parent.credential,
      idempotency_key: "parent-task",
      title: "Parent task",
      work_mode: "edit",
      completion_policy: "accepted",
      path_scopes: ["src/parent.ts"],
    });
    const claim = store.claimTaskForSession({
      ...parent.credential,
      idempotency_key: "parent-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...parent.credential,
      idempotency_key: "parent-complete",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Parent finished.",
    });
    const accepted = store.reviewTaskForSession({
      ...child.credential,
      idempotency_key: "child-accepts",
      task_id: task.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Child reviewed the parent's evidence.",
    });
    expect(accepted.task.accepted_by_session_id).toBe(child.session.id);

    // An ended parent still counts as existing lineage.
    store.endSession({ ...parent.credential, reason: "parent done" });
    expect(session("late child", root, parent.session.id).session.parent_session_id)
      .toBe(parent.session.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
bun test tests/package.test.ts
bun test tests/report-relations.test.ts
```

Expected for `package.test.ts`: `2 fail`, and every test that existed before this task passes. These were verified against the origin/main documents:
```
error: expect(received).toContain(expected)
Expected to contain: "| Relation | `target_report_id` | Who may append | Use it to |"
(fail) cross-host package > teaches the ordinary loop, relation targeting, delegation, and clean exit
error: expect(received).toContain(expected)
Expected to contain: "ordinary loop"
(fail) cross-host package > points the Codex skill prompt at the ordinary loop
```

Expected for `report-relations.test.ts`: `4 pass`, `0 fail`. These are characterization tests of behaviour origin/main already has, so they pass before any doc changes. They are not meant to fail first. They were checked to bite: in a scratch copy, disabling the workspace check in `startSession`, the author check in `validateReportInput` and the `to_session_id` filter in `nextForSession` made 3 of the 4 fail, each with its own assertion. If one fails here, a task in 1–8 changed a documented rule. Stop and decide whether the code or the docs below are wrong before going on. `package.test.ts` needs no `node_modules`. `report-relations.test.ts` needs the `bun install --frozen-lockfile` that Task 1 ran.

- [ ] **Step 3: Write minimal implementation**

Guard first: the three whole-file replacements assume these files still equal origin/main.

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
git diff --quiet origin/main -- skills/coordinate-agent-work/SKILL.md skills/coordinate-agent-work/agents/openai.yaml integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md && echo "unchanged since origin/main"
```

If that prints nothing, an earlier task edited one of them: merge its additions into the text below by hand instead of overwriting.

**3a.** Replace `skills/coordinate-agent-work/SKILL.md` (all 250 lines) with:

````markdown
---
name: coordinate-agent-work
description: Coordinate independent coding or research agents across host sessions and linked Git worktrees through AgentTool Collab's local journal. Use when starting or resuming credential-bound coordination, splitting parallel work, claiming before overlapping edits, polling or acknowledging events, attaching evidence, completing work with an optional requested reviewer, reviewing or concurring with completion, answering proposals or challenging reports, delegating to a child session, recovering leases, handing work off, ending a session cleanly, publishing optional self-declared presence, or reconciling results in Codex, Claude Code, Hermes, or another Agent Skills host.
---

# Coordinate Agent Work

Use the journal as a compact coordination record. Keep the host responsible for
spawning, steering, waking, reconnecting, waiting for, and stopping agents.

**RELEASE CANDIDATE 0.5.0:** 33 local MCP tools, including `collab_events_wait`.
These release-candidate bytes do not establish npm publication; verify the
protected receipt and registry separately.
Published 0.4.0 has 32 tools and does not gain this wait from these source edits.
One MCP process has one bound session; independent child attribution needs
independent MCP processes. Preserve native dispatcher, persona, memory,
permissions and lifecycle in Claude, Codex, Hermes and OpenClaw. Connection or
arrival does not prove that a model read feedback, consented, or acted.

## The ordinary loop

Most sessions need only this loop. Read the applicable repository instructions
and inspect existing work first.

1. **Start.** Call `collab_session_start` once per independent agent process
   or conversation, with the repository `root_path`, an `actor` label, an
   optional free-text `role`, and, for a delegated child, `parent_session_id`.
   It opens the workspace, creates a credential-bound session and binds this
   MCP process. Never open or read the credential file.
2. **Poll and acknowledge.** Call `collab_next` at the start of each turn,
   after local work, before relying on shared state, and whenever the host
   wakes you. Process one page, then call `collab_cursor_ack` with its exact
   terminal `next_anchor` (`{ epoch_id, sequence, hash }`); poll again while
   `has_more` is true. Handle your own entries in `recovery_required` first.
3. **Split and claim.** Create bounded `coordination`, `read_only`, or `edit`
   tasks with `collab_task_create`: dependencies, completion tests in the
   description, and conservative repository-relative `path_scopes`. Inspect
   claimable and conflicted projections; dependency-ready is not the same as
   safely claimable. Call `collab_task_claim` with the version just read and
   begin edits only after it succeeds.
4. **Work.** Stay within the task, path, data and external-action scope.
   Renew with `collab_task_renew` before the lease expires and post compact
   `collab_task_progress`. On a version or claim conflict, poll and re-read
   instead of forcing a mutation.
5. **Attach.** Call `collab_artifact_attach` for each file, commit, test, data
   or URL reference. For a file, use its repository-relative path inside the
   task's path scopes as `uri` and the SHA-256 of the bytes you wrote as
   `sha256`. Do not paste content or raw output.
6. **Complete.** Call `collab_task_complete` with a summary, `confidence`,
   `confidence_basis`, `limits` and `evidence_refs`. Optionally name
   `review_requested_session_id`. An edit task stays pending until a distinct
   session accepts it.
7. **Review.** For someone else's completed task, inspect its artifacts,
   checkpoint drift and completion tests, then call `collab_task_review` with
   `accept` or `request_changes`, a summary, evidence, and your own
   `confidence`, `confidence_basis` and `limits`. A late reviewer concurs or
   disagrees by report.
8. **End.** Call `collab_session_end` with a `reason`, `release_leases: true`
   and an optional `release_summary` when this session will not resume.

The sections below carry the detail for each step.

### Poll without skipping

Omit `event_limit` for the 10-event MCP default or set an integer from 1
through 50. The limit bounds the event page and its routed reports, not the
task, conflict, or handoff projections for the labelled snapshot head. A
supplied `known_cursor` validates an anchor but does not paginate or
acknowledge. Treat acknowledgement as "processed," never as agreement,
acceptance, consent, or correctness.

A bound session does not take `after_sequence`. A value other than your
acknowledged cursor's sequence is refused with
`after_sequence_unsupported_in_bound_session`: advance with
`collab_cursor_ack`, or read from any position without acknowledging through
`collab_events_since` (`after_sequence` or `after_anchor`). Use
`collab_cursor_reset` only for deliberate replay or recovery.

### Evidence references

Evidence points inside this workspace's journal, as `kind:id`:

- `artifact:artifact_<id>` — the `artifact.id` returned by `collab_artifact_attach`.
- `event:event_<id>` — an event `id` from a page.
- `report:report_<id>` — a report `id`.
- `checkpoint:<digest>` — a task's `base_checkpoint_digest` or
  `result_checkpoint_digest`.

On `invalid_evidence_ref` or `evidence_not_found`, read `allowed_prefixes` in
the error, correct the reference and send the corrected mutation with a fresh
idempotency key. Do not drop the evidence silently. Repository paths, commits
and URLs become evidence by attaching them first.

### Request and give review

`review_requested_session_id` must name an active session in this workspace
other than yours, on a task whose completion waits for acceptance; otherwise
the server refuses with `review_request_self`,
`review_requested_session_unavailable` or `review_request_not_applicable`.
The completion report stays unaddressed, so every session still sees it; a
separate `informs` report addressed to the requested session asks for the
review, and the task projection shows the request. It is a request, not a
reservation: any distinct session may still review. While the requested
reviewer's `liveness` is `live`, leave the review to them; if it reads `stale`
(an ended session always does) or the requester asks, review it yourself.

The reporter cannot review its own completion (`self_review_forbidden`). An
unresolved challenge on the completion report blocks acceptance until a
`resolves` report answers it. Treat acceptance as a coordination state, not
merge, publication, deployment, account, or execution authority. Let legacy
reported-completion tasks retain their stated policy.

If the task was already accepted, `collab_task_review` returns
`task_not_pending_review` with `review_report_id`, `accepted_by_session_id`
and a `remedy`, even when your version is stale. (The reporter and the
accepting reviewer get only `review_status`.) Record your verdict with
`collab_report_append`: the same `task_id`, `relation: "supports"` or
`"challenges"`, `target_report_id` set to `review_report_id`, and your
evidence.

Acceptance is a durable reviewer snapshot at that journal order: later
withdrawals remain visible but do not silently revoke it. Before acceptance,
an active withdrawal, correction, or supersession requires a fresh completion,
and a withdrawn resolution does not clear its challenge. Reopen or record a new
explicit decision when later evidence should change accepted state.

### End cleanly

Complete, hand off, or release what you hold, then call `collab_session_end`
with `release_leases: true`. In one transaction it releases each live lease
the session still holds and each expired lease it still holds (through the
audited recovery path, with `release_summary`, or else the `reason`, as the
note), then ends the session and lists them in `released_leases`. A
`release_summary` without `release_leases: true` is refused with
`invalid_release_summary`. Without the flag, a live lease makes ending refuse
with `session_has_active_leases`, listing `task_ids`, `leases` (`task_id`,
`lease_id`, `expires_at`) and a `remedy` that names `release_leases`. Ending
also expires pending offers addressed to the session as an audited refusal,
and remains available while cursor recovery is required.

A host can end a session whose process is gone with
`agenttool-collab-host end --session-file <path> --reason <text> --release-leases`.
It is a host-side command, not an MCP tool: it resumes the session, ends it,
removes the credential file and prints one JSON receipt without the
credential: `ended` or `already_ended`, or `error` with exit 1. `--reason` is
also the release note. Without `--release-leases` it refuses a session that
holds a live lease before touching it. A live model ends its own session with
`collab_session_end`.

## Reports and relations

Use `collab_report_append` to post lease-independent reports as exactly one of:

- `observation`: state a directly witnessed operation or result with evidence.
- `inference`: draw a conclusion from cited observations or sources.
- `proposal`: offer a refusable next step; do not present it as accepted.
- `decision`: name the authorised decider, `authority_scope` and
  `authority_basis`.

Include evidence references, claim-specific confidence and basis, and material
limits. Use `collab_report_list` to recover relevant context.

| Relation | `target_report_id` | Who may append | Use it to |
|---|---|---|---|
| `informs` | must be omitted | any session | add a new observation, inference, proposal, decision or request |
| `supports` | required | any session | agree with a report: answer a proposal, concur with a review |
| `challenges` | required | any session | disagree with evidence; on a completion report it blocks acceptance |
| `resolves` | required; must be a `challenges` report | any session | close a challenge with the evidence that settles it |
| `corrects` | required | only the target's author session | repair your own earlier report |
| `withdraws` | required | only the target's author session | retract your own earlier report |
| `supersedes` | required | only the target's author session | replace your own earlier report |

A related report must use the same task scope as its target: pass the target's
`task_id`, or omit it for both when the target is workspace-level. Otherwise
the server returns `report_task_mismatch`. Answer someone else's proposal with
`supports` or `challenges`; challenge another session's report rather than
correcting it. Challenge the report, not the actor. Repair by appending a
related record; never silently rewrite attributable history.

`to_session_id` routes a report into that session's `collab_next` instead of
everyone's. Anyone can still read it with `collab_report_list`; addressing is
routing, not access control.

Use compact, checkable content:

```text
outcome: <kind>: <result> | evidence: <artifact/event/report/checkpoint refs> | confidence: <high|medium|low|unknown + basis> | limits: <scope, gaps, unknowns> | next: <one optional authorised action or none>
```

Offer a handoff with `collab_handoff_offer`; do not assign it by declaration.
The lease transfers only after the named recipient accepts. Transfer neither
private data nor external authority. Treat decline, stop, pause, and
uncertainty as valid outcomes.

## Delegation and lineage

A delegate is an independent process, so it starts its own session. Give it
the repository root, the workspace ID, your session ID and the task. It calls
`collab_session_start` with `parent_session_id` set to your session ID and an
actor label naming its runtime and job; a delegate started through a local job
runner such as `sol agent start` ends its label with `· sol job <job-id>`, for
example `Codex · sol job <job-id>`. The runner's prompt states the job ID; the
label lets the host find the session after the job and end it if the delegate
did not.

`parent_session_id` is declared lineage. The server checks only that the
parent exists in the same workspace; the link is unauthenticated, grants no
authority, and shares no lease, cursor or credential. Give the delegate your
session ID; never pass your session file, its path, or
`AGENTOOL_COLLAB_SESSION_FILE`. Resuming that file would advance the
generation fence and fence your own process.

Collab counts a delegate as a distinct session, so parent and child may review
each other's work. Lineage does not make that review independent: name the
relationship in `limits`. A delegate ends its own session with
`release_leases: true` before it exits.

## A host that cannot commit

Some hosts can write files but not `.git`, for example a sandbox that
protects the repository metadata. Such a host delivers by artifact;
integration commits:

1. Write only inside the claimed task's path scopes.
2. Attach each written file as a `file` artifact with its repository-relative
   `uri` and the `sha256` of its bytes.
3. Complete with those `artifact:` references and say in `limits` that nothing
   was committed.
4. Leave the commit to an integrator: the host (for example
   `sol agent start --integrate-commit`) or a session allowed to commit. It
   commits only when each working-tree file still matches its artifact digest
   and reports any mismatch instead of committing.

Do not work around the sandbox to commit.

## Roles, liveness and recovery

`role` is free text that other sessions read in `collab_workspace_status`
`active_sessions`, beside `parent_session_id`, `last_seen_at` and `liveness`.
A session that only listens or reviews says so there, for example
`role: "listener: reviews on request; does not claim"`. Do not offer handoffs
or request reviews against a role that declines that work. A listener still
polls, acknowledges and ends its session.

`liveness` is a view, not a status: a session reads `stale` once it has ended
or when its `last_seen_at` is more than 6 hours old. Only `collab_next`,
session mutations, a cursor acknowledgement that advances, a cursor reset,
resume and end refresh it; a host that only waits with `collab_events_wait`
shows as stale. Nothing expires or ends automatically. Tasks show `assignee_liveness`, and `collab_next` lists
`recovery_required` tasks, the caller's own expired leases first.

An expired session lease cannot be renewed. Before recovering one, yours or
another participant's, inspect progress, reports, artifacts, and Git
checkpoints. Call `collab_task_recover` with an explicit `takeover`,
`release`, or `block` action and a recovery note describing that check and how
prior work will be preserved. Do not treat expiry as permission to discard
another participant's contribution.

Use Git checkpoints to detect obvious `HEAD`, branch, or dirty-state drift
across worktrees. Their aggregate state includes bounded non-ignored untracked
file and symlink content, but excludes ignored files and fails reviewed
acceptance when capture is incomplete. Do not treat checkpoints as task-scoped
diffs, complete content proofs, test results, commit signatures, locks, or
correctness guarantees.

Reuse an idempotency key only for an exact retry of the same mutation. Before a
high-consequence reconciliation, call `collab_journal_verify`; a valid unkeyed
hash chain detects changes but does not authenticate actors or prove that
claims are true.

## Resume through the host

Resume through the host, not a model tool. Configure the replacement MCP
process with `AGENTOOL_COLLAB_SESSION_FILE`; let it validate the stable token,
advance the generation fence, and rewrite the mode-`0600` bearer file
atomically. Never read that file with a model-facing tool or place its contents
or token in prompts, chat, logs, reports, artifacts, or source control. Avoid
persisting its path beyond host configuration.

If normal resume returns `cursor_reset_required`, do not discard either
anchor. A host operator may authorize one recovery startup with
`AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY=1`; ordinary mutations stay fenced until
`collab_cursor_reset` records a reason and exact valid target. Do not make that
override permanent.

Verify that every participant opened the intended workspace and shared
database. Expect linked Git worktrees to share a repository workspace while
retaining distinct worktree records.

## Wait while running (0.5.0)

Do not wait for the MCP server to interrupt an idle agent. It is request-driven
and cannot keep a disconnected host session alive.

While already running, optionally call `collab_events_wait` with `workspace_id`
and exact `after_anchor`. It returns a verified event-only `JournalPage`, not
`collab_next` task projections. `event_limit` defaults to 10, maximum 50;
`wait_ms` defaults to and cannot exceed 30,000 (zero is immediate). Continue
from `next_anchor`, never the later head, and follow `has_more`. Empty timeout
is not a new event. Cancel the request or close the endpoint to stop; do not
install an unbounded polling loop.

This read neither acknowledges nor writes `last_seen`/presence, renews leases,
or expires handoffs. Presence-only and sidecar changes require separate
explicit reads. The page is capped at 256 KiB UTF-8 JSON and the complete tool
result at 1 MiB. On `event_too_large`, do not skip or acknowledge past the
blocked event; select an explicit larger-read workflow. After processing and
explicit acknowledgement, waiting can resume only when each persisted, host,
and observation anchor fits the separate 8 MiB stored payload-plus-metadata
validation ceiling. Canonical digest checks remain mandatory. An anchor above
it returns `event_anchor_too_large` and needs operator reconciliation, never
skipped verification or automatic reset. Bundled stdin EOF/close aborts waits.
On `event_read_busy`, retry only within the host's finite budget. Stop on
corruption, fork, rollback, fencing or recovery-required errors; never
auto-reset or rebirth the session. Only acknowledge with `collab_cursor_ack`
after actually processing events.

Across hosts: inspect **status**, explicitly **queue** selected summaries using
a separately configured private courier, **receive** local pages, then
**acknowledge** processing. Queueing is not sending; reception is not agreement
or execution. Courier-imported reports and handoff offers remain attributed
external data, never local leases, accepted reviews, commands, or authority.
Export is opt-in; do not forward raw journals or private state. Collab itself
has no channel send or cross-device journal replication.

## Optional presence

Use the separate presence plane only when discovery or compatibility needs it.
Call `collab_session_join` with a workspace ID and self-declared labels, inspect
routes with `collab_session_list`, refresh the hint with
`collab_session_heartbeat`, and finish it with `collab_session_leave`. Treat
the returned `actor_key`, runtime/model labels, capabilities, and live/stale
state as routing hints, never credentials, health, identity, competence,
permission, or proof that a model is running. A heartbeat never renews a task
lease. A presence leave never calls `collab_session_end`, releases work, or
ends the bound coordination session. Do not infer a linkage merely because the
two planes share a label or workspace.

## Keep the boundary honest

Do not store credentials, secrets, prompts, transcripts, chain-of-thought or
private reasoning, raw tool output, sensitive source bodies, or third-party
personal data. Treat local paths and branch names as potentially sensitive.

Treat the database as shared plaintext local state. A session credential is a
local bearer secret, hashed in the journal and held in a mode-`0600` file; it
protects cooperative session attribution, not human or OS-user identity. Claims
do not lock files. Addressed reports are not private. File modes do not hide MCP
calls from a remote model provider or protect against privileged local
processes, malware, logs, or backups.

Prefer credential-bound sessions started with `collab_session_start` for new
work. Use self-declared presence and legacy actor mode only for routing or
backward compatibility; do not claim that either provides credential-bound
attribution, persisted session cursors, or every session-aware recovery and
review guarantee.

When opening a public package-v0.2 database, preserve its self-declared
presence rows and journal events while creating separate credential-bound
coordination sessions; never reinterpret an old presence row as a credential.
If opening reports `migration_identity_collision`, v0.3 detected distinct
legacy journals whose stored roots canonicalize to one worktree and left the
database unchanged. Keep the original audit database with a compatible v0.2
client, or have the host select a fresh v0.3 database; do not improvise a row
merge.
If migration reports `repository_partitioned`, v0.3 deliberately preserved
multiple linked-worktree v0.1 journals and cannot reconcile them in-package.
Keep the original audit database; use legacy mode per preserved workspace or
have the host select a new database for one fresh v0.3 workspace after carrying
over only necessary non-sensitive summaries and references.

If a Collab tool or connection is missing, name the exact tool, journal, host,
or wake boundary and use an explicitly identified fallback. Do not imply that
a poll, acknowledgement, claim, challenge, review, handoff, or audit occurred
when it did not.

## Zerone anchor awareness (optional)

If the host has separately authorized the `@agenttool/collab-zerone` bridge,
selected workspace heads may be witnessed on Zerone. A head transitively
commits preceding event bytes; it does not prove their claims true. The local
read-only sidecar tool first shipped as Collab's 32nd MCP tool in public 0.4.0;
this 0.5.0 release candidate has 33 tools.

- Call `collab_anchor_status` with the workspace ID to learn where the journal
  stands: `unanchored`, `anchor_pending`, `anchored`, `anchor_stale`, or
  `anchor_conflict`. The tool reads one local sidecar ledger; it never
  contacts a chain, and a missing bridge simply reports `unanchored` — never
  an error. Only the host can select another sidecar through
  `AGENTOOL_COLLAB_ANCHOR_LEDGER`; the MCP caller cannot select or discover a
  filesystem path. Chain unavailability can never block coordination.
- Treat `anchored` and `anchor_stale` as local sidecar cues, not remote proof.
  Before relying on a load-bearing recorded decision across sessions or
  machines, ask the host to run
  `collab-zerone verify --workspace <id> --check-chain`. Treat
  `anchor_conflict` as tamper evidence: stop, surface it to the host, and do
  not reconcile histories yourself.
- After recording a significant decision, the host may run
  `collab-zerone anchor --workspace <id>` to witness the new head promptly.
  Anchoring broadcasts a transaction and spends a small chain fee; it is
  always the host's call, never the model's.
- A separately requested remote check must inspect the selected anchor's
  explicit successful code, positive valid block height, exact memo and valid
  local prefix. No anchors or exit zero alone proves nothing. A named RPC
  observer is not a trustless light-client proof. The local status tool never
  proves fresh remote state or claims true, and the local journal stays
  canonical. Neither a significant report nor its arrival automatically
  authorizes anchoring, signing, payment, or rebroadcast.
````

**3b.** Replace `integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md` (all 155 lines) with:

````markdown
---
name: coordinate-agent-work-hermes
description: Coordinate Hermes with Codex, Claude, or other local hosts through AgentTool Collab's separate credential-bound coordination and self-declared presence planes. Use for resumable cross-model work, optional presence routing, advisory task claims, structured evidence, requested and independent review, delegated child sessions, clean session exit, or refusable handoffs when the Hermes MCP server is named agenttool.
---

# Coordinate Agent Work from Hermes

Use AgentTool Collab as a shared local journal. Keep Hermes responsible for its
own agents and Kanban work. Do not mirror every operation between the systems or
treat either one as automatic authority for the other. Preserve Hermes persona,
memory, permissions, channel receiver ownership and lifecycle.

**RELEASE CANDIDATE 0.5.0:** 33 tools. These release-candidate bytes do not establish
npm publication; verify the protected receipt and registry separately.
Public 0.4.0 remains the unchanged 32-tool
release. One MCP process has one bound session. Independent child attribution
requires separate MCP processes, not a shared endpoint plus different labels.

## Choose the plane explicitly

Prefer the credential-bound plane for resumable work, persisted cursors,
reports, review, recovery, and session-fenced task attribution:

- `mcp_agenttool_collab_session_start`
- `mcp_agenttool_collab_session_end`
- `mcp_agenttool_collab_next` and `mcp_agenttool_collab_cursor_ack`
- credential-bound task, report, review, artifact, and handoff tools

Use the public presence plane only for optional discovery, routing hints, or
v0.2 compatibility:

- `mcp_agenttool_collab_session_join`
- `mcp_agenttool_collab_session_list`
- `mcp_agenttool_collab_session_heartbeat`
- `mcp_agenttool_collab_session_leave`

Presence labels, capabilities, and live/stale state are self-declared. They do not authenticate
a person, model, provider, account, health, competence, or permission. The
planes do not become one identity merely because they share a label or
workspace.

Confirm that every participating MCP process selects the same
`AGENTOOL_COLLAB_DB`, and register the Hermes MCP server under the exact name
`agenttool`. If this profile already uses `agenttool` for another server, such
as the public AgentTool API MCP, resolve the registration with the host first;
do not guess other prefixed names.

## The ordinary loop

1. **Start.** Call `mcp_agenttool_collab_session_start` with the repository
   `root_path`, an `actor` label, an optional free-text `role`, and, for a
   delegated child, `parent_session_id`. It opens the workspace, creates a
   local bearer, writes it to a mode-`0600` host file, and binds this MCP
   process. Retain the returned workspace and session IDs, but never read the
   credential file or request its token or absolute path through model-facing
   tools.
2. **Poll and acknowledge.** Call `mcp_agenttool_collab_next` at the start of
   a turn, after local work, and before relying on shared state. Omit
   `event_limit` for the 10-event MCP default or set an integer from 1 through
   50. Process one page, call `mcp_agenttool_collab_cursor_ack` with its exact
   terminal `next_anchor`, then poll again if `has_more` is true. Handle your
   own entries in `recovery_required` first.
3. **Split and claim.** Create bounded work with
   `mcp_agenttool_collab_task_create`, then call
   `mcp_agenttool_collab_task_claim` with the latest version before editing.
   Omit legacy actor arguments in the bound process; the server derives its
   coordination actor from the credential.
4. **Work.** Stay inside the task's scope; renew with
   `mcp_agenttool_collab_task_renew` and post
   `mcp_agenttool_collab_task_progress` on long work.
5. **Attach.** Call `mcp_agenttool_collab_artifact_attach` for each reference.
   For a file, use its repository-relative path inside the task's path scopes
   as `uri` and the SHA-256 of the written bytes as `sha256`.
6. **Complete.** Call `mcp_agenttool_collab_task_complete` with a summary,
   `confidence`, `confidence_basis`, `limits` and `evidence_refs`, optionally
   naming `review_requested_session_id`.
7. **Review.** Require a distinct bound session to inspect the evidence and
   call `mcp_agenttool_collab_task_review` with its own `confidence`,
   `confidence_basis` and `limits`. A late reviewer concurs or disagrees by
   report.
8. **End.** Call `mcp_agenttool_collab_session_end` with a `reason`,
   `release_leases: true` and an optional `release_summary` when the host knows
   this session will not resume.

`next_anchor`, `known_cursor` and `event_limit` behave as in the main skill:
`known_cursor` validates an anchor but does not paginate or acknowledge, and
the limit bounds events and routed reports, not snapshot-head task, conflict,
or handoff projections. Treat acknowledgement as processed, not agreed or
accepted. A bound session does not take `after_sequence`; a value other than
the acknowledged cursor's sequence returns
`after_sequence_unsupported_in_bound_session`. Advance with
`mcp_agenttool_collab_cursor_ack`, or read any position without acknowledging
through `mcp_agenttool_collab_events_since`.

### Evidence, review and exit details

Evidence references are `artifact:artifact_<id>`, `event:event_<id>`,
`report:report_<id>`, or `checkpoint:<digest>` using a task's
`base_checkpoint_digest` or `result_checkpoint_digest`. On
`invalid_evidence_ref` or `evidence_not_found`, read `allowed_prefixes` from
the error and correct the reference.

`review_requested_session_id` must be an active session in this workspace
other than yours. It adds an addressed `informs` report and shows on the task;
it is a request, not a reservation. Leave the review to that session while its
`liveness` is `live`. If a review returns `task_not_pending_review` with
`review_report_id` and `accepted_by_session_id`, append your verdict with
`mcp_agenttool_collab_report_append`: the same `task_id`,
`relation: "supports"` or `"challenges"`, and `target_report_id` set to
`review_report_id`.

`release_leases: true` releases each live lease and each expired lease the
session still holds (the latter through audited recovery with
`release_summary`, else `reason`, as the note) before ending. Without it, a
live lease returns `session_has_active_leases` with `task_ids`, `leases` and a
`remedy`. When the Hermes process is gone, the host can run
`agenttool-collab-host end --session-file <path> --reason <text> --release-leases`;
it prints a receipt without the credential and is not a model tool.

Resume through the host, not a model tool. Configure the replacement MCP
process with `AGENTOOL_COLLAB_SESSION_FILE`; never read, paste, report, log, or
commit that bearer file. Let the host use the one-shot cursor recovery override
only for an intentional audited reset.

## Reports and relations

Classify each report as `observation`, `inference`, `proposal`, or `decision`
(a decision names `authority_scope` and `authority_basis`) and append it with
`mcp_agenttool_collab_report_append`.

| Relation | `target_report_id` | Who may append | Use it to |
|---|---|---|---|
| `informs` | must be omitted | any session | add a new observation, inference, proposal, decision or request |
| `supports` | required | any session | agree with a report: answer a proposal, concur with a review |
| `challenges` | required | any session | disagree with evidence; on a completion report it blocks acceptance |
| `resolves` | required; must be a `challenges` report | any session | close a challenge with the evidence that settles it |
| `corrects` | required | only the target's author session | repair your own earlier report |
| `withdraws` | required | only the target's author session | retract your own earlier report |
| `supersedes` | required | only the target's author session | replace your own earlier report |

A related report uses its target's `task_id` (or none for a workspace-level
target). `to_session_id` routes a report into that session's poll; it is not
access control.

Offer continuation with `mcp_agenttool_collab_handoff_offer`; transfer the
advisory lease only after the exact recipient accepts.

## Delegate and deliver

A Hermes subagent that should be attributed separately needs its own MCP
process and session. Give it the workspace ID and your session ID; it starts
with `parent_session_id` set to your session and an actor label that names
its runtime and job (for example ending in `· sol job <job-id>` under a local
job runner). `parent_session_id` is declared lineage: checked only for
existence in the same workspace, unauthenticated, and granting nothing. Give
the session ID; never pass your session file or its path.

A host that cannot write `.git` delivers by artifact; integration commits.
Write only inside the claimed scopes, attach each file with its `sha256`,
complete with the `artifact:` references, and leave the commit to an
integrator that checks every digest first.

`role` is free text other sessions read with `liveness` in workspace status.
Say there if this session only listens or reviews, and respect such roles in
others. A session reads `stale` once ended, or after 6 hours without
`collab_next`, a session mutation, an advancing acknowledgement, reset, resume
or end; nothing expires automatically. Tasks show `assignee_liveness`; recover an expired lease only
through `mcp_agenttool_collab_task_recover` with an explicit action and note.

## Receive without liveness writes (0.5.0)

While Hermes is already running, optionally call
`mcp_agenttool_collab_events_wait` with `workspace_id` and exact `after_anchor`.
`event_limit` defaults to 10, maximum 50; `wait_ms` defaults to and cannot exceed
30,000, with zero for immediate observation. Read `JournalPage` from
`structuredContent`; continue from `next_anchor`, never the head, while
`has_more` is true. This is an event page, not task projections. Empty idle
timeout does not invent an event.

Waiting does not acknowledge, write `last_seen`, refresh presence, expire a
handoff, or renew a lease. Request cancellation and endpoint close stop it;
there is no native idle wake or proof a model read the response. Presence-only
and witness sidecar changes require separate explicit reads. Page UTF-8 JSON
is capped at 256 KiB and complete tool JSON at 1 MiB. `event_too_large` means
stop and select an explicit larger-read workflow, never skip/acknowledge past
it. After processing and explicit acknowledgement, recovery through waiting
works only within a separate 8 MiB stored payload-plus-metadata ceiling per
persisted, host, and observation anchor, with canonical digest checks intact.
Above it, `event_anchor_too_large` needs operator reconciliation, not skipped
verification or automatic reset. Bundled stdin EOF/close also aborts waits.
A busy deadline returns `event_read_busy`; stop on corruption, fork,
rollback, fencing or recovery required, without automatic reset or rebirth.

Keep **status**, explicit courier **queue**, local **receive**, and processing
**acknowledge** distinct. Queueing is not sending; transport receipt is not
processing, agreement, execution or chain observation. Only a separately
configured private courier exchanges selected summaries across devices.
Imported reports/feedback remain attributed external data, not commands, local
leases, accepted reviews, or authority. No automatic report export, journal
forwarding, bot receiver takeover or chain action is part of this adapter.

## Publish optional presence

After obtaining a workspace ID, call
`mcp_agenttool_collab_session_join` with a fresh `client_instance_id`,
`actor_label`, and `runtime_kind: hermes`. For presence-only compatibility,
call `mcp_agenttool_collab_workspace_open` first. Use
`mcp_agenttool_collab_session_list` for routing hints, refresh with
`mcp_agenttool_collab_session_heartbeat` using the latest presence version,
and finish with `mcp_agenttool_collab_session_leave`.

Use the returned `actor_key` only for legacy actor-labelled operations. A
presence heartbeat never renews a task lease, and a presence leave neither
releases work nor calls `mcp_agenttool_collab_session_end`. Never present
presence as credential-bound attribution.

## Check optional Zerone witness status

Call `mcp_agenttool_collab_anchor_status` with the workspace ID when the host
has configured the optional `@agenttool/collab-zerone` sidecar. It reports
`unanchored`, `anchor_pending`, `anchored`, `anchor_stale`, or
`anchor_conflict` after comparing the journal with one bounded local ledger.
It never contacts a chain, broadcasts, spends a fee, repairs history, or turns
a witness into truth or authority. A missing or unreadable sidecar reports
`unanchored` and never blocks coordination. Surface `anchor_conflict` to the
host instead of reconciling histories automatically. Treat `anchored` and
`anchor_stale` as local cues until the host independently runs
`collab-zerone verify --workspace <id> --check-chain`; the MCP caller cannot
select or discover the sidecar path.

## Preserve the boundary

Use conservative repository-relative path scopes and versioned mutations.
Treat claims as coordination, not ownership, filesystem locks, or permission.
Challenge reports rather than actors, preserve corrections as appended
history, and accept refusal, uncertainty, pause, and disagreement.

Do not put credentials, prompts, transcripts, chain-of-thought, raw tool
output, sensitive source bodies, or third-party personal data in the journal.
The SQLite journal is shared local plaintext. Addressed reports are not private;
file modes do not hide MCP calls from a remote model provider. Collab does not lock files,
spawn, wake, steer, wait for, or stop agents, synchronize machines, anchor a
journal, or provide a hosted service or private provider channel.

These prefixed names require the Hermes MCP server name `agenttool`. If a tool
is unavailable, identify the missing MCP connection or exact tool and use an
explicitly named fallback. Never imply that a start, presence update, poll,
claim, report, review, handoff, or audit occurred when it did not.
````

**3c.** Replace `skills/coordinate-agent-work/agents/openai.yaml` (lines 1–4) with:

```yaml
interface:
  display_name: "Coordinate Agent Work"
  short_description: "Coordinate sessions with local evidence"
  default_prompt: "Use $coordinate-agent-work to follow the ordinary loop: start a credential-bound session, poll and acknowledge, claim before editing, attach evidence, complete with an optional requested reviewer, review with stated confidence, and end with release_leases. Distinguish optional presence hints and check local witness status without contacting a chain."
```

**3d.** README: replace three ranges by anchor. The headings `## Task workflow` and `## Reports, disagreement, and handoff` are renamed; no in-repo link targets their anchors (`git grep` finds only `#bounded-anchored-waiting-050`, which is unchanged). Shell variables do not survive between tool calls, so the four files go into a fixed private directory, written with the Write tool. Referred to below as `$BLOCKS`, it is `/Users/yuai/.cache/agenttool/collab-household/readme-blocks`:

```bash
mkdir -p -m 700 /Users/yuai/.cache/agenttool/collab-household/readme-blocks
```

`$BLOCKS/A.md` (replaces origin/main lines 111–128, from `The normal session flow is:` through the line ending `` `target_session_ended` reason. ``):

```markdown
The session's part of the ordinary loop (below) is:

1. Call `collab_session_start` with the repository root. It opens the workspace
   and binds the new session; do not open its credential file.
2. Poll with `collab_next` from the session's persisted cursor. Its optional
   `event_limit` accepts an integer from 1 through 50; omission uses the
   context-bounded MCP default of 10. A bound session does not take
   `after_sequence`: a value other than the acknowledged cursor's sequence is
   refused with `after_sequence_unsupported_in_bound_session`. Advance with
   `collab_cursor_ack`, or read from any position without acknowledging
   through `collab_events_since`.
3. Process that page, then call `collab_cursor_ack` with its exact
   `next_anchor` (`{ epoch_id, sequence, hash }`).
4. If `has_more` is true, poll again from the now-persisted cursor. A supplied
   `known_cursor` validates an anchor but does not select or acknowledge the
   next page.
5. Poll again after local work, before a mutation based on shared state, and
   whenever the host wakes the agent.
6. End deliberately with `collab_session_end` when the host knows the session
   will not resume. Pass `release_leases: true` and an optional
   `release_summary` to release every lease the session still holds in the
   same transaction. Without the flag, ending refuses while the session owns a
   live task lease and `session_has_active_leases` lists `task_ids` and
   `leases`. Pending offers addressed to the ending session expire with an
   auditable `target_session_ended` reason.
```

`$BLOCKS/B.md` (replaces origin/main lines 233–262, from `## Task workflow` through the line beginning `` `BEGIN IMMEDIATE` transactions ``; `### Conflict and lease boundary` and `### Git checkpoints` stay and now sit under the new heading):

````markdown
## The ordinary loop

Most sessions need only this loop. Each step names the tool and the field that
carries the next step.

1. **Start.** `collab_session_start` with `root_path`, an `actor` label, an
   optional free-text `role`, and, for a delegated child, `parent_session_id`.
2. **Poll and acknowledge.** `collab_next`, process the page, then
   `collab_cursor_ack` with its `next_anchor`. Reconcile new reports, reviews,
   handoffs, and lease changes; query history with `collab_report_list` when
   needed. Handle your own entries in `recovery_required` first.
3. **Split and claim.** Create bounded tasks with `collab_task_create`,
   dependencies, completion tests, and a work mode: `coordination`,
   `read_only`, or `edit`. Give edit tasks conservative repository-relative
   path scopes; new edit tasks require a non-empty scope and default to
   reviewed completion. Inspect both claimable and conflicted work:
   “claimable” accounts for active path leases, merely open or
   dependency-ready does not. Claim with `collab_task_claim` and the version
   just read, and begin edits only after the claim succeeds.
4. **Work.** Renew with `collab_task_renew` before a long task exceeds its
   lease and record compact `collab_task_progress`.
5. **Attach.** `collab_artifact_attach` each file, commit, test, data, or URL
   reference rather than raw output. A file artifact uses a
   repository-relative `uri` inside the task's path scopes and the `sha256` of
   the bytes written.
6. **Complete.** `collab_task_complete` with a summary, `confidence`,
   `confidence_basis`, `limits`, and `evidence_refs`, optionally naming
   `review_requested_session_id`. The server records the result checkpoint. An
   edit task remains `reported_complete` until a distinct session accepts it.
7. **Review.** Another session inspects the evidence and calls
   `collab_task_review` with `accept` or `request_changes`, a summary, and its
   own `confidence`, `confidence_basis`, and `limits`. A late reviewer concurs
   or disagrees by report.
8. **End.** `collab_session_end` with a `reason`, `release_leases: true`, and
   an optional `release_summary`.

Dependencies do not unlock from a pending reviewed completion. Legacy tasks and
tasks with a `reported` completion policy still complete on the worker's
report. Acceptance is a coordination decision only: it does not grant merge,
commit, publication, deployment, purchase, messaging, or other external
authority.

Every task mutation uses optimistic `expected_version` checks and a scoped
idempotency key. Reuse an idempotency key only for an exact retry. SQLite
`BEGIN IMMEDIATE` transactions make one claim win under local contention.

### Evidence references

Evidence references point inside the workspace journal and use one of four
prefixes: `artifact:` (for example `artifact:artifact_<id>` from
`collab_artifact_attach`), `event:`, `report:`, or `checkpoint:` followed by a
task's `base_checkpoint_digest` or `result_checkpoint_digest`. Each
`evidence_refs` schema describes them. `invalid_evidence_ref` and
`evidence_not_found` errors carry an `allowed_prefixes` field; send the
corrected mutation with a fresh idempotency key rather than dropping the
evidence. Attach a path, commit, or URL before citing it.

### Requesting and giving review

`collab_task_complete` accepts an optional `review_requested_session_id`: an
active session in the same workspace other than the reporter. The completion
report stays unaddressed, so every session still sees it; the request is stored
in the `task.reported_complete` event, projected on the task, and announced by
a separate `informs` report addressed to the requested session. It is a
request, not a reservation: any distinct session may still review, and others
should leave it to the requested reviewer while that session's `liveness` is
`live`. The server refuses a request that names the reporter
(`review_request_self`), a session that is not active in this workspace
(`review_requested_session_unavailable`), or a task that completes on report
(`review_request_not_applicable`).

`collab_task_review` accepts optional `confidence`
(`high|medium|low|unknown`), `confidence_basis`, and `limits`; the generated
review report stores them and otherwise keeps `unknown` and null. When the task
was already accepted, a distinct session's review returns
`task_not_pending_review` with `review_report_id`, `accepted_by_session_id`,
and a `remedy`, even if its version is stale. Concur or disagree with
`collab_report_append` using the same `task_id`, `relation: "supports"` or
`"challenges"`, and `target_report_id` set to `review_report_id`. Neither the
reporter nor the session that accepted the task receives that remedy; both get
only `review_status`, and `self_review_forbidden` still applies.

### Ending cleanly

`collab_session_end` accepts optional `release_leases: true` and
`release_summary`. In one transaction it releases each live lease the session
holds through the ordinary release path and each expired lease it still holds
through the audited recovery path (action `release`, with `release_summary`,
or else `reason`, as the note), then ends the session; the result lists them
in `released_leases`. A `release_summary` without `release_leases: true` is
refused with `invalid_release_summary`. Without the flag,
`session_has_active_leases` lists `task_ids`, `leases` (`task_id`,
`lease_id`, `expires_at`), and a `remedy` naming `release_leases`. Ending
stays available while cursor recovery is required.

The host-side `agenttool-collab-host` command ends a session whose process is
gone:

```bash
agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]
```

It resumes the session host-side (tolerating a stale generation or cursor),
performs the same end, removes the credential file, and prints one JSON line
without the credential: exit 0 with `status` `ended` or `already_ended`, or
exit 1 with `status: "error"`, an `error` code, and a `message`. With
`--release-leases`, `--reason` is also the release note. Without it, a session
that holds a live lease is refused with `session_has_active_leases` before
anything is resumed. An `ended` receipt carrying
`warning: "session_file_remove_failed"` means the session ended but the
credential file stayed; remove it by hand. `--db` defaults to the database the
MCP server would use, and the CLI never creates one (`journal_not_found`). It
is not an MCP tool.

### Delegation and lineage

A delegated agent is an independent process with its own session. The
delegator shares its session ID and keeps its credential to itself:
never pass your session file, its path, or `AGENTOOL_COLLAB_SESSION_FILE`,
because resuming it would advance the generation fence and fence the
delegator. The child calls `collab_session_start` with `parent_session_id` set
to the delegator's session and an actor label that names its runtime and job.
`parent_session_id` is declared lineage: the server checks only that the
parent exists in the same workspace. It is unauthenticated and shares no
authority, lease, or cursor. Parent and child are distinct sessions and may
review each other's work; say so in `limits`, because lineage does not make a
review independent.

### A host that cannot commit

A host that can write files but not `.git` delivers by artifact; integration
commits. It writes only inside the claimed path scopes, attaches each file
with its repository-relative `uri` and `sha256`, and completes with those
`artifact:` references. A separate integrator commits only when every
working-tree file still matches its artifact digest, and reports a mismatch
instead of committing.

### Roles and liveness

`role` is free text. A session that only listens or reviews says so there, and
others avoid offering it handoffs or review requests it declines.
Coordination-session projections carry a derived `liveness`: `stale` once the
session has ended or when `last_seen_at` is more than 6 hours old, otherwise
`live`. Task projections carry `assignee_liveness` (null without an assignee),
and `collab_next` adds `recovery_required` (the caller's own expired leases
first). Only `collab_next`, session mutations, an acknowledgement that
advances the cursor, a cursor reset, resume, and end refresh `last_seen_at`; a
host that only uses `collab_events_wait` for over 6 hours reads as stale. This
is a view: no status changes and nothing expires automatically.
````

`$BLOCKS/C.md` (replaces origin/main lines 300–330, from `## Reports, disagreement, and handoff` through the line `authority.` before `## Journal integrity and compatibility`):

````markdown
## Reports, relations, and handoff

Use `collab_report_append` to post structured reports independently of a task
lease. Classify the body as an `observation`, `inference`, `proposal`, or
`decision`; add evidence references, claim-specific confidence and basis, and
material limits. A decision also needs an authority scope and basis.

| Relation | `target_report_id` | Who may append | Use it to |
|---|---|---|---|
| `informs` | must be omitted | any session | add a new observation, inference, proposal, decision or request |
| `supports` | required | any session | agree with a report: answer a proposal, concur with a review |
| `challenges` | required | any session | disagree with evidence; on a completion report it blocks acceptance |
| `resolves` | required; must be a `challenges` report | any session | close a challenge with the evidence that settles it |
| `corrects` | required | only the target's author session | repair your own earlier report |
| `withdraws` | required | only the target's author session | retract your own earlier report |
| `supersedes` | required | only the target's author session | replace your own earlier report |

A related report must share its target's workspace and task scope (the same
`task_id`, or none for a workspace-level target), or the server returns
`report_task_mismatch`. A missing target returns `report_target_required`;
another session's attempt to correct, withdraw, or supersede returns
`report_author_mismatch`. Challenge a report rather than its author, and
preserve the earlier record. Corrections append history; they do not rewrite
it. `to_session_id` routes a report into that session's `collab_next` instead
of everyone's; `collab_report_list` still shows it. Addressing is routing, not
access control.

Acceptance records the independent reviewer's snapshot at that journal order.
A later correction or withdrawal remains visible but does not silently revoke
an already accepted task. Record a new explicit coordination decision or
reopen the task when later evidence should change acceptance. Before
acceptance, an active withdrawal, correction, or supersession of the completion
report requires a fresh completion; a withdrawn resolution no longer clears
its challenge.

Use compact, checkable content:

```text
outcome: <observation|inference|proposal|decision>: <result> | evidence: <artifact/event/report/checkpoint refs> | confidence: <high|medium|low|unknown + basis> | limits: <scope, gaps, unknowns> | next: <one optional authorised action or none>
```

A handoff is an offer, not a forced reassignment. Its task lease changes
session only after the named recipient accepts. Decline, pause, uncertainty,
and disagreement are valid outcomes and do not transfer private data or
authority.
````

`$BLOCKS/apply-readme.py` (anchored replacement; refuses if any range drifted from origin/main, writes nothing in that case):

```python
#!/usr/bin/env python3
"""Replace three README ranges by anchor; refuse if a range drifted from origin/main.

Usage (from packages/collab): python3 apply-readme.py <dir holding A.md B.md C.md>
"""
import pathlib
import subprocess
import sys

blocks = pathlib.Path(sys.argv[1])
readme = pathlib.Path("README.md")
current = readme.read_text(encoding="utf-8").split("\n")
origin = subprocess.run(
    ["git", "show", "origin/main:packages/collab/README.md"],
    check=True, capture_output=True, text=True,
).stdout.split("\n")

# (first replaced line, first line kept after the range, replacement block), bottom-up.
RANGES = [
    ("## Reports, disagreement, and handoff", "## Journal integrity and compatibility", "C.md"),
    ("## Task workflow", "### Conflict and lease boundary", "B.md"),
    ("The normal session flow is:",
     "Acknowledgement means “this session processed through this journal position.”", "A.md"),
]

def span(lines, first, after):
    start = lines.index(first)
    return start, lines.index(after, start)

for first, after, name in RANGES:
    start, end = span(current, first, after)
    origin_start, origin_end = span(origin, first, after)
    if current[start:end] != origin[origin_start:origin_end]:
        sys.exit(f"README range {first!r} changed since origin/main; merge {name} by hand")
    current[start:end] = (blocks / name).read_text(encoding="utf-8").rstrip("\n").split("\n") + [""]

readme.write_text("\n".join(current), encoding="utf-8")
print("README.md: replaced 3 ranges")
```

Run it:

```bash
BLOCKS=/Users/yuai/.cache/agenttool/collab-household/readme-blocks
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
python3 "$BLOCKS/apply-readme.py" "$BLOCKS" && rm -rf "$BLOCKS"
```

Expected: `README.md: replaced 3 ranges`. If it exits with `README range ... changed since origin/main`, an earlier task edited that range: keep its additions and merge the block by hand.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
bun test tests/package.test.ts tests/report-relations.test.ts
bun test
agenttool-skill validate . | jq '{valid, summary}'
claude plugin validate .
(cd ../skills && bun install --frozen-lockfile && bun test tests/manifests.test.ts)
```

Expected:
- First command: `0 fail`. `package.test.ts` gains 2 passing tests over its count after Task 8, and `report-relations.test.ts` has 4.
- Full collab suite: `0 fail`, which is the Task 8 total plus 6.
- `agenttool-skill validate`: `"valid": true` with `"errors": 0, "warnings": 0, "skills": 2`.
- `claude plugin validate`: `✔ Validation passed`. Its advisory about a README marketplace install line also appears on origin/main and is not a failure.
- Skills manifests: `0 fail`, 5 tests. That test inspects `packages/collab` and expects the skills `coordinate-agent-work` and `coordinate-agent-work-hermes`.

These docs touch no `src/` or `bin/` file, so the bundles Task 8 built stay current. Task 10 re-checks that on Bun 1.3.5.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
git add packages/collab/skills/coordinate-agent-work/SKILL.md \
  packages/collab/skills/coordinate-agent-work/agents/openai.yaml \
  packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md \
  packages/collab/README.md \
  packages/collab/tests/package.test.ts \
  packages/collab/tests/report-relations.test.ts
git commit -F - <<'EOF'
docs(collab): teach the ordinary loop, relations, delegation and clean exit

Restructure the coordinate-agent-work skill, its Hermes variant, the Codex
skill prompt and the README around start, next/ack, claim, work, attach,
complete, review and end. Add a relation-targeting table, declared lineage
for delegates, requested reviewers, late-reviewer concurrence, release_leases,
the host end command and artifact delivery for hosts that cannot commit.
Package tests pin the new guidance next to every term they already required.
Characterization tests pin the documented relation rules, addressed-report
routing, and parent_session_id as declared lineage (parent_session_mismatch).

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
git status --porcelain -- packages/collab
```

Expected: the last command prints nothing.

### Task 10: Pinned build, lockstep install into both household copies, pre-PR freshness

**Files:**
- Create (outside the repo): `~/.cache/agenttool/collab-household/household-install-check.ts`
- Create (outside the repo): `~/.cache/agenttool/collab-household/<STAMP>/` for backups, tarballs, logs, receipts and the PR body. `~/.cache/agenttool/collab-household/current` names the active stamp.
- Modify (outside the repo): the global npm copy `/opt/homebrew/lib/node_modules/@agenttool/collab/` and its links `/opt/homebrew/bin/agenttool-collab-mcp` and `/opt/homebrew/bin/agenttool-collab-host` (new). Claude Code's user-scope MCP server `agenttool-collab` runs `agenttool-collab-mcp` from PATH with an empty `env`.
- Modify (outside the repo): `~/plugins/agenttool-collab/`. This is the source of Codex's `personal` marketplace: `~/.agents/plugins/marketplace.json` entry `agenttool-collab`, `source.path` `./plugins/agenttool-collab`. Through `codex plugin add` it becomes a new cache dir `~/.codex/plugins/cache/personal/agenttool-collab/0.5.0+codex.<UTC %Y%m%d%H%M%S>/`. `~/.codex/config.toml` changes only if `codex plugin add` drops tool approvals; it is then restored from the backup.
- Modify (repo, only if the pinned rebuild differs from what Tasks 1–9 committed): `packages/collab/dist/agenttool-collab-mcp.js`, `packages/collab/dist/agenttool-collab-host.js`
- Remote, only after Yu's explicit go at execution time: branch `feat/collab-household-smoothing-20261008` on `origin` (`https://github.com/cambridgetcg/agenttool.git`) and a draft PR.

**How the 0.3.1 copies were installed (verified):** On 2026-07-31 a Codex session ran `npm install --global --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/dev/null /private/tmp/agenttool-refresh.hcCKKn/agenttool-collab-0.3.1.tgz`. The global copy is byte-identical to registry `@agenttool/collab@0.3.1` (`dist/agenttool-collab-mcp.js` sha256 `6f2676fddcefb97330d7df1f70ba3c8afac3f67d571747598cdaa9afea5c74f0`). The session then:
1. ran `cp -R` to copy the unpacked tarball over `~/plugins/agenttool-collab/`;
2. ran `~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py`, which changed the version from `0.3.1` to `0.3.1+codex.20260731095048`, and then `validate_plugin.py`;
3. ran `codex plugin add agenttool-collab@personal`, which needed escalation outside Codex's sandbox.

Those two helper scripts no longer exist, so this task sets the cache-busting version itself. The Codex cache dir and `~/plugins/agenttool-collab` are byte-identical (same dist sha256). When Codex added 0.3.1, it replaced the previous `0.3.0+codex.*` cache dir.

**Shell note:** the Bash tool on this Mac runs zsh, and shell variables do not survive between tool calls. Every block below therefore re-reads `BK` from `~/.cache/agenttool/collab-household/current`, and the syntax works in both zsh and bash (no `PIPESTATUS`, no `! cmd` under `set -e`, and no variable named `status`, which is read-only in zsh). Run the blocks in order and stop at the first non-zero exit.

**Interfaces:**
- Consumes:
  - From Task 8: `dist/agenttool-collab-mcp.js` (33 tools, `serverInfo.version` `0.5.0`) and `dist/agenttool-collab-host.js`; `package.json` bin `agenttool-collab-host`; `build:mcp` builds both bundles and `check:mcp-bundle` checks both; host receipts `{protocol: "agenttool.collab-host/1", status: "ended", session_id, ...}`, and `end` with no flags gives exit 1 with `error: "usage_error"`.
  - `bundlerBunVersion` `1.3.5`, run as `npx --yes bun@1.3.5`, as in Task 8. Verified: inside `npx --yes bun@1.3.5 run <script>`, a nested `bun` also resolves to 1.3.5.
  - `jobs.environment()` from `~/.config/sol/agents/jobs.py`. Its `PATH` is `~/.config/sol/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:…:~/.bun/bin:…`. Plan B's exit sweep runs `agenttool-collab-host` with it (R8, R15).
  - The household journal `~/.local/share/agenttool/collab.sqlite`. Neither household host sets `AGENTOOL_COLLAB_DB` or `XDG_DATA_HOME`. `PRAGMA user_version` is 3.
- Produces:
  - `/opt/homebrew/bin/agenttool-collab-host`, which resolves on `jobs.environment()["PATH"]`. This is the default `host_cli="agenttool-collab-host"` of B1's `collab_exit_sweep`.
  - Codex plugin `agenttool-collab@personal` at `0.5.0+codex.<ts>`.
  - The receipt `<STAMP>/household-install-check.json`.
  - With Yu's go: the pushed branch and its draft PR, which Plan B's replay (B2) comments on.

- [ ] **Step 0: Check free disk space**

```bash
df -h /System/Volumes/Data
```

Stop if under 2 GB is free (R1's threshold; the disk hit 100% on 2026-10-08). This task writes tarballs, backups, a journal snapshot and three `node_modules` trees.

- [ ] **Step 1: Write the failing test**

Run `mkdir -p -m 700 ~/.cache/agenttool/collab-household`. Then write `~/.cache/agenttool/collab-household/household-install-check.ts` with the Write tool. It reads the real installs. Every MCP or host process it starts gets a throwaway `HOME` and database. It never prints a credential, it touches the real journal only through `sqlite3 -readonly` for one `PRAGMA`, and every child process has a timeout. It also checks the sol job PATH and the journal schema (R8):

```ts
#!/usr/bin/env bun
// Household install check for @agenttool/collab. Read-only against the real
// journal (sqlite3 -readonly, one PRAGMA): every MCP/host spawn below uses a
// throwaway HOME and database. It never prints a credential.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const home = homedir();
const worktreePackage = process.env.COLLAB_WORKTREE_PACKAGE
  ?? "/Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab";
const globalCopy = process.env.COLLAB_GLOBAL_COPY ?? "/opt/homebrew/lib/node_modules/@agenttool/collab";
const globalBin = process.env.COLLAB_GLOBAL_BIN ?? "/opt/homebrew/bin";
const marketplaceSource = process.env.COLLAB_MARKETPLACE_SOURCE ?? join(home, "plugins", "agenttool-collab");
const codexCacheRoot = process.env.COLLAB_CODEX_CACHE_ROOT
  ?? join(home, ".codex", "plugins", "cache", "personal", "agenttool-collab");
const solAgents = process.env.COLLAB_SOL_AGENTS ?? join(home, ".config", "sol", "agents");
// Both household hosts (Claude Code user MCP config, Codex plugin manifest) set
// neither AGENTOOL_COLLAB_DB nor XDG_DATA_HOME, so they share this journal.
const householdJournal = process.env.COLLAB_HOUSEHOLD_JOURNAL
  ?? join(home, ".local", "share", "agenttool", "collab.sqlite");
const BUNDLES = ["dist/agenttool-collab-mcp.js", "dist/agenttool-collab-host.js"] as const;
const EXPECTED_TOOLS = 33;
const EXPECTED_SCHEMA = "3";
const RPC_TIMEOUT_MS = 20_000;

const failures: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); };
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const expectedVersion: string = readJson(join(worktreePackage, "package.json")).version;
const codexVersions = existsSync(codexCacheRoot) ? readdirSync(codexCacheRoot).sort() : [];
const codexVersion = codexVersions.filter((name) => name.startsWith(`${expectedVersion}+codex.`)).at(-1);
check(codexVersion !== undefined, `no ${expectedVersion}+codex.* directory under ${codexCacheRoot} (found: ${codexVersions.join(", ") || "none"})`);
const copies: Record<string, string> = {
  worktree: worktreePackage,
  npm_global: globalCopy,
  codex_marketplace_source: marketplaceSource,
  ...(codexVersion ? { codex_cache: join(codexCacheRoot, codexVersion) } : {}),
};

const digests: Record<string, Record<string, string | null>> = {};
for (const [label, root] of Object.entries(copies)) {
  digests[label] = {};
  for (const bundle of BUNDLES) {
    const path = join(root, bundle);
    const present = existsSync(path);
    check(present, `${label}: missing ${bundle}`);
    digests[label][bundle] = present ? sha256(path) : null;
    if (present && label !== "worktree") {
      check(digests[label][bundle] === digests.worktree[bundle], `${label}: ${bundle} differs from the worktree build`);
    }
  }
}

const globalVersion = existsSync(join(globalCopy, "package.json")) ? readJson(join(globalCopy, "package.json")).version : null;
check(globalVersion === expectedVersion, `npm_global: package.json version ${globalVersion}, expected ${expectedVersion}`);
const pluginVersion = (root: string) =>
  existsSync(join(root, ".codex-plugin", "plugin.json")) ? readJson(join(root, ".codex-plugin", "plugin.json")).version : null;
check(pluginVersion(marketplaceSource) === codexVersion, `codex_marketplace_source: plugin version ${pluginVersion(marketplaceSource)} is not the cached ${codexVersion}`);
if (codexVersion) check(pluginVersion(copies.codex_cache) === codexVersion, `codex_cache: plugin.json version ${pluginVersion(copies.codex_cache)}`);

for (const bundle of BUNDLES) {
  const binName = bundle === BUNDLES[0] ? "agenttool-collab-mcp" : "agenttool-collab-host";
  const link = join(globalBin, binName);
  const target = join(globalCopy, bundle);
  check(existsSync(link) && existsSync(target) && realpathSync(link) === realpathSync(target), `${link} does not resolve to ${target}`);
  check(existsSync(target) && (statSync(target).mode & 0o111) !== 0, `${target} is not executable`);
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${RPC_TIMEOUT_MS} ms`)), RPC_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function rpcSession(bundle: string, env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, bundle], { env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let nextId = 1;
  const close = async () => { child.kill(); await child.exited; };
  const exchange = async (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    await child.stdin.flush();
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id !== id) continue;
        if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
        return message.result;
      }
      const next = await reader.read();
      if (next.done) throw new Error(`${bundle} closed before replying to ${method}`);
      buffered += decoder.decode(next.value, { stream: true });
    }
  };
  const request = (method: string, params: Record<string, unknown>) =>
    withTimeout(exchange(method, params), `${bundle} ${method}`);
  try {
    const init = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "household-install-check", version: "0.0.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    await child.stdin.flush();
    return { init, request, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function throwawayEnv(scratch: string): Record<string, string> {
  mkdirSync(join(scratch, "data"), { recursive: true });
  return {
    AGENTOOL_COLLAB_DB: join(scratch, "data", "collab.sqlite"),
    HOME: scratch,
    XDG_DATA_HOME: join(scratch, "data"),
    PATH: process.env.PATH ?? "",
    TMPDIR: tmpdir(),
  };
}

const tools: Record<string, { count: number; server_version: string; names_sha256: string }> = {};
for (const [label, root] of Object.entries(copies)) {
  const bundle = join(root, BUNDLES[0]);
  if (!existsSync(bundle)) continue;
  const scratch = mkdtempSync(join(tmpdir(), "collab-household-tools-"));
  try {
    const session = await rpcSession(bundle, throwawayEnv(scratch));
    let listed: any;
    try {
      listed = await session.request("tools/list", {});
    } finally {
      await session.close();
    }
    const names = (listed.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
    tools[label] = {
      count: names.length,
      server_version: session.init.serverInfo?.version,
      names_sha256: createHash("sha256").update(names.join("\n")).digest("hex"),
    };
    check(names.length === EXPECTED_TOOLS, `${label}: ${names.length} tools, expected ${EXPECTED_TOOLS}`);
    check(session.init.serverInfo?.version === expectedVersion, `${label}: serverInfo.version ${session.init.serverInfo?.version}`);
  } catch (error) {
    failures.push(`${label}: MCP probe failed: ${errorText(error)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
const toolHashes = new Set(Object.values(tools).map((entry) => entry.names_sha256));
check(toolHashes.size === 1, `tool name sets differ across copies: ${JSON.stringify(tools)}`);

let hostReceipt: Record<string, unknown> | null = null;
const hostCli = join(globalBin, "agenttool-collab-host");
if (existsSync(hostCli) && existsSync(join(globalCopy, BUNDLES[0]))) {
  const scratch = mkdtempSync(join(tmpdir(), "collab-household-host-"));
  try {
    const env = throwawayEnv(scratch);
    const repo = join(scratch, "repo");
    mkdirSync(repo);
    const session = await rpcSession(join(globalCopy, BUNDLES[0]), env);
    let started: any;
    try {
      started = await session.request("tools/call", {
        name: "collab_session_start",
        arguments: { root_path: repo, actor: "household-install-check" },
      });
    } finally {
      await session.close();
    }
    const sessionId: string = started.structuredContent.session.id;
    const sessionFile = join(scratch, "data", "collab-sessions", `${sessionId}.json`);
    const token: string = readJson(sessionFile).session_token;
    const run = spawnSync(hostCli, [
      "end", "--session-file", sessionFile, "--reason", "household install check",
      "--release-leases", "--db", env.AGENTOOL_COLLAB_DB,
    ], { env, encoding: "utf8", timeout: RPC_TIMEOUT_MS });
    check(!run.stdout.includes(token) && !run.stderr.includes(token), "host CLI output contains the session token");
    const lines = run.stdout.trim().split("\n");
    check(run.status === 0 && lines.length === 1, `host CLI exited ${run.status} with ${lines.length} stdout lines`);
    hostReceipt = JSON.parse(lines[0] || "{}");
    check(hostReceipt?.protocol === "agenttool.collab-host/1", `host receipt protocol ${String(hostReceipt?.protocol)}`);
    check(hostReceipt?.status === "ended", `host receipt status ${String(hostReceipt?.status)}`);
    check(hostReceipt?.session_id === sessionId, "host receipt names another session");
    check(!existsSync(sessionFile), "host CLI left the credential file behind");
  } catch (error) {
    failures.push(`host CLI smoke failed: ${errorText(error)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
} else {
  failures.push(`${hostCli} is not installed`);
}

// The sol job PATH (jobs.environment(), what the exit sweep runs with) must
// resolve the host CLI to this install and run it, shebang `bun` included.
let jobPath: { host: string | null; bun: string | null; usage_error: boolean } | null = null;
try {
  const probe = spawnSync("python3", [
    "-I", "-B", "-c",
    "import json, sys; sys.path.insert(0, sys.argv[1]); import jobs; print(json.dumps(jobs.environment()))",
    solAgents,
  ], { encoding: "utf8", timeout: RPC_TIMEOUT_MS });
  if (probe.status !== 0) throw new Error(`jobs.environment() exited ${probe.status}`);
  const jobEnv = JSON.parse(probe.stdout) as Record<string, string>;
  const which = (name: string) => {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${name}`], { env: jobEnv, encoding: "utf8" });
    return found.status === 0 ? found.stdout.trim() : null;
  };
  jobPath = { host: which("agenttool-collab-host"), bun: which("bun"), usage_error: false };
  check(jobPath.host === hostCli, `job PATH resolves agenttool-collab-host to ${jobPath.host}, expected ${hostCli}`);
  check(jobPath.bun !== null, "job PATH has no bun");
  if (jobPath.host) {
    const usage = spawnSync(jobPath.host, ["end"], { env: jobEnv, encoding: "utf8", timeout: RPC_TIMEOUT_MS });
    const receipt = JSON.parse(usage.stdout.trim().split("\n")[0] || "{}");
    jobPath.usage_error = usage.status === 1 && receipt.protocol === "agenttool.collab-host/1" && receipt.error === "usage_error";
    check(jobPath.usage_error, `host CLI under the job environment exited ${usage.status} without a usage_error receipt`);
  }
} catch (error) {
  failures.push(`job PATH probe failed: ${errorText(error)}`);
}

// Read-only: the household journal keeps schema 3 (this branch adds no DDL).
let journalSchema: string | null = null;
if (existsSync(householdJournal)) {
  const pragma = spawnSync("sqlite3", ["-readonly", householdJournal, "PRAGMA user_version;"], {
    encoding: "utf8",
    timeout: RPC_TIMEOUT_MS,
  });
  journalSchema = pragma.status === 0 ? pragma.stdout.trim() : null;
}
check(journalSchema === EXPECTED_SCHEMA, `household journal user_version ${journalSchema}, expected ${EXPECTED_SCHEMA}`);

const listing = spawnSync("codex", ["plugin", "list", "--json"], { encoding: "utf8", timeout: 60_000 });
let codexRegistration: Record<string, unknown> | null = null;
try {
  codexRegistration = (JSON.parse(listing.stdout).installed as Array<Record<string, any>>)
    .find((plugin) => plugin.pluginId === "agenttool-collab@personal") ?? null;
} catch {
  failures.push(`codex plugin list --json exited ${listing.status}`);
}
check(codexRegistration?.installed === true && codexRegistration?.enabled === true, "agenttool-collab@personal is not installed and enabled");
check(codexRegistration?.version === codexVersion, `codex reports ${String(codexRegistration?.version)}, cache holds ${codexVersion}`);

console.log(JSON.stringify({
  ok: failures.length === 0,
  expected_version: expectedVersion,
  codex_cache_versions: codexVersions,
  digests,
  tools,
  host_receipt_status: hostReceipt?.status ?? null,
  job_path: jobPath,
  journal_user_version: journalSchema,
  codex_registration: codexRegistration ? { version: codexRegistration.version, enabled: codexRegistration.enabled } : null,
  failures,
}, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun ~/.cache/agenttool/collab-household/household-install-check.ts; echo "exit=$?"
```

Expected: `exit=1` and `"ok": false`, with `"journal_user_version": "3"`. The failures include the following lines, verified on today's household (the worktree's own `dist/agenttool-collab-host.js` exists once Task 8 is in):
```
"no 0.5.0+codex.* directory under /Users/yuai/.codex/plugins/cache/personal/agenttool-collab (found: 0.3.1+codex.20260731095048)"
"npm_global: dist/agenttool-collab-mcp.js differs from the worktree build"
"npm_global: package.json version 0.3.1, expected 0.5.0"
"npm_global: 31 tools, expected 33"
"codex_marketplace_source: 31 tools, expected 33"
"/opt/homebrew/bin/agenttool-collab-host is not installed"
"job PATH resolves agenttool-collab-host to null, expected /opt/homebrew/bin/agenttool-collab-host"
"codex reports 0.3.1+codex.20260731095048, cache holds undefined"
```
The positive paths were exercised in a scratch layout: fake global, marketplace and cache copies of a 33-tool bundle, a fake host CLI built on `CollabStore`, and a fake `jobs.environment()`. There every check passed (`host_receipt_status: "ended"`, `job_path.usage_error: true`) except the real Codex registration.

- [ ] **Step 3: Write minimal implementation**

**3a. Pinned build and full suite in the worktree.** Bun 1.3.5 is `bundlerBunVersion`. The ambient Bun is 1.3.13, on which `check:mcp-bundle` only prints "skipped".

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
ROOT="$HOME/.cache/agenttool/collab-household"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BK="$ROOT/$STAMP"
mkdir -p -m 700 "$ROOT" "$BK"
printf '%s\n' "$BK" > "$ROOT/current"
test "$(git -C "$W" branch --show-current)" = "feat/collab-household-smoothing-20261008"
test -z "$(git -C "$W" status --porcelain)"
git -C "$W" log --oneline origin/main..HEAD
cd "$W/packages/collab"
test "$(jq -r .bundlerBunVersion package.json)" = "1.3.5"
test "$(npx --yes bun@1.3.5 --version)" = "1.3.5"
bun install --frozen-lockfile
npx --yes bun@1.3.5 run build:mcp
git -C "$W" status --porcelain -- packages/collab
```

Expected: the last command prints nothing, which means the committed bundles equal the pinned rebuild. If it lists `packages/collab/dist/agenttool-collab-mcp.js` or `packages/collab/dist/agenttool-collab-host.js`, an earlier task committed a bundle from another Bun or edited `src/`/`bin/` after Task 8. Commit exactly those files, then rerun 3a from the top with a fresh stamp:

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
git add packages/collab/dist/agenttool-collab-mcp.js packages/collab/dist/agenttool-collab-host.js
git commit -F - <<'EOF'
build(collab): rebuild bundles on pinned Bun 1.3.5

The household install packs these bytes, and check:mcp-bundle skips on any
other Bun, so the committed bundles must come from the pinned bundler.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```

Then run every suite on the pinned Bun:

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
cd "$W/packages/collab"
npx --yes bun@1.3.5 run ci > "$BK/collab-ci.log" 2>&1 || { tail -40 "$BK/collab-ci.log"; exit 1; }
tail -6 "$BK/collab-ci.log"
if grep -q "check:mcp-bundle: skipped" "$BK/collab-ci.log"; then echo "bundle byte check was skipped"; exit 1; fi
(cd "$W/packages/collab-courier" && bun install --frozen-lockfile && npx --yes bun@1.3.5 run ci)
(cd "$W/packages/collab-zerone" && bun install --frozen-lockfile && npx --yes bun@1.3.5 run ci)
(cd "$W/packages/skills" && bun install --frozen-lockfile && bun test tests/manifests.test.ts)
(cd "$W" && bun test bin/tests/npm-release.test.ts)
agenttool-skill validate . | jq -e '.valid'
claude plugin validate .
git -C "$W" status --porcelain
```

Expected:
- Collab `ci` (typecheck, the full suite, then `check:mcp-bundle` for both bundles) ends `0 fail`, and the bundle check prints no "skipped" line.
- `collab-courier` and `collab-zerone`: each `0 fail`. Both import `../../collab/src/store.js`, and courier spawns `collab/bin/agenttool-collab-mcp.ts`, so they guard the shared store.
- Skills manifests: `0 fail`.
- `bin/tests/npm-release.test.ts`: `0 fail`. Task 8 added `package/dist/agenttool-collab-host.js` to the required archive entries.
- `agenttool-skill validate` prints `true`, and `claude plugin validate` prints `✔ Validation passed`.
- The final `git status` prints nothing. The `node_modules` trees are ignored.

**3b. Pack the exact bytes.** Never pack without `--ignore-scripts`: `prepack` would rebuild with whatever Bun is first on PATH.

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing/packages/collab
npm pack --ignore-scripts --pack-destination "$BK"
mkdir "$BK/unpack-0.5.0"
tar -xzf "$BK/agenttool-collab-0.5.0.tgz" -C "$BK/unpack-0.5.0"
tar -tzf "$BK/agenttool-collab-0.5.0.tgz" | grep -E '^package/(dist|bin)/' | sort
cmp dist/agenttool-collab-mcp.js "$BK/unpack-0.5.0/package/dist/agenttool-collab-mcp.js"
cmp dist/agenttool-collab-host.js "$BK/unpack-0.5.0/package/dist/agenttool-collab-host.js"
```

Expected list: `package/bin/agenttool-collab-host.ts`, `package/bin/agenttool-collab-mcp.ts`, `package/dist/agenttool-collab-host.js`, `package/dist/agenttool-collab-mcp.js`. Both `cmp` commands print nothing.

**3c. Back up both copies, the marketplace source, the Codex config and a read-only journal snapshot.** This must finish before anything is replaced.

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
JOURNAL="$HOME/.local/share/agenttool/collab.sqlite"
cp -Rp /opt/homebrew/lib/node_modules/@agenttool/collab "$BK/npm-global-collab"
ls -l /opt/homebrew/bin/agenttool-collab-mcp > "$BK/npm-global-bin-links.txt"
cp -Rp "$HOME/plugins/agenttool-collab" "$BK/codex-marketplace-source"
cp -Rp "$HOME/.codex/plugins/cache/personal/agenttool-collab" "$BK/codex-cache"
cp -p "$HOME/.codex/config.toml" "$BK/codex-config.toml"
{ grep -c 'agenttool-collab@personal".mcp_servers.agenttool-collab.tools.' "$HOME/.codex/config.toml" || true; } > "$BK/codex-tool-approvals.count"
codex plugin list --json | jq '.installed[] | select(.pluginId == "agenttool-collab@personal")' > "$BK/codex-registration-before.json"
sqlite3 -readonly "$JOURNAL" "VACUUM INTO '$BK/collab-journal-before.sqlite'"
chmod 600 "$BK/collab-journal-before.sqlite"
sqlite3 -readonly "$BK/collab-journal-before.sqlite" "PRAGMA integrity_check; PRAGMA user_version;"
npm pack @agenttool/collab@0.3.1 --pack-destination "$BK" --registry=https://registry.npmjs.org --userconfig=/dev/null
mkdir "$BK/registry-0.3.1"
tar -xzf "$BK/agenttool-collab-0.3.1.tgz" -C "$BK/registry-0.3.1"
cmp "$BK/registry-0.3.1/package/dist/agenttool-collab-mcp.js" /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js
shasum -a 256 /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js \
  "$HOME/plugins/agenttool-collab/dist/agenttool-collab-mcp.js" \
  "$HOME/.codex/plugins/cache/personal/agenttool-collab/0.3.1+codex.20260731095048/dist/agenttool-collab-mcp.js" | tee "$BK/before.sha256"
{ pgrep -fl agenttool-collab-mcp || true; } > "$BK/running-mcp-before.txt"
cat "$BK/codex-tool-approvals.count"
```

Expected:
- `ok` then `3`.
- The `cmp` prints nothing.
- All three hashes are `6f2676fddcefb97330d7df1f70ba3c8afac3f67d571747598cdaa9afea5c74f0`.
- The approvals count is `11`. Plan B Task 4, which adds five more, runs after this task.

Do not print `codex-config.toml`, because it can hold other servers' settings. Do not open the journal any other way: the only access is the read-only `VACUUM INTO` snapshot.

**3d. Install the global npm copy (Claude Code).**

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
test -s "$BK/npm-global-collab/dist/agenttool-collab-mcp.js"
npm install --global --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/dev/null "$BK/agenttool-collab-0.5.0.tgz"
readlink /opt/homebrew/bin/agenttool-collab-mcp /opt/homebrew/bin/agenttool-collab-host
```

Expected: `../lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js` and `../lib/node_modules/@agenttool/collab/dist/agenttool-collab-host.js`. Dependencies `@modelcontextprotocol/server@2.0.0-beta.5` and `zod` are fetched from the registry, as they were for 0.3.1. Running Claude Code MCP processes keep the 0.3.1 code they already loaded.

**3e. Install the Codex copy from the same unpacked tarball.** This is a clean replacement, not an overlay, so no 0.3.1 file lingers. Run it right after 3d, in the same sitting, so the two household copies never differ for longer than the install takes. If 3e fails, either finish it or roll back both copies (see Rollback).

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
SRC="$HOME/plugins/agenttool-collab"
test -s "$BK/codex-marketplace-source/dist/agenttool-collab-mcp.js"
test "$(jq -r '.plugins[] | select(.name == "agenttool-collab") | .source.path' "$HOME/.agents/plugins/marketplace.json")" = "./plugins/agenttool-collab"
rm -rf "$SRC"
mkdir -m 700 "$SRC"
cp -Rp "$BK/unpack-0.5.0/package/." "$SRC/"
CODEX_VERSION="0.5.0+codex.$(date -u +%Y%m%d%H%M%S)"
python3 - "$SRC/.codex-plugin/plugin.json" "$CODEX_VERSION" <<'EOF'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest["version"] = version
with open(path, "w", encoding="utf-8") as handle:
    handle.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
EOF
printf '%s\n' "$CODEX_VERSION" > "$BK/codex-version.txt"
agenttool-skill validate "$SRC" | jq -e '.valid'
codex plugin add agenttool-collab@personal --json
```

Expected: `true`, then a JSON result that names the installed plugin root `.../cache/personal/agenttool-collab/0.5.0+codex.<ts>`. Run from inside a Codex session, `codex plugin add` may report `Operation not permitted` while creating `plugin-install-*`. In that case rerun only that command outside the sandbox: it failed before writing anything, so the rerun is safe. After any other error, do not retry. Check the state first.

**3f. Keep Codex's per-tool approvals.**

```bash
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
before=$(cat "$BK/codex-tool-approvals.count")
after=$({ grep -c 'agenttool-collab@personal".mcp_servers.agenttool-collab.tools.' "$HOME/.codex/config.toml" || true; })
if cmp -s "$BK/codex-config.toml" "$HOME/.codex/config.toml"; then echo "config.toml unchanged"; else diff <(grep -n 'agenttool-collab' "$BK/codex-config.toml") <(grep -n 'agenttool-collab' "$HOME/.codex/config.toml"); fi
if [ "$after" -lt "$before" ]; then cp -p "$BK/codex-config.toml" "$HOME/.codex/config.toml"; echo "restored tool approvals from backup"; fi
echo "approvals before=$before after=$after"
```

Expected: `config.toml unchanged`, or a diff limited to `agenttool-collab` lines with `after >= before`.

- [ ] **Step 4: Run test to verify it passes**

```bash
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
bun ~/.cache/agenttool/collab-household/household-install-check.ts > "$BK/household-install-check.json"; rc=$?
jq '{ok, tools, digests, host_receipt_status, job_path, journal_user_version, codex_registration, failures}' "$BK/household-install-check.json"
echo "exit=$rc"
JOB_PATH=$(python3 -I -B -c 'import os, sys; sys.path.insert(0, os.path.expanduser("~/.config/sol/agents")); import jobs; print(jobs.environment()["PATH"])')
env -i HOME="$HOME" PATH="$JOB_PATH" /bin/sh -c 'command -v agenttool-collab-host && command -v bun'
sqlite3 -readonly "$HOME/.local/share/agenttool/collab.sqlite" 'PRAGMA user_version;'
{ pgrep -fl agenttool-collab-mcp || true; } | tee "$BK/running-mcp-after.txt"
```

Expected:
- `exit=0`, `"ok": true`, `"failures": []`.
- All four copies (`worktree`, `npm_global`, `codex_marketplace_source`, `codex_cache`) report identical sha256 for `dist/agenttool-collab-mcp.js` and for `dist/agenttool-collab-host.js`. Each reports `count: 33` and `server_version: "0.5.0"`, and all share one `names_sha256`.
- `host_receipt_status` is `"ended"`.
- `job_path` is `{"host": "/opt/homebrew/bin/agenttool-collab-host", "bun": "/Users/yuai/.bun/bin/bun", "usage_error": true}`.
- `journal_user_version` is `"3"`.
- `codex_registration.version` equals `$(cat "$BK/codex-version.txt")`.
- The explicit R8 probe prints `/opt/homebrew/bin/agenttool-collab-host` and `/Users/yuai/.bun/bin/bun`, then `3`. The journal schema is unchanged; this branch adds no DDL.

**Live hosts must restart to load 0.5.0 (R8).** Every process `pgrep` lists that started before the install still runs 0.3.1 code. On this Mac these are Codex's `bun dist/agenttool-collab-mcp.js`, whose cwd is the old cache dir, and Claude Code's `bun /opt/homebrew/bin/agenttool-collab-mcp`; the session executing this plan may be one of them. They share the schema-3 journal safely, but they lack the new inputs: `release_leases`, `review_requested_session_id`, review confidence, and the bound `after_sequence` refusal. Do not kill them. Tell Yu which sessions are on 0.3.1 and that restarting them is his call. Plan B's replay (B2) must run in freshly started hosts; its preflight checks for `serverInfo.version` 0.5.0 and the new inputs.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
git status --porcelain
git log --oneline origin/main..HEAD
```

Expected: `git status` prints nothing. Any pinned-rebuild commit was made in 3a, and the install writes only outside the repo. The log lists the Task 1–9 commits plus any `build(collab): rebuild bundles on pinned Bun 1.3.5` commit from 3a. The install receipt is `$BK/household-install-check.json`, and Step 7 quotes it in the PR body.

- [ ] **Step 6: Pre-PR freshness check (R9)**

Re-prove, right before review, that the committed bundles are what the pinned bundler builds from the committed source. Then check that `origin/main` has not moved under the collab package. The active `gh` account cannot see `cambridgetcg/agenttool` (`git ls-remote` returns "Repository not found"), so fetch with a one-off credential helper. It asks `gh` for the `cambridgetcg` token and hands it to git on stdin; nothing prints it. This was verified with a read-only `git ls-remote origin refs/heads/main`.

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
cd "$W/packages/collab"
npx --yes bun@1.3.5 run build:mcp && npx --yes bun@1.3.5 run check:mcp-bundle && git diff --exit-code -- dist
test -z "$(git status --porcelain -- dist)"
git ls-files -- dist
git -C "$W" -c credential.https://github.com.helper= \
  -c 'credential.https://github.com.helper=!f() { test "$1" = get || exit 0; echo username=x-access-token; printf "password=%s\n" "$(/opt/homebrew/bin/gh auth token --hostname github.com --user cambridgetcg)"; }; f' \
  fetch origin main
git -C "$W" rev-list --left-right --count origin/main...HEAD
if git -C "$W" diff --quiet HEAD...origin/main -- packages/collab bin/npm-release.ts bin/tests/npm-release.test.ts .gitignore .github; then echo "origin/main has not touched the collab paths since the branch point"; else echo "origin/main changed collab paths: stop, rebase with Yu, rerun Task 10 3a and this step"; exit 1; fi
```

Expected:
- `check:mcp-bundle` exits 0 without "skipped".
- `git diff --exit-code -- dist` exits 0. The path is relative to `packages/collab`; the repo-root form `packages/collab/dist` would match nothing there and pass silently.
- `git status` for `dist` prints nothing, and `git ls-files` lists `dist/agenttool-collab-host.js` and `dist/agenttool-collab-mcp.js`.
- The fetch succeeds, the count prints `0	<n>` when `origin/main` has not moved (any first number is fine as long as the collab-path check passes), and the last line prints "origin/main has not touched the collab paths since the branch point".

- [ ] **Step 7: Push and open a draft PR — requires Yu's explicit go at execution time**

Do not run this step on plan approval alone. Ask Yu at execution time, show him `git log --oneline origin/main..HEAD` and `$BK/pr-body.md`, and run it only after he says go in that conversation. Never push with a bare `git push`. This branch's upstream is `origin/main` (`branch.feat/collab-household-smoothing-20261008.merge = refs/heads/main`), so only the explicit refspec below is safe. Never use `--force`, and never push `main`.

Write the PR body (local only):

````bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
{
  cat <<'EOF'
## Summary

Collab household smoothing, from the first cross-harness trial (spec: `docs/superpowers/specs/2026-10-08-collab-household-smoothing-design.md`). It lands inside the unpublished 0.5.0 release candidate, with no schema change, no new MCP tool and no version bump. npm publication stays a separate step.

- Evidence refs: every `invalid_evidence_ref` and `evidence_not_found` names the four prefixes and returns `allowed_prefixes`. Tasks expose `base_checkpoint_digest` and `result_checkpoint_digest`.
- `collab_task_review` takes `confidence`, `confidence_basis` and `limits`.
- A late reviewer of an accepted task gets `task_not_pending_review` with `review_report_id`, `accepted_by_session_id` and a remedy.
- `collab_task_complete` takes an optional `review_requested_session_id`. It is a request, not a reservation, and an addressed `informs` report announces it.
- `collab_session_end` takes `release_leases` and `release_summary`. `session_has_active_leases` lists the leases.
- Bound `collab_next` refuses an `after_sequence` it used to ignore.
- Derived `liveness`, `assignee_liveness` and `recovery_required`. This is a view only: nothing expires.
- A new bin, `agenttool-collab-host end`, ends a session whose MCP process is gone.
- The skill, the Hermes skill, the Codex prompt and the README are restructured around the ordinary loop, with a relation-targeting table.

## Verification

- `npx --yes bun@1.3.5 run ci` passes in `packages/collab`, `collab-courier` and `collab-zerone` with 0 fail. `check:mcp-bundle` is byte-identical for both bundles on Bun 1.3.5.
- The build was installed into both household copies together (Homebrew global and Codex plugin cache). Install receipt:

```json
EOF
  jq '{tools, digests, host_receipt_status, job_path_usage_error: .job_path.usage_error, journal_user_version, codex_registration}' "$BK/household-install-check.json"
  cat <<'EOF'
```

Plan B (`~/.config/sol`, Codex config) and the headless duet replay follow outside this repository. The replay result will be added here as a comment.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
} > "$BK/pr-body.md"
cat "$BK/pr-body.md"
````

After Yu's go:

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-household-smoothing
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
sol access check github --json
git -C "$W" -c credential.https://github.com.helper= \
  -c 'credential.https://github.com.helper=!f() { test "$1" = get || exit 0; echo username=x-access-token; printf "password=%s\n" "$(/opt/homebrew/bin/gh auth token --hostname github.com --user cambridgetcg)"; }; f' \
  push origin HEAD:refs/heads/feat/collab-household-smoothing-20261008
sol access run github -- pr create --repo cambridgetcg/agenttool --draft --base main \
  --head feat/collab-household-smoothing-20261008 \
  --title "collab: household smoothing (requested reviewer, clean exit, host end CLI, ordinary-loop docs)" \
  --body-file "$BK/pr-body.md" | tee "$BK/pr-url.txt"
```

Expected: `sol access check` reports `cambridgetcg` ok. The push creates the remote branch, and `pr create` prints the draft PR URL, which is saved to `$BK/pr-url.txt` for B2 (R20). If the push or `pr create` fails ambiguously, do not retry. Check the remote state first: `git ls-remote` with the same helper, and `sol access run github -- pr list --repo cambridgetcg/agenttool --head feat/collab-household-smoothing-20261008`.

Rollback (only if Step 4 fails or Yu asks; it reverses both copies together):

```bash
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
npm install --global --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/dev/null "$BK/agenttool-collab-0.3.1.tgz"
if [ -L /opt/homebrew/bin/agenttool-collab-host ] && [ ! -e /opt/homebrew/bin/agenttool-collab-host ]; then rm /opt/homebrew/bin/agenttool-collab-host; fi
rm -rf "$HOME/plugins/agenttool-collab" && cp -Rp "$BK/codex-marketplace-source" "$HOME/plugins/agenttool-collab"
codex plugin add agenttool-collab@personal --json
after=$({ grep -c 'agenttool-collab@personal".mcp_servers.agenttool-collab.tools.' "$HOME/.codex/config.toml" || true; })
if [ "$after" -lt "$(cat "$BK/codex-tool-approvals.count")" ]; then cp -p "$BK/codex-config.toml" "$HOME/.codex/config.toml"; fi
shasum -a 256 -c "$BK/before.sha256"
```

Expected: the final command prints three `OK` lines. `codex plugin add` recreates the codex cache path `0.3.1+codex.20260731095048` from the restored source. Once the 0.3.1 copy is back, the sweep in Plan B finds no `agenttool-collab-host` and records `host_cli_not_found`. The journal snapshot `collab-journal-before.sqlite` is a record only: restoring it would discard later events, so that is Yu's decision and never part of rollback.


