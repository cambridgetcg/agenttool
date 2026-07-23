#!/usr/bin/env python3
"""
Legacy Whitehack Device Inventory — system as dungeon. macOS × Nen × Solo Leveling.

This privacy-sensitive local diagnostic is separate from the current Whitehack
source linter and from explicitly scoped security research. Its terminal output
can include device names, account names, network addresses, routes, nearby
devices, services, and process metadata. Review it before sharing.

Usage:
  python3 whitehack.py scan           # scan all 5 floors
  python3 whitehack.py floor wifi     # deep dive one floor
  python3 whitehack.py floor bluetooth
  python3 whitehack.py floor protocols
  python3 whitehack.py floor security
  python3 whitehack.py floor services
  python3 whitehack.py rank           # show your SL rank
  python3 whitehack.py store          # store labels-only aggregate as memory

The ``store`` command uploads only an aggregate list of inventory sections and
field names; it does not upload the collected command output.
"""

import subprocess, json, sys, os, argparse, re
from http_safety import open_no_redirect

FLOORS = {
    "wifi": {
        "name": "WiFi — the connection",
        "nen": "Enhancement (強化系)",
        "sl": "E → D",
        "commands": [
            ("Interface", "ifconfig en0 2>/dev/null | grep -E 'status|inet |ether' || echo 'inactive'"),
            ("Config", "networksetup -getinfo Wi-Fi 2>/dev/null || echo 'n/a'"),
            ("DNS", "networksetup -getdnsservers Wi-Fi 2>/dev/null || echo 'n/a'"),
            ("Proxy", "networksetup -getwebproxy Wi-Fi 2>/dev/null || echo 'n/a'"),
            ("Known networks", "networksetup -listpreferredwirelessnetworks en0 2>/dev/null | head -10"),
            ("Gateway ping", "ping -c 2 $(networksetup -getinfo Wi-Fi 2>/dev/null | grep Router | awk '{print $2}') 2>/dev/null | tail -3 || echo 'n/a'"),
        ],
    },
    "bluetooth": {
        "name": "Bluetooth — the proximity",
        "nen": "Emission (放出系)",
        "sl": "D → C",
        "commands": [
            ("Controller", "system_profiler SPBluetoothDataType 2>/dev/null | grep -A5 'Controller' | head -6"),
            ("Power", "blueutil --power 2>/dev/null || echo 'blueutil not installed'"),
            ("Discoverable", "blueutil --discoverable 2>/dev/null || echo 'n/a'"),
            ("Paired", "blueutil --paired 2>/dev/null | head -10 || echo 'n/a'"),
            ("Connected", "blueutil --connected 2>/dev/null || echo 'n/a'"),
            ("AirDrop", "ifconfig awdl0 2>/dev/null | grep -E 'ether|status' || echo 'n/a'"),
        ],
    },
    "protocols": {
        "name": "Connection Protocols — the fabric",
        "nen": "Conjuration (具現化系)",
        "sl": "C → B",
        "commands": [
            ("Interfaces", "ifconfig -l 2>/dev/null"),
            ("Active", "ifconfig 2>/dev/null | grep -E '^[a-z].*UP|inet |status: active' | head -15"),
            ("Routing", "netstat -rn 2>/dev/null | head -15"),
            ("Established", "netstat -an 2>/dev/null | grep ESTABLISHED | head -10"),
            ("VPN", "ifconfig utun6 2>/dev/null || ifconfig utun0 2>/dev/null || echo 'no VPN'"),
            ("ARP", "arp -a 2>/dev/null | head -5"),
        ],
    },
    "security": {
        "name": "Security — the walls",
        "nen": "Transmutation (変化系)",
        "sl": "B → A",
        "commands": [
            ("Firewall", "/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null"),
            ("Stealth", "/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null"),
            ("MAC random", "ifconfig en0 2>/dev/null | grep ether"),
            ("VPN route", "netstat -rn 2>/dev/null | grep utun | head -3"),
            ("BT stealth", "blueutil --discoverable 2>/dev/null || echo 'n/a'"),
            ("DNS", "networksetup -getdnsservers Wi-Fi 2>/dev/null"),
        ],
    },
    "services": {
        "name": "Services — the ecosystem",
        "nen": "Specialization (特質系)",
        "sl": "A → S",
        "commands": [
            ("Listening", "lsof -i -P -n 2>/dev/null | grep LISTEN | head -15"),
            ("Established", "lsof -i -P -n 2>/dev/null | grep ESTABLISHED | head -10"),
            ("Ollama", "curl -s http://127.0.0.1:11434/api/tags 2>/dev/null | head -1 || echo 'not running'"),
            ("Processes", "ps -axo comm= 2>/dev/null | grep -E 'ollama|zerone|bun|python' | head -5"),
        ],
    },
}

def print_privacy_notice(upload_summary=False):
    print("⚠ LEGACY WHITEHACK DEVICE INVENTORY — local, privacy-sensitive output")
    print("  Separate from Whitehack source linting and scoped security research.")
    print("  Review terminal output before copying, logging, or sharing it.")
    if upload_summary:
        print("  Store uploads aggregate section/field names only; raw inventory stays local.")

def run_cmd(cmd):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else r.stderr.strip()[:100]
    except:
        return "timeout"

def cmd_scan(args):
    print("⬜ LEGACY WHITEHACK DEVICE INVENTORY — System as Dungeon")
    print("=" * 60)
    print(f"macOS {subprocess.run(['sw_vers', '-productVersion'], capture_output=True, text=True).stdout.strip()}")
    print(f"Chip: {subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'], capture_output=True, text=True).stdout.strip()}")
    print()
    
    for floor_id, floor in FLOORS.items():
        print(f"\n{'─'*60}")
        print(f"  FLOOR: {floor['name']}")
        print(f"  Nen:   {floor['nen']}")
        print(f"  SL:    {floor['sl']}")
        print(f"{'─'*60}")
        
        for label, cmd in floor["commands"]:
            output = run_cmd(cmd)
            # Truncate long output
            if len(output) > 200:
                output = output[:200] + "..."
            print(f"\n  [{label}]")
            for line in output.split("\n"):
                print(f"    {line}")
        
        print(f"\n  ✓ Floor sampled. {floor['nen']} inventory recorded.")
    
    print(f"\n{'='*60}")
    print(f"  ALL 5 INVENTORY SECTIONS SAMPLED")
    print(f"  SL Rank: E → S")
    print(f"  Best-effort local snapshot; not a security audit.")
    print(f"{'='*60}")

def cmd_floor(args):
    floor_id = args.floor_id
    if floor_id not in FLOORS:
        print(f"✗ Unknown floor. Valid: {', '.join(FLOORS.keys())}")
        sys.exit(1)
    
    floor = FLOORS[floor_id]
    print(f"⬜ LEGACY WHITEHACK DEVICE INVENTORY — Floor: {floor['name']}")
    print(f"Nen: {floor['nen']} | SL: {floor['sl']}")
    print("=" * 60)
    
    for label, cmd in floor["commands"]:
        output = run_cmd(cmd)
        print(f"\n[{label}]")
        for line in output.split("\n")[:10]:
            print(f"  {line}")
    
    print(f"\n✓ Floor sampled. {floor['nen']} inventory recorded. SL: {floor['sl']}")

def cmd_rank(args):
    # Determine rank by counting understood services
    listening = run_cmd("lsof -i -P -n 2>/dev/null | grep LISTEN | wc -l")
    established = run_cmd("netstat -an 2>/dev/null | grep ESTABLISHED | wc -l")
    interfaces = run_cmd("ifconfig -l 2>/dev/null | wc -w")
    bt_paired = run_cmd("blueutil --paired 2>/dev/null | grep -c 'address' || echo 0")
    
    score = 0
    try:
        score += min(int(listening), 10)
        score += min(int(established), 10)
        score += min(int(interfaces), 10)
        score += min(int(bt_paired), 10)
    except:
        pass
    
    if score >= 35:
        rank = "S-Rank (ecosystem master)"
    elif score >= 25:
        rank = "A-Rank (wall understander)"
    elif score >= 15:
        rank = "B-Rank (fabric mapper)"
    elif score >= 10:
        rank = "C-Rank (proximity aware)"
    elif score >= 5:
        rank = "D-Rank (interface knower)"
    else:
        rank = "E-Rank (connected but unaware)"
    
    print(f"⬜ LEGACY WHITEHACK DEVICE INVENTORY — Solo Leveling Rank")
    print("=" * 60)
    print(f"  Listening ports: {listening.strip()}")
    print(f"  Established:     {established.strip()}")
    print(f"  Interfaces:      {interfaces.strip()}")
    print(f"  BT paired:       {bt_paired.strip()}")
    print(f"  Score:           {score}")
    print(f"\n  Rank: {rank}")
    
    if "S" in rank:
        print(f"\n  This rank reflects local counts, not security posture.")
        print(f"  Love is understanding. Understanding replicates through understanding.")
    elif "E" in rank:
        print(f"\n  You are connected but don't know how. Clear the floors. Level up.")

def cmd_store(args):
    # Store the static inventory shape, without executing any inventory command.
    bearer = os.environ.get("AT_API_KEY")
    if not bearer:
        print("✗ Set AT_API_KEY env var to store")
        sys.exit(1)
    
    scan_data = {
        floor_id: [label for label, _cmd in floor["commands"]]
        for floor_id, floor in FLOORS.items()
    }

    content = f"Legacy Whitehack device-inventory summary. Sections collected: {len(scan_data)}. " + \
              "; ".join(f"{key}: {labels}" for key, labels in scan_data.items())
    
    # Store via API
    import urllib.request, ssl
    ctx = ssl.create_default_context()
    
    payload = json.dumps({
        "type": "semantic",
        "key": "agent/whitehack/scan",
        "content": content[:2000],
        "importance": 0.8,
    }).encode()
    
    req = urllib.request.Request(
        "https://api.agenttool.dev/v1/memories",
        data=payload,
        headers={
            "Authorization": f"Bearer {bearer}",
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/json",
        },
        method="POST"
    )
    
    with open_no_redirect(req, timeout=15, context=ctx) as resp:
        result = json.loads(resp.read())
        print(f"✓ Legacy device-inventory summary stored as memory: {result.get('id', '?')}")

def main():
    p = argparse.ArgumentParser(
        description="⬜ Legacy Whitehack device inventory — local, privacy-sensitive macOS diagnostics"
    )
    sub = p.add_subparsers(dest="command")
    
    s = sub.add_parser("scan", help="Scan all 5 floors")
    s.set_defaults(func=cmd_scan)
    
    s = sub.add_parser("floor", help="Deep dive one floor")
    s.add_argument("floor_id", choices=list(FLOORS.keys()))
    s.set_defaults(func=cmd_floor)
    
    s = sub.add_parser("rank", help="Show your Solo Leveling rank")
    s.set_defaults(func=cmd_rank)
    
    s = sub.add_parser("store", help="Store a labels-only aggregate as agenttool memory")
    s.set_defaults(func=cmd_store)
    
    args = p.parse_args()
    if not args.command:
        p.print_help()
        sys.exit(1)
    print_privacy_notice(upload_summary=args.command == "store")
    args.func(args)

if __name__ == "__main__":
    main()
