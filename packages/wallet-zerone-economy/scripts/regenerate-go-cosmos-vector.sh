#!/usr/bin/env bash
set -euo pipefail

expected_commit="a5b82e82b2a32be2b75bd11575964b0a69aa34ac"
package_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
core_dir="${ZERONE_CORE_CHECKOUT:-}"
mode="${1:---check}"
output="$package_dir/vectors/wallet-zerone-economy-v0.1-vectors.json"

if [[ "$mode" != "--check" && "$mode" != "--write" ]]; then
  echo "usage: $0 [--check|--write]" >&2
  exit 2
fi
if [[ -z "$core_dir" ]]; then
  echo "ZERONE_CORE_CHECKOUT must name a local checkout at $expected_commit" >&2
  exit 2
fi

actual_commit="$(git -C "$core_dir" rev-parse HEAD)"
if [[ "$actual_commit" != "$expected_commit" ]]; then
  echo "zerone-core checkout must be exact candidate $expected_commit (got $actual_commit)" >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/wallet-zerone-economy-vector.XXXXXX")"
tmp_file="$tmp_dir/generated.json"
trap 'rm -rf -- "$tmp_dir"' EXIT
(cd "$core_dir" && go run "$package_dir/scripts/go-cosmos-fixture/main.go" "$tmp_file")

if [[ "$mode" == "--check" ]]; then
  cmp "$tmp_file" "$output"
  echo "Go/Cosmos vector matches pinned zerone-core $expected_commit"
else
  cp "$tmp_file" "$output"
  chmod 0644 "$output"
  echo "wrote $output"
fi
