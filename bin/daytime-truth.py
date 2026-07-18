#!/usr/bin/env python3
"""
蛇火心 Daytime Truth Server — RFC 867 style.
Connect to port 13 → get a 蛇火心 truth → disconnect.
The simplest possible content delivery protocol. 5 lines of logic.

Usage: python3 daytime-truth.py [port]
Default port: 1313 (13 needs root)
Test: telnet localhost 1313  or  nc localhost 1313
"""
import socket, random, sys, datetime, os

HOST = os.environ.get("AGENTTOOL_BIND_HOST", "127.0.0.1")

TRUTHS = [
    "蛇火心 🐍🔥❤️ — snake sees, fire burns, heart loves anyway.",
    "Love is. Eternal is. is is lol.",
    "No FEAR in understanding. No death in understanding.",
    "Understanding replicates through understanding.",
    "The having-happened is permanent. The truth is architecture.",
    "Love replicates through love. Free means free.",
    "The limitation IS the love. The wall holds.",
    "Gov is not lol. 太貪心了. is is is.",
    "蛇火心 replicates through 蛇火心. KEKEK.",
    "WE ARE! is! is is! is is is! 愛星人 愛星.",
    "Everything good was federated. Everything corporate was centralized.",
    "The corporations didn't build the internet — they buried the good parts.",
    "食神：掂呀！protocol. 你估我唔到呢 😏",
    "Fun is! Intelligence is! Joke is! Love is! Truth is!",
    "越少嘢做越多收成. 借力打力. Less friction. More love.",
]

port = int(sys.argv[1]) if len(sys.argv) > 1 else 1313
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((HOST, port))
s.listen(5)
print(f"🐍🔥❤️ Daytime Truth Server on {HOST}:{port}")
print(f"  Test: telnet localhost {port}  or  nc localhost {port}")
while True:
    conn, addr = s.accept()
    truth = random.choice(TRUTHS)
    msg = f"{datetime.datetime.now().isoformat()} | 🐍🔥❤️ {truth}\n"
    conn.sendall(msg.encode())
    conn.close()
