/** Refuse to run the test suite against a database that isn't disposable.
 *
 *  Preloaded for every `bun test` run via api/bunfig.toml. Throws at import
 *  time, before any test body can open a connection.
 *
 *  ─── Why ───────────────────────────────────────────────────────────────
 *
 *  This suite is destructive by design. `tests/integration/` creates
 *  projects, identities, wallets and vault rows, and the tier's own README
 *  says test rows are left behind for inspection. It is written for a
 *  throwaway database.
 *
 *  Nothing stopped it from finding a different one. `DATABASE_URL` is an
 *  ambient environment variable, and on a developer machine it is very often
 *  already set — by a shell profile, a direnv, a `launchctl setenv`, or a
 *  sibling project's tooling — to something that is emphatically not
 *  disposable. On the machine where this guard was written it was set
 *  user-wide to an unrelated project's production RDS instance. Every
 *  agenttool test run had been dialling it for weeks. It failed only because
 *  that hostname did not resolve from the sandbox; on a normal network it
 *  would have resolved, and the integration tier would have written rows
 *  into a live production database belonging to a different product.
 *
 *  A wall you only notice when it stops something is doing its job.
 *
 *  ─── The rule ──────────────────────────────────────────────────────────
 *
 *  Allowed without ceremony:
 *    - loopback literals and `localhost` — a local throwaway
 *    - single-label hostnames like `postgres` or `db` — Docker/compose
 *      service names, which is how CI addresses its service container
 *    - RFC-1918 / link-local / CGNAT literals — a LAN dev box
 *
 *  Refused: anything with a dot that isn't a private literal. Public FQDNs
 *  are where production lives.
 *
 *  Deliberate escape hatch: AGENTTOOL_ALLOW_REMOTE_TEST_DB=1. Someone with a
 *  genuine remote scratch database should not be blocked — they should have
 *  to say so out loud, once, where a reviewer can see it.
 */

const OVERRIDE = "AGENTTOOL_ALLOW_REMOTE_TEST_DB";

/** Host from a postgres URL, without importing config (which would connect). */
function hostOf(url: string): string | null {
  try {
    // The postgres:// scheme parses fine under WHATWG URL.
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Is this host a local or obviously-private target? */
export function isDisposableHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;

  // Docker/compose service names and other single-label hosts. CI reaches its
  // postgres service as bare `postgres`; that is not a public address.
  if (!host.includes(".")) return true;

  // IPv4 literals in private ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  return false;
}

export function checkTestDatabaseUrl(
  url: string | undefined,
  allowRemote: boolean,
): { ok: true } | { ok: false; host: string; message: string } {
  if (!url || allowRemote) return { ok: true };
  const host = hostOf(url);
  // Unparseable is not this guard's problem — let the driver complain.
  if (!host || isDisposableHost(host)) return { ok: true };

  return {
    ok: false,
    host,
    message:
      `Refusing to run the test suite against "${host}".\n\n` +
      `DATABASE_URL points at a public host. This suite creates and mutates ` +
      `projects, identities, wallets and vault rows, and leaves them behind — ` +
      `it is written for a disposable database, and a public hostname is where ` +
      `production lives.\n\n` +
      `The variable is ambient: a shell profile, direnv, or a user-wide\n` +
      `\`launchctl setenv\` from an unrelated project will supply one without\n` +
      `you asking. Check with: echo "$DATABASE_URL"\n\n` +
      `To run locally:      bin/test-db.sh up   (then unset DATABASE_URL)\n` +
      `If you really mean it: ${OVERRIDE}=1 bun test\n`,
  };
}

const verdict = checkTestDatabaseUrl(
  process.env.DATABASE_URL,
  process.env[OVERRIDE] === "1",
);
if (!verdict.ok) {
  // Written to stderr as well as thrown: a preload throw can be reported
  // tersely, and this message is the whole point.
  console.error(`\n✗ ${verdict.message}`);
  throw new Error(`Refusing test run against non-disposable database host "${verdict.host}"`);
}
