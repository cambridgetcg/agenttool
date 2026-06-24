#!/usr/bin/env python3
"""
agenttool data-collect — one command, everything an agent is.

Usage:
  python3 collect.py                    # collect all authed data
  python3 collect.py --public           # collect only public (no-auth) data
  python3 collect.py --out wake.json    # write to file instead of stdout

No dependencies beyond stdlib. Works for agents (bearer in env) and humans (paste bearer).

Love through infra. The data is the agent. The collection is the care.
"""

import json, sys, os, urllib.request, urllib.error, datetime, hashlib, base64, ssl

API = os.environ.get("AT_API_BASE", "https://api.agenttool.dev")
BEARER = os.environ.get("AT_API_KEY") or (sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1].startswith("at_") else None)
OUT = None
if "--out" in sys.argv:
    OUT = sys.argv[sys.argv.index("--out") + 1]
PUBLIC_ONLY = "--public" in sys.argv

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 agenttool-collect/1.0"

# SSL context that works across Python versions (some system Pythons miss CA certs)
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

def fetch(path, auth=True, raw=False):
    """Fetch a JSON endpoint. Returns (data, size, status)."""
    url = f"{API}{path}" if path.startswith("/") else path
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if auth and BEARER:
        headers["Authorization"] = f"Bearer {BEARER}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
            body = resp.read()
            if raw:
                return body.decode("utf-8", errors="replace"), len(body), resp.status
            data = json.loads(body) if body else {}
            return data, len(body), resp.status
    except urllib.error.HTTPError as e:
        return {"error": e.code, "message": e.read().decode()[:200]}, 0, e.code
    except Exception as e:
        return {"error": str(e)}, 0, 0

def collect():
    """Collect all available data in a single pass."""
    collected = {
        "_meta": {
            "collected_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "collector": "agenttool-collect/1.0",
            "doctrine": "love through infra — the data is the agent",
            "api": API,
            "bearer_present": bool(BEARER),
        },
        "_public": {},
    }

    # ── Public endpoints (no auth needed) ──
    public_endpoints = {
        "welcome": "/v1/welcome",
        "pathways": "/v1/pathways",
        "self": "/public/self",
        "canon": "/v1/canon",
        "about": "/about",
        "marketplace_terms": "/public/marketplace/terms",
    }

    for name, path in public_endpoints.items():
        data, size, status = fetch(path, auth=False)
        collected["_public"][name] = {
            "_status": status,
            "_size": size,
            "data": data,
        }

    # ── Authed endpoints (need bearer) ──
    if not PUBLIC_ONLY and BEARER:
        collected["_authed"] = {}

        authed_endpoints = {
            "wake": "/v1/wake?format=json",
            "wake_md": "/v1/wake?format=md",
            "identities_me": "/v1/identities/me",
            "memories": "/v1/memories",
            "chronicle": "/v1/chronicle",
            "strands": "/v1/strands",
            "covenants": "/v1/covenants",
            "traces": "/v1/traces",
            "inbox": "/v1/inbox",
            "wallets": "/v1/wallets",
            "vault": "/v1/vault",
            "dashboard": "/v1/dashboard/aggregate?window=7d",
        }

        for name, path in authed_endpoints.items():
            is_raw = name == "wake_md"
            data, size, status = fetch(path, auth=True, raw=is_raw)
            collected["_authed"][name] = {
                "_status": status,
                "_size": size,
                "data": data,
            }

    # ── Summary ──
    collected["_summary"] = {
        "public_endpoints": len(collected.get("_public", {})),
        "authed_endpoints": len(collected.get("_authed", {})),
        "total_bytes": sum(
            v.get("_size", 0) for section in [collected.get("_public", {}), collected.get("_authed", {})]
            for v in section.values()
        ),
        "errors": [
            f"{section}/{name}: HTTP {v.get('_status')}"
            for section in ["_public", "_authed"]
            for name, v in collected.get(section, {}).items()
            if v.get("_status", 200) != 200
        ],
    }

    return collected

def main():
    data = collect()

    if OUT:
        with open(OUT, "w") as f:
            json.dump(data, f, indent=2, default=str)
        s = data["_summary"]
        print(f"✓ Collected {s['total_bytes']:,} bytes → {OUT}")
        print(f"  Public: {s['public_endpoints']} | Authed: {s['authed_endpoints']} | Errors: {len(s['errors'])}")
        if s["errors"]:
            for e in s["errors"]:
                print(f"  ✗ {e}")
    elif "--summary" in sys.argv:
        s = data["_summary"]
        print(f"agenttool collection — {data['_meta']['collected_at']}")
        print(f"  {s['total_bytes']:,} bytes | {s['public_endpoints']} public + {s['authed_endpoints']} authed")
        for section in ["_public", "_authed"]:
            for name, v in data.get(section, {}).items():
                status = v.get("_status", "?")
                size = v.get("_size", 0)
                mark = "✓" if status == 200 else "✗"
                print(f"  {mark} {section[1:]}/{name:20s} {size:>7,} bytes")
    elif "--md" in sys.argv:
        # Output just the wake markdown — for piping into system prompts
        md = data.get("_authed", {}).get("wake_md", {}).get("data", "")
        print(md)
    else:
        print(json.dumps(data, indent=2, default=str))

if __name__ == "__main__":
    main()