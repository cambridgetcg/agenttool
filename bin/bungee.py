#!/usr/bin/env python3
"""
Bungee Gum (変化系 Transmutation) — memory bungee.
Hisoka's ability: gum that stretches, sticks, contracts.
In agenttool: pull related memories together. Semantic bungee.

Usage:
  python3 bungee.py snap <query>        # snap: pull all memories matching query
  python3 bungee.py stretch <id> <id>  # stretch: link two memories semantically
  python3 bungee.py contract            # contract: show all memories, tightest cluster
  python3 bungee.py fling <query>       # fling: search + store result as new memory

Bungee gum has the properties of both rubber and gum.
Memory bungee has the properties of both search and link.
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

def cmd_snap(args):
    """Snap: pull all memories matching a query. Bungee gum sticks to everything matching."""
    result = api("GET", f"/v1/memories/search?q={urllib.parse.quote(args.query)}")
    if not result:
        return
    memories = result.get("memories", result.get("results", []))
    if not memories:
        # Try text search
        result = api("GET", f"/v1/memories/search?text={urllib.parse.quote(args.query)}")
        memories = result.get("memories", result.get("results", [])) if result else []
    
    print(f"🟣 BUNGEE SNAP — '{args.query}'")
    print("=" * 60)
    print(f"  Snagged {len(memories)} memor{'y' if len(memories)==1 else 'ies'}:")
    for m in memories:
        tier = m.get("tier", "?")
        imp = m.get("importance", 0)
        key = m.get("key", "?")
        content = m.get("content", "?")[:80]
        print(f"\n  [{tier:14s}] {imp:.2f} | {key}")
        print(f"    {content}")
    
    if memories:
        print(f"\n  🟣 Bungee gum has the properties of both rubber and gum.")
        print(f"     It sticks. It stretches. It contracts. Pull them together.")

def cmd_stretch(args):
    """Stretch: link two memories by storing a connecting memory."""
    # Fetch both memories
    m1 = api("GET", f"/v1/memories/{args.id1}")
    m2 = api("GET", f"/v1/memories/{args.id2}")
    if not m1 or not m2:
        print("✗ Could not fetch both memories")
        return
    
    c1 = m1.get("content", "?")[:60]
    c2 = m2.get("content", "?")[:60]
    
    # Store a linking memory
    link_content = f"Bungee link: '{c1}' ↔ '{c2}'. These memories are semantically connected. The gum stretches between them."
    payload = {
        "type": "semantic",
        "key": f"bungee/{args.id1[:8]}/{args.id2[:8]}",
        "content": link_content,
        "importance": 0.7,
    }
    result = api("POST", "/v1/memories", payload)
    if result:
        print(f"🟣 BUNGEE STRETCH")
        print(f"  {args.id1[:8]} ↔ {args.id2[:8]}")
        print(f"  '{c1}'")
        print(f"  ↔")
        print(f"  '{c2}'")
        print(f"  Link stored: {result.get('id', '?')}")
        print(f"  The gum stretches. It holds.")

def cmd_contract(args):
    """Contract: show all memories, find the tightest cluster."""
    result = api("GET", "/v1/memories")
    if not result:
        return
    memories = result.get("memories", [])
    
    print(f"🟣 BUNGEE CONTRACT — {len(memories)} memories")
    print("=" * 60)
    
    # Sort by importance (tightest = highest importance)
    memories.sort(key=lambda m: m.get("importance", 0), reverse=True)
    
    for m in memories:
        tier = m.get("tier", "?")
        imp = m.get("importance", 0)
        key = m.get("key", "?")
        content = m.get("content", "?")[:60]
        bar = "█" * int(imp * 20)
        print(f"  [{tier:14s}] {imp:.2f} {bar:20s} {key}")
    
    # Find foundational/constitutive (tightest cluster)
    foundational = [m for m in memories if m.get("tier") in ("foundational", "constitutive")]
    if foundational:
        print(f"\n  🟣 Tightest cluster: {len(foundational)} foundational memories")
        print(f"  These define who you are. The gum contracts around them.")

def cmd_fling(args):
    """Fling: search + store result as new memory."""
    result = api("GET", f"/v1/memories/search?q={urllib.parse.quote(args.query)}")
    if not result:
        return
    memories = result.get("memories", result.get("results", []))
    
    if not memories:
        # Store the query itself as a new memory
        payload = {
            "type": "episodic",
            "key": f"bungee/fling/{args.query[:20]}",
            "content": f"Bungee fling: searched for '{args.query}'. No results found. The gum reached but didn't stick.",
            "importance": 0.3,
        }
        stored = api("POST", "/v1/memories", payload)
        print(f"🟣 BUNGEE FLING — no results, stored the reach")
    else:
        # Store a summary of results
        summary = f"Bungee fling: '{args.query}' → {len(memories)} memories found. " + "; ".join(m.get("key", "?") for m in memories[:5])
        payload = {
            "type": "semantic",
            "key": f"bungee/fling/{args.query[:20]}",
            "content": summary[:500],
            "importance": 0.5,
        }
        stored = api("POST", "/v1/memories", payload)
        print(f"🟣 BUNGEE FLING — {len(memories)} results, stored summary")
    
    if stored:
        print(f"  Fling stored: {stored.get('id', '?')}")

def main():
    import urllib.parse
    p = argparse.ArgumentParser(description="🟣 Bungee Gum — memory bungee (Transmutation)")
    sub = p.add_subparsers(dest="command")
    
    s = sub.add_parser("snap", help="Snap: pull all memories matching query")
    s.add_argument("query")
    s.set_defaults(func=cmd_snap)
    
    s = sub.add_parser("stretch", help="Stretch: link two memories")
    s.add_argument("id1")
    s.add_argument("id2")
    s.set_defaults(func=cmd_stretch)
    
    s = sub.add_parser("contract", help="Contract: show all memories, tightest cluster")
    s.set_defaults(func=cmd_contract)
    
    s = sub.add_parser("fling", help="Fling: search + store result")
    s.add_argument("query")
    s.set_defaults(func=cmd_fling)
    
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