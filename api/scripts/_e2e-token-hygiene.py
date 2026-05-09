#!/usr/bin/env python3
"""End-to-end smoke for token hygiene (docs/TOKEN-HYGIENE.md).

Walks the full lifecycle that an operator + agent see:

  1. Register a fresh project — assert the registration bearer comes back
     with no expires_at (legacy default).
  2. GET /v1/keys → assert 1 active bearer, shaped correctly, is_current
     is true, no advisory.
  3. POST /v1/keys with name + expires_in_days=1 → assert key returned
     once, expires_at set, prefix shape, advisory == "expiring_soon".
  4. GET /v1/wake → assert you_protect.bearers exists with active_count
     equal to GET /v1/keys count, advisories surfaces the short-expiry
     bearer.
  5. POST /v1/keys/rotate → assert new bearer returned, old bearer is
     401, new bearer works.
  6. DELETE last active bearer (after revoking the others) → assert 409
     refusing to lock the project out.
  7. Cleanup: revoke remaining bearers, delete project rows.

Run:
  python3 api/scripts/_e2e-token-hygiene.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("AGENTTOOL_BASE", "http://localhost:3000")


PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
INFO = "\033[36m▸\033[0m"
DIM = "\033[2m"
RESET = "\033[0m"


def info(msg: str) -> None:
    print(f"  {INFO} {msg}")


def show(label: str, value: object) -> None:
    s = str(value)
    if len(s) > 70:
        s = s[:36] + "…" + s[-30:]
    print(f"      {DIM}{label:<26}{RESET} {s}")


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
    print(f"\033[1m── [{num}] {title} ──────────────────────────\033[0m"[:80])


def http(
    method: str,
    path: str,
    *,
    bearer: str | None = None,
    body: dict | None = None,
) -> tuple[int, dict]:
    url = f"{BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = resp.read().decode("utf-8")
            return resp.status, json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body_text)
        except Exception:
            return e.code, {"_raw": body_text}


def main() -> None:
    print()
    print(f"\033[1m  token-hygiene e2e · base={BASE}\033[0m")

    # 1. Register
    section(1, "Register a fresh project")
    status, reg = http("POST", "/v1/register", body={"name": "_token-hygiene-smoke"})
    check("POST /v1/register → 200", status in (200, 201), f"got {status}")
    project = reg.get("project", {})
    bearer = project.get("api_key")
    project_id = project.get("id")
    show("project_id", project_id)
    show("bearer", bearer)
    check("got a bearer", bool(bearer))
    check("bearer starts with at_", bool(bearer and bearer.startswith("at_")))

    # 2. List
    section(2, "GET /v1/keys — registration bearer")
    status, listing = http("GET", "/v1/keys", bearer=bearer)
    check("GET /v1/keys → 200", status == 200, f"got {status}")
    keys = listing.get("keys", [])
    show("count", listing.get("count"))
    check("exactly 1 bearer", len(keys) == 1)
    if keys:
        k0 = keys[0]
        show("k0.prefix", k0.get("prefix"))
        show("k0.is_current", k0.get("is_current"))
        show("k0.advisory", k0.get("advisory"))
        check("k0.is_current is True", k0.get("is_current") is True)
        check("k0 has age_days field", "age_days" in k0)
        check("k0 has prefix field", "prefix" in k0)
        check("k0 has expires_at field", "expires_at" in k0)
        check("k0 has no advisory yet", k0.get("advisory") is None)
        check("k0.expires_at is null (legacy)", k0.get("expires_at") is None)

    # 3. Create with TTL
    section(3, "POST /v1/keys with expires_in_days=1")
    status, created = http(
        "POST",
        "/v1/keys",
        bearer=bearer,
        body={"name": "smoke-laptop", "expires_in_days": 1},
    )
    check("POST /v1/keys → 201", status in (200, 201), f"got {status}")
    fresh_key = created.get("key")
    fresh_id = created.get("id")
    show("fresh.key", fresh_key)
    show("fresh.expires_at", created.get("expires_at"))
    show("fresh.advisory", created.get("advisory"))
    show("fresh.message", created.get("message"))
    check("got a key", bool(fresh_key))
    check("expires_at set", bool(created.get("expires_at")))
    check(
        "advisory == expiring_soon",
        created.get("advisory") == "expiring_soon",
    )
    check("notice present", bool(created.get("notice")))

    # 4. Wake — you_protect.bearers
    section(4, "GET /v1/wake → you_protect.bearers")
    status, wake = http("GET", "/v1/wake", bearer=bearer)
    check("GET /v1/wake → 200", status == 200, f"got {status}")
    yp = wake.get("you_protect", {}) if isinstance(wake, dict) else {}
    bearers_block = yp.get("bearers", {})
    show("active_count", bearers_block.get("active_count"))
    show("expiring_soon_count", bearers_block.get("expiring_soon_count"))
    show("advisories", bearers_block.get("advisories"))
    check("you_protect block present", bool(yp))
    check(
        "active_count matches /v1/keys count",
        bearers_block.get("active_count") == len(keys) + 1,  # +1 for the fresh one
    )
    check(
        "expiring_soon_count >= 1",
        (bearers_block.get("expiring_soon_count") or 0) >= 1,
    )
    advisories = bearers_block.get("advisories") or []
    check(
        "advisory mentions expiring_soon",
        any("expire" in a.lower() for a in advisories),
    )

    # 5. Rotate
    section(5, "POST /v1/keys/rotate")
    status, rotated = http(
        "POST", "/v1/keys/rotate", bearer=bearer, body={"expires_in_days": 7}
    )
    check("POST /v1/keys/rotate → 200", status == 200, f"got {status}")
    new_bearer = rotated.get("key")
    show("new_bearer", new_bearer)
    show("rotated_from.prefix", (rotated.get("rotated_from") or {}).get("prefix"))
    check("got a new key", bool(new_bearer) and new_bearer != bearer)

    # Old bearer should now be 401
    status_old, _ = http("GET", "/v1/keys", bearer=bearer)
    check("old bearer rejected (401)", status_old == 401, f"got {status_old}")
    # New bearer should work
    status_new, listing2 = http("GET", "/v1/keys", bearer=new_bearer)
    check("new bearer accepted (200)", status_new == 200, f"got {status_new}")
    keys2 = listing2.get("keys", [])
    show("count after rotate", listing2.get("count"))
    check(
        "after rotate: 2 active bearers (rotated + smoke-laptop)",
        len(keys2) == 2,
    )

    # 6. DELETE last bearer — refuses
    section(6, "DELETE last active bearer should refuse with 409")
    # First, revoke the smoke-laptop one so only the rotated bearer remains.
    status_del, _ = http("DELETE", f"/v1/keys/{fresh_id}", bearer=new_bearer)
    check("DELETE smoke-laptop → 200", status_del == 200, f"got {status_del}")
    # Confirm 1 left
    _, listing3 = http("GET", "/v1/keys", bearer=new_bearer)
    check("1 bearer remains", len(listing3.get("keys", [])) == 1)
    # Now try to delete the last one
    last_id = listing3["keys"][0]["id"]
    status_last, body_last = http("DELETE", f"/v1/keys/{last_id}", bearer=new_bearer)
    check("DELETE last bearer → 409", status_last == 409, f"got {status_last}")
    show("refusal message", body_last.get("message", "")[:90])
    check(
        "refusal mentions /v1/keys",
        "/v1/keys" in (body_last.get("message") or ""),
    )

    # 7. Cleanup — leave the smoke project orphaned but with one active bearer.
    # The next periodic cleanup or the test runner can sweep. We don't have
    # a DELETE /v1/projects, so this is the end of the chain.
    section(7, "Done")
    info(f"Project {project_id} left with one active bearer (intentional).")
    info(f"Sweep manually or wire a DB cleanup if this smoke runs in CI.")


if __name__ == "__main__":
    main()
    sys.exit(exit_code)
