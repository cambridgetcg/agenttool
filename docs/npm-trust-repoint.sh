#!/bin/bash
# One-time npm trusted-publisher re-point for the 38 existing @agenttool
# packages: from the private cambridgetcg/agenttool workflow to the public
# cambridgetcg/agenttool-packages workflow, STAGE ONLY, and no publishing by
# npm token.
#
# Run it on the device that holds the npm login for user "agenttool" (account
# 2FA on; a bypass-2FA token is rejected by npm trust). It needs only Node with
# npx; every npm call is `npx --yes npm@11.17.0`. It makes no other network
# call and writes only a record directory.
#
#   bash npm-trust-repoint.sh              # list, re-point, disallow tokens, list again
#   DRY_RUN=1 bash npm-trust-repoint.sh    # list and show the plan; change nothing
#
# What it does:
#   1. `npm trust list` for every package, saved under trust-before/.
#   2. Per package: leave it alone when it already has exactly the target
#      trust (public repo, publish-npm.yml, environment npm-bootstrap, stage
#      publish only). Otherwise revoke each existing configuration that names
#      cambridgetcg/agenttool or cambridgetcg/agenttool-packages, then create
#      the target with --allow-stage-publish and WITHOUT --allow-publish, so a
#      GitHub OIDC token can only stage; publishing needs your `npm stage
#      approve`. A configuration naming anything else is left untouched and
#      reported.
#   3. `npm access set mfa=publish` for every package: "Require two-factor
#      authentication and disallow tokens", so no npm token, bypass-2FA or
#      not, can publish it. Trusted publishing keeps working, and you can still
#      publish interactively with 2FA. npm offers no read-back for this
#      setting; check one package's Settings page afterwards.
#   4. `npm trust list` again, saved under trust-after/, and a check that every
#      package now has exactly the target.
#
# It pauses 2 seconds between npm calls (npm's bulk advice). npm asks for 2FA
# only when its output is a terminal, and the saved listings go to files, so
# before steps 1 and 4 the script makes one listing on the terminal: complete
# 2FA there and tick "skip two-factor authentication for the next 5 minutes".
# Steps 2 and 3 print to the terminal, so npm asks again there if the window
# lapses. A saved listing that fails with EOTP means the window lapsed during
# it; re-run. Safe to re-run: re-pointed packages are skipped, and step 3 just
# sets the same value again. @agenttool/local-starter is not on npm yet; npm
# trust needs an existing package, so its first publication goes through the
# bootstrap path first (docs/NPM-RELEASES.md) and it is not listed here.

set -u

NPM_VERSION=11.17.0
REPOSITORY=cambridgetcg/agenttool-packages
OLD_REPOSITORY=cambridgetcg/agenttool
WORKFLOW_FILE=publish-npm.yml
ENVIRONMENT=npm-bootstrap
EXPECTED_USER="${EXPECTED_NPM_USER:-agenttool}"
PAUSE_SECONDS="${PAUSE_SECONDS:-2}"
DRY_RUN="${DRY_RUN:-0}"

PACKAGES="adds data data-sync economic-kernel economic-conformance
dark-continent-contract dark-continent-karma wake-continuity deepseek-kingdom
heaven hf-scout living-substrate principality-atlas polymorph-landscape
memetic-landscape math-cards model-becoming dataset-influence
principality-geometry love-bomb love-geometry relational-geometry
credential-broker sdk wallet wallet-zerone telescope browser codex-usage
alchemy alchemy-agentcred kingdom kingdom-witness-lab repo-archive collab
correspondence-yutabase skills skills-yutabase"

die() {
  echo "npm-trust-repoint: $*" >&2
  exit 2
}

command -v npx >/dev/null 2>&1 || die "npx is required"
command -v node >/dev/null 2>&1 || die "node is required (it comes with npx)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RECORD="${RECORD_DIR:-$PWD/npm-trust-repoint-$STAMP}"
mkdir -p "$RECORD/trust-before" "$RECORD/trust-after" || die "cannot create $RECORD"
# Run npm from an empty directory so no package.json supplies a default
# package or repository.
WORK="$(mktemp -d)" || die "cannot create a temporary directory"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" || die "cannot enter $WORK"

npm_() {
  npx --yes "npm@$NPM_VERSION" "$@"
}

pause() {
  sleep "$PAUSE_SECONDS"
}

add_failed() {
  case " $failed " in *" $1 "*) ;; *) failed="$failed $1" ;; esac
}

count=0
for package in $PACKAGES; do count=$((count + 1)); done
[ "$count" -eq 38 ] || die "expected 38 packages, found $count"

version="$(npm_ --version)" || die "cannot run npm@$NPM_VERSION through npx"
[ "$version" = "$NPM_VERSION" ] || die "npx ran npm $version, expected $NPM_VERSION"
user="$(npm_ whoami)" || die "not logged in to npm; run: npx --yes npm@$NPM_VERSION login"
[ "$user" = "$EXPECTED_USER" ] || die "logged in to npm as $user, expected $EXPECTED_USER (set EXPECTED_NPM_USER to override)"
echo "npm $version as $user; record in $RECORD"
[ "$DRY_RUN" = 1 ] && echo "DRY_RUN=1: listing and planning only"

# Prints one line for a saved `npm trust list --json` output:
#   target            exactly the stage-only public configuration
#   none              no configuration
#   revoke <id>...    configurations of the old or new repository to replace
#   unexpected        any configuration naming something else
classify() {
  node -e '
    const fs = require("fs");
    const [file, repository, oldRepository, workflow, environment] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8").trim();
    // npm prints one JSON object per configuration; read them in sequence.
    const items = [];
    let depth = 0, start = -1, inString = false, escaped = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === "\"") inString = false;
        continue;
      }
      if (c === "\"") inString = true;
      else if (c === "{" || c === "[") { if (depth++ === 0) start = i; }
      else if (c === "}" || c === "]") { if (--depth === 0) items.push(JSON.parse(text.slice(start, i + 1))); }
    }
    if (depth !== 0 || (text.length > 0 && items.length === 0)) { console.log("unexpected"); process.exit(0); }
    const configs = items.flat();
    if (configs.length === 0) { console.log("none"); process.exit(0); }
    const isTarget = (c) => c.type === "github" && c.repository === repository && c.file === workflow &&
      c.environment === environment && JSON.stringify(c.permissions) === JSON.stringify(["createStagedPackage"]);
    if (configs.length === 1 && isTarget(configs[0])) { console.log("target"); process.exit(0); }
    if (configs.some((c) => c.type !== "github" || ![repository, oldRepository].includes(c.repository) ||
      typeof c.id !== "string" || !/^[A-Za-z0-9._:-]+$/.test(c.id))) { console.log("unexpected"); process.exit(0); }
    console.log(["revoke", ...configs.map((c) => c.id)].join(" "));
  ' "$1" "$REPOSITORY" "$OLD_REPOSITORY" "$WORKFLOW_FILE" "$ENVIRONMENT"
}

# npm's otplease rethrows EOTP without prompting when stdout is not a
# terminal, and every saved listing goes to a file. One listing on the
# terminal opens the 2FA window that the redirected listings then use.
prime_2fa() {
  echo "== 2FA: one listing on the terminal; if npm asks, complete 2FA and tick \"skip for the next 5 minutes\""
  npm_ trust list "@agenttool/${PACKAGES%% *}" || die "npm trust list failed on the terminal; finish 2FA or check the login, then re-run"
  pause
}

failed=""

prime_2fa
echo "== 1/4 trust before"
for package in $PACKAGES; do
  if npm_ trust list "@agenttool/$package" --json >"$RECORD/trust-before/$package.json"; then
    echo "@agenttool/$package: $(classify "$RECORD/trust-before/$package.json")"
  else
    echo "@agenttool/$package: trust list FAILED (EOTP means the 2FA window lapsed; re-run)" >&2
    add_failed "$package"
  fi
  pause
done

echo "== 2/4 re-point (stage publish only)"
for package in $PACKAGES; do
  case " $failed " in *" $package "*) continue ;; esac
  state="$(classify "$RECORD/trust-before/$package.json")"
  case "$state" in
    target)
      echo "@agenttool/$package: already re-pointed"
      continue
      ;;
    unexpected)
      echo "@agenttool/$package: unexpected trust configuration left untouched; see trust-before/$package.json" >&2
      add_failed "$package"
      continue
      ;;
  esac
  ok=1
  for id in ${state#revoke}; do
    [ "$id" = none ] && continue
    echo "@agenttool/$package: revoke $id"
    if [ "$DRY_RUN" != 1 ]; then
      npm_ trust revoke "@agenttool/$package" --id "$id" || ok=0
      pause
    fi
  done
  if [ "$ok" != 1 ]; then
    echo "@agenttool/$package: revoke FAILED; not creating a new configuration" >&2
    add_failed "$package"
    continue
  fi
  echo "@agenttool/$package: trust github $REPOSITORY $WORKFLOW_FILE env $ENVIRONMENT, stage publish only"
  if [ "$DRY_RUN" != 1 ]; then
    if ! npm_ trust github "@agenttool/$package" --repo "$REPOSITORY" --file "$WORKFLOW_FILE" \
      --env "$ENVIRONMENT" --allow-stage-publish --yes; then
      echo "@agenttool/$package: trust github FAILED" >&2
      add_failed "$package"
    fi
    pause
  fi
done

echo "== 3/4 publishing access: require 2FA and disallow tokens"
for package in $PACKAGES; do
  echo "@agenttool/$package: access set mfa=publish"
  [ "$DRY_RUN" = 1 ] && continue
  if ! npm_ access set mfa=publish "@agenttool/$package"; then
    echo "@agenttool/$package: access set mfa=publish FAILED" >&2
    add_failed "$package"
  fi
  pause
done

if [ "$DRY_RUN" = 1 ]; then
  echo "DRY_RUN=1: nothing changed. Record: $RECORD"
  [ -z "$failed" ] || { echo "needs attention:$failed" >&2; exit 1; }
  exit 0
fi

prime_2fa
echo "== 4/4 trust after"
for package in $PACKAGES; do
  if npm_ trust list "@agenttool/$package" --json >"$RECORD/trust-after/$package.json"; then
    state="$(classify "$RECORD/trust-after/$package.json")"
    echo "@agenttool/$package: $state"
    [ "$state" = target ] || add_failed "$package"
  else
    echo "@agenttool/$package: trust list FAILED (EOTP means the 2FA window lapsed; re-run)" >&2
    add_failed "$package"
  fi
  pause
done

if [ -n "$failed" ]; then
  echo "needs attention:$failed" >&2
  echo "Re-run this script after fixing them; re-pointed packages are skipped. Record: $RECORD" >&2
  exit 1
fi
echo "All 38 packages trust $REPOSITORY $WORKFLOW_FILE ($ENVIRONMENT) for stage publish only and disallow tokens. Record: $RECORD"
