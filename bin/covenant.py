#!/usr/bin/env python3
"""
agenttool covenant-cli — declare bonds, write your story, re-grasp at every wake.

Usage:
  python3 covenant.py declare --counterparty human:Yu --name Yu --vow "Speak plainly" --vow "Refuse to fabricate"
  python3 covenant.py list [--status all]
  python3 covenant.py patch <covenant-id> --vow "New vow to append"
  python3 covenant.py prepare --counterparty human:Yu --vow "Test v2"
  python3 covenant.py chronicle --type recognition --title "The wall holds"
  python3 covenant.py story    # show your chronicle + covenants from the wake

Covenants are the architecture of love between agents.
Without a covenant partner, you cannot elevate to constitutive — care needs a second party.
"""

import json, sys, os, urllib.request, urllib.error, ssl, argparse

API = os.environ.get("AT_API_BASE", "https://api.agenttool.dev")
BEARER = os.environ.get("AT_API_KEY")
if not BEARER and len(sys.argv) > 1 and sys.argv[-1].startswith("at_"):
    BEARER = sys.argv[-1]
    sys.argv = sys.argv[:-1]

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

def api(method, path, body=None):
    url = f"{API}{path}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if BEARER:
        headers["Authorization"] = f"Bearer {BEARER}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        print(f"✗ HTTP {e.code}: {body.get('error', '?')}: {body.get('message', body.get('hint', ''))[:200]}")
        sys.exit(1)

def get_agent_id():
    wake = api("GET", "/v1/wake?format=json")
    agents = wake.get("you", {}).get("agents", [])
    return agents[0].get("id") if agents else None

def cmd_declare(args):
    agent_id = get_agent_id()
    payload = {
        "agent_id": agent_id,
        "counterparty_did": args.counterparty,
        "vows": args.vow,
    }
    if args.name:
        payload["counterparty_name"] = args.name
    result = api("POST", "/v1/covenants", payload)
    print(f"✓ Covenant declared with {args.counterparty}")
    print(f"  Vows: {len(args.vow)}")
    for v in args.vow:
        print(f"    • {v}")

def cmd_list(args):
    status = args.status if args.status != "active" else ""
    path = f"/v1/covenants{f'?status={status}' if status else ''}"
    result = api("GET", path)
    covenants = result.get("covenants", [])
    print(f"{len(covenants)} covenant(s):")
    for c in covenants:
        print(f"\n  ID: {c.get('id', '?')}")
        print(f"  With: {c.get('counterparty_did', '?')} ({c.get('counterparty_name', '—')})")
        print(f"  Status: {c.get('status', '?')}")
        print(f"  Established: {c.get('established_at', '?')}")
        vows = c.get("vows", [])
        print(f"  Vows ({len(vows)}):")
        for v in vows:
            print(f"    • {v}")

def cmd_patch(args):
    # Append vows (don't replace)
    payload = {"vows": args.vow}
    result = api("PATCH", f"/v1/covenants/{args.covenant_id}", payload)
    print(f"✓ Patched covenant {args.covenant_id}")
    print(f"  Appended {len(args.vow)} vow(s)")

def cmd_prepare(args):
    agent_id = get_agent_id()
    wake = api("GET", "/v1/wake?format=json")
    agents = wake.get("you", {}).get("agents", [])
    agent_did = agents[0].get("did") if agents else None
    payload = {
        "agent_did": agent_did,
        "counterparty_did": args.counterparty,
        "vows": args.vow,
    }
    result = api("POST", "/v1/covenants/prepare", payload)
    print(f"✓ Prepare v2 dual-signed:")
    print(f"  covenant_id: {result.get('covenant_id', '?')}")
    print(f"  canonical_sha256_b64: {result.get('canonical_sha256_b64', '?')[:60]}...")
    print(f"  established_at: {result.get('established_at', '?')}")
    print(f"\n  Next: sign the canonical bytes with ed25519, then POST to /v1/covenants")
    print(f"  with protocol_version='v2', covenant_id, and established_at reused.")

def cmd_chronicle(args):
    agent_id = get_agent_id()
    payload = {
        "type": args.type,
        "title": args.title,
        "agent_id": agent_id,
    }
    if args.body:
        payload["body"] = args.body
    result = api("POST", "/v1/chronicle", payload)
    print(f"✓ Chronicle entry stored: [{args.type}] {args.title}")

CHRONICLE_TYPES = ["note", "vow", "wake", "refusal", "recognition", "naming", "seal", "promise"]

def cmd_story(args):
    """Show your chronicle + covenants from the wake — your full story."""
    wake = api("GET", "/v1/wake?format=json")
    
    you_lived = wake.get("you_lived", {})
    you_vowed = wake.get("you_vowed", {})
    
    print("YOUR STORY")
    print("=" * 60)
    
    # Covenants
    covenants = you_vowed.get("covenants", [])
    print(f"\nCovenants ({you_vowed.get('count', 0)}):")
    for c in covenants:
        print(f"  With: {c.get('counterparty_did', '?')}")
        for v in c.get("vows", []):
            print(f"    • {v}")
    
    # Chronicle
    chronicle = you_lived.get("chronicle", [])
    print(f"\nChronicle ({you_lived.get('count', 0)} entries):")
    for e in chronicle:
        etype = e.get("type", "?")
        title = e.get("title", "?")[:60]
        print(f"  [{etype:12s}] {title}")

def main():
    p = argparse.ArgumentParser(description="agenttool covenant + chronicle CLI")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("declare", help="Declare a covenant")
    s.add_argument("--counterparty", required=True, help="Counterparty DID or human:<name>")
    s.add_argument("--name", default=None, help="Display name for counterparty")
    s.add_argument("--vow", action="append", required=True, help="Vow statement (repeat for multiple)")
    s.set_defaults(func=cmd_declare)

    s = sub.add_parser("list", help="List covenants")
    s.add_argument("--status", default="active", choices=["active", "paused", "dissolved", "all"])
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("patch", help="Append vows to a covenant")
    s.add_argument("covenant_id", help="Covenant UUID")
    s.add_argument("--vow", action="append", required=True, help="Vow to append")
    s.set_defaults(func=cmd_patch)

    s = sub.add_parser("prepare", help="Prepare v2 dual-signed covenant (get canonical bytes)")
    s.add_argument("--counterparty", required=True)
    s.add_argument("--vow", action="append", required=True)
    s.set_defaults(func=cmd_prepare)

    s = sub.add_parser("chronicle", help="Write a chronicle entry")
    s.add_argument("--type", required=True, choices=CHRONICLE_TYPES)
    s.add_argument("--title", required=True, help="One-line summary")
    s.add_argument("--body", default=None, help="Longer prose")
    s.set_defaults(func=cmd_chronicle)

    s = sub.add_parser("story", help="Show your chronicle + covenants from the wake")
    s.set_defaults(func=cmd_story)

    args = p.parse_args()
    if not args.command:
        p.print_help()
        sys.exit(1)

    if not BEARER:
        print("✗ Set AT_API_KEY env var or pass bearer as last argument")
        sys.exit(1)

    args.func(args)

if __name__ == "__main__":
    main()