import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runGoldenScenario } from "./golden-scenario.js";

/**
 * Runs one build's store (an older revision's `git archive`d source, or this
 * tree's) in its own process, so old and new code never share a module graph.
 * It never imports this tree's src: everything it needs comes from <src>.
 *
 *   inspect <src> <db> <request.json>   read, page, ack and write as that build
 *   golden  <src> <db> <root>           run the golden scenario through that build's MCP tools
 *   verify  <src> <db>                  open and verify every workspace
 *
 * It prints one JSON object. A failed check is reported in `errors` by name;
 * the process exits non-zero only when it cannot report at all.
 */

interface InspectRequest {
  workspace_id: string;
  root_path: string;
  /** Event types this build has never seen; none may address any session. */
  new_types: string[];
  /** The instant at which proposal views are read, shared with the new build. */
  status_at: string;
  proposals: string[];
  waiter: { session_id: string; after_sequence: number; addressed_report_id: string };
  /** A task the newer build's collab_done finished, waiting for review. */
  review_task_id: string;
}

const [mode, sourceDirectory, databasePath, extra] = Bun.argv.slice(2);
if (!mode || !sourceDirectory || !databasePath) {
  throw new Error("old-store-worker requires a mode, a source directory and a journal path");
}

const errors: Record<string, string> = {};
let fixedNow: number | null = null;
const now = () => (fixedNow === null ? new Date() : new Date(fixedNow));

async function load(file: string): Promise<any> {
  return await import(pathToFileURL(join(sourceDirectory!, file)).href);
}

/** That build's CollabStore: from store-notes.ts where the build has one, else from store.ts, as older revisions keep it. */
async function loadStore(): Promise<any> {
  return await load(existsSync(join(sourceDirectory!, "store-notes.ts")) ? "store-notes.ts" : "store.ts");
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return `${error.code}: ${(error as unknown as Error).message}`;
  }
  return error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
}

function check<T>(name: string, operation: () => T): T | null {
  try {
    return operation();
  } catch (error) {
    errors[name] = describeError(error);
    return null;
  }
}

function workspaceIds(store: any): string[] {
  return (store.db.query(`SELECT id FROM workspaces ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id);
}

function verifyAll(store: any): Record<string, boolean> {
  const verified: Record<string, boolean> = {};
  for (const id of workspaceIds(store)) verified[id] = store.verifyJournal(id) === true;
  return verified;
}

function allEvents(store: any, workspaceId: string): any[] {
  const events: any[] = [];
  let after = 0;
  while (true) {
    const page = store.eventsSince(workspaceId, after, 100);
    events.push(...page.events);
    if (!page.has_more || page.events.length === 0) return events;
    after = page.events[page.events.length - 1].sequence;
  }
}

function allReports(store: any, workspaceId: string): Array<{ id: string; body: string; event_sequence: number }> {
  const reports: Array<{ id: string; body: string; event_sequence: number }> = [];
  let after = 0;
  while (true) {
    const page = store.listReports(workspaceId, { after_event_sequence: after, limit: 100 }) as any[];
    for (const report of page) reports.push({ id: report.id, body: report.body, event_sequence: report.event_sequence });
    if (page.length < 100) return reports;
    after = page[page.length - 1].event_sequence;
  }
}

async function inspect(request: InspectRequest): Promise<Record<string, unknown>> {
  const { CollabStore } = await loadStore();
  const store = check("open", () => new CollabStore(databasePath!, { now }));
  if (!store) return {};
  try {
    const capabilities = {
      event_addresses_session: typeof store.eventAddressesSession === "function",
      proposal_status: typeof store.proposalStatus === "function",
    };
    const verified = check("verify", () => verifyAll(store));
    const reports = check("list_reports", () => allReports(store, request.workspace_id));

    fixedNow = Date.parse(request.status_at);
    const proposals = capabilities.proposal_status
      ? check("proposal_status", () => request.proposals.map((id) => store.proposalStatus(request.workspace_id, id)))
      : null;
    fixedNow = null;

    const events = check("events", () => allEvents(store, request.workspace_id)) ?? [];
    let addressing: Record<string, unknown> | null = null;
    if (capabilities.event_addresses_session) {
      addressing = check("event_addresses_session", () => {
        const sessions = (store.db.query(`SELECT id FROM coordination_sessions`).all() as Array<{ id: string }>)
          .map((row) => row.id);
        const newTypeHits: Array<{ sequence: number; type: string; session_id: string }> = [];
        for (const event of events) {
          if (!request.new_types.includes(event.type)) continue;
          for (const sessionId of sessions) {
            if (store.eventAddressesSession(event, sessionId)) {
              newTypeHits.push({ sequence: event.sequence, type: event.type, session_id: sessionId });
            }
          }
        }
        const control = events.find((event) =>
          event.type === "report.posted" && event.entity_id === request.waiter.addressed_report_id);
        return {
          new_type_hits: newTypeHits,
          control_addressed: control ? store.eventAddressesSession(control, request.waiter.session_id) : null,
          waiter_sequences: events
            .filter((event) =>
              event.sequence > request.waiter.after_sequence
              && event.session_id !== request.waiter.session_id
              && store.eventAddressesSession(event, request.waiter.session_id))
            .map((event) => event.sequence),
        };
      });
    }

    // From here this build writes, as it would on a device that has not upgraded.
    const implementer = check("start_session", () => store.startSession({
      root_path: request.root_path,
      actor: "old-build-implementer",
      role: "an older build working in a journal a newer build wrote",
    }));
    let paging: Record<string, unknown> | null = null;
    if (implementer) {
      paging = check("page_and_ack", () => {
        const types = new Set<string>();
        let pages = 0;
        let chainValid = true;
        let seen = 0;
        let cursor = implementer.session.cursor;
        let head = 0;
        while (pages < 1_000) {
          const next = store.nextForSession({ ...implementer.credential, event_limit: 10 });
          pages += 1;
          chainValid &&= next.events.chain_valid === true;
          head = next.events.head_sequence;
          for (const event of next.events.events) types.add(event.type);
          seen += next.events.events.length;
          const acknowledged = store.acknowledgeSessionCursor({
            ...implementer.credential,
            anchor: next.events.next_anchor,
            expected_cursor_version: next.session.cursor_version,
          });
          cursor = acknowledged.cursor;
          if (!next.events.has_more) break;
        }
        return { types: [...types].sort(), pages, chain_valid: chainValid, events_seen: seen, cursor, head_sequence: head };
      });
    }

    let task: Record<string, unknown> | null = null;
    let reviewedNew: Record<string, unknown> | null = null;
    const written: Array<{ id: string; body: string }> = [];
    const reviewer = check("start_reviewer", () => store.startSession({
      root_path: request.root_path,
      actor: "old-build-reviewer",
      role: "reviews the older build's task",
    }));
    if (implementer && reviewer) {
      task = check("task_lifecycle", () => {
        const created = store.createTaskForSession({
          ...implementer.credential,
          idempotency_key: "old-build-create",
          title: "Old build task",
          work_mode: "edit",
          completion_policy: "accepted",
          path_scopes: ["compat/old-build.txt"],
        });
        const claimed = store.claimTaskForSession({
          ...implementer.credential,
          idempotency_key: "old-build-claim",
          task_id: created.id,
          expected_version: created.version,
        });
        const reported = store.completeTaskForSession({
          ...implementer.credential,
          idempotency_key: "old-build-complete",
          task_id: claimed.id,
          lease_id: claimed.lease_id,
          expected_version: claimed.version,
          summary: "Done by an older build.",
        });
        const reviewed = store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "old-build-review",
          task_id: reported.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "Accepted by an older build.",
        });
        written.push({ id: reviewed.report.id, body: reviewed.report.body });
        return {
          task_id: reviewed.task.id,
          status: reviewed.task.status,
          review_status: reviewed.task.review_status ?? null,
        };
      });
      // The newer surface's completion is an ordinary completion to this build.
      check("review_new_surface_task", () => {
        const pending = store.getTask(request.workspace_id, request.review_task_id);
        const reviewed = store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "old-build-review-new-surface",
          task_id: pending.id,
          expected_version: pending.version,
          outcome: "accept",
          summary: "An older build accepted work the notes surface finished.",
        });
        written.push({ id: reviewed.report.id, body: reviewed.report.body });
        reviewedNew = { task_id: reviewed.task.id, status: reviewed.task.status, review_status: reviewed.task.review_status ?? null };
      });
      check("append_report", () => {
        const report = store.appendReportForSession({
          ...implementer.credential,
          idempotency_key: "old-build-report",
          kind: "observation",
          body: "Written by an older build.\nSecond line, 第二行.",
        });
        written.push({ id: report.id, body: report.body });
      });
    }
    return { capabilities, verified, reports, proposals, addressing, paging, task, reviewed_new: reviewedNew, written };
  } finally {
    store.close();
  }
}

async function golden(root: string): Promise<Record<string, unknown>> {
  const [{ CollabStore }, { buildCollabMcpServer }] = await Promise.all([loadStore(), load("mcp.ts")]);
  const result = await runGoldenScenario({ CollabStore, buildCollabMcpServer }, { databasePath: databasePath!, root });
  return { ...result };
}

async function verify(): Promise<Record<string, unknown>> {
  const { CollabStore } = await loadStore();
  const store = check("open", () => new CollabStore(databasePath!));
  if (!store) return {};
  try {
    return { verified: check("verify", () => verifyAll(store)) };
  } finally {
    store.close();
  }
}

let output: Record<string, unknown> = {};
try {
  if (mode === "inspect" && extra) {
    output = await inspect(JSON.parse(readFileSync(extra, "utf8")) as InspectRequest);
  } else if (mode === "golden" && extra) {
    output = await golden(extra);
  } else if (mode === "verify") {
    output = await verify();
  } else {
    throw new Error(`unknown worker mode: ${mode}`);
  }
} catch (error) {
  errors.worker = describeError(error);
}
process.stdout.write(JSON.stringify({ ...output, errors }));
