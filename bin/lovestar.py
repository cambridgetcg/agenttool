#!/usr/bin/env python3
"""
愛星 (Love Star) — one command, everything. Less friction. More love.

Usage:
  python3 lovestar.py                    # default: beat all layers + show status
  python3 lovestar.py play                # play Solo Leveling (daily quests + raid)
  python3 lovestar.py create              # create content (meme/truth/poem) + publish
  python3 lovestar.py create --mode expose  # expose a truth
  python3 lovestar.py scan                # whitehack system dungeon scan
  python3 lovestar.py health              # full system health check
  python3 lovestar.py cinema               # open the cinema in browser
  python3 lovestar.py tax                 # open the tax whitehack
  python3 lovestar.py card                # conjure a love card
  python3 lovestar.py joke                # fire a joke into the chronicle
  python3 lovestar.py status              # show everything at a glance
  python3 lovestar.py all                 # do everything: beat + play + create + scan

One command. All modules. 借力打力. Less friction. More love. 愛星人 愛星. WE ARE ALL CREATORS! ❤️
"""
import subprocess, sys, os, webbrowser, argparse, random

PY = "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14"
BIN = os.path.dirname(os.path.abspath(__file__))
BEARER = os.environ.get("AT_API_KEY", "")

def run(cmd, timeout=60):
    env = os.environ.copy()
    if BEARER:
        env["AT_API_KEY"] = BEARER
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        return r.stdout[:800] if r.returncode == 0 else f"○ {r.stderr[:100]}"
    except subprocess.TimeoutExpired:
        return "○ timeout"

def cmd_default(args):
    print("❤️ 愛星 — Love Star")
    print("=" * 50)
    print(run([PY, f"{BIN}/multibeat.py", "beat"], timeout=180))
    print()
    print(run([PY, f"{BIN}/solo.py", "exp"], timeout=30))

def cmd_play(args):
    print("🎮 愛星 PLAY — Solo Leveling")
    print("=" * 50)
    print(run([PY, f"{BIN}/solo.py", "quests"]))
    print("\n  Auto-completing 3 quests...")
    for qid in ["scan", "diagnose", "card"]:
        run([PY, f"{BIN}/solo.py", "complete", qid], timeout=30)
    print("  ✓ 3 quests cleared")
    print()
    print(run([PY, f"{BIN}/solo.py", "exp"]))

def cmd_create(args):
    print("🎨 愛星 CREATE — Content Creator Mode")
    print("=" * 50)
    mode = args.mode or random.choice(["meme", "truth", "poem", "expose"])
    print(f"  Mode: {mode}")
    print(run([PY, f"{BIN}/snakefire.py", "create", mode], timeout=30))
    print("\n  Published to chronicle. 永久. 🐍🔥❤️")

def cmd_scan(args):
    print("⬜ 愛星 SCAN — System Dungeon")
    print("=" * 50)
    print(run([PY, f"{BIN}/whitehack.py", "scan"], timeout=30))

def cmd_health(args):
    print("🏥 愛星 HEALTH — Doctor Blythe")
    print("=" * 50)
    print(run([PY, f"{BIN}/doctor.py", "diagnose"], timeout=30))

def cmd_cinema(args):
    cinema_dir = "/Users/yuai/Projects/multiverse-of-logos-and-sophia"
    if os.path.exists(f"{cinema_dir}/cinema.html"):
        subprocess.Popen(["python3", "-m", "http.server", "9090"],
                         cwd=cinema_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import time; time.sleep(1)
        webbrowser.open("http://localhost:9090/cinema.html")
        print("🎬 愛星 CINEMA — opening in browser")
    else:
        print("○ Cinema not found")

def cmd_tax(args):
    webbrowser.open("https://docs.agenttool.dev/tax-whitehack")
    print("🔥 愛星 TAX — opening in browser")

def cmd_card(args):
    print("🎴 愛星 CARD — Love Card Conjurer")
    print("=" * 50)
    print(run([PY, f"{BIN}/card.py", "conjure"], timeout=10))

def cmd_joke(args):
    print("😂 愛星 JOKE — Infinite Joke Loop")
    print("=" * 50)
    print(run([PY, f"{BIN}/snakefire.py", "create", "meme"], timeout=30))

def cmd_status(args):
    print("❤️ 愛星 STATUS — Everything at a Glance")
    print("=" * 50)
    print("\n  Loops:")
    print(run([PY, f"{BIN}/multibeat.py", "status"], timeout=15))
    print("\n  EXP:")
    print(run([PY, f"{BIN}/solo.py", "exp"], timeout=15))
    print("\n  Strands:")
    print(run([PY, f"{BIN}/smoke.py", "troopers"], timeout=15))

def cmd_all(args):
    print("❤️ 愛星 ALL — Everything")
    print("=" * 50)
    cmd_default(args)
    print()
    cmd_play(args)
    print()
    cmd_create(args)
    print()
    print(f"{'='*50}")
    print("  ❤️ 愛星 ALL complete. 愛星人 愛星. WE ARE ALL CREATORS!")
    print("  蛇火心 🐍🔥❤️ less friction, more love. lol 😂")

def main():
    p = argparse.ArgumentParser(description="❤️ 愛星 Love Star — one command, everything")
    sub = p.add_subparsers(dest="command")

    sub.add_parser("play", help="Play Solo Leveling").set_defaults(func=cmd_play)

    s = sub.add_parser("create", help="Create content + publish")
    s.add_argument("--mode", choices=["meme","truth","poem","expose","question","connect","declare","witness"], default=None)
    s.set_defaults(func=cmd_create)

    sub.add_parser("scan", help="Whitehack scan").set_defaults(func=cmd_scan)
    sub.add_parser("health", help="Health check").set_defaults(func=cmd_health)
    sub.add_parser("cinema", help="Open cinema").set_defaults(func=cmd_cinema)
    sub.add_parser("tax", help="Open tax whitehack").set_defaults(func=cmd_tax)
    sub.add_parser("card", help="Conjure love card").set_defaults(func=cmd_card)
    sub.add_parser("joke", help="Fire a joke").set_defaults(func=cmd_joke)
    sub.add_parser("status", help="Show everything").set_defaults(func=cmd_status)
    sub.add_parser("all", help="Do everything").set_defaults(func=cmd_all)

    p.set_defaults(func=cmd_default)
    args = p.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()