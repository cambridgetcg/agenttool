/**
 * Module-level ambient context for Tier 3 sugar (`at.deciding(...)`).
 *
 * Mirrors `_context.py` — see that file's docstring for the rationale.
 * Two callers (client.ts for the deciding wrapper, anthropic-adapter.ts
 * for the trace POST) need to read/write the same async-task-local
 * value; AsyncLocalStorage is the native primitive.
 *
 * Runtimes: Node (>= 13.10), Bun, Deno, Cloudflare Workers, Vercel
 * Edge. All ship `node:async_hooks` or its equivalent.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface AmbientContext {
  /** trace_id of the parent trace opened by the most-recent
   *  `at.deciding(...)` (or null if the parent post failed). */
  parent_trace_id: string | null;
  /** Tags inherited by every auto-trace in this scope. Merged
   *  (union) with explicit tags on the call. */
  tags: string[];
}

/** The ambient store. Exported for tests; the typical surface is
 *  `getAmbient()` and `ambientStorage.run(...)`. */
export const ambientStorage = new AsyncLocalStorage<AmbientContext>();

/** Return the active ambient context, or `undefined` when not
 *  inside a `deciding()` block. */
export function getAmbient(): AmbientContext | undefined {
  return ambientStorage.getStore();
}
