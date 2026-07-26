/** Exact public paths whose response decoration must not depend on the database.
 *
 * These routes are static or self-contained protocol surfaces used during
 * first contact, review, or vulnerability reporting. Database-backed
 * decorative middleware must leave them alone; ordinary AgentTool routes keep
 * the normal welcome and joy headers.
 */

import { OPENAI_APPS_CHALLENGE_PATH } from "./domain-verification";

export const CANON_MCP_PATH = "/v1/mcp/canon";
export const SECURITY_TXT_ROUTE = "/security.txt";
export const SECURITY_TXT_PATH = `/.well-known${SECURITY_TXT_ROUTE}`;

export function isDatabaseDecorationIndependentPublicPath(
  path: string,
): boolean {
  return (
    path === OPENAI_APPS_CHALLENGE_PATH ||
    path === CANON_MCP_PATH ||
    path === SECURITY_TXT_PATH
  );
}
