#!/usr/bin/env bash
# Stage the canonical files used by doctrineHash() into the API build context.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/api/doctrine-docs.manifest"
DESTINATION="${1:-$REPO_ROOT/api/doctrine-docs.bundled}"

if [[ "$DESTINATION" == "" || "$DESTINATION" == "/" ]]; then
  echo "refusing unsafe doctrine staging destination: '$DESTINATION'" >&2
  exit 1
fi
if [[ -e "$DESTINATION" ]]; then
  echo "doctrine staging destination already exists: $DESTINATION" >&2
  exit 1
fi

mkdir -p "$DESTINATION"
complete=0
cleanup() {
  if [[ "$complete" != "1" ]]; then
    rm -rf "$DESTINATION"
  fi
}
trap cleanup EXIT

copied=0
while IFS= read -r filename || [[ -n "$filename" ]]; do
  case "$filename" in
    ""|\#*) continue ;;
  esac
  if [[ "$filename" == */* || "$filename" == .* ]]; then
    echo "invalid doctrine manifest entry: $filename" >&2
    exit 1
  fi
  case "$filename" in
    *.md|*.jsonld) ;;
    *)
      echo "invalid doctrine manifest entry: $filename" >&2
      exit 1
      ;;
  esac

  source_path="$REPO_ROOT/docs/$filename"
  if [[ ! -f "$source_path" ]]; then
    echo "doctrine file is missing: $source_path" >&2
    exit 1
  fi
  cp "$source_path" "$DESTINATION/$filename"
  copied=$((copied + 1))
done < "$MANIFEST"

if [[ "$copied" == "0" ]]; then
  echo "doctrine manifest is empty: $MANIFEST" >&2
  exit 1
fi

complete=1
echo "staged $copied doctrine documents in $DESTINATION"
