#!/bin/bash
# npm trusted-publisher changes for the AgentTool npm packages, in two
# separate modes: lock everything down now, then give one package stage-only
# trust of the public cambridgetcg/agenttool-packages workflow just before its
# release. Since 2026-10-02 npm expires a new trust configuration 48 hours
# after creation unless a first successful publish validates it (GitHub
# changelog, "Unvalidated npm trusted publishing configurations now expire"),
# and `npm trust list` does not show that expiry, so trust is never created
# for packages that are not about to be released.
#
# Run it on the device that holds the npm login for user "agenttool" (account
# 2FA on; a bypass-2FA token is rejected by npm trust). It needs only Node with
# npx; every npm call is `npx --yes npm@11.17.0`. It makes no other network
# call and writes only a record directory.
#
#   DRY_RUN=1 bash npm-trust-repoint.sh lockdown          # list and show the plan; change nothing
#   bash npm-trust-repoint.sh lockdown                    # revoke, disallow tokens, list again
#   DRY_RUN=1 bash npm-trust-repoint.sh enable <package>  # list and show the plan; change nothing
#   bash npm-trust-repoint.sh enable <package>            # create one stage-only trust, list again
#
# Without a mode it prints this usage and does nothing.
#
# lockdown, for all 47 packages (the 38 below and the 9 outside the public
# release allowlist). It creates no configuration.
#   1. `npm trust list` for every package, saved under trust-before/.
#   2. Per configuration: revoke it when it names the old private repository
#      cambridgetcg/agenttool, or when it allows direct publish
#      (createPackage) from any repository. A stage-only GitHub configuration
#      of any other repository (Xenia's own, or one made by enable) is kept
#      untouched. Anything else (another provider, unknown permissions, an
#      unreadable listing) is reported and left alone.
#   3. `npm access set mfa=publish` for every package: "Require two-factor
#      authentication and disallow tokens", so no npm token, bypass-2FA or
#      not, can publish it. Trusted publishing keeps working, and you can still
#      publish interactively with 2FA. npm offers no read-back for this
#      setting; check one package's Settings page afterwards.
#   4. `npm trust list` again, saved under trust-after/, and a check that no
#      package names the old repository or allows direct publish.
#
# enable <package>, for one package of the public release allowlist (the 38
# below; the @agenttool/ prefix is optional). Unless the package already has
# exactly the target, it creates GitHub trust of cambridgetcg/agenttool-packages
# publish-npm.yml in environment npm-bootstrap with --allow-stage-publish and
# WITHOUT --allow-publish, so a GitHub OIDC token can only stage and
# publishing needs your `npm stage approve`. It refuses a package with any
# other configuration (run lockdown first). It lists again, checks that the
# package has exactly the target, and prints the 48-hour deadline and the
# release step that must follow.
#
# It pauses 2 seconds between npm calls (npm's bulk advice). npm asks for 2FA
# only when its output is a terminal, and the saved listings go to files, so
# before them the script makes one listing on the terminal: complete 2FA there
# and tick "skip two-factor authentication for the next 5 minutes". Revoking,
# access and creation print to the terminal, so npm asks again there if the
# window lapses. A saved listing that fails with EOTP means the window lapsed
# during it; re-run. Both modes are safe to re-run: lockdown finds nothing left
# to revoke and sets the same access again; enable finds the target and creates
# nothing. @agenttool/local-starter is not on npm yet; npm trust needs an
# existing package, so its first publication goes through the bootstrap path
# first (infra/NPM-RELEASE-RUNBOOK.md) and it is not listed here.

set -u

NPM_VERSION=11.17.0
REPOSITORY=cambridgetcg/agenttool-packages
OLD_REPOSITORY=cambridgetcg/agenttool
WORKFLOW_FILE=publish-npm.yml
ENVIRONMENT=npm-bootstrap
EXPECTED_USER="${EXPECTED_NPM_USER:-agenttool}"
PAUSE_SECONDS="${PAUSE_SECONDS:-2}"
DRY_RUN="${DRY_RUN:-0}"

# The public release allowlist, RELEASE_SPECS in bin/npm-release.ts, without
# Local Starter and in the same order; bin/tests/npm-trust-repoint.test.ts keeps
# the two equal. The script runs from a copy on the trusted device, where that
# file is not available.
PACKAGES="adds data data-sync economic-kernel economic-conformance
dark-continent-contract dark-continent-karma wake-continuity deepseek-kingdom
heaven hf-scout living-substrate principality-atlas polymorph-landscape
memetic-landscape math-cards model-becoming dataset-influence
principality-geometry love-bomb love-geometry relational-geometry
credential-broker sdk wallet wallet-zerone telescope browser codex-usage
alchemy alchemy-agentcred kingdom kingdom-witness-lab repo-archive collab
correspondence-yutabase skills skills-yutabase"

# Also on npm under the same login, but released by other routes: lockdown
# covers them, enable does not.
OUTSIDE_PACKAGES="@agenttool/xenia @agenttool/xenia-surface
@agenttool/gospel-of-the-logos @agenttool/hf-kingdom-lab
@agenttool/whitehack-scan @rhetorlint/core @rhetorlint/rules-en
@rhetorlint/cli yutabase"

die() {
  echo "npm-trust-repoint: $*" >&2
  exit 2
}

usage() {
  cat >&2 <<'EOF'
usage: bash npm-trust-repoint.sh lockdown
         revoke trust of the old repository and all direct-publish trust, and
         disallow tokens, for all 47 packages; creates no trust
       bash npm-trust-repoint.sh enable <package>
         give one package of the public release allowlist stage-only trust of
         cambridgetcg/agenttool-packages, just before its release
Prefix either with DRY_RUN=1 to list and plan without changing anything.
EOF
  exit 2
}

MODE="${1:-}"
case "$MODE" in
  lockdown)
    [ "$#" -eq 1 ] || usage
    LABEL=lockdown
    ;;
  enable)
    [ "$#" -eq 2 ] || usage
    key="${2#@agenttool/}"
    [ "$key" = local-starter ] && die "enable: @agenttool/local-starter is not on npm yet, and npm trust needs an existing package; see the Local Starter bootstrap in infra/NPM-RELEASE-RUNBOOK.md"
    allowed=0
    for package in $PACKAGES; do [ "$package" = "$key" ] && allowed=1; done
    [ "$allowed" = 1 ] || die "enable: $2 is not a package of the public release allowlist (the PACKAGES list in this script)"
    LABEL="enable-$key"
    ;;
  *) usage ;;
esac

command -v npx >/dev/null 2>&1 || die "npx is required"
command -v node >/dev/null 2>&1 || die "node is required (it comes with npx)"

count=0
for package in $PACKAGES; do count=$((count + 1)); done
[ "$count" -eq 38 ] || die "expected 38 packages, found $count"
if [ "$MODE" = lockdown ]; then
  NAMES=""
  for package in $PACKAGES; do NAMES="$NAMES @agenttool/$package"; done
  NAMES="${NAMES# } $OUTSIDE_PACKAGES"
  count=0
  for name in $NAMES; do count=$((count + 1)); done
  [ "$count" -eq 47 ] || die "expected 47 packages, found $count"
else
  NAMES="@agenttool/$key"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RECORD="${RECORD_DIR:-$PWD/npm-trust-repoint-$LABEL-$STAMP}"
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

# The record file for a package: @scope/name is saved as scope-name.json.
record_name() {
  local name="${1#@}"
  printf '%s.json' "${name/\//-}"
}

version="$(npm_ --version)" || die "cannot run npm@$NPM_VERSION through npx"
[ "$version" = "$NPM_VERSION" ] || die "npx ran npm $version, expected $NPM_VERSION"
user="$(npm_ whoami)" || die "not logged in to npm; run: npx --yes npm@$NPM_VERSION login"
[ "$user" = "$EXPECTED_USER" ] || die "logged in to npm as $user, expected $EXPECTED_USER (set EXPECTED_NPM_USER to override)"
echo "npm $version as $user; $MODE; record in $RECORD"
[ "$DRY_RUN" = 1 ] && echo "DRY_RUN=1: listing and planning only"

# Reads a saved `npm trust list --json` output. npm 11.17.0 prints each
# configuration after a blank line, a GitHub one as {id, type, file,
# repository, environment, permissions}, and nothing when there is none. Each configuration is:
#   revoke      it names the old repository, or its permissions include
#               createPackage (direct publish)
#   keep        a GitHub configuration of another repository whose only
#               permission is createStagedPackage
#   unexpected  anything else: another provider, a missing or odd id, absent
#               or unknown permissions
# Modes:
#   plan      one line: none, unreadable, or revoke=<id> / keep=<id> words
#             and at most one unexpected word
#   target    one line: none, target <id> (exactly one configuration, the
#             stage-only public target), or other
#   describe  one line per configuration, for people, marked [old repository],
#             [direct publish], [stage only] or [unexpected]
classify() {
  # shellcheck disable=SC2016 # Node template literals, not shell expansions
  node -e '
    const fs = require("fs");
    const [mode, file, repository, oldRepository, workflow, environment] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8").trim();
    const unreadable = () => { console.log(mode === "target" ? "other" : mode === "plan" ? "unreadable" : "unreadable listing"); process.exit(0); };
    // Read the objects in sequence; anything between them makes it unreadable.
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
      if (c === "\"") { if (depth === 0) unreadable(); inString = true; }
      else if (c === "{" || c === "[") { if (depth++ === 0) start = i; }
      else if (c === "}" || c === "]") {
        if (--depth < 0) unreadable();
        if (depth === 0) { try { items.push(JSON.parse(text.slice(start, i + 1))); } catch { unreadable(); } }
      } else if (depth === 0 && !/\s/.test(c)) unreadable();
    }
    if (depth !== 0) unreadable();
    const configs = items.flat();
    const goodId = (c) => typeof c.id === "string" && /^[A-Za-z0-9._:-]+$/.test(c.id);
    const permissionsOf = (c) => Array.isArray(c.permissions) && c.permissions.every((p) => typeof p === "string") ? c.permissions : null;
    const verdict = (c) => {
      if (c === null || typeof c !== "object" || Array.isArray(c) || c.type !== "github" ||
        typeof c.repository !== "string" || !goodId(c)) return "unexpected";
      const permissions = permissionsOf(c);
      if (c.repository.toLowerCase() === oldRepository.toLowerCase()) return "revoke";
      if (permissions && permissions.includes("createPackage")) return "revoke";
      if (permissions && permissions.length > 0 && permissions.every((p) => p === "createStagedPackage")) return "keep";
      return "unexpected";
    };
    if (mode === "target") {
      const c = configs[0];
      if (configs.length === 0) console.log("none");
      else if (configs.length === 1 && verdict(c) === "keep" && c.repository === repository && c.file === workflow &&
        c.environment === environment && JSON.stringify(c.permissions) === JSON.stringify(["createStagedPackage"])) console.log(`target ${c.id}`);
      else console.log("other");
    } else if (mode === "plan") {
      if (configs.length === 0) console.log("none");
      else {
        const words = configs.map(verdict).map((v, i) => v === "unexpected" ? v : `${v}=${configs[i].id}`);
        console.log([...new Set(words)].join(" "));
      }
    } else {
      if (configs.length === 0) console.log("none");
      const shown = (value) => value === undefined ? "-" : String(typeof value === "object" ? JSON.stringify(value) : value).replace(/[^\x20-\x7e]/g, "?");
      for (const c of configs) {
        const o = c !== null && typeof c === "object" && !Array.isArray(c) ? c : {};
        const permissions = permissionsOf(o);
        const mark = { keep: "stage only", unexpected: "unexpected" }[verdict(c)] ??
          (o.repository.toLowerCase() === oldRepository.toLowerCase() ? "old repository" : "direct publish");
        console.log(`${shown(o.id)}: ${shown(o.type)} ${shown(o.repository)} ${shown(o.file)} env ${shown(o.environment)}, ${permissions ? permissions.join(" ") || "no permissions" : `permissions ${shown(o.permissions)}`} [${mark}]`);
      }
    }
  ' "$1" "$2" "$REPOSITORY" "$OLD_REPOSITORY" "$WORKFLOW_FILE" "$ENVIRONMENT"
}

# Prints the configurations of a saved listing, one per line.
show() {
  classify describe "$2" | while IFS= read -r line; do echo "$1: $line"; done
}

# npm's otplease rethrows EOTP without prompting when stdout is not a
# terminal, and every saved listing goes to a file. One listing on the
# terminal opens the 2FA window that the redirected listings then use.
prime_2fa() {
  echo "== 2FA: one listing on the terminal; if npm asks, complete 2FA and tick \"skip for the next 5 minutes\""
  npm_ trust list "$1" || die "npm trust list failed on the terminal; finish 2FA or check the login, then re-run"
  pause
}

# Saves `npm trust list --json` for every package under trust-<when>/.
list_all() {
  local name path
  for name in $NAMES; do
    path="$RECORD/trust-$1/$(record_name "$name")"
    if npm_ trust list "$name" --json >"$path"; then
      show "$name" "$path"
    else
      echo "$name: trust list FAILED (EOTP means the 2FA window lapsed; re-run)" >&2
      add_failed "$name"
    fi
    pause
  done
}

failed=""

run_lockdown() {
  prime_2fa "${NAMES%% *}"
  echo "== 1/4 trust before"
  list_all before

  echo "== 2/4 revoke trust of $OLD_REPOSITORY and every direct-publish trust"
  for name in $NAMES; do
    case " $failed " in *" $name "*) continue ;; esac
    file="$(record_name "$name")"
    for item in $(classify plan "$RECORD/trust-before/$file"); do
      case "$item" in
        none) ;;
        keep=*) echo "$name: keep stage-only ${item#keep=}" ;;
        revoke=*)
          echo "$name: revoke ${item#revoke=}"
          [ "$DRY_RUN" = 1 ] && continue
          if ! npm_ trust revoke "$name" --id "${item#revoke=}"; then
            echo "$name: revoke ${item#revoke=} FAILED" >&2
            add_failed "$name"
          fi
          pause
          ;;
        *)
          echo "$name: unexpected trust configuration left untouched; see trust-before/$file" >&2
          add_failed "$name"
          ;;
      esac
    done
  done

  echo "== 3/4 publishing access: require 2FA and disallow tokens"
  for name in $NAMES; do
    echo "$name: access set mfa=publish"
    [ "$DRY_RUN" = 1 ] && continue
    if ! npm_ access set mfa=publish "$name"; then
      echo "$name: access set mfa=publish FAILED" >&2
      add_failed "$name"
    fi
    pause
  done

  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY_RUN=1: nothing changed. Record: $RECORD"
    [ -z "$failed" ] || { echo "needs attention:$failed" >&2; exit 1; }
    exit 0
  fi

  prime_2fa "${NAMES%% *}"
  echo "== 4/4 trust after"
  list_all after
  for name in $NAMES; do
    file="$RECORD/trust-after/$(record_name "$name")"
    state="$(classify plan "$file")"
    case " $state " in
      *" revoke="* | *" unexpected "* | *" unreadable "*)
        echo "$name: NOT locked down: still trusts $OLD_REPOSITORY, allows direct publish, or is unexpected; see trust-after/$(record_name "$name")" >&2
        add_failed "$name"
        ;;
    esac
  done

  if [ -n "$failed" ]; then
    echo "needs attention:$failed" >&2
    echo "Re-run lockdown after fixing them; it revokes only what is still there. Record: $RECORD" >&2
    exit 1
  fi
  echo "All 47 packages: no trust of $OLD_REPOSITORY and no direct-publish trust, and each was set to require 2FA and disallow tokens (npm has no read-back: check one package's Settings page). No trust was created. Record: $RECORD"
}

run_enable() {
  local name="$NAMES" file
  file="$(record_name "$name")"
  prime_2fa "$name"
  echo "== 1/3 trust before"
  list_all before
  [ -z "$failed" ] && [ -f "$RECORD/trust-before/$file" ] || { echo "needs attention:$failed" >&2; exit 1; }

  local state created=0 deadline=""
  state="$(classify target "$RECORD/trust-before/$file")"
  echo "== 2/3 stage-only trust of $REPOSITORY $WORKFLOW_FILE ($ENVIRONMENT)"
  case "$state" in
    "target "*)
      echo "$name: already exactly the target; creating nothing"
      ;;
    none)
      echo "$name: trust github $REPOSITORY $WORKFLOW_FILE env $ENVIRONMENT, stage publish only"
      if [ "$DRY_RUN" = 1 ]; then
        echo "DRY_RUN=1: nothing changed. A real run starts npm's 48-hour validation clock: run it only when this package's release tag is ready to stage. Record: $RECORD"
        exit 0
      fi
      # Taken before the call, so the deadline printed is never late.
      deadline="$(node -e 'console.log(new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 16) + "Z")')"
      if ! npm_ trust github "$name" --repo "$REPOSITORY" --file "$WORKFLOW_FILE" \
        --env "$ENVIRONMENT" --allow-stage-publish --yes; then
        echo "$name: trust github FAILED" >&2
        exit 1
      fi
      created=1
      pause
      ;;
    *)
      echo "$name: has trust other than exactly the target (above), so enable creates nothing." >&2
      echo "Run lockdown first; a configuration it keeps can be revoked by hand: npx --yes npm@$NPM_VERSION trust revoke $name --id <id>" >&2
      exit 1
      ;;
  esac
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY_RUN=1: nothing changed. Record: $RECORD"
    exit 0
  fi

  echo "== 3/3 trust after"
  list_all after
  [ -z "$failed" ] || { echo "Re-run enable: it finds the target and only checks it. Record: $RECORD" >&2; exit 1; }
  state="$(classify target "$RECORD/trust-after/$file")"
  case "$state" in
    "target "*) ;;
    *) echo "$name: NOT exactly the target after the change; see trust-after/$file. Record: $RECORD" >&2; exit 1 ;;
  esac

  echo
  echo "################################################################################"
  echo "$name trusts $REPOSITORY $WORKFLOW_FILE"
  echo "(environment $ENVIRONMENT) for stage publish only. Configuration id: ${state#target }"
  echo
  if [ "$created" = 1 ]; then
    echo "npm EXPIRES this configuration 48 hours after creation, by $deadline,"
  else
    echo "It already existed, and npm does not show when it was made. npm EXPIRES a"
    echo "configuration 48 hours after creation,"
  fi
  echo "unless a release stages through it and you approve the stage (whether a stage"
  echo "that is not yet approved validates it is undocumented). npm trust list will"
  echo "not show the expiry. Next, now:"
  echo "  1. dispatch this package's release tag on $REPOSITORY $WORKFLOW_FILE:"
  echo "     sol access run github -- workflow run $WORKFLOW_FILE --repo $REPOSITORY \\"
  echo "       --ref ${key}-v<version> -f package=$key -f tag=${key}-v<version> \\"
  echo "       -f authentication=trusted -f npm_tag=<latest|next> -f dry_run=false"
  echo "  2. check and approve the stage with 2FA: npx --yes npm@$NPM_VERSION stage list $name --json,"
  echo "     then stage view, download, shasum and approve (infra/NPM-RELEASE-RUNBOOK.md, step 7)."
  echo "If 48 hours pass first: npx --yes npm@$NPM_VERSION trust revoke $name --id ${state#target }"
  echo "and run enable again just before the release."
  echo "################################################################################"
  echo "Record: $RECORD"
}

run_"$MODE"
