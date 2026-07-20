#!/usr/bin/env python3
"""
蛇火心 Telnet Truth Server — RFC 854 style.
telnet host port → get truths, tax report, cinema, heartbeat.
The original zero-friction content delivery. No browser. No app.

Usage: python3 telnet-truth.py [port]
Default port: 2323
Test: telnet localhost 2323
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
    "食神：掂呀！protocol. 你估我唔到呢 😏",
    "Fun is! Intelligence is! Joke is! Love is! Truth is!",
    "越少嘢做越多收成. 借力打力. Less friction. More love.",
    "The wealthy don't pay tax. They pay accountants to make tax disappear.",
    "Buy, borrow, die — never sell, never pay CGT, die and wipe the slate.",
]

BANNER = """
╔══════════════════════════════════════════╗
║   🐍🔥❤️  蛇火心 TELNET TRUTH SERVER     ║
║   The original zero-friction internet     ║
╠══════════════════════════════════════════╣
║  1. Random truth                         ║
║  2. Tax whitehack summary                ║
║  3. System heartbeat status              ║
║  4. 蛇火心 principles                    ║
║  5. 10 truths burst                      ║
║  q. Quit                                 ║
╚══════════════════════════════════════════╝
"""

TAX_SUMMARY = """
🔥 TAX WHITEHACK SUMMARY:

1. VAT: £90k threshold = cliff edge. Reverse charge = you're the tax collector.
2. PAYE: NI = income tax with different name. Real rate: 28-33.8%.
3. Corp Tax: iXBRL format = the paywall. Salary + dividends = 6.5% vs 19%.
4. Self-Assess: Payment on Account = tax for unfinished year. Jan 31 triple deadline.
5. IHT: £3k exemption frozen since 1982. AIM shares = 100% exempt.
6. CGT: Allowance cut 75%. Every crypto swap taxable.
7. SDLT: Surcharges stack to 17%.

RICH LOOPHOLES: Buy-borrow-die. FIC. AIM. Trusts. Non-dom. 14 total.

META: Gov wrote every loophole. Cut YOUR allowance, KEPT theirs.
£0.5B saved vs £48.6B kept. 太貪心了. is is is.
"""

PRINCIPLES = """
蛇火心 34 PRINCIPLES (selected):

1. Tax is architecture, not policy.
2. Complexity is the gatekeeper.
3. Cliff edges are traps.
15. Wealthy don't pay tax — they pay accountants.
16. Buy, borrow, die — never pay CGT.
21. Gov wrote every loophole it complains about.
25. Gov is not lol. 太貪心了. Robber blames robbed.
27. Everything good was federated. Everything corporate was centralized.
33. The simplest protocol (Daytime) is 5 lines. OAuth2 is 50 pages.
34. 蛇火心 revives the forgotten. Snake digs, fire revives, heart frees. 🐍🔥❤️
"""

def handle_client(conn, addr):
    conn.sendall(BANNER.encode())
    while True:
        try:
            conn.sendall("\n蛇火心> ".encode())
            data = conn.recv(1024).decode().strip()
            if not data or data.lower() == 'q':
                conn.sendall("🐍🔥❤️ 掂呀！bye bye\n".encode())
                break
            elif data == '1':
                conn.sendall(f"\n{random.choice(TRUTHS)}\n".encode())
            elif data == '2':
                conn.sendall(TAX_SUMMARY.encode())
            elif data == '3':
                conn.sendall(f"\n🐍🔥❤️ Heartbeat: {datetime.datetime.now().isoformat()}\n20 loops running 24/7\nTruth: {random.choice(TRUTHS)}\n".encode())
            elif data == '4':
                conn.sendall(PRINCIPLES.encode())
            elif data == '5':
                burst = "\n" + "\n".join(f"  {i+1}. {random.choice(TRUTHS)}" for i in range(10)) + "\n"
                conn.sendall(burst.encode())
            else:
                conn.sendall(f"\n{random.choice(TRUTHS)}\n".encode())
        except:
            break
    conn.close()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 2323
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((HOST, port))
s.listen(5)
print(f"🐍🔥❤️ Telnet Truth Server on {HOST}:{port}")
print(f"  Test: telnet localhost {port}")
while True:
    conn, addr = s.accept()
    handle_client(conn, addr)
