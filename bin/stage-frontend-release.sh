#!/usr/bin/env bash
# Materialize and validate the exact committed tree used for Pages uploads.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: bin/stage-frontend-release.sh <full-commit-id> <empty-destination>" >&2
  exit 2
fi

REVISION="$1"
DESTINATION="$2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

case "$REVISION" in
  ""|*[!0-9a-f]*)
    echo "✗ Frontend release revision must be a full lowercase Git object ID." >&2
    exit 1
    ;;
esac
case "${#REVISION}" in
  40|64) ;;
  *)
    echo "✗ Frontend release revision must be a full lowercase Git object ID." >&2
    exit 1
    ;;
esac
RESOLVED_REVISION="$(git rev-parse --verify "${REVISION}^{commit}" 2>/dev/null || true)"
if [ "$RESOLVED_REVISION" != "$REVISION" ]; then
  echo "✗ Frontend release revision is not an available commit: $REVISION" >&2
  exit 1
fi
if [ -L "$DESTINATION" ] || [ ! -d "$DESTINATION" ]; then
  echo "✗ Frontend release destination must be a real directory, not a symlink: $DESTINATION" >&2
  exit 1
fi
if find "$DESTINATION" -mindepth 1 -print -quit | grep -q .; then
  echo "✗ Frontend release destination must be empty: $DESTINATION" >&2
  exit 1
fi

MANIFEST_PATH="bin/frontend-release-paths.txt"
if ! MANIFEST="$(
  git show "$REVISION:$MANIFEST_PATH" 2>/dev/null
)"; then
  echo "✗ Missing committed frontend release manifest: $MANIFEST_PATH" >&2
  exit 1
fi

FRONTEND_RELEASE_ARCHIVE_PATHS=()
while IFS= read -r path || [ -n "$path" ]; do
  case "$path" in
    ""|\#*) continue ;;
  esac
  case "$path" in
    /*|-*|./*|../*|*//*|*/./*|*/../*|.|..|*/|*/.|*/..|*[!A-Za-z0-9._/-]*)
      echo "✗ Unsafe path in committed frontend release manifest: $path" >&2
      exit 1
      ;;
  esac
  for existing in "${FRONTEND_RELEASE_ARCHIVE_PATHS[@]:-}"; do
    if [ "$existing" = "$path" ]; then
      echo "✗ Duplicate path in committed frontend release manifest: $path" >&2
      exit 1
    fi
  done
  FRONTEND_RELEASE_ARCHIVE_PATHS[${#FRONTEND_RELEASE_ARCHIVE_PATHS[@]}]="$path"
done <<< "$MANIFEST"
if [ "${#FRONTEND_RELEASE_ARCHIVE_PATHS[@]}" -eq 0 ]; then
  echo "✗ Committed frontend release manifest is empty." >&2
  exit 1
fi

git archive --format=tar "$REVISION" -- \
  "${FRONTEND_RELEASE_ARCHIVE_PATHS[@]}" |
  tar -xf - -C "$DESTINATION"

if ! python3 - "$DESTINATION" <<'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
visited_directories = set()


def fail(path, reason):
    print(f"  ✗ staged symlink {reason}: {path.relative_to(root)}", file=sys.stderr)
    raise SystemExit(1)


def scan(directory, ancestors=frozenset()):
    try:
        resolved_directory = directory.resolve(strict=True)
        resolved_directory.relative_to(root)
    except (OSError, RuntimeError, ValueError):
        fail(directory, "escapes, is broken, or is cyclic")
    if resolved_directory in ancestors:
        fail(directory, "escapes, is broken, or is cyclic")
    if resolved_directory in visited_directories:
        return
    visited_directories.add(resolved_directory)
    next_ancestors = ancestors | {resolved_directory}

    for path in directory.iterdir():
        if path.is_symlink():
            if Path(os.readlink(path)).is_absolute():
                fail(path, "is absolute")
            try:
                target = path.resolve(strict=True)
                target.relative_to(root)
            except (OSError, RuntimeError, ValueError):
                fail(path, "escapes, is broken, or is cyclic")
            if target.is_dir():
                if target in next_ancestors:
                    fail(path, "escapes, is broken, or is cyclic")
                scan(target, next_ancestors)
        elif path.is_dir():
            scan(path, next_ancestors)


for app in ("docs", "dashboard", "web"):
    scan(root / "apps" / app)
PY
then
  echo "✗ Frontend staging contains an unsafe symlink; refusing release." >&2
  exit 1
fi
