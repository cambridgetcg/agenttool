import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { compareSnapshot, sampleSnapshot, type UsageSample } from "./delta.js";
import { CodexUsageReader, publicError } from "./reader.js";
import {
  usageDoctorReportSchema,
  usageSelfOutputSchema,
  usageSessionOutputSchema,
  usageSessionsOutputSchema,
  usageSnapshotWithDeltaSchema,
} from "./schemas.js";

const localReadOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const activeWindowSeconds = z.number().int().min(15).max(86_400).optional()
  .describe("Recent-activity window in seconds; recent means local state updated in this window, not proven process health");
const sessionLimit = z.number().int().min(0).max(200).optional();
const includeBreakdown = z.boolean().optional()
  .describe("Opt in to reading the latest numeric-only token_count event for returned sessions; defaults false and transcript text is never returned");
const sessionReference = z.string().regex(/^s_[a-f0-9]{12}$/)
  .describe("Hashed session_ref returned by another codex_usage tool");

export function buildCodexUsageMcpServer(reader = new CodexUsageReader()): McpServer {
  const previousByScope = new Map<string, UsageSample>();
  const server = new McpServer(
    { name: "agenttool-codex-usage", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Read-only, local-only Codex token usage inspection. Polls the latest committed local Codex numeric counters and returns hashed session references plus closed source kinds. It never returns prompts, replies, reasoning, transcript text, titles, cwd, rollout paths, Git metadata, model names, free-form agent labels, credentials, account identity, prices, billing attribution, or a guarantee that a recent session is still running. Cumulative tokens are observed processing counters, not invoices, credits, remaining quota, or a universal latency guarantee.",
    },
  );

  server.registerTool(
    "codex_usage_snapshot",
    {
      title: "Inspect the live local Codex token pulse",
      description:
        "Return fleet totals plus the most recently updated sessions. Repeated calls with the same scope include a process-local delta; counter resets/source changes are explicitly uncomparable, and polling does not guarantee zero latency.",
      annotations: localReadOnly,
      inputSchema: z.object({
        active_window_seconds: activeWindowSeconds,
        session_limit: sessionLimit,
        include_breakdown: includeBreakdown,
      }).strict(),
      outputSchema: usageSnapshotWithDeltaSchema,
    },
    async ({ active_window_seconds, session_limit, include_breakdown }) => call(() => {
      const snapshot = reader.snapshot({
        ...(active_window_seconds === undefined ? {} : { activeWindowSeconds: active_window_seconds }),
        ...(session_limit === undefined ? {} : { sessionLimit: session_limit }),
        ...(include_breakdown === undefined ? {} : { includeBreakdown: include_breakdown }),
      });
      const key = snapshotScopeKey(snapshot.scope.active_window_seconds, snapshot.scope.returned_session_limit, include_breakdown ?? false);
      const previous = previousByScope.get(key) ?? null;
      const result = {
        ...snapshot,
        delta_since_previous_sample: previous ? compareSnapshot(snapshot, previous) : null,
      };
      rememberSample(previousByScope, key, sampleSnapshot(snapshot));
      return result;
    }),
  );

  server.registerTool(
    "codex_usage_sessions",
    {
      title: "List local Codex sessions by token use",
      description:
        "Return hashed, privacy-filtered session records. By default only self/recent sessions are returned; include_inactive can inspect older rows without returning transcript content.",
      annotations: localReadOnly,
      inputSchema: z.object({
        active_window_seconds: activeWindowSeconds,
        session_limit: sessionLimit,
        include_breakdown: includeBreakdown,
        include_inactive: z.boolean().optional(),
      }).strict(),
      outputSchema: usageSessionsOutputSchema,
    },
    async ({ active_window_seconds, session_limit, include_breakdown, include_inactive }) => call(() => {
      const snapshot = reader.snapshot({
        ...(active_window_seconds === undefined ? {} : { activeWindowSeconds: active_window_seconds }),
        ...(session_limit === undefined ? {} : { sessionLimit: session_limit }),
        ...(include_breakdown === undefined ? {} : { includeBreakdown: include_breakdown }),
        ...(include_inactive === undefined ? {} : { includeInactive: include_inactive }),
      });
      return {
        schema: snapshot.schema,
        observed_at: snapshot.observed_at,
        scope: snapshot.scope,
        sessions: snapshot.sessions,
        data_boundary: snapshot.data_boundary,
        limitations: snapshot.limitations,
      };
    }),
  );

  server.registerTool(
    "codex_usage_session",
    {
      title: "Inspect one hashed Codex session",
      description:
        "Return one privacy-filtered session by the hashed reference from another usage result. A missing row is explicit and does not expose raw IDs or paths.",
      annotations: localReadOnly,
      inputSchema: z.object({
        session_ref: sessionReference,
        include_breakdown: includeBreakdown,
      }).strict(),
      outputSchema: usageSessionOutputSchema,
    },
    async ({ session_ref, include_breakdown }) => call(() => ({
      session_ref,
      session: reader.sessionByRef(session_ref, {
        ...(include_breakdown === undefined ? {} : { includeBreakdown: include_breakdown }),
      }),
    })),
  );

  server.registerTool(
    "codex_usage_self",
    {
      title: "Inspect this Codex session's usage",
      description:
        "Match the MCP process's inherited CODEX_THREAD_ID to local state, returning only its hashed reference and privacy-filtered counters. Null means this host did not provide a detectable current thread.",
      annotations: localReadOnly,
      inputSchema: z.object({ include_breakdown: includeBreakdown }).strict(),
      outputSchema: usageSelfOutputSchema,
    },
    async ({ include_breakdown }) => call(() => ({
      session: reader.self({
        ...(include_breakdown === undefined ? {} : { includeBreakdown: include_breakdown }),
      }),
      identity_boundary:
        "CODEX_THREAD_ID is only a local matching hint; it is not identity, authentication, ownership, permission, consciousness, or proof of a running process.",
    })),
  );

  server.registerTool(
    "codex_usage_doctor",
    {
      title: "Check the local Codex usage source",
      description:
        "Inspect only database presence, required schema columns, row count, and boundary flags. It performs no network call and returns no transcript content.",
      annotations: localReadOnly,
      inputSchema: z.object({}).strict(),
      outputSchema: usageDoctorReportSchema,
    },
    async () => call(() => reader.doctor()),
  );

  return server;
}

function snapshotScopeKey(activeWindow: number, limit: number, breakdown: boolean): string {
  return `${activeWindow}:${limit}:${breakdown ? "breakdown" : "counters"}`;
}

function rememberSample(samples: Map<string, UsageSample>, key: string, value: UsageSample): void {
  samples.delete(key);
  samples.set(key, value);
  if (samples.size <= 32) return;
  const oldest = samples.keys().next().value;
  if (oldest !== undefined) samples.delete(oldest);
}

function success(payload: unknown) {
  const structured = isRecord(payload) ? payload : { result: payload };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

function failure(error: unknown) {
  const detail = publicError(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: detail }, null, 2) }],
    structuredContent: { error: detail },
  };
}

async function call<T>(operation: () => T | Promise<T>) {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
