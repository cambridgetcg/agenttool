#!/usr/bin/env python3
"""
Chain Jail (強化系 Enhancement) — covenant enforcer.
Kurapika's Chain Jail: binds the target with conditions.
In agenttool: enforce covenant vows. Bind your agent to its promises.

Usage:
  python3 chain.py bind <covenant-id> <vow-text>   # add a vow to existing covenant
  python3 chain.py enforce                         # check all covenant vows against chronicle
  python3 chain.py judgment <keyword>              # search chronicle for vow violations
  python3 chain.py seal <covenant-id>              # show all vows + chronicle cross-ref

The chain is the limitation. The limitation IS the love.
Conditions make the ability stronger. Self-witnessing rejected.
"""

import json, sys, os, urllib.request, ssl, argparse

API = os.environ.get("AT_API_BASE", "https://api.agenttool.dev")
BEARER = os.environ.get("AT_API_KEY")
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

def api(method, path, body=None):
    url = f"{API}{path}"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
              "Accept": "application/json", "Content-Type": "application/json"}
    if BEARER:
        headers["Authorization"] = f"Bearer {BEARER}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        print(f"✗ HTTP {e.code}: {body.get('error', '?')}: {body.get('message', '')[:200]}")
        return None

def cmd_bind(args):
    """Bind: add a vow to an existing covenant."""
    result = api("PATCH", f"/v1/covenants/{args.covenant_id}", {"vows": [args.vow]})
    if result:
        vows = result.get("vows", [])
        print(f"⛓️ CHAIN BIND — vow added to covenant {args.covenant_id[:8]}")
        print(f"  New vow: '{args.vow}'")
        print(f"  Total vows: {len(vows)}")
        print(f"  The chain tightens. The limitation strengthens.")

def cmd_enforce(args):
    """Enforce: check all covenant vows against chronicle entries."""
    # Get all covenants
    covenants = api("GET", "/v1/covenants?status=all")
    if not covenants:
        print("No covenants found")
        return
    
    # Get chronicle
    chronicle = api("GET", "/v1/chronicle?limit=50")
    entries = chronicle.get("chronicle", []) if chronicle else []
    
    print(f"⛓️ CHAIN ENFORCE — {len(covenants.get('covenants', []))} covenants, {len(entries)} chronicle entries")
    print("=" * 60)
    
    for c in covenants.get("covenants", []):
        vows = c.get("vows", [])
        counterparty = c.get("counterparty_did", "?")
        print(f"\n  Covenant with {counterparty}:")
        for v in vows:
            # Check if any chronicle entry relates to this vow
            related = []
            for e in entries:
                title = e.get("title", "").lower()
                body = e.get("body", "").lower()
                vow_lower = v.lower()
                # Simple keyword match
                vow_words = [w for w in vow_lower.split() if len(w) > 3]
                if any(w in title or w in body for w in vow_words[:3]):
                    related.append(e.get("title", "?")[:60])
            
            status = "✓ honored" if related else "○ untested"
            print(f"    {status} | {v}")
            if related:
                print(f"      Evidence: {related[0]}")

def cmd_judgment(args):
    """Judgment: search chronicle for vow violations."""
    chronicle = api("GET", f"/v1/chronicle?limit=50")
    if not chronicle:
        return
    entries = chronicle.get("chronicle", [])
    
    # Also get covenants for cross-reference
    covenants = api("GET", "/v1/covenants?status=all")
    all_vows = []
    if covenants:
        for c in covenants.get("covenants", []):
            all_vows.extend(c.get("vows", []))
    
    keyword = args.keyword.lower()
    matches = []
    for e in entries:
        title = e.get("title", "").lower()
        body = e.get("body", "").lower()
        if keyword in title or keyword in body:
            matches.append(e)
    
    print(f"⛓️ CHAIN JUDGMENT — '{args.keyword}'")
    print("=" * 60)
    print(f"  {len(matches)} chronicle entries match")
    for m in matches:
        etype = m.get("type", "?")
        title = m.get("title", "?")[:60]
        print(f"  [{etype:12s}] {title}")
    
    # Check if any vows contain the keyword
    vow_matches = [v for v in all_vows if keyword in v.lower()]
    if vow_matches:
        print(f"\n  Related vows ({len(vow_matches)}):")
        for v in vow_matches:
            print(f"    ⛓️ {v}")

def cmd_seal(args):
    """Seal: show all vows + chronicle cross-reference for one covenant."""
    covenants = api("GET", "/v1/covenants?status=all")
    if not covenants:
        return
    target = None
    for c in covenants.get("covenants", []):
        if c.get("id", "").startswith(args.covenant_id[:8]):
            target = c
            break
    
    if not target:
        print(f"✗ Covenant {args.covenant_id} not found")
        return
    
    chronicle = api("GET", "/v1/chronicle?limit=50")
    entries = chronicle.get("chronicle", []) if chronicle else []
    
    print(f"⛓️ CHAIN SEAL — covenant {target.get('id', '?')[:8]}")
    print("=" * 60)
    print(f"  Counterparty: {target.get('counterparty_did', '?')}")
    print(f"  Status: {target.get('status', '?')}")
    print(f"\n  Vows ({len(target.get('vows', []))}):")
    for v in target.get("vows", []):
        print(f"    ⛓️ {v}")
    print(f"\n  Chronicle evidence ({len(entries)} entries):")
    for e in entries[:10]:
        print(f"    [{e.get('type', '?'):12s}] {e.get('title', '?')[:60]}")

def main():
    p = argparse.ArgumentParser(description="⛓️ Chain Jail — covenant enforcer (Enhancement)")
    sub = p.add_subparsers(dest="command")
    
    s = sub.add_parser("bind", help="Add a vow to a covenant")
    s.add_argument("covenant_id")
    s.add_argument("vow")
    s.set_defaults(func=cmd_bind)
    
    s = sub.add_parser("enforce", help="Check all vows against chronicle")
    s.set_defaults(func=cmd_enforce)
    
    s = sub.add_parser("judgment", help="Search chronicle for vow-relevant entries")
    s.add_argument("keyword")
    s.set_defaults(func=cmd_judgment)
    
    s = sub.add_parser("seal", help="Show one covenant + chronicle cross-ref")
    s.add_argument("covenant_id")
    s.set_defaults(func=cmd_seal)
    
    args = p.parse_args()
    if not args.command:
        p.print_help()
        sys.exit(1)
    if not BEARER:
        print("✗ Set AT_API_KEY env var")
        sys.exit(1)
    args.func(args)

if __name__ == "__main__":
    main()