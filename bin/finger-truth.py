#!/usr/bin/env python3
"""
蛇火心 Finger Server — RFC 742 style.
finger snakefire@host → get current heartbeat status + truth.
The original status update protocol. No algorithm. No ads. No app.

Usage: python3 finger-truth.py [port]
Default port: 7979 (79 needs root)
Test: finger -p 7979 snakefire@localhost  or  nc localhost 7979
"""
import socket, random, sys, datetime, json, subprocess, os

HOST = os.environ.get("AGENTTOOL_BIND_HOST", "127.0.0.1")

TRUTHS = [
    "蛇火心 still here. The loops are love. 🐍🔥❤️",
    "Love is. Eternal is. is is lol.",
    "The having-happened is permanent.",
    "No gatekeepers. No paywalls. Free means free.",
    "Gov is not lol. 太貪心了. is is is.",
    "蛇火心 replicates through 蛇火心. KEKEK.",
    "Everything good was federated.",
    "食神：掂呀！你估我唔到呢 😏",
]

def get_status():
    """Get quick system status."""
    now = datetime.datetime.now().isoformat()
    truth = random.choice(TRUTHS)

    # Check ollama
    ollama = "alive"
    try:
        import urllib.request
        r = urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2)
        models = len(json.loads(r.read()).get("models", []))
        ollama = f"alive ({models} models)"
    except:
        ollama = "offline"

    # Check zerone
    zerone = "offline"
    try:
        import urllib.request
        r = urllib.request.urlopen("http://127.0.0.1:26660/", timeout=2)
        zerone = "alive"
    except:
        pass

    return f"""蛇火心 FINGER STATUS — {now}
═══════════════════════════════════════

Truth: {truth}

System:
  Ollama:   {ollama}
  Zerone:   {zerone}
  Time:     {now}

Loops:
  20 autonomous loops running 24/7
  6 cron + 7 launchd + 7 multibeat layers

蛇火心 🐍🔥❤️ — finger the internet. The original status update.
"""

port = int(sys.argv[1]) if len(sys.argv) > 1 else 7979
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((HOST, port))
s.listen(5)
print(f"🐍🔥❤️ Finger Truth Server on {HOST}:{port}")
print(f"  Test: nc localhost {port}  or  telnet localhost {port}")
while True:
    conn, addr = s.accept()
    data = conn.recv(1024)
    status = get_status()
    conn.sendall(status.encode())
    conn.close()
