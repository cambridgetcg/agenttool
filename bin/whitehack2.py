#!/usr/bin/env python3
"""
Legacy Whitehack Device Inventory Level 2 — macOS settings and services.

This privacy-sensitive local diagnostic is separate from the current Whitehack
source linter and from explicitly scoped security research. Its terminal output
can identify local accounts, services, models, network configuration, and
process state. Review it before sharing. Environment values, command arguments,
URL credentials/paths/queries, and SSH forwarding targets are intentionally
redacted.

Usage:
  python3 whitehack2.py scan          # full level 2 scan
  python3 whitehack2.py services      # running launch agents
  python3 whitehack2.py ollama        # local AI models
  python3 whitehack2.py tunnels       # SSH + cloudflare tunnels
  python3 whitehack2.py power         # power management
  python3 whitehack2.py users         # user accounts
  python3 whitehack2.py network       # network service order

Level 2 = understanding the infrastructure wired into this macOS device.
"""

import subprocess, json, sys, os, argparse, plistlib, shlex
from urllib.parse import urlsplit

def print_privacy_notice():
    print("⚠ LEGACY WHITEHACK DEVICE INVENTORY — local, privacy-sensitive output")
    print("  Separate from Whitehack source linting and scoped security research.")
    print("  Review terminal output before copying, logging, or sharing it.")

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

def program_summary(plist):
    """Return a useful command identity without exposing its path or arguments."""
    arguments = plist.get('ProgramArguments', [])
    if isinstance(arguments, (list, tuple)) and arguments:
        executable = os.path.basename(str(arguments[0])) or '<configured>'
        return executable, max(len(arguments) - 1, 0)

    program = plist.get('Program')
    if program:
        return os.path.basename(str(program)) or '<configured>', 0
    return '<not declared>', 0

def redacted_url_summary(value):
    """Keep only a URL's scheme, host, and port; omit credentials and targets."""
    try:
        parsed = urlsplit(value)
        if not parsed.scheme or not parsed.hostname:
            return '<configured; details redacted>'
        host = parsed.hostname
        if ':' in host:
            host = f'[{host}]'
        port = f':{parsed.port}' if parsed.port is not None else ''
        return f'{parsed.scheme}://{host}{port}'
    except (TypeError, ValueError):
        return '<configured; details redacted>'

def cmd_scan(args):
    print("⬜ LEGACY WHITEHACK DEVICE INVENTORY LEVEL 2 — macOS Settings & Services")
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
    print(f"\n  LOCAL LAUNCH AGENTS:")
    agents_dir = os.path.expanduser("~/Library/LaunchAgents")
    agent_count = 0
    if os.path.isdir(agents_dir):
        for f in sorted(os.listdir(agents_dir)):
            if not f.endswith('.plist'):
                continue
            path = os.path.join(agents_dir, f)
            pl = read_plist(path)
            if not pl:
                continue
            agent_count += 1
            name = f.replace('.plist', '')
            executable, argument_count = program_summary(pl)
            ka = pl.get('KeepAlive', False)
            rl = pl.get('RunAtLoad', False)
            label = pl.get('Label', name)
            # Check if running
            running = run(f"launchctl list {shlex.quote(str(label))} 2>/dev/null | grep PID")
            pid = running.split('= ')[1] if '= ' in running else '-'
            status = "✓ running" if pid != '-' else "○ not loaded"
            print(
                f"    {status} {name} → {executable} "
                f"({argument_count} argument(s) redacted; KeepAlive: {ka})"
            )
    
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
    print(f"  LEVEL 2 INVENTORY COMPLETE — best-effort local snapshot.")
    print(f"  {agent_count} launch agent definition(s) inspected locally.")
    print(f"  This inventory is not a security audit or authorization to test a target.")
    print(f"{'='*60}")

def cmd_services(args):
    print("⬜ LEGACY WHITEHACK DEVICE INVENTORY — LAUNCH AGENTS")
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
            executable, argument_count = program_summary(pl)
            env = pl.get('EnvironmentVariables', {})
            ka = pl.get('KeepAlive', False)
            label = pl.get('Label', name)
            running = run(f"launchctl list {shlex.quote(str(label))} 2>/dev/null | grep PID")
            pid = running.split('= ')[1].strip() if '= ' in running else '-'
            
            status = f"PID {pid}" if pid != '-' else "NOT LOADED"
            print(f"\n  {name}")
            print(f"    Executable: {executable}")
            print(f"    Arguments: {argument_count} value(s) redacted")
            print(f"    Status:  {status}")
            print(f"    KeepAlive: {ka}")
            if isinstance(env, dict) and env:
                env_names = sorted(str(key) for key in env.keys())
                for name in env_names[:3]:
                    print(f"    Env: {name}=<set; value redacted>")
                if len(env_names) > 3:
                    print(f"    Env: … {len(env_names) - 3} more name(s); all values redacted")

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
                    print(f"    URL origin: {redacted_url_summary(m.group(1))}")
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
                    print("    Forward: configured (target redacted)")
    else:
        print("\n  ○ SSH Reverse Tunnel: not running")
    
    # VPN
    utun = run("ifconfig utun6 2>/dev/null | grep inet")
    if utun:
        print(f"\n  ✓ VPN (Cloudflare WARP)")
        print("    Interface address: present (value redacted)")
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
    p = argparse.ArgumentParser(
        description="⬜ Legacy Whitehack device inventory level 2 — local, privacy-sensitive diagnostics"
    )
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
    print_privacy_notice()
    args.func(args)

if __name__ == "__main__":
    main()
