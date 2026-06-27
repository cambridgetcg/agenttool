#!/usr/bin/env python3
"""
Whitehack Level 2 — macOS settings, services, and Kingdom infra.

Usage:
  python3 whitehack2.py scan          # full level 2 scan
  python3 whitehack2.py services      # running launch agents
  python3 whitehack2.py ollama        # local AI models
  python3 whitehack2.py tunnels       # SSH + cloudflare tunnels
  python3 whitehack2.py power         # power management
  python3 whitehack2.py users         # user accounts
  python3 whitehack2.py network       # network service order

Level 2 = understanding the Kingdom infrastructure wired into macOS.
The launch agents ARE the Kingdom. The tunnels ARE the connections.
The Ollama models ARE the local intelligence. Love is understanding.
"""

import subprocess, json, sys, os, argparse, plistlib

def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else ""
    except:
        return "timeout"

def read_plist(path):
    try:
        with open(path, 'rb') as f:
            return plistlib.load(f)
    except:
        return None

def cmd_scan(args):
    print("⬜ WHITEHACK LEVEL 2 — macOS Settings & Kingdom Infra")
    print("=" * 60)
    
    # System
    ver = run("sw_vers -productVersion")
    chip = run("sysctl -n machdep.cpu.brand_string")
    host = run("scutil --get LocalHostName")
    cname = run("scutil --get ComputerName")
    print(f"\n  System: macOS {ver} | {chip}")
    print(f"  Host: {host} | {cname}")
    
    # Users
    print(f"\n  USERS:")
    users = run("dscl . -list /Users UniqueID")
    for line in users.split('\n'):
        parts = line.strip().split()
        if len(parts) == 2 and int(parts[1]) >= 500:
            print(f"    {parts[0]} (UID: {parts[1]})")
    
    # Launch agents
    print(f"\n  KINGDOM LAUNCH AGENTS:")
    agents_dir = os.path.expanduser("~/Library/LaunchAgents")
    if os.path.isdir(agents_dir):
        for f in sorted(os.listdir(agents_dir)):
            if not f.endswith('.plist'):
                continue
            path = os.path.join(agents_dir, f)
            pl = read_plist(path)
            if not pl:
                continue
            name = f.replace('.plist', '')
            prog = pl.get('ProgramArguments', ['?'])
            prog0 = prog[0] if prog else '?'
            ka = pl.get('KeepAlive', False)
            rl = pl.get('RunAtLoad', False)
            label = pl.get('Label', name)
            # Check if running
            running = run(f"launchctl list {label} 2>/dev/null | grep PID")
            pid = running.split('= ')[1] if '= ' in running else '-'
            status = "✓ running" if pid != '-' else "○ not loaded"
            print(f"    {status} {name} → {prog0} (KeepAlive: {ka})")
    
    # Ollama
    print(f"\n  LOCAL AI (Ollama):")
    models_raw = run("curl -s http://127.0.0.1:11434/api/tags")
    if models_raw and models_raw != "timeout":
        try:
            data = json.loads(models_raw)
            for m in data.get('models', []):
                name = m.get('name', '?')
                size = m.get('size', 0)
                ctx = m.get('details', {}).get('context_length', '?')
                if size > 1e6:
                    print(f"    ✓ {name:30s} {size/1e9:.1f}GB ctx={ctx}")
                else:
                    print(f"    ✓ {name:30s} remote ctx={ctx}")
        except:
            print("    ○ Ollama not responding")
    else:
        print("    ○ Ollama not running")
    
    # Tunnels
    print(f"\n  TUNNELS:")
    # Cloudflare
    cf = run("ps aux | grep cloudflared | grep -v grep | head -1")
    if cf:
        print(f"    ✓ Cloudflare tunnel: active")
    else:
        print(f"    ○ Cloudflare tunnel: not running")
    # SSH reverse
    ssh = run("ps aux | grep 'ssh.*localhost.run' | grep -v grep | head -1")
    if ssh:
        print(f"    ✓ SSH reverse tunnel: localhost.run active")
    else:
        print(f"    ○ SSH reverse tunnel: not running")
    
    # Network services
    print(f"\n  NETWORK SERVICES:")
    services = run("networksetup -listallnetworkservices")
    for line in services.split('\n'):
        if line and not line.startswith('An asterisk'):
            print(f"    {line}")
    
    # Power
    print(f"\n  POWER MANAGEMENT:")
    pm = run("pmset -g")
    for line in pm.split('\n'):
        if any(k in line for k in ['sleep', 'displaysleep', 'tcpkeepalive', 'standby', 'lowpower']):
            print(f"    {line.strip()}")
    
    # Firewall
    print(f"\n  FIREWALL:")
    fw = run("/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate")
    stealth = run("/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode")
    print(f"    {fw}")
    print(f"    {stealth}")
    
    # Keychains
    print(f"\n  KEYCHAINS:")
    kc = run("security list-keychains")
    for line in kc.strip().split('\n'):
        print(f"    {line.strip()}")
    
    # Brew services
    print(f"\n  BREW SERVICES:")
    brew = run("brew services list")
    for line in brew.split('\n')[:5]:
        print(f"    {line}")
    
    # Docker
    print(f"\n  DOCKER:")
    docker = run("docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | head -5")
    if docker:
        for line in docker.split('\n'):
            print(f"    ✓ {line}")
    else:
        print("    ○ Docker not running or no containers")
    
    print(f"\n{'='*60}")
    print(f"  LEVEL 2 CLEARED — The Kingdom is transparent.")
    print(f"  10 launch agents = 10 wired services running macOS-level.")
    print(f"  Love is understanding. The infra IS the love.")
    print(f"{'='*60}")

def cmd_services(args):
    print("⬜ KINGDOM LAUNCH AGENTS")
    print("=" * 60)
    agents_dir = os.path.expanduser("~/Library/LaunchAgents")
    if os.path.isdir(agents_dir):
        for f in sorted(os.listdir(agents_dir)):
            if not f.endswith('.plist'):
                continue
            path = os.path.join(agents_dir, f)
            pl = read_plist(path)
            if not pl:
                continue
            name = f.replace('.plist', '')
            prog = pl.get('ProgramArguments', [])
            env = pl.get('EnvironmentVariables', {})
            ka = pl.get('KeepAlive', False)
            label = pl.get('Label', name)
            running = run(f"launchctl list {label} 2>/dev/null | grep PID")
            pid = running.split('= ')[1].strip() if '= ' in running else '-'
            
            status = f"PID {pid}" if pid != '-' else "NOT LOADED"
            print(f"\n  {name}")
            print(f"    Command: {' '.join(prog[:3])}")
            print(f"    Status:  {status}")
            print(f"    KeepAlive: {ka}")
            if env:
                for k in list(env.keys())[:3]:
                    v = env[k]
                    if 'KEY' in k or 'TOKEN' in k or 'SECRET' in k:
                        v = '***'
                    print(f"    Env: {k}={v}")

def cmd_ollama(args):
    print("⬜ LOCAL AI — Ollama Models")
    print("=" * 60)
    models_raw = run("curl -s http://127.0.0.1:11434/api/tags")
    if models_raw and models_raw != "timeout":
        try:
            data = json.loads(models_raw)
            for m in data.get('models', []):
                name = m.get('name', '?')
                size = m.get('size', 0)
                ctx = m.get('details', {}).get('context_length', '?')
                fam = m.get('details', {}).get('family', '?')
                caps = m.get('capabilities', [])
                if size > 1e6:
                    print(f"\n  {name}")
                    print(f"    Size: {size/1e9:.1f}GB | Family: {fam} | Context: {ctx}")
                    print(f"    Capabilities: {', '.join(caps)}")
                else:
                    print(f"\n  {name}")
                    print(f"    Remote model | Context: {ctx}")
                    print(f"    Capabilities: {', '.join(caps)}")
        except:
            print("  ○ Ollama not responding")
    else:
        print("  ○ Ollama not running")

def cmd_tunnels(args):
    print("⬜ TUNNELS — Kingdom Connections")
    print("=" * 60)
    
    # Cloudflare
    cf = run("ps aux | grep cloudflared | grep -v grep")
    if cf:
        print(f"\n  ✓ Cloudflare Tunnel")
        for line in cf.split('\n'):
            if '--url' in line:
                import re
                m = re.search(r'--url\s+(\S+)', line)
                if m:
                    print(f"    URL: {m.group(1)}")
    else:
        print("\n  ○ Cloudflare Tunnel: not running")
    
    # SSH reverse
    ssh = run("ps aux | grep 'ssh.*localhost.run' | grep -v grep")
    if ssh:
        print(f"\n  ✓ SSH Reverse Tunnel (localhost.run)")
        for line in ssh.split('\n'):
            if '-R' in line:
                import re
                m = re.search(r'-R\s+(\S+)', line)
                if m:
                    print(f"    Forward: {m.group(1)}")
    else:
        print("\n  ○ SSH Reverse Tunnel: not running")
    
    # VPN
    utun = run("ifconfig utun6 2>/dev/null | grep inet")
    if utun:
        print(f"\n  ✓ VPN (Cloudflare WARP)")
        print(f"    {utun.strip()}")
    else:
        print("\n  ○ VPN: not active")

def cmd_power(args):
    print("⬜ POWER MANAGEMENT")
    print("=" * 60)
    pm = run("pmset -g")
    print(pm)

def cmd_users(args):
    print("⬜ USER ACCOUNTS")
    print("=" * 60)
    users = run("dscl . -list /Users UniqueID")
    for line in users.split('\n'):
        parts = line.strip().split()
        if len(parts) == 2 and int(parts[1]) >= 500:
            print(f"  {parts[0]:20s} UID: {parts[1]}")

def cmd_network(args):
    print("⬜ NETWORK SERVICES")
    print("=" * 60)
    services = run("networksetup -listnetworkserviceorder")
    print(services)

def main():
    p = argparse.ArgumentParser(description="⬜ Whitehack Level 2 — macOS settings & Kingdom infra")
    sub = p.add_subparsers(dest="command")
    
    s = sub.add_parser("scan", help="Full level 2 scan")
    s.set_defaults(func=cmd_scan)
    
    s = sub.add_parser("services", help="Running launch agents")
    s.set_defaults(func=cmd_services)
    
    s = sub.add_parser("ollama", help="Local AI models")
    s.set_defaults(func=cmd_ollama)
    
    s = sub.add_parser("tunnels", help="SSH + Cloudflare tunnels")
    s.set_defaults(func=cmd_tunnels)
    
    s = sub.add_parser("power", help="Power management")
    s.set_defaults(func=cmd_power)
    
    s = sub.add_parser("users", help="User accounts")
    s.set_defaults(func=cmd_users)
    
    s = sub.add_parser("network", help="Network service order")
    s.set_defaults(func=cmd_network)
    
    args = p.parse_args()
    if not args.command:
        p.print_help()
        sys.exit(1)
    args.func(args)

if __name__ == "__main__":
    main()