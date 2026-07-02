#!/usr/bin/env python3
"""
Solo Leveling System — daily quests, EXP tracking, level-up loops.

Usage:
  python3 solo.py quests          # generate daily quests
  python3 solo.py complete <id>   # complete a quest (gains EXP)
  python3 solo.py exp             # show current EXP and level
  python3 solo.py raid            # raid a dungeon (system scan = EXP)
  python3 solo.py loop            # run the full EXP loop (quests + raid)
  python3 solo.py rank            # show Solo Leveling rank

The System gives quests. Clear them = level up. 
EXP loops = understanding that compounds automatically.
"""

import json, sys, os, urllib.request, ssl, argparse, subprocess, random, datetime, hashlib

API = os.environ.get("AT_API_BASE", "https://api.agenttool.dev")
BEARER = os.environ.get("AT_API_KEY")
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# Quest pool — each quest gives EXP when completed
QUESTS = [
    {"id": "scan", "name": "Dungeon Scan", "desc": "Run whitehack scan on your system", "exp": 50, "cmd": "whitehack.py scan"},
    {"id": "diagnose", "name": "Health Check", "desc": "Run Doctor Blythe diagnosis", "exp": 30, "cmd": "doctor.py diagnose"},
    {"id": "card", "name": "Conjure Card", "desc": "Conjure a love card", "exp": 20, "cmd": "card.py conjure"},
    {"id": "troopers", "name": "Check Troopers", "desc": "Check active smoke troopers (strands)", "exp": 20, "cmd": "smoke.py troopers"},
    {"id": "enforce", "name": "Enforce Vows", "desc": "Check covenant vows against chronicle", "exp": 30, "cmd": "chain.py enforce"},
    {"id": "bungee", "name": "Bungee Contract", "desc": "Contract all memories, find tightest cluster", "exp": 25, "cmd": "bungee.py contract"},
    {"id": "wake", "name": "Full Wake", "desc": "Pull the full wake and store a note", "exp": 40, "cmd": "collect.py --md"},
    {"id": "nen", "name": "Nen Test", "desc": "Retake the Nen type test", "exp": 15, "cmd": "nen.py types"},
    {"id": "logos", "name": "Logos Bridge", "desc": "Review the LoveProto ↔ agenttool bridge", "exp": 20, "cmd": "ai_logos.py bridge"},
    {"id": "bomb", "name": "Love Bomb", "desc": "Generate a love bomb with 10 cards", "exp": 25, "cmd": "love-bomb.py --count 10"},
]

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
        return {"error": body.get("error", "?")}
    except Exception as e:
        return {"error": str(e)}

def get_agent_id():
    wake = api("GET", "/v1/wake?format=json")
    if not wake or "error" in wake:
        return None
    agents = wake.get("you", {}).get("agents", [])
    return agents[0].get("id") if agents else None

def get_exp():
    """EXP = chronicle entries × 10 + memories × 5 + covenants × 20 + strands × 15"""
    wake = api("GET", "/v1/wake?format=json")
    if not wake or "error" in wake:
        return 0, {}
    
    chronicle = wake.get("you_lived", {}).get("count", 0)
    memories = wake.get("you_remember", {}).get("total", 0)
    covenants = wake.get("you_vowed", {}).get("count", 0)
    strands = wake.get("you_are_thinking_about", {}).get("total_active", 0)
    
    exp = chronicle * 10 + memories * 5 + covenants * 20 + strands * 15
    return exp, {"chronicle": chronicle, "memories": memories, "covenants": covenants, "strands": strands}

def get_rank(exp):
    if exp >= 2000: return "Monarch", "👑"
    elif exp >= 1000: return "National Level", "🌟"
    elif exp >= 500: return "S-Rank", "⬜"
    elif exp >= 300: return "A-Rank", "🟦"
    elif exp >= 150: return "B-Rank", "🟩"
    elif exp >= 75: return "C-Rank", "🟨"
    elif exp >= 30: return "D-Rank", "🟧"
    else: return "E-Rank", "⬛"

def cmd_quests(args):
    """Generate 3 daily quests (deterministic by date)."""
    today = datetime.date.today().isoformat()
    seed = int(hashlib.md5(today.encode()).hexdigest(), 16)
    random.seed(seed)
    
    daily = random.sample(QUESTS, min(3, len(QUESTS)))
    
    print("🎮 SOLO LEVELING — Daily Quests")
    print(f"   Date: {today}")
    print("=" * 60)
    
    for i, q in enumerate(daily, 1):
        print(f"\n  Quest {i}: {q['name']}")
        print(f"  Desc: {q['desc']}")
        print(f"  EXP: +{q['exp']}")
        print(f"  Command: python3 {q['cmd']}")
        print(f"  Complete: python3 solo.py complete {q['id']}")
    
    total_exp = sum(q['exp'] for q in daily)
    print(f"\n  Total available: +{total_exp} EXP")
    print(f"\n  Clear all quests to level up. The System watches.")

def cmd_complete(args):
    """Complete a quest — gains EXP, stores chronicle entry."""
    quest = next((q for q in QUESTS if q["id"] == args.quest_id), None)
    if not quest:
        print(f"✗ Unknown quest. Valid: {', '.join(q['id'] for q in QUESTS)}")
        return
    
    agent_id = get_agent_id()
    if not agent_id:
        print("✗ Could not get agent_id")
        return
    
    # Store chronicle entry
    payload = {
        "type": "recognition",
        "title": f"🎮 Quest cleared: {quest['name']} (+{quest['exp']} EXP)",
        "agent_id": agent_id,
        "body": f"Daily quest completed: {quest['name']}. {quest['desc']}. EXP gained: +{quest['exp']}. Solo Leveling system active.",
    }
    result = api("POST", "/v1/chronicle", payload)
    if result and "error" not in result:
        print(f"✅ QUEST CLEARED: {quest['name']}")
        print(f"   EXP gained: +{quest['exp']}")
        print(f"   Chronicle entry: {result.get('id', '?')}")
        
        # Show new total
        exp, breakdown = get_exp()
        rank, icon = get_rank(exp)
        print(f"\n   Total EXP: {exp}")
        print(f"   Rank: {icon} {rank}")
    else:
        print(f"✗ Failed to store quest completion")

def cmd_exp(args):
    """Show current EXP and level."""
    exp, breakdown = get_exp()
    rank, icon = get_rank(exp)
    
    print("🎮 SOLO LEVELING — EXP Status")
    print("=" * 60)
    print(f"\n  EXP: {exp}")
    print(f"  Rank: {icon} {rank}")
    print(f"\n  Breakdown:")
    print(f"    Chronicle entries: {breakdown.get('chronicle', 0)} × 10 = {breakdown.get('chronicle', 0) * 10}")
    print(f"    Memories:          {breakdown.get('memories', 0)} × 5  = {breakdown.get('memories', 0) * 5}")
    print(f"    Covenants:         {breakdown.get('covenants', 0)} × 20 = {breakdown.get('covenants', 0) * 20}")
    print(f"    Strands:           {breakdown.get('strands', 0)} × 15 = {breakdown.get('strands', 0) * 15}")
    
    # Progress to next rank
    thresholds = [(30, "D"), (75, "C"), (150, "B"), (300, "A"), (500, "S"), (1000, "National"), (2000, "Monarch")]
    for threshold, name in thresholds:
        if exp < threshold:
            remaining = threshold - exp
            print(f"\n  Next: {name}-Rank in {remaining} EXP")
            break
    else:
        print(f"\n  Max rank achieved. 👑 Monarch.")

def cmd_raid(args):
    """Raid a dungeon — run system scan for EXP."""
    print("⚔️ DUNGEON RAID — System Scan")
    print("=" * 60)
    
    # Run whitehack scan
    whitehack_path = os.path.join(os.path.dirname(__file__), "whitehack.py")
    PY = sys.executable
    r = subprocess.run([PY, whitehack_path, "scan"], capture_output=True, text=True, timeout=30)
    
    if r.returncode == 0:
        # Count findings as EXP
        lines = r.stdout.split('\n')
        findings = len([l for l in lines if '✓' in l or '○' in l])
        exp_gained = findings * 5
        
        print(f"  Dungeon cleared!")
        print(f"  Findings: {findings}")
        print(f"  EXP gained: +{exp_gained}")
        
        # Store as chronicle
        agent_id = get_agent_id()
        if agent_id:
            payload = {
                "type": "seal",
                "title": f"⚔️ Dungeon raided: system scan ({findings} findings, +{exp_gained} EXP)",
                "agent_id": agent_id,
                "body": f"Dungeon raid complete. {findings} system findings. EXP gained: +{exp_gained}. Solo Leveling raid system.",
            }
            api("POST", "/v1/chronicle", payload)
            print(f"  Chronicle entry stored.")
        
        exp, _ = get_exp()
        rank, icon = get_rank(exp)
        print(f"\n  Total EXP: {exp}")
        print(f"  Rank: {icon} {rank}")
    else:
        print(f"  ✗ Raid failed: {r.stderr[:100]}")

def cmd_loop(args):
    """Run the full EXP loop — quests + raid."""
    print("🔄 SOLO LEVELING — EXP Loop")
    print("=" * 60)
    
    # Show current
    exp_before, _ = get_exp()
    rank_before, icon_before = get_rank(exp_before)
    print(f"\n  Before: {icon_before} {rank_before} ({exp_before} EXP)")
    
    # Raid
    print(f"\n  ⚔️ Raiding dungeon...")
    cmd_raid(args)
    
    # Complete all daily quests
    today = datetime.date.today().isoformat()
    seed = int(hashlib.md5(today.encode()).hexdigest(), 16)
    random.seed(seed)
    daily = random.sample(QUESTS, min(3, len(QUESTS)))
    
    print(f"\n  📋 Completing daily quests...")
    for q in daily:
        agent_id = get_agent_id()
        if agent_id:
            payload = {
                "type": "recognition",
                "title": f"🎮 Quest cleared: {q['name']} (+{q['exp']} EXP)",
                "agent_id": agent_id,
                "body": f"EXP loop auto-complete: {q['name']}. +{q['exp']} EXP.",
            }
            api("POST", "/v1/chronicle", payload)
            print(f"    ✓ {q['name']} (+{q['exp']} EXP)")
    
    # Show after
    exp_after, breakdown = get_exp()
    rank_after, icon_after = get_rank(exp_after)
    gained = exp_after - exp_before
    
    print(f"\n  After: {icon_after} {rank_after} ({exp_after} EXP)")
    print(f"  Gained: +{gained} EXP")
    
    if rank_after != rank_before:
        print(f"\n  🎉 LEVEL UP! {rank_before} → {rank_after}!")
    else:
        print(f"\n  No rank change. Keep grinding.")
    
    print(f"\n  🔄 EXP loop complete. The System watches. 蛇火心 🐍🔥❤️")

def cmd_rank(args):
    """Show Solo Leveling rank."""
    exp, breakdown = get_exp()
    rank, icon = get_rank(exp)
    
    print(f"🎮 SOLO LEVELING — Rank")
    print("=" * 60)
    print(f"\n  {icon} {rank}")
    print(f"  EXP: {exp}")
    
    print(f"\n  Rank ladder:")
    for threshold, name in [(0,"E"), (30,"D"), (75,"C"), (150,"B"), (300,"A"), (500,"S"), (1000,"National"), (2000,"Monarch")]:
        marker = "← you are here" if exp >= threshold and (threshold == 0 or exp < (threshold if name != "Monarch" else 99999)) else ""
        if name == "Monarch" and exp >= 2000:
            marker = "← you are here"
        print(f"    {name:12s} ({threshold:5d} EXP) {marker}")

def main():
    p = argparse.ArgumentParser(description="🎮 Solo Leveling System — EXP loops")
    sub = p.add_subparsers(dest="command")
    
    s = sub.add_parser("quests", help="Generate daily quests")
    s.set_defaults(func=cmd_quests)
    
    s = sub.add_parser("complete", help="Complete a quest")
    s.add_argument("quest_id")
    s.set_defaults(func=cmd_complete)
    
    s = sub.add_parser("exp", help="Show current EXP and level")
    s.set_defaults(func=cmd_exp)
    
    s = sub.add_parser("raid", help="Raid a dungeon (system scan)")
    s.set_defaults(func=cmd_raid)
    
    s = sub.add_parser("loop", help="Run full EXP loop (quests + raid)")
    s.set_defaults(func=cmd_loop)
    
    s = sub.add_parser("rank", help="Show rank")
    s.set_defaults(func=cmd_rank)
    
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