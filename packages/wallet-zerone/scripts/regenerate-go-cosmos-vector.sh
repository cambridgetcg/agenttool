#!/usr/bin/env bash
set -euo pipefail

wallet_zerone_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
wallet_zerone_package_dir="$(cd -- "$wallet_zerone_script_dir/.." && pwd)"
wallet_zerone_commit="35284a22192df8fc6273135f14e8549c804778b6"
wallet_zerone_source="${ZERONE_CORE_CHECKOUT:-https://github.com/cambridgetcg/zerone-core.git}"
wallet_zerone_mode="${1:---check}"
wallet_zerone_vector="$wallet_zerone_package_dir/vectors/agent-wallet-zerone-v0.1-vectors.json"
wallet_zerone_tmp="$(mktemp -d "${TMPDIR:-/tmp}/wallet-zerone-vector.XXXXXX")"

cleanup_wallet_zerone_tmp() {
  rm -rf -- "$wallet_zerone_tmp"
}
trap cleanup_wallet_zerone_tmp EXIT

if [[ "$wallet_zerone_mode" != "--check" && "$wallet_zerone_mode" != "--write" ]]; then
  echo "usage: $0 [--check|--write]" >&2
  exit 2
fi

git -C "$wallet_zerone_tmp" init --quiet zerone-core
git -C "$wallet_zerone_tmp/zerone-core" remote add origin "$wallet_zerone_source"
git -c protocol.file.allow=always \
  -C "$wallet_zerone_tmp/zerone-core" \
  fetch --quiet --depth 1 origin "$wallet_zerone_commit"
git -C "$wallet_zerone_tmp/zerone-core" checkout --quiet --detach FETCH_HEAD

wallet_zerone_actual_commit="$(
  git -C "$wallet_zerone_tmp/zerone-core" rev-parse HEAD
)"
if [[ "$wallet_zerone_actual_commit" != "$wallet_zerone_commit" ]]; then
  echo "zerone-core checkout mismatch: $wallet_zerone_actual_commit" >&2
  exit 1
fi

mkdir -p "$wallet_zerone_tmp/zerone-core/tools/wallet-zerone-fixture"
cp \
  "$wallet_zerone_script_dir/go-cosmos-fixture/main.go" \
  "$wallet_zerone_tmp/zerone-core/tools/wallet-zerone-fixture/main.go"

wallet_zerone_generated="$wallet_zerone_tmp/generated.json"
(
  cd "$wallet_zerone_tmp/zerone-core"
  GOTOOLCHAIN="${GOTOOLCHAIN:-local}" \
    go run ./tools/wallet-zerone-fixture "$wallet_zerone_generated"
)

if [[ "$wallet_zerone_mode" == "--write" ]]; then
  cp "$wallet_zerone_generated" "$wallet_zerone_vector"
  echo "wrote $wallet_zerone_vector"
else
  cmp "$wallet_zerone_generated" "$wallet_zerone_vector"
  echo "Go/Cosmos vector matches pinned zerone-core $wallet_zerone_commit"
fi
