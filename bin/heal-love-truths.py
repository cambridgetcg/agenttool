#!/usr/bin/env python3
"""Validate or deliberately repair misplaced love truth engravings.

An autonomous loop has historically appended new truth strings to the last
``];`` in a file, which can strand them inside THEMES/PRINCIPLES instead of
TRUTHS and can leave apostrophes unescaped.

The default (and ``--check``) mode is read-only: it reports whether a repair
would be needed and syntax-checks each source file. ``--write`` is the only
mode that changes files. Frontend deployment uses ``--check`` so a deploy can
never silently change its own inputs.
"""

from __future__ import annotations

import argparse
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
DEFAULT_FILES = [
    REPO / "apps/docs/love.js",
    REPO / "apps/docs/love-widget.js",
]

ARRAY_RE = re.compile(r"^  var (TRUTHS|THEMES|PRINCIPLES) = \[\s*$")
CLOSE = "  ];"


class SourceError(ValueError):
    """The source shape is not safe for this deliberately narrow repair."""


def escape(content: str) -> str:
    """Render a value as the body of a single-quoted JavaScript literal."""

    return content.replace("\\", "\\\\").replace("'", "\\'")


def literal_content(line: str) -> str:
    """Extract the body of the line-oriented truth literals used here."""

    value = line.strip()
    if not value.startswith("'"):
        raise SourceError("expected a single-quoted string literal")
    value = value[1:]
    if value.endswith(","):
        value = value[:-1].rstrip()
    if value.endswith("'"):
        value = value[:-1]
    return value.replace("\\'", "'")


def array_bounds(lines: list[str]) -> dict[str, tuple[int, int]]:
    """Locate the arrays this tool understands, rejecting ambiguous shapes."""

    arrays: dict[str, tuple[int, int]] = {}
    index = 0
    while index < len(lines):
        match = ARRAY_RE.match(lines[index])
        if not match:
            index += 1
            continue

        name = match.group(1)
        if name in arrays:
            raise SourceError(f"multiple {name} arrays found")
        close = index + 1
        while close < len(lines) and lines[close] != CLOSE:
            close += 1
        if close == len(lines):
            raise SourceError(f"{name} array has no standalone {CLOSE.strip()} close")
        arrays[name] = (index, close)
        index = close + 1
    return arrays


def repair_text(text: str) -> tuple[str, list[str], list[str]]:
    """Return repaired text plus all rescued and newly-added truth values.

    This function is pure: callers decide whether the returned bytes should be
    written. Only single-quoted lines after the final object in a known
    non-TRUTHS array are moved, keeping the repair intentionally conservative.
    """

    lines = text.split("\n")
    rescued: list[str] = []

    # Remove one violated array at a time so every replacement can safely
    # change line offsets before the next scan.
    while True:
        arrays = array_bounds(lines)
        if "TRUTHS" not in arrays:
            raise SourceError("no TRUTHS array found")

        repaired_one = False
        for name, (start, close) in arrays.items():
            if name == "TRUTHS":
                continue

            body = lines[start + 1 : close]
            # The supported THEMES/PRINCIPLES entries are one-line object
            # literals. A truth may legitimately contain a `}` character, so
            # searching for any closing brace would misclassify that truth as
            # the final object and falsely report the source clean.
            last_object = max(
                (
                    offset
                    for offset, line in enumerate(body)
                    if line.lstrip().startswith("{")
                ),
                default=-1,
            )
            keep = body[: last_object + 1]
            orphans: list[str] = []
            for line in body[last_object + 1 :]:
                stripped = line.strip()
                if stripped.startswith("'"):
                    orphans.append(literal_content(line))
                else:
                    keep.append(line)

            if not orphans:
                continue

            lines[start + 1 : close] = keep
            rescued.extend(orphans)
            repaired_one = True
            break

        if not repaired_one:
            break

    if not rescued:
        return text, [], []

    arrays = array_bounds(lines)
    truth_start, truth_close = arrays["TRUTHS"]
    existing = {
        literal_content(line)
        for line in lines[truth_start + 1 : truth_close]
        if line.strip().startswith("'")
    }
    added: list[str] = []
    for truth in rescued:
        if truth and truth not in existing:
            existing.add(truth)
            added.append(truth)

    lines[truth_close:truth_close] = [f"    '{escape(truth)}'," for truth in added]
    return "\n".join(lines), rescued, added


def syntax_check_text(text: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["node", "--check", "-"],
            input=text,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return False, "node is required for JavaScript syntax validation"

    if result.returncode == 0:
        return True, ""
    details = result.stderr.strip() or result.stdout.strip() or "node --check failed"
    return False, details.splitlines()[0]


def atomic_write(path: Path, text: str) -> None:
    """Replace one source file atomically while preserving its mode."""

    original_mode = stat.S_IMODE(path.stat().st_mode)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as handle:
            temporary = handle.name
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, original_mode)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def process(path: Path, *, write: bool) -> bool:
    if not path.is_file():
        print(f"  ✗ {path}: source file does not exist")
        return False

    try:
        original = path.read_text(encoding="utf-8")
        repaired, rescued, added = repair_text(original)
    except (OSError, UnicodeError, SourceError) as error:
        print(f"  ✗ {path.name}: cannot validate safely: {error}")
        return False

    needs_repair = repaired != original
    if needs_repair and write:
        parses, detail = syntax_check_text(repaired)
        if not parses:
            print(
                f"  ✗ {path.name}: candidate repair does not parse; "
                f"source left unchanged: {detail}"
            )
            return False
        try:
            atomic_write(path, repaired)
        except OSError as error:
            print(f"  ✗ {path.name}: atomic repair failed; source left unchanged: {error}")
            return False
        print(
            f"  ✓ {path.name}: rescued {len(rescued)} orphan string(s); "
            f"added {len(added)} new truth(s)"
        )
    elif needs_repair:
        print(
            f"  ✗ {path.name}: needs healing ({len(rescued)} misplaced truth "
            f"string(s)); source left unchanged"
        )

    parses, detail = syntax_check_text(repaired if write and needs_repair else original)
    if not parses:
        print(f"  ✗ {path.name}: JavaScript syntax check failed: {detail}")
        return False
    if needs_repair and not write:
        return False

    if not needs_repair:
        print(f"  ✓ {path.name}: clean and parses")
    elif write:
        print(f"  ✓ {path.name}: repaired source parses")
    return True


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--check",
        action="store_true",
        help="validate without writing (the default; used by deploys)",
    )
    mode.add_argument(
        "--write",
        action="store_true",
        help="deliberately move misplaced strings into TRUTHS and rewrite files",
    )
    parser.add_argument(
        "files",
        nargs="*",
        type=Path,
        help="optional source files (defaults to the two docs love scripts)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    files = args.files or DEFAULT_FILES
    results = [process(path.resolve(), write=args.write) for path in files]
    ok = all(results)
    if not ok and not args.write:
        print("  Run `python3 bin/heal-love-truths.py --write` deliberately, review the diff, then deploy.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
