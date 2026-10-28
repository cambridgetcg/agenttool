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
#      untouched; if cambridgetcg does not own that repository, or the
#      configuration has no workflow file or environment, it is kept but
#      fails the run as needing review. Anything else (another provider,
#      unknown permissions, an unreadable listing) is reported and left alone.
#      Where its id is readable, the script prints the revoke command for it
#      without running it.
#   3. `npm access set mfa=publish` for every package: "Require two-factor
#      authentication and disallow tokens", so no npm token, bypass-2FA or
#      not, can publish it. Trusted publishing keeps working, and you can still
#      publish interactively with 2FA. npm offers no read-back for this
#      setting; check one package's Settings page afterwards.
#   4. `npm trust list` again, saved under trust-after/, and a check that no
#      package names the old repository or allows direct publish. The run
#      ends by listing the stage-only trust that stays.
#
# enable <package>, for one package of the public release allowlist (the 38
# below; the @agenttool/ prefix is optional). Unless the package already has
# exactly the target, it creates GitHub trust of cambridgetcg/agenttool-packages
# publish-npm.yml in environment npm-bootstrap with --allow-stage-publish and
# WITHOUT --allow-publish, so a GitHub OIDC token can only stage and
# publishing needs your `npm stage approve`. It refuses a package with any
# other configuration (run lockdown first). It records the 48-hour deadline as
# expires-by.txt in its record directory (also when the create fails, since npm
# may have created it all the same), lists again, checks that the package has
# exactly the target, and prints the deadline and the release step that must
# follow. For an existing target, a dry run prints the same notice as a real
# run.
#
# DRY_RUN is 1 or 0 (the default); any other value is refused.
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

# Any other value would run for real; DRY_RUN=true must not revoke or create.
case "$DRY_RUN" in
  0 | 1) ;;
  *) die "DRY_RUN must be 1 (list and plan only) or 0 (change npm), not $DRY_RUN" ;;
esac

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
# repository, environment, permissions} (without an empty field), and nothing
# when there is none. Each configuration is:
#   revoke      it names the old repository, or its permissions include
#               createPackage (direct publish)
#   keep        a GitHub configuration of another repository whose only
#               permission is createStagedPackage
#   review      the same, but of a repository another owner controls, or
#               without a workflow file or environment, so it matches more
#               than the job it was made for
#   unexpected  anything else: another provider, a missing or odd id, absent
#               or unknown permissions
# Modes:
#   plan      one line: none, unreadable, or revoke=<id> / keep=<id> /
#             review=<id> / unexpected=<id> words, and at most one
#             unexpected word (a configuration without a readable id)
#   target    one line: none, target <id> (exactly one configuration, the
#             stage-only public target), or other
#   describe  one line per configuration, for people, marked [old repository],
#             [direct publish], [stage only], [stage only, needs review: ...]
#             or [unexpected]
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
    const owner = (r) => r.split("/")[0].toLowerCase();
    const named = (value) => typeof value === "string" && value !== "";
    // Why stage-only trust of a GitHub repository needs a person to look at it.
    const review = (c) => owner(c.repository) !== owner(repository) ? `not a ${owner(repository)} repository` :
      !named(c.file) ? "no workflow file" : !named(c.environment) ? "no environment" : "";
    const verdict = (c) => {
      if (c === null || typeof c !== "object" || Array.isArray(c) || c.type !== "github" ||
        typeof c.repository !== "string" || !goodId(c)) return "unexpected";
      const permissions = permissionsOf(c);
      if (c.repository.toLowerCase() === oldRepository.toLowerCase()) return "revoke";
      if (permissions && permissions.includes("createPackage")) return "revoke";
      if (permissions && permissions.length > 0 && permissions.every((p) => p === "createStagedPackage")) return review(c) ? "review" : "keep";
      return "unexpected";
    };
    const hasId = (c) => c !== null && typeof c === "object" && goodId(c);
    if (mode === "target") {
      const c = configs[0];
      if (configs.length === 0) console.log("none");
      else if (configs.length === 1 && verdict(c) === "keep" && c.repository === repository && c.file === workflow &&
        c.environment === environment && JSON.stringify(c.permissions) === JSON.stringify(["createStagedPackage"])) console.log(`target ${c.id}`);
      else console.log("other");
    } else if (mode === "plan") {
      if (configs.length === 0) console.log("none");
      else {
        const words = configs.map(verdict).map((v, i) => v === "unexpected" && !hasId(configs[i]) ? v : `${v}=${configs[i].id}`);
        console.log([...new Set(words)].join(" "));
      }
    } else {
      if (configs.length === 0) console.log("none");
      const shown = (value) => value === undefined ? "-" : String(typeof value === "object" ? JSON.stringify(value) : value).replace(/[^\x20-\x7e]/g, "?");
      for (const c of configs) {
        const o = c !== null && typeof c === "object" && !Array.isArray(c) ? c : {};
        const permissions = permissionsOf(o);
        const v = verdict(c);
        const mark = v === "keep" ? "stage only" : v === "review" ? `stage only, needs review: ${review(o)}` : v === "unexpected" ? v :
          o.repository.toLowerCase() === oldRepository.toLowerCase() ? "old repository" : "direct publish";
        console.log(`${shown(o.id)}: ${shown(o.type)} ${shown(o.repository)} ${shown(o.file)} env ${shown(o.environment)}, ${permissions ? permissions.join(" ") || "no permissions" : `permissions ${shown(o.permissions)}`} [${mark}]`);
      }
    }
  ' "$1" "$2" "$REPOSITORY" "$OLD_REPOSITORY" "$WORKFLOW_FILE" "$ENVIRONMENT"
}

# Prints the configurations of a saved listing, one per line.
show() {
  classify describe "$2" | while IFS= read -r line; do echo "$1: $line"; done
}

# Lists the stage-only configurations that lockdown keeps, from trust-$1/, for
# the packages named in $2, so an unfamiliar repository among them is seen.
show_kept() {
  local name
  if [ -z "$2" ]; then
    echo "Stage-only trust that stays: none"
  else
    echo "Stage-only trust that stays (a stage through it still needs your npm stage approve):"
    for name in $2; do
      show "$name" "$RECORD/trust-$1/$(record_name "$name")" | grep -F '[stage only'
    done
  fi
  # A listing that failed or could not be read is not in the list.
  [ -z "$failed" ] || echo "(a package that needs attention may have more)"
}

# Prints the revoke command for a configuration the script leaves to a person.
revoke_hint() {
  echo "  to revoke it by hand: npx --yes npm@$NPM_VERSION trust revoke $1 --id $2" >&2
}

REVIEW_NOTE="Lockdown never revokes stage-only trust: revoke one that needs review by hand (the command is above), or keep it knowingly, and lockdown keeps reporting it."

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
kept=""
review_seen=0

run_lockdown() {
  prime_2fa "${NAMES%% *}"
  echo "== 1/4 trust before"
  list_all before

  echo "== 2/4 revoke trust of $OLD_REPOSITORY and every direct-publish trust"
  for name in $NAMES; do
    case " $failed " in *" $name "*) continue ;; esac
    file="$(record_name "$name")"
    # A classifier that fails or prints nothing must not read as "no trust".
    plan="$(classify plan "$RECORD/trust-before/$file")" || plan=unreadable
    for item in ${plan:-unreadable}; do
      case "$item" in
        none) ;;
        keep=*)
          echo "$name: keep stage-only ${item#keep=}"
          case " $kept " in *" $name "*) ;; *) kept="$kept $name" ;; esac
          ;;
        review=*)
          echo "$name: keep stage-only ${item#review=}, but it needs review (another owner's repository, or no workflow file or environment); see trust-before/$file" >&2
          revoke_hint "$name" "${item#review=}"
          case " $kept " in *" $name "*) ;; *) kept="$kept $name" ;; esac
          add_failed "$name"
          review_seen=1
          ;;
        unexpected=*)
          echo "$name: unexpected trust configuration ${item#unexpected=} left untouched; see trust-before/$file" >&2
          revoke_hint "$name" "${item#unexpected=}"
          add_failed "$name"
          ;;
        unreadable)
          echo "$name: listing unreadable, nothing revoked; see trust-before/$file" >&2
          add_failed "$name"
          ;;
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
    show_kept before "$kept"
    echo "DRY_RUN=1: nothing changed. Record: $RECORD"
    if [ -n "$failed" ]; then
      echo "needs attention:$failed" >&2
      [ "$review_seen" = 1 ] && echo "$REVIEW_NOTE" >&2
      exit 1
    fi
    exit 0
  fi

  prime_2fa "${NAMES%% *}"
  echo "== 4/4 trust after"
  list_all after
  kept=""
  for name in $NAMES; do
    file="$(record_name "$name")"
    # Passes only what is known to be locked down: no trust, or stage-only trust.
    state="$(classify plan "$RECORD/trust-after/$file")" || state=unreadable
    locked=1 needs_review=0
    for item in ${state:-unreadable}; do
      case "$item" in none | keep=*) ;; review=*) needs_review=1 ;; *) locked=0 ;; esac
    done
    case " $state " in *" keep="* | *" review="*) kept="$kept $name" ;; esac
    if [ "$locked" = 0 ]; then
      echo "$name: NOT locked down: still trusts $OLD_REPOSITORY, allows direct publish, or is unexpected or unreadable; see trust-after/$file" >&2
      add_failed "$name"
    elif [ "$needs_review" = 1 ]; then
      echo "$name: locked down, but keeps stage-only trust that needs review; see trust-after/$file" >&2
      add_failed "$name"
      review_seen=1
    fi
  done

  show_kept after "$kept"
  if [ -n "$failed" ]; then
    echo "needs attention:$failed" >&2
    [ "$review_seen" = 1 ] && echo "$REVIEW_NOTE" >&2
    echo "Re-run lockdown after fixing them; it revokes only what is still there. Record: $RECORD" >&2
    exit 1
  fi
  echo "All 47 packages: no trust of $OLD_REPOSITORY and no direct-publish trust, and each was set to require 2FA and disallow tokens (npm has no read-back: check one package's Settings page). No trust was created. Record: $RECORD"
}

# The newest earlier enable record for this package, from records beside this
# one: sets earlier_dir to its directory and earlier_deadline to the first line
# of its expires-by.txt; both stay empty if there is none.
earlier_dir=""
earlier_deadline=""
recorded_deadline() {
  local path
  for path in "$(dirname "$RECORD")/npm-trust-repoint-enable-$key-"[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z/expires-by.txt; do
    [ -f "$path" ] && earlier_dir="$(dirname "$path")"
  done
  [ -n "$earlier_dir" ] && IFS= read -r earlier_deadline <"$earlier_dir/expires-by.txt"
}

run_enable() {
  local name="$NAMES" file
  file="$(record_name "$name")"
  prime_2fa "$name"
  echo "== 1/3 trust before"
  list_all before
  [ -z "$failed" ] && [ -f "$RECORD/trust-before/$file" ] || { echo "needs attention:$failed" >&2; exit 1; }

  local state created=0 deadline="" item plan
  state="$(classify target "$RECORD/trust-before/$file")" || state=other
  echo "== 2/3 stage-only trust of $REPOSITORY $WORKFLOW_FILE ($ENVIRONMENT)"
  case "$state" in
    "target "*)
      echo "$name: already exactly the target; creating nothing"
      recorded_deadline
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
        # npm reads the registry's answer after sending the request, so a
        # failure there can follow a configuration that was created.
        printf '%s (if npm created it)\n' "$deadline" >"$RECORD/expires-by.txt"
        echo "$name: trust github FAILED" >&2
        echo "npm may still have created it: run DRY_RUN=1 bash npm-trust-repoint.sh enable $key to check; if it is listed, it expires by $deadline unless a stage through it is approved first." >&2
        exit 1
      fi
      created=1
      # Recorded at once, so a later failure cannot lose the deadline.
      printf '%s\n' "$deadline" >"$RECORD/expires-by.txt"
      echo "$name: created; npm expires it by $deadline unless a stage through it is approved first"
      pause
      ;;
    *)
      echo "$name: has trust other than exactly the target (above), so enable creates nothing." >&2
      echo "Run lockdown first; a configuration it keeps can be revoked by hand: npx --yes npm@$NPM_VERSION trust revoke $name --id <id>" >&2
      exit 1
      ;;
  esac
  if [ "$DRY_RUN" = 1 ]; then
    # Only an existing target gets here. A real run would create nothing,
    # list again and print the same notice, so the preview shows it too.
    echo "DRY_RUN=1: nothing changed; a real run lists again and prints the notice below."
  else
    echo "== 3/3 trust after"
    list_all after
    if [ -n "$failed" ]; then
      [ "$created" = 1 ] && echo "$name: the configuration was created; npm expires it by $deadline unless a stage through it is approved first (also in $RECORD/expires-by.txt)." >&2
      echo "Re-run enable: it finds the target and only checks it. Record: $RECORD" >&2
      exit 1
    fi
    state="$(classify target "$RECORD/trust-after/$file")" || state=other
    case "$state" in
      "target "*) ;;
      *)
        echo "$name: NOT exactly the target after the change; see trust-after/$file. Record: $RECORD" >&2
        [ "$created" = 1 ] && echo "What this run created expires by $deadline unless a stage through it is approved first." >&2
        echo "Do not dispatch. Revoke what is listed above, then run enable again:" >&2
        plan="$(classify plan "$RECORD/trust-after/$file")" || plan=unreadable
        for item in ${plan:-unreadable}; do
          case "$item" in
            revoke=* | keep=* | review=* | unexpected=*) echo "  npx --yes npm@$NPM_VERSION trust revoke $name --id ${item#*=}" >&2 ;;
            none) ;;
            *) echo "  (a configuration the script cannot read; revoke it on the package's npmjs.com Settings page)" >&2 ;;
          esac
        done
        echo "Or run lockdown now: it revokes every configuration that allows direct publish." >&2
        exit 1
        ;;
    esac
  fi

  echo
  echo "################################################################################"
  echo "$name trusts $REPOSITORY $WORKFLOW_FILE"
  echo "(environment $ENVIRONMENT) for stage publish only. Configuration id: ${state#target }"
  echo
  if [ "$created" = 1 ]; then
    echo "npm EXPIRES this configuration 48 hours after creation, by $deadline,"
    echo "unless a release stages through it and you approve the stage (whether a stage"
    echo "that is not yet approved validates it is undocumented). npm trust list will"
    echo "not show the expiry. Next, now:"
  else
    echo "It already existed. npm shows neither when it was made nor whether it has"
    echo "expired: a configuration expires 48 hours after creation unless a release"
    echo "staged through it and the stage was approved."
    if [ -n "$earlier_dir" ]; then
      echo "The newest enable record for this package, $earlier_dir,"
      echo "records the deadline $earlier_deadline; if nothing was revoked or created by"
      echo "hand since, this is the configuration that run created."
    fi
    echo "Unless a stage through it was approved, or you know it is under 48 hours old,"
    echo "revoke it and run enable again before dispatching: a dispatch through an"
    echo "expired configuration fails at npm, and can leave a public GitHub Release and"
    echo "a Rekor entry behind (run 39288082185)."
    echo "  npx --yes npm@$NPM_VERSION trust revoke $name --id ${state#target }"
    echo "Then, within the 48 hours:"
  fi
  echo "  1. dispatch this package's release tag on $REPOSITORY $WORKFLOW_FILE:"
  echo "     sol access run github -- workflow run $WORKFLOW_FILE --repo $REPOSITORY \\"
  echo "       --ref ${key}-v<version> -f package=$key -f tag=${key}-v<version> \\"
  echo "       -f authentication=trusted -f npm_tag=<latest|next> -f dry_run=false"
  echo "  2. check and approve the stage with 2FA: npx --yes npm@$NPM_VERSION stage list $name --json,"
  echo "     then stage view, download, shasum and approve (infra/NPM-RELEASE-RUNBOOK.md, step 7)."
  echo "If 48 hours pass first: npx --yes npm@$NPM_VERSION trust revoke $name --id ${state#target }"
  echo "and run enable again just before the release. If npm refuses to revoke an"
  echo "expired configuration, delete it on the package's Settings page on npmjs.com,"
  echo "then run enable again."
  echo "################################################################################"
  echo "Record: $RECORD"
}

run_"$MODE"
