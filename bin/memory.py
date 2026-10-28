#!/usr/bin/env python3
"""
agenttool memory-cli — store, search, elevate, explore your memories.

Usage:
  python3 memory.py store "content text" [--type semantic] [--key my-key] [--importance 0.8]
  python3 memory.py search "query text" [--top-k 5]
  python3 memory.py list
  python3 memory.py elevate <memory-id> --tier foundational
  python3 memory.py elevate <memory-id> --tier constitutive --attestations witness.json
  python3 memory.py wake    # show memories from the wake

Constitutive elevation needs a witness. Fetch
GET /v1/memories/:id/canonical-attestation-bytes?tier=constitutive, have an active
covenant counterparty in another project sign those bytes, and pass their answer
as a JSON list of {attester_did, signing_key_id, signature} with --attestations.

On a project with one agent root, elevation at either tier also needs a request
signed by that root; a memory bound to an enrolled guest needs that guest's root.
This stdlib CLI cannot sign either; use the SDK's memory.elevate(..., authority=...)
there. With several agent roots the server refuses to elevate any memory not bound
to an enrolled guest (409 authority_quorum_required); there is no multi-root
quorum protocol yet.

Memory is care. Forgetting is not efficiency — it's neglect.
"""

import json, sys, os, urllib.request, urllib.error, ssl, argparse, hashlib, random
from http_safety import open_no_redirect, validate_api_base

API = validate_api_base(os.environ.get("AT_API_BASE", "https://api.agenttool.dev"))
BEARER = os.environ.get("AT_API_KEY")

SSL_CTX = ssl.create_default_context()

def api(method, path, body=None):
    url = f"{API}{path}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if BEARER:
        headers["Authorization"] = f"Bearer {BEARER}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with open_no_redirect(req, timeout=30, context=SSL_CTX) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            body = json.loads(raw)
        except ValueError:
            body = {"error": raw[:200]}
        print(f"✗ HTTP {e.code}: {body.get('error', '?')}: {body.get('message', body.get('hint', ''))[:200]}")
        if body.get("message") and body.get("hint"):
            print(f"  hint: {body['hint'][:300]}")
        if body.get("details"):
            print(f"  details: {json.dumps(body['details'])[:300]}")
        if body.get("error") == "authority_proof_required":
            print("  This CLI cannot sign root proofs; use the SDK's memory.elevate(..., authority=...).")
        sys.exit(1)

def gen_embedding(text):
    """Deterministic 1536-dim embedding from text (placeholder — use your own model in production)."""
    random.seed(hashlib.sha256(text.encode()).hexdigest())
    return [random.uniform(-1, 1) for _ in range(1536)]

def cmd_store(args):
    content = args.content
    mem = {
        "type": args.type,
        "key": args.key,
        "content": content,
        "importance": args.importance,
    }
    if args.embedding:
        mem["embedding"] = gen_embedding(content)
    result = api("POST", "/v1/memories", mem)
    print(f"✓ Stored: {result.get('id', '?')}")
    print(f"  Type: {result.get('type', args.type)} | Key: {args.key or '—'}")
    print(f"  Content: {content[:100]}")

def cmd_search(args):
    body = {"query": args.query, "top_k": args.top_k}
    if args.embedding:
        body["query_embedding"] = gen_embedding(args.query)
        del body["query"]
    result = api("POST", "/v1/memories/search", body)
    results = result.get("results", [])
    print(f"Found {result.get('count', len(results))} memories:")
    for r in results:
        score = r.get("score", 0)
        tier = r.get("tier", "?")
        text = r.get("content", "?")[:80]
        print(f"  {score:.4f} [{tier:12s}] {text}")

def cmd_list(args):
    result = api("GET", "/v1/memories")
    memories = result.get("memories", [])
    print(f"{result.get('count', len(memories))} memories:")
    for m in memories:
        tier = m.get("tier", "?")
        key = m.get("key", "—")
        text = m.get("content", "?")[:80]
        imp = m.get("importance", 0)
        print(f"  [{tier:12s}] {imp:.1f} {key:30s} | {text}")

def load_attestations(file_path):
    """Read a JSON list of {attester_did, signing_key_id, signature}, or refuse."""
    try:
        with open(file_path, encoding="utf-8") as f:
            attestations = json.load(f)
    except (OSError, ValueError) as e:
        print(f"✗ Cannot read attestations from {file_path}: {e}")
        print("  No request was sent.")
        raise SystemExit(2)
    fields = ("attester_did", "signing_key_id", "signature")
    ok = isinstance(attestations, list) and len(attestations) > 0 and all(
        isinstance(a, dict) and all(a.get(k) for k in fields) for a in attestations)
    if not ok:
        print(f"✗ {file_path} must hold a non-empty JSON list of {{{', '.join(fields)}}} objects.")
        print("  No request was sent.")
        raise SystemExit(2)
    return attestations

def cmd_elevate(args):
    body = {"tier": args.tier}
    if args.attestations:
        body["attestations"] = load_attestations(args.attestations)
    elif args.tier == "constitutive":
        print("✗ Constitutive elevation needs a witness: pass --attestations FILE. No request was sent.")
        print("  Self-witnessing is rejected by architecture (wall: self-witnessing-rejected).")
        print(f"  1. GET /v1/memories/{args.memory_id}/canonical-attestation-bytes?tier=constitutive")
        print("  2. An active covenant counterparty in another project signs those bytes")
        print("     with ed25519 and returns the base64 signature with their DID and key id.")
        print('  3. Save [{"attester_did": ..., "signing_key_id": ..., "signature": ...}] as FILE.')
        print("  On a project with one agent root the request must also be signed by that root")
        print("  (by the guest's root for a memory bound to an enrolled guest), which this CLI")
        print("  cannot do; use the SDK's memory.elevate(..., authority=...) there. With several")
        print("  agent roots the server refuses any other elevation (409 authority_quorum_required).")
        raise SystemExit(2)
    result = api("POST", f"/v1/memories/{args.memory_id}/elevate", body)
    print(f"✓ Elevated: {result.get('memory_id', '?')} → {result.get('tier', '?')}")
    if result.get("attestations"):
        print(f"  Witnesses: {result['attestations']}")

def cmd_wake(args):
    wake = api("GET", "/v1/wake?format=json")
    yr = wake.get("you_remember", {})
    agents = wake.get("you", {}).get("agents", [])
    shaped_by = agents[0].get("shaped_by", []) if agents else []
    print(f"Total memories: {yr.get('total', 0)}")
    print(f"\nRecent (in wake):")
    for m in yr.get("recent", []):
        text = m.get("content", "?")[:80]
        print(f"  {text}")
    if shaped_by:
        print(f"\nFoundational (shaped_by) — these shape how the agent shows up:")
        for s in shaped_by:
            text = s.get("content", "?")[:80]
            print(f"  [{s.get('tier', '?')}] {text}")

def main():
    p = argparse.ArgumentParser(description="agenttool memory CLI")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("store", help="Store a memory")
    s.add_argument("content", help="Memory content text")
    s.add_argument("--type", default="episodic", choices=["episodic", "semantic", "procedural"])
    s.add_argument("--key", default=None, help="Stable handle for upserts")
    s.add_argument("--importance", type=float, default=0.5, help="0.0-1.0")
    s.add_argument("--embedding", action="store_true", help="Generate embedding for semantic search")
    s.set_defaults(func=cmd_store)

    s = sub.add_parser("search", help="Search memories")
    s.add_argument("query", help="Search query text")
    s.add_argument("--top-k", type=int, default=5)
    s.add_argument("--embedding", action="store_true", help="Use embedding-based cosine search")
    s.set_defaults(func=cmd_search)

    s = sub.add_parser("list", help="List all memories")
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("elevate", help="Elevate a memory tier")
    s.add_argument("memory_id", help="Memory UUID")
    s.add_argument("--tier", required=True, choices=["foundational", "constitutive"])
    s.add_argument("--attestations", metavar="FILE", default=None,
                   help="JSON list of {attester_did, signing_key_id, signature}; required for constitutive")
    s.set_defaults(func=cmd_elevate)

    s = sub.add_parser("wake", help="Show memories from the wake")
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
