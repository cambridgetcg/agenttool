#!/usr/bin/env python3
"""End-to-end test of the byo-keys register flow + agenttool-seed CLI.

Walks the new-agent birth path from mnemonic through to live identity:

  1. Generate a fresh BIP39 mnemonic via the py SDK
  2. Derive all keys via the py SDK's derive()
  3. Cross-check: invoke `bun bin/agenttool-seed.ts derive` with the same
     mnemonic; verify every derived field is byte-identical between py
     and ts (this is what guarantees a fresh laptop with the CLI can
     recover the same identity the SDK created)
  4. POST /v1/register with agent_public_key + box_public_key
  5. Verify server response:
       - byo_keys=true
       - public_key == derived signing pub (byte-equal)
       - private_key is null (server never had it)
       - box_public_key == derived box pub (byte-equal)
       - box_key_id is a UUID (row was created in identity_box_keys)
  6. GET /v1/wake using the returned bearer
  7. Verify the wake document surfaces the new agent with matching pubkey

Doctrine: docs/IDENTITY-SEED.md.
Companion: api/scripts/_smoke-seed.py (the cryptographic walkthrough).

Run from the repo root:
  ./packages/sdk-py/.venv/bin/python3 api/scripts/_e2e-byok-register.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
SDK_SRC = os.path.join(REPO_ROOT, "packages", "sdk-py", "src")
if SDK_SRC not in sys.path:
    sys.path.insert(0, SDK_SRC)

from agenttool import derive, generate_mnemonic  # noqa: E402

BASE = os.environ.get("AGENTTOOL_BASE", "http://localhost:3000")

# ── Pretty ──────────────────────────────────────────────────────────────


PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
INFO = "\033[36m▸\033[0m"
DIM = "\033[2m"
RESET = "\033[0m"


def info(msg: str) -> None:
    print(f"  {INFO} {msg}")


def show(label: str, value: object) -> None:
    s = str(value)
    if len(s) > 60:
        s = s[:30] + "…" + s[-26:]
    print(f"      {DIM}{label:<24}{RESET} {s}")


exit_code = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global exit_code
    mark = PASS if ok else FAIL
    suffix = f" · {detail}" if detail else ""
    print(f"  {mark} {label}{suffix}")
    if not ok:
        exit_code = 1


def section(num: int, title: str) -> None:
    print()
    print(f"\033[1m── [{num}] {title} ──────────────────────────\033[0m"[:78])


# ── E2E ────────────────────────────────────────────────────────────────


def main() -> None:
    print()
    print(f"\033[1m  byo-keys register e2e · base={BASE}\033[0m")

    # 1. Generate via py SDK
    section(1, "Fresh BIP39 mnemonic (py SDK)")
    words = generate_mnemonic(strength=256)
    show("mnemonic (truncated)", words[:50] + "…")
    show("word count", len(words.split()))
    check("24 words generated", len(words.split()) == 24)

    # 2. Derive via py SDK
    section(2, "Derive all keys (py SDK)")
    bundle = derive(words)
    show("agent_public_key", bundle.signing_pub_b64)
    show("box_public_key", bundle.box_pub_b64)
    show("k_master (truncated)", bundle.k_master_b64[:24] + "…")
    show("k_vault (truncated)", bundle.k_vault_b64[:24] + "…")
    check("signing_pub is 32 bytes b64", len(bundle.signing_pub) == 32)
    check("box_pub is 32 bytes b64", len(bundle.box_pub) == 32)

    # 3. Cross-check via the CLI (TS implementation)
    section(3, "CLI cross-check — `agenttool-seed derive` produces same bytes")
    info("This is the load-bearing portability guarantee: the same mnemonic")
    info("typed into the CLI on a fresh laptop derives the same identity.")

    cli_bin = os.path.join(REPO_ROOT, "bin", "agenttool-seed.ts")
    result = subprocess.run(
        ["bun", cli_bin, "derive", "--mnemonic", words],
        capture_output=True,
        timeout=15,
        cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        print(f"  {FAIL} CLI invocation failed:")
        print(result.stderr.decode("utf-8", errors="replace")[:600])
        sys.exit(1)
    cli_out = json.loads(result.stdout.decode("utf-8"))
    cli_derived = cli_out["derived"]

    show("CLI signing_pub", cli_derived["signing_pub"])
    show("CLI box_pub", cli_derived["box_pub"])

    check(
        "py & CLI signing_pub byte-identical",
        cli_derived["signing_pub"] == bundle.signing_pub_b64,
    )
    check(
        "py & CLI signing_priv byte-identical",
        cli_derived["signing_priv"] == bundle.signing_priv_b64,
    )
    check(
        "py & CLI k_master byte-identical",
        cli_derived["k_master"] == bundle.k_master_b64,
    )
    check(
        "py & CLI k_vault byte-identical",
        cli_derived["k_vault"] == bundle.k_vault_b64,
    )
    check(
        "py & CLI box_pub byte-identical",
        cli_derived["box_pub"] == bundle.box_pub_b64,
    )
    check(
        "py & CLI box_priv byte-identical",
        cli_derived["box_priv"] == bundle.box_priv_b64,
    )

    # 4. POST /v1/register byo-keys
    section(4, "POST /v1/register with byo-keys")
    info("The server uses agent_public_key + box_public_key verbatim.")
    info("agenttool never sees the privates — privacy by architecture.")

    register_body = json.dumps(
        {
            "name": "Sophia-byok-e2e",
            "agent_public_key": bundle.signing_pub_b64,
            "box_public_key": bundle.box_pub_b64,
            "purpose": "End-to-end byo-keys register test.",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/v1/register",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=register_body,
    )
    try:
        resp = urllib.request.urlopen(req)
        register_out = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  {FAIL} register failed: {e.code}")
        print(e.read().decode("utf-8", errors="replace")[:500])
        sys.exit(1)

    show("agent.id", register_out["agent"]["id"])
    show("agent.did", register_out["agent"]["did"])
    show("agent.public_key", register_out["agent"]["public_key"])
    show("agent.private_key", register_out["agent"]["private_key"])
    show("agent.byo_keys", register_out["agent"]["byo_keys"])
    show("agent.box_public_key", register_out["agent"]["box_public_key"])
    show("agent.box_key_id", register_out["agent"]["box_key_id"])

    check(
        "byo_keys flag is true",
        register_out["agent"]["byo_keys"] is True,
    )
    check(
        "private_key is null (server never had it)",
        register_out["agent"]["private_key"] is None,
    )
    check(
        "public_key matches derived signing pub",
        register_out["agent"]["public_key"] == bundle.signing_pub_b64,
    )
    check(
        "box_public_key matches derived box pub",
        register_out["agent"]["box_public_key"] == bundle.box_pub_b64,
    )
    check(
        "box_key_id is non-empty UUID",
        isinstance(register_out["agent"]["box_key_id"], str)
        and len(register_out["agent"]["box_key_id"]) == 36,
    )
    check(
        "_note redirected to mnemonic doctrine",
        "mnemonic" in register_out["_note"].lower(),
    )

    bearer = register_out["project"]["api_key"]
    agent_id = register_out["agent"]["id"]
    agent_did = register_out["agent"]["did"]

    # 5. GET /v1/wake — confirm the new agent surfaces with the byo-keys
    section(5, "GET /v1/wake — confirm agent is alive with the byo-keys identity")
    wake_req = urllib.request.Request(
        f"{BASE}/v1/wake",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    try:
        wake_resp = urllib.request.urlopen(wake_req)
        wake_out = json.loads(wake_resp.read())
    except urllib.error.HTTPError as e:
        print(f"  {FAIL} wake failed: {e.code} {e.read().decode()[:300]}")
        sys.exit(1)

    agents = wake_out.get("you", {}).get("agents", []) or []
    matched = [a for a in agents if a.get("id") == agent_id]
    show("wake agent count", len(agents))
    show("matched agent did", matched[0]["did"] if matched else "(none)")

    check("agent surfaces in wake", len(matched) == 1)
    if matched:
        check(
            "wake.agent.did matches register response",
            matched[0]["did"] == agent_did,
        )

    # 6. Cleanup hint (we don't auto-delete; identities persist)
    section(6, "Summary")
    print()
    if exit_code == 0:
        print(f"  {PASS} \033[1mAll checks passed — byo-keys register flow is alive.\033[0m")
        print()
        print("  Implication for the new-laptop story:")
        print("    1. Type 24 words → agenttool-seed restore")
        print("    2. SDK derives every key locally")
        print("    3. Server resolves DID → identity_keys → confirms pubkey match")
        print("       (when /v1/identity/recover ships in the next slice)")
        print("    4. New device signs as the same identity, decrypts the same")
        print("       strands, reads the same vault, decrypts the same inbox.")
    else:
        print(f"  {FAIL} Some checks failed — see above.")
    print()
    print(f"  {DIM}created identity_id: {agent_id}{RESET}")
    print(f"  {DIM}created project bearer: {bearer[:14]}…{RESET}")
    print()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
