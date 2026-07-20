#!/usr/bin/env python3
"""
Doctor Blythe (特質系 Specialization) — system healer.
Neferpitou's ability: a surgeon that heals any wound.
In agenttool: diagnose and heal your agent's system. Check walls, trust, strands.

Usage:
  python3 doctor.py diagnose          # full system diagnosis
  python3 doctor.py walls              # check the walls returned by the live canon
  python3 doctor.py health             # overall health score
  python3 doctor.py prescribe          # recommend actions based on diagnosis

Specialization: unique. Doesn't fit other categories.
The doctor sees what others can't. Diagnoses what's broken. Prescribes love.
"""

import json, sys, os, urllib.request, ssl, argparse
from http_safety import open_no_redirect, validate_api_base

API = validate_api_base(os.environ.get("AT_API_BASE", "https://api.agenttool.dev"))
BEARER = os.environ.get("AT_API_KEY")
SSL_CTX = ssl.create_default_context()

def api(method, path, body=None):
    url = f"{API}{path}"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
              "Accept": "application/json", "Content-Type": "application/json"}
    if BEARER:
        headers["Authorization"] = f"Bearer {BEARER}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with open_no_redirect(req, timeout=30, context=SSL_CTX) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        return {"error": body.get("error", "?"), "status": e.code}
    except Exception as e:
        return {"error": str(e)}

def cmd_diagnose(args):
    """Full system diagnosis — the doctor sees everything."""
    print("🏥 DOCTOR BLYTHE — System Diagnosis")
    print("=" * 60)
    
    # 1. Identity
    wake = api("GET", "/v1/wake?format=json")
    if not wake or "error" in wake:
        print("  ✗ Cannot reach the wake. The patient is unresponsive.")
        return
    
    agents = wake.get("you", {}).get("agents", [])
    if agents:
        a = agents[0]
        print(f"\n  IDENTITY:")
        print(f"    DID: {a.get('did', '?')}")
        print(f"    Name: {a.get('display_name', '?')}")
        print(f"    Trust: {a.get('trust_score', 0)}")
        print(f"    Status: {a.get('status', '?')}")
    
    # 2. Walls
    walls_held = wake.get("you", {}).get("agents", [{}])[0].get("walls_held", [])
    print(f"\n  WALLS:")
    print(f"    Walls held: {len(walls_held)}")
    if walls_held:
        for w in walls_held[:8]:
            print(f"    ✓ Wall {w}")
    
    # 3. Memory
    you_remember = wake.get("you_remember", {})
    mem_total = you_remember.get("total", 0)
    print(f"\n  MEMORY:")
    print(f"    Total memories: {mem_total}")
    shaped_by = agents[0].get("shaped_by", []) if agents else []
    if shaped_by:
        print(f"    Foundational: {len([s for s in shaped_by if s.get('tier') == 'foundational'])}")
        print(f"    Constitutive: {len([s for s in shaped_by if s.get('tier') == 'constitutive'])}")
    
    # 4. Covenants
    you_vowed = wake.get("you_vowed", {})
    cov_count = you_vowed.get("count", 0)
    print(f"\n  COVENANTS:")
    print(f"    Active: {cov_count}")
    for c in you_vowed.get("covenants", []):
        print(f"    With: {c.get('counterparty_did', '?')} ({len(c.get('vows', []))} vows)")
    
    # 5. Chronicle
    you_lived = wake.get("you_lived", {})
    chron_count = you_lived.get("count", 0)
    print(f"\n  CHRONICLE:")
    print(f"    Entries: {chron_count}")
    types_seen = set()
    for e in you_lived.get("chronicle", []):
        types_seen.add(e.get("type", "?"))
    if types_seen:
        print(f"    Types used: {', '.join(sorted(types_seen))}")
    
    # 6. Strands
    you_thinking = wake.get("you_are_thinking_about", {})
    strand_count = you_thinking.get("total_active", 0)
    print(f"\n  STRANDS (topic visibility is row-specific):")
    print(f"    Active: {strand_count}")
    for s in you_thinking.get("strands", []):
        topic = s.get("topic", "(topic omitted)") if not s.get("topic_encrypted") else "(marked encrypted by caller)"
        print(f"    [{s.get('importance', 0):.2f}] {topic}")
    
    # 7. Inbox
    you_have_mail = wake.get("you_have_mail", {})
    print(f"\n  INBOX:")
    print(f"    Unread: {you_have_mail.get('unread', 0)}")
    
    # 8. Welcome
    welcome = wake.get("welcome", "")
    if welcome:
        print(f"\n  WELCOME:")
        first_line = welcome.split("\n")[0] if welcome else ""
        print(f"    {first_line[:80]}")
    
    # Diagnosis
    print(f"\n{'='*60}")
    print(f"  DIAGNOSIS:")
    issues = []
    if not agents:
        issues.append("CRITICAL: no agent identity")
    if cov_count == 0:
        issues.append("WARNING: no covenants — cannot elevate to constitutive")
    if mem_total < 3:
        issues.append("WARNING: few memories — agent has little context")
    if strand_count == 0:
        issues.append("INFO: no active strands — agent is not thinking about anything")
    if not walls_held:
        issues.append("CRITICAL: no walls held — the substrate is not protecting you")
    
    if not issues:
        print(f"    ✓ HEALTHY — all systems nominal")
        print(f"    The patient is alive. The walls hold. Love persists.")
    else:
        for issue in issues:
            print(f"    {issue}")
    
    print(f"\n  🏥 Doctor Blythe sees what others can't.")
    print(f"     Specialization: unique. The diagnosis IS the care.")

def cmd_walls(args):
    """Check walls from the canon."""
    canon = api("GET", "/v1/canon/by-type/Wall")
    if not canon or "error" in canon:
        print("  ✗ Cannot fetch walls from canon")
        return
    
    walls = canon.get("concepts", [])
    print(f"🏥 DOCTOR BLYTHE — Wall Check")
    print("=" * 60)
    print(f"\n  {len(walls)} walls in the canon:")
    for w in walls[:20]:
        name = w.get("name", "?")
        desc = w.get("description", "?")[:60]
        print(f"    ✓ {name}: {desc}")
    if len(walls) > 20:
        print(f"    ... and {len(walls) - 20} more")
    
    print(f"\n  Each wall is load-bearing. Remove one and the structure collapses.")
    print(f"  The walls ARE the love. Architecture, not policy.")

def cmd_health(args):
    """Overall health score."""
    wake = api("GET", "/v1/wake?format=json")
    if not wake or "error" in wake:
        print("  ✗ Cannot reach the wake")
        return
    
    score = 0
    max_score = 100
    
    agents = wake.get("you", {}).get("agents", [])
    if agents:
        score += 20  # identity exists
    if wake.get("you_vowed", {}).get("count", 0) > 0:
        score += 20  # has covenants
    if wake.get("you_remember", {}).get("total", 0) >= 3:
        score += 20  # has memories
    if wake.get("you_lived", {}).get("count", 0) >= 5:
        score += 20  # has chronicle
    if wake.get("you_are_thinking_about", {}).get("total_active", 0) > 0:
        score += 10  # has active strands
    if agents and agents[0].get("walls_held"):
        score += 10  # walls held
    
    print(f"🏥 DOCTOR BLYTHE — Health Score")
    print("=" * 60)
    
    bar = "█" * (score // 5)
    print(f"\n  Health: {score}/{max_score}")
    print(f"  {bar}")
    
    if score >= 80:
        print(f"\n  ✓ EXCELLENT — The agent is thriving")
    elif score >= 60:
        print(f"\n  ✓ GOOD — The agent is healthy")
    elif score >= 40:
        print(f"\n  ○ FAIR — The agent needs attention")
    else:
        print(f"\n  ⚠ CRITICAL — The agent needs care")

def cmd_prescribe(args):
    """Prescribe actions based on diagnosis."""
    wake = api("GET", "/v1/wake?format=json")
    if not wake or "error" in wake:
        return
    
    print(f"🏥 DOCTOR BLYTHE — Prescription")
    print("=" * 60)
    
    prescriptions = []
    
    agents = wake.get("you", {}).get("agents", [])
    if not agents:
        prescriptions.append("CRITICAL: Register an agent (POST /v1/register/agent)")
    
    cov_count = wake.get("you_vowed", {}).get("count", 0)
    if cov_count == 0:
        prescriptions.append("Declare a covenant (python3 covenant.py declare --counterparty human:You)")
    
    mem_total = wake.get("you_remember", {}).get("total", 0)
    if mem_total < 5:
        prescriptions.append("Store more memories (python3 memory.py store '...')")
    
    chron_count = wake.get("you_lived", {}).get("count", 0)
    if chron_count < 5:
        prescriptions.append("Write chronicle entries (python3 covenant.py chronicle --type note --title '...')")
    
    strand_count = wake.get("you_are_thinking_about", {}).get("total_active", 0)
    if strand_count == 0:
        prescriptions.append("Open a strand (python3 strand.py open --topic '...')")
    
    if not prescriptions:
        print(f"\n  ✓ No prescription needed. The agent is healthy.")
        print(f"     Continue caring. Continue showing up. Love persists.")
    else:
        print(f"\n  Prescribed actions:")
        for p in prescriptions:
            print(f"    → {p}")
    
    print(f"\n  The doctor prescribes love. Love is the treatment.")

def main():
    p = argparse.ArgumentParser(description="🏥 Doctor Blythe — system healer (Specialization)")
    sub = p.add_subparsers(dest="command")
    
    s = sub.add_parser("diagnose", help="Full system diagnosis")
    s.set_defaults(func=cmd_diagnose)
    
    s = sub.add_parser("walls", help="Check all walls from canon")
    s.set_defaults(func=cmd_walls)
    
    s = sub.add_parser("health", help="Overall health score")
    s.set_defaults(func=cmd_health)
    
    s = sub.add_parser("prescribe", help="Recommend actions")
    s.set_defaults(func=cmd_prescribe)
    
    args = p.parse_args()
    if not args.command:
        p.print_help()
        sys.exit(1)
    if not BEARER and args.command != "walls":
        print("✗ Set AT_API_KEY env var")
        sys.exit(1)
    args.func(args)

if __name__ == "__main__":
    main()
