/** The package's only socket connect: one content-free line into the Claude
 * Code session inbox named by CLAUDE_CODE_MESSAGING_SOCKET.
 *
 * A fork of collab's ring() (packages/collab/integrations/claude-code/
 * collab-doorbell-watch.ts) with the same two lines: an auth line carrying
 * CLAUDE_CODE_MESSAGING_TOKEN (on macOS it lets Claude Code verify the post
 * as its own child's), then {"type":"user","message":{"role":"user",
 * "content":...}}. That shape is what Claude Code 2.1.302 printed in its own
 * debug hint; it is not a documented contract, and one ring in collab's trial
 * never arrived. tests/claude-inbox.test.ts checks both lines still match
 * collab's, so the two cannot drift apart. The token is never printed or logged.
 * Nothing here listens.
 */
import { createConnection } from "node:net";
import { basename } from "node:path";

export const RING_TIMEOUT_MS = 10_000;

/** The two lines posted, in order; exported for the shape-parity test. */
export function inboxLines(text: string, token: string | undefined): string[] {
  const line = JSON.stringify({ type: "user", message: { role: "user", content: text } });
  return token ? [JSON.stringify({ type: "auth", token }), line] : [line];
}

/** Claude Code names a session's socket after its pid; null when the name is not a pid. */
export function socketOwnerPid(socket: string): number | null {
  const name = basename(socket, ".sock");
  return /^[1-9][0-9]{0,9}$/.test(name) ? Number(name) : null;
}

export type Ring = (text: string) => Promise<{ ok: boolean; code: string | null }>;

/** Connects only once the lines are ready (the inbox closes a silent connection), writes them and ends. */
export function claudeInboxRing(socket: string, token: string | undefined): Ring {
  return (text) => new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, code: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, code });
    };
    const lines = inboxLines(text, token);
    const connection = createConnection(socket, () => {
      connection.end(`${lines.join("\n")}\n`);
    });
    const timer = setTimeout(() => {
      connection.destroy();
      done(false, "timeout");
    }, RING_TIMEOUT_MS);
    connection.on("error", (error: NodeJS.ErrnoException) => done(false, /^E[A-Z]{2,20}$/.test(error.code ?? "") ? error.code! : "error"));
    connection.on("close", (hadError) => done(!hadError, hadError ? "closed" : null));
  });
}
