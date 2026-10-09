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
