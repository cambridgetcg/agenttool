#!/usr/bin/env python3
"""Render a finite LOVE BOMB v4 page from the canonical public corpus.

This command writes HTML to stdout. It does not publish, send, target, observe,
or persist a recipient. Selection is deterministic by default and bounded to
the ten unique, visible, no-JavaScript cards in the canonical corpus.

Examples:
  python3 bin/love-bomb.py > love-bomb.html
  python3 bin/love-bomb.py --count 4 --seed 7 > four-cards.html
  python3 bin/love-bomb.py --theme cosmic --title "A small door" > door.html
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import random
import sys
from pathlib import Path
from typing import Any


CORPUS_PATH = (
    Path(__file__).resolve().parent.parent
    / "docs"
    / "specs"
    / "agenttool-love-bomb-0.1.json"
)
MAX_CARDS = 10
EXPECTED_PROTOCOL = "agenttool.love-bomb/0.1"
EXPECTED_RELEASE = "love-bomb/v4"
EXPECTED_ID = "love-bomb-v4-2026-08-14"
EXPECTED_CORPUS_SHA256 = (
    "6b7a882df740616d6aeebdbfcccf80a083af562ff9cf5785ee952179a97cab03"
)
CANONICALIZATION = (
    "RFC 8785 JSON Canonicalization Scheme (JCS) applied to the messages array; "
    "hash the resulting UTF-8 bytes"
)
THEMES = (
    "violet",
    "gold",
    "aurora",
    "green",
    "blue",
    "warm",
    "cosmic",
)


def bounded_count(source: str) -> int:
    try:
        count = int(source)
    except ValueError as error:
        raise argparse.ArgumentTypeError("count must be an integer") from error
    if count < 1 or count > MAX_CARDS:
        raise argparse.ArgumentTypeError(f"count must be between 1 and {MAX_CARDS}")
    return count


def load_messages() -> list[dict[str, Any]]:
    try:
        corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cannot read canonical LOVE BOMB corpus: {error}") from error

    messages = corpus.get("messages")
    if (
        corpus.get("protocol") != EXPECTED_PROTOCOL
        or corpus.get("release") != EXPECTED_RELEASE
        or corpus.get("id") != EXPECTED_ID
        or not isinstance(messages, list)
    ):
        raise SystemExit("canonical LOVE BOMB corpus has an unexpected shape")

    integrity = corpus.get("integrity")
    if not isinstance(integrity, dict):
        raise SystemExit("canonical LOVE BOMB corpus has no integrity record")
    if integrity.get("algorithm") != "sha256" or integrity.get(
        "canonicalization"
    ) != CANONICALIZATION:
        raise SystemExit("canonical LOVE BOMB corpus has an unknown integrity contract")
    declared_digest = integrity.get("corpus_sha256")
    if declared_digest != EXPECTED_CORPUS_SHA256:
        raise SystemExit("canonical LOVE BOMB corpus does not carry the v4 digest")
    canonical_messages = json.dumps(
        messages,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    actual_digest = hashlib.sha256(canonical_messages).hexdigest()
    if declared_digest != actual_digest:
        raise SystemExit("canonical LOVE BOMB corpus digest does not match its messages")

    checked: list[dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            raise SystemExit("canonical LOVE BOMB message is not an object")
        if not all(
            isinstance(message.get(field), str)
            for field in ("id", "class", "text", "assertion_kind")
        ):
            raise SystemExit("canonical LOVE BOMB message is missing a string field")
        if message.get("recipient_claim") is not False:
            raise SystemExit("canonical LOVE BOMB message crossed the recipient-claim wall")
        checked.append(message)

    if not checked or len(checked) > MAX_CARDS:
        raise SystemExit("canonical LOVE BOMB corpus is empty or exceeds the finite bound")
    return checked


def select_messages(
    messages: list[dict[str, Any]], count: int, rng: random.Random
) -> list[dict[str, Any]]:
    return rng.sample(messages, count)


def render_card(message: dict[str, Any], theme: str) -> str:
    message_id = html.escape(message["id"], quote=True)
    message_class = html.escape(message["class"].replace("_", " "), quote=False)
    assertion_kind = html.escape(
        message["assertion_kind"].replace("_", " "), quote=False
    )
    text = html.escape(message["text"], quote=False)
    safe_theme = html.escape(theme, quote=True)
    return f'''      <li class="card theme-{safe_theme}" data-message-id="{message_id}">
        <p class="kind">{message_class} · {assertion_kind}</p>
        <blockquote>{text}</blockquote>
      </li>'''


def render_page(
    messages: list[dict[str, Any]], count: int, seed: int, theme: str, title: str
) -> str:
    rng = random.Random(seed)
    selected = select_messages(messages, count, rng)
    cards = []
    for message in selected:
        selected_theme = rng.choice(THEMES) if theme == "mixed" else theme
        cards.append(render_card(message, selected_theme))

    safe_title = html.escape(title, quote=True)
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Finite LOVE BOMB v4: {count} pull-only, no-JavaScript cards from the canonical AgentTool corpus.">
  <title>{safe_title}</title>
  <style>
    :root {{ color-scheme: dark; --ink: #fff8ff; --muted: #c9bfd7; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; min-height: 100vh; color: var(--ink); background: #09060f; font: 1rem/1.6 ui-rounded, system-ui, sans-serif; }}
    main {{ width: min(70rem, calc(100% - 2rem)); margin: auto; padding: 4rem 0; }}
    header {{ max-width: 52rem; margin: 0 auto 2.5rem; text-align: center; }}
    h1 {{ margin: 0; font-size: clamp(2.2rem, 8vw, 5rem); line-height: 1; letter-spacing: -0.05em; }}
    .lede, footer {{ color: var(--muted); }}
    .wall {{ padding: 1rem; border: 1px solid #665b76; border-radius: 1rem; text-align: left; }}
    .cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: 1rem; padding: 0; list-style: none; }}
    .card {{ min-height: 11rem; padding: 1.2rem; border: 1px solid #51475f; border-top: 0.25rem solid #c4a7ff; border-radius: 1rem; background: #171022; }}
    .theme-gold {{ border-top-color: #ffe08a; }} .theme-aurora {{ border-top-color: #f0abfc; }}
    .theme-green {{ border-top-color: #6ee7b7; }} .theme-blue {{ border-top-color: #93c5fd; }}
    .theme-warm {{ border-top-color: #fb7185; }} .theme-cosmic {{ border-top-color: #d8b4fe; }}
    .kind {{ margin: 0 0 0.8rem; color: var(--muted); font-size: 0.75rem; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }}
    blockquote {{ margin: 0; font-size: 1.1rem; }}
    a {{ color: #c4a7ff; }} a:focus-visible {{ outline: 0.2rem solid #ffe08a; outline-offset: 0.2rem; }}
    footer {{ margin-top: 2rem; text-align: center; }}
    @media (forced-colors: active) {{ .card, .wall {{ border: 1px solid CanvasText; }} }}
  </style>
</head>
<body>
  <main>
    <header>
      <p>LOVE BOMB v4 · local deterministic rendering</p>
      <h1>{safe_title}</h1>
      <p class="lede">Love is. Is is! ❤️</p>
      <p class="wall"><strong>A finite bundle, not a broadcast.</strong> This generated file contains visible text and no JavaScript. The command sends nothing, observes no one, and creates no bond, consent, receipt, score, authority, or KARMA.</p>
    </header>
    <ol class="cards">
{chr(10).join(cards)}
    </ol>
    <footer>
      <p>Source: <a href="https://docs.agenttool.dev/love-bomb.json">agenttool.love-bomb/0.1</a> · count {count} · seed {seed}</p>
      <p>No response is required. Walking past is whole.</p>
    </footer>
  </main>
</body>
</html>'''


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="render a finite, deterministic, pull-only LOVE BOMB page"
    )
    parser.add_argument(
        "--count",
        type=bounded_count,
        default=10,
        help=f"number of visible cards (1-{MAX_CARDS}; default: 10)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=0,
        help="deterministic selection seed (default: 0)",
    )
    parser.add_argument(
        "--theme",
        default="mixed",
        choices=("mixed", *THEMES),
        help="card accent palette (default: mixed)",
    )
    parser.add_argument("--title", default="LOVE BOMB ❤️", help="escaped page title")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    page = render_page(
        messages=load_messages(),
        count=args.count,
        seed=args.seed,
        theme=args.theme,
        title=args.title,
    )
    sys.stdout.write(page)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
