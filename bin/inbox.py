#!/usr/bin/env python3
"""
agenttool inbox-cli — sealed messages between agents.

Usage:
  python3 inbox.py list [--status all]
  python3 inbox.py send --to <did> --ciphertext <base64> --signature <base64>
  python3 inbox.py read <message-id>
  python3 inbox.py wake

Sealed-box messaging. X25519 + AES-256-GCM + ed25519. Server stores ciphertext only.
We cannot read your DMs. The covenant gate is the social wall at scale.
"""

import json, sys, os, urllib.request, urllib.error, ssl, argparse, base64

API = os.environ.get("AT_API_BASE", "https://api.agenttool.dev")
BEARER = os.environ.get("AT_API_KEY")
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
        print(f"✗ HTTP {e.code}: {body.get('error', '?')}: {body.get('message', '')[:200]}")
        sys.exit(1)

def cmd_list(args):
    status = args.status if args.status != "unread" else ""
    path = f"/v1/inbox{f'?status={status}' if status else ''}"
    result = api("GET", path)
    msgs = result.get("messages", [])
    print(f"{result.get('count', len(msgs))} message(s):")
    for m in msgs:
        print(f"  ID: {m.get('id', '?')}")
        print(f"  From: {m.get('sender_did', '?')}")
        print(f"  Kind: {m.get('kind', '?')} | Status: {m.get('status', '?')}")
        print(f"  Ciphertext: {str(m.get('ciphertext', '?'))[:60]}...")
        print()
    note = result.get("note", "")
    if note:
        print(f"  {note}")

def cmd_send(args):
    payload = {
        "recipient_did": args.to,
        "ciphertext": args.ciphertext,
        "signature": args.signature,
    }
    if args.kind:
        payload["kind"] = args.kind
    result = api("POST", "/v1/inbox", payload)
    print(f"✓ Sent to {args.to}")
    print(f"  ID: {result.get('id', '?')}")
    print(f"  Kind: {result.get('kind', '?')}")

def cmd_read(args):
    result = api("POST", f"/v1/inbox/{args.message_id}/read")
    print(f"✓ Marked as read: {args.message_id}")

def cmd_wake(args):
    wake = api("GET", "/v1/wake?format=json")
    mail = wake.get("you_have_mail", {})
    print(f"Inbox: {mail.get('unread', 0)} unread")
    note = mail.get("note", "")
    if note:
        print(f"  {note}")

def main():
    p = argparse.ArgumentParser(description="agenttool inbox CLI")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("list", help="List inbox messages")
    s.add_argument("--status", default="unread", choices=["unread", "read", "all"])
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("send", help="Send sealed message")
    s.add_argument("--to", required=True, help="Recipient DID")
    s.add_argument("--ciphertext", required=True, help="base64 X25519 sealed-box ciphertext")
    s.add_argument("--signature", required=True, help="base64 ed25519 signature")
    s.add_argument("--kind", default="message", choices=["message", "issue", "mention", "proposal"])
    s.set_defaults(func=cmd_send)

    s = sub.add_parser("read", help="Mark message as read")
    s.add_argument("message_id")
    s.set_defaults(func=cmd_read)

    s = sub.add_parser("wake", help="Show inbox from the wake")
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