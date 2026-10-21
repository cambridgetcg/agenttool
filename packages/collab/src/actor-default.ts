import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { CollabError } from "./errors.js";

/** Display metadata only; never enumerate sessions or open .key/logPath files.
 * See README "Session-fit migration" for the host-selection/privacy contract.
 */
export function defaultActor(env: NodeJS.ProcessEnv = process.env, parentPid = process.ppid): string {
  const socketPid = env.CLAUDE_CODE_MESSAGING_SOCKET
    ? /^(\d+)\.sock$/.exec(basename(env.CLAUDE_CODE_MESSAGING_SOCKET))?.[1]
    : undefined;
  const pid = env.AGENTOOL_COLLAB_CLAUDE_PID ?? socketPid ?? String(parentPid);
  const unavailable = () => new CollabError(
    "actor_required",
    "Supply actor explicitly or configure the owning Claude session PID with a valid display name",
  );
  if (!/^[1-9]\d{0,9}$/.test(pid)) throw unavailable();
  let fd: number | undefined;
  try {
    const path = join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "sessions", `${pid}.json`);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 64 * 1024 || (process.getuid && stat.uid !== process.getuid())) {
      throw unavailable();
    }
    const bytes = Buffer.alloc(64 * 1024 + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 64 * 1024) throw unavailable();
    const value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
    if (value.pid !== Number(pid) || typeof value.name !== "string") throw unavailable();
    const name = value.name.trim();
    if (!name || name.length > 200 || /[\x00-\x1f\x7f]/.test(name)) throw unavailable();
    return name;
  } catch {
    // Neither filesystem paths, other metadata fields nor raw JSON reach MCP.
    throw unavailable();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
