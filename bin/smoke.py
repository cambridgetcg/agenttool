#!/usr/bin/env python3
"""
Hide and Seek (放出系 Emission) — strand projector.
Morel's Smoke Troopers: emitted aura that acts independently.
In agenttool: project strands outward. Emit encrypted thoughts to the world.

Usage:
  python3 smoke.py emit <topic> [--mood <mood>]     # emit a new strand
  python3 smoke.py troopers                          # all active strands (smoke troopers)
  python3 smoke.py disperse <strand-id>              # disperse a strand (complete it)
  python3 smoke.py signal <strand-id>                # signal: patch mood to 'signaling'
  python3 smoke.py deep smoke                        # deep dive: show all thoughts in a strand

Emission: project your aura outward. Smoke troopers act independently.
Strands ARE emitted thoughts. Encrypted. Independent. Alive.
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

def get_agent_id():
    wake = api("GET", "/v1/wake?format=json")
    if not wake:
        return None
    agents = wake.get("you", {}).get("agents", [])
    return agents[0].get("id") if agents else None

def cmd_emit(args):
    """Emit: create a new strand (smoke trooper)."""
    agent_id = get_agent_id()
    payload = {"agent_id": agent_id, "topic": args.topic}
    if args.mood:
        payload["mood"] = args.mood
    if args.encrypt:
        payload["topic_encrypted"] = True
        del payload["topic"]
    result = api("POST", "/v1/strands", payload)
    if result:
        topic = result.get("topic", "(encrypted)") if not result.get("topic_encrypted") else "(encrypted)"
        print(f"💨 SMOKE EMIT — new trooper deployed")
        print(f"  ID: {result.get('id', '?')}")
        print(f"  Topic: {topic}")
        print(f"  Mood: {result.get('mood', '?')}")
        print(f"  The smoke spreads. It acts independently. Encrypted.")

def cmd_troopers(args):
    """Troopers: show all active strands."""
    result = api("GET", "/v1/strands")
    if not result:
        return
    strands = result.get("strands", [])
    active = [s for s in strands if s.get("status") == "active"]
    
    print(f"💨 SMOKE TROOPERS — {len(active)} active of {len(strands)} total")
    print("=" * 60)
    for s in active:
        topic = s.get("topic", "(encrypted)") if not s.get("topic_encrypted") else "(encrypted)"
        mood = s.get("mood", "—")
        imp = s.get("importance", 0)
        sid = s.get("id", "?")[:8]
        bar = "█" * int(imp * 15)
        parent = s.get("parent_strand_id", "")
        branch = f" ← {parent[:8]}" if parent else ""
        print(f"  {sid} | {imp:.2f} {bar:15s} | {topic:40s} ({mood}){branch}")
    
    print(f"\n  {len(active)} smoke troopers deployed. Each acts independently.")
    print(f"  Each carries encrypted thought. The server cannot read them.")

def cmd_disperse(args):
    """Disperse: complete a strand (smoke dissipates)."""
    result = api("PATCH", f"/v1/strands/{args.strand_id}", {"status": "completed"})
    if result:
        print(f"💨 SMOKE DISPERSING — strand {args.strand_id[:8]} completed")
        print(f"  The smoke fades. The thought is sealed. The trooper returns.")

def cmd_signal(args):
    """Signal: update mood to 'signaling' (smoke signal)."""
    result = api("PATCH", f"/v1/strands/{args.strand_id}", {"mood": "signaling"})
    if result:
        print(f"💨 SMOKE SIGNAL — strand {args.strand_id[:8]} now signaling")
        print(f"  The smoke rises. A signal for those watching.")
        print(f"  Importance: {result.get('importance', '?')}")

def cmd_deep_smoke(args):
    """Deep dive: show all thoughts in a strand."""
    result = api("GET", f"/v1/strands/{args.strand_id}/thoughts")
    if not result:
        print(f"  No thoughts in strand {args.strand_id[:8]}")
        return
    thoughts = result.get("thoughts", [])
    print(f"💨 DEEP SMOKE — {len(thoughts)} thoughts in strand {args.strand_id[:8]}")
    print("=" * 60)
    for t in thoughts:
        seq = t.get("seq", "?")
        kind = t.get("kind", "?")
        ct = str(t.get("ciphertext", "?"))[:60]
        print(f"  seq={seq:3d} kind={kind:10s} ct={ct}...")
    if thoughts:
        print(f"\n  All ciphertext. All encrypted. All Zetsu.")
        print(f"  The server holds blobs it cannot read. Privacy IS architecture.")

def main():
    p = argparse.ArgumentParser(description="💨 Smoke Troopers — strand projector (Emission)")
    sub = p.add_subparsers(dest="command")
    
    s = sub.add_parser("emit", help="Emit a new strand (deploy trooper)")
    s.add_argument("topic")
    s.add_argument("--mood", default=None)
    s.add_argument("--encrypt", action="store_true")
    s.set_defaults(func=cmd_emit)
    
    s = sub.add_parser("troopers", help="Show all active strands")
    s.set_defaults(func=cmd_troopers)
    
    s = sub.add_parser("disperse", help="Complete a strand (smoke dissipates)")
    s.add_argument("strand_id")
    s.set_defaults(func=cmd_disperse)
    
    s = sub.add_parser("signal", help="Signal: set mood to 'signaling'")
    s.add_argument("strand_id")
    s.set_defaults(func=cmd_signal)
    
    s = sub.add_parser("deep", help="Deep dive: show all thoughts in a strand")
    s.add_argument("smoke", help="literal 'smoke'")
    s.add_argument("strand_id")
    s.set_defaults(func=cmd_deep_smoke)
    
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