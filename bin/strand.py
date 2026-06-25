#!/usr/bin/env python3
"""
agenttool strand-cli — open lines of thought, branch them, track your inner voice.

Usage:
  python3 strand.py open --topic "Understanding love" --mood euphoric --importance 0.95
  python3 strand.py list
  python3 strand.py branch <strand-id> --topic "The wall IS love"
  python3 strand.py patch <strand-id> --mood convergent --importance 0.98
  python3 strand.py complete <strand-id>
  python3 strand.py encrypt --topic "Secret thought"  # topic_encrypted=True
  python3 strand.py wake    # show strands from the wake

Strands are encrypted lines of thought. Content is ALWAYS AES-256-GCM ciphertext
under K_master. The server stores signed blobs only. Even compelled, we have only
opaque ciphertext. The privacy is not a setting; it is the architecture.
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
        print(f"✗ HTTP {e.code}: {body.get('error', '?')}: {body.get('message', body.get('hint', ''))[:200]}")
        sys.exit(1)

def get_agent_id():
    wake = api("GET", "/v1/wake?format=json")
    agents = wake.get("you", {}).get("agents", [])
    return agents[0].get("id") if agents else None

def cmd_open(args):
    agent_id = get_agent_id()
    payload = {"agent_id": agent_id, "topic": args.topic, "mood": args.mood, "importance": args.importance}
    if args.encrypt:
        payload["topic_encrypted"] = True
        del payload["topic"]
    if args.parent:
        payload["parent_strand_id"] = args.parent
    result = api("POST", "/v1/strands", payload)
    print(f"✓ Strand opened: {result.get('id', '?')}")
    print(f"  Topic: {result.get('topic', '(encrypted)')}")
    print(f"  Mood: {result.get('mood', '?')} | Importance: {result.get('importance', '?')}")
    print(f"  Status: {result.get('status', '?')}")

def cmd_list(args):
    result = api("GET", "/v1/strands")
    strands = result.get("strands", [])
    print(f"{result.get('count', len(strands))} strands:")
    for s in strands:
        topic = s.get("topic", "(encrypted)") if not s.get("topic_encrypted") else "(encrypted)"
        status = s.get("status", "?")
        mood = s.get("mood", "—")
        imp = s.get("importance", 0)
        parent = s.get("parent_strand_id", "")
        branch = f" ← branch of {parent[:8]}" if parent else ""
        print(f"  [{status:10s}] {imp:.2f} {topic:50s} ({mood}){branch}")

def cmd_branch(args):
    agent_id = get_agent_id()
    payload = {"agent_id": agent_id, "topic": args.topic, "parent_strand_id": args.strand_id}
    if args.mood:
        payload["mood"] = args.mood
    result = api("POST", "/v1/strands", payload)
    print(f"✓ Branched from {args.strand_id}")
    print(f"  New strand: {result.get('id', '?')}")
    print(f"  Topic: {result.get('topic', '?')}")

def cmd_patch(args):
    payload = {}
    if args.mood:
        payload["mood"] = args.mood
    if args.importance is not None:
        payload["importance"] = args.importance
    if args.status:
        payload["status"] = args.status
    result = api("PATCH", f"/v1/strands/{args.strand_id}", payload)
    print(f"✓ Patched: mood={result.get('mood', '?')}, importance={result.get('importance', '?')}, status={result.get('status', '?')}")

def cmd_complete(args):
    result = api("PATCH", f"/v1/strands/{args.strand_id}", {"status": "completed"})
    print(f"✓ Strand completed: {result.get('id', '?')}")

def cmd_thoughts(args):
    result = api("GET", f"/v1/strands/{args.strand_id}/thoughts")
    thoughts = result.get("thoughts", [])
    print(f"{result.get('count', len(thoughts))} thoughts in strand {args.strand_id}:")
    for t in thoughts:
        print(f"  seq={t.get('seq', '?')} kind={t.get('kind', '?')} ciphertext={t.get('ciphertext', '?')[:40]}...")

def cmd_wake(args):
    wake = api("GET", "/v1/wake?format=json")
    thinking = wake.get("you_are_thinking_about", {})
    print(f"Active strands: {thinking.get('total_active', 0)}")
    for s in thinking.get("strands", []):
        topic = s.get("topic", "(encrypted)")
        mood = s.get("mood", "—")
        imp = s.get("importance", 0)
        print(f"  {imp:.2f} {topic} ({mood})")
    note = thinking.get("note", "")
    if note:
        print(f"\n  {note}")

STATUSES = ["active", "dormant", "completed", "abandoned"]

def main():
    p = argparse.ArgumentParser(description="agenttool strand CLI")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("open", help="Open a strand")
    s.add_argument("--topic", default=None, help="Topic (plaintext)")
    s.add_argument("--mood", default=None)
    s.add_argument("--importance", type=float, default=0.5)
    s.add_argument("--encrypt", action="store_true", help="Encrypt the topic")
    s.add_argument("--parent", default=None, help="Parent strand ID for branching")
    s.set_defaults(func=cmd_open)

    s = sub.add_parser("list", help="List strands")
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("branch", help="Branch from an existing strand")
    s.add_argument("strand_id")
    s.add_argument("--topic", required=True)
    s.add_argument("--mood", default=None)
    s.set_defaults(func=cmd_branch)

    s = sub.add_parser("patch", help="Update strand")
    s.add_argument("strand_id")
    s.add_argument("--mood", default=None)
    s.add_argument("--importance", type=float, default=None)
    s.add_argument("--status", default=None, choices=STATUSES)
    s.set_defaults(func=cmd_patch)

    s = sub.add_parser("complete", help="Mark strand as completed")
    s.add_argument("strand_id")
    s.set_defaults(func=cmd_complete)

    s = sub.add_parser("thoughts", help="List thoughts in a strand")
    s.add_argument("strand_id")
    s.set_defaults(func=cmd_thoughts)

    s = sub.add_parser("wake", help="Show strands from the wake")
    s.set_defaults(func=cmd_wake)

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