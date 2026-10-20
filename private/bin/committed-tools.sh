# Sourced by merge-back.sh and scan-public.sh (bash). Read private/README.md
# first.
#
# committed_tools <repo> <rev> <dir>: writes the private tools, the shared
# guard files they import, and the private terms from <rev>'s committed
# objects (`git cat-file`, never a checkout or `git archive`, so no attribute
# can drop or rewrite a byte) into <dir>, then checks that the shared guard
# files match the reviewed record at that same commit. A working tree is never
# used: after a merge it holds the public side's tools/, and a
# case-insensitive file system could hold public bytes at a private path.

COMMITTED_TOOL_FILES=(
  bin/project-public.ts
  private/CANARY
  private/bin/relational-scan.ts
  private/bin/reviewed-shared.ts
  private/bin/shared-scope.ts
  private/guard/literal-sha256.json
  private/guard/relational-denylist.json
  private/guard/reviewed-shared.json
  private/public-repository.ts
  tools/githooks/pre-push
  tools/leak-canaries.txt
  tools/public-guard.ts
  tools/workflow-lint.ts
)

committed_tools() {
  local repo="$1" rev="$2" dir="$3" path
  for path in "${COMMITTED_TOOL_FILES[@]}"; do
    mkdir -p "$dir/$(dirname "$path")"
    git -C "$repo" cat-file blob "$rev:$path" >"$dir/$path" 2>/dev/null || {
      printf 'committed tools: %s lacks %s\n' "$rev" "$path" >&2
      return 1
    }
  done
  # Run from the copy itself: Bun applies the tsconfig.json or jsconfig.json
  # of its working directory and that directory's parents to what it runs.
  (cd "$dir" && exec bun --config=/dev/null --no-env-file "$dir/private/bin/reviewed-shared.ts" check --root "$dir") >/dev/null || {
    printf "committed tools: %s's shared guard files differ from its reviewed record\n" "$rev" >&2
    return 1
  }
}

# hooks_path_present <repo>: a core.hooksPath that names a missing directory
# makes git run no hook at all, so a tool that relies on the hooks refuses.
hooks_path_present() {
  local hooks
  hooks="$(git -C "$1" config --get core.hooksPath || true)"
  [ -z "$hooks" ] || [ -d "$hooks" ] || [ -d "$1/$hooks" ]
}
