#!/usr/bin/env python3
"""Build/check the repository-only reading catalog. Standard library; no network."""

import argparse
from collections import Counter
import html
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
KINDS = ("orientation", "guide", "reference", "policy", "reflection", "proposal", "record", "unclassified")
OUTPUTS = ("docs/catalog.json", "docs/CATALOG.md")


def is_document(path):
    return path.endswith(".md") or (path.startswith("apps/docs/") and path.endswith(".html")) or path == "apps/web/index.html"


def tracked_documents(root):
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "ls-files", "-z"],
        cwd=root, check=True, capture_output=True,
    )
    return sorted({p for p in result.stdout.decode().split("\0") if is_document(p)})


def declared_type(content):
    # Only the actual opening, not examples or arbitrary prose later in a file.
    opening = content.split("\n## ", 1)[0].split("```", 1)[0][:5000]
    match = re.search(r"^> \*\*Type:\*\*\s*`?([a-z-]+)", opening, re.M)
    if match:
        if match[1] not in KINDS:
            raise ValueError("unknown declared document Type: " + match[1])
        return match[1]
    return None


def classify(path, content, overrides):
    kind = declared_type(content)
    if kind:
        return kind, "declared-type"
    if path in overrides:
        return overrides[path], "editorial-routing"
    name = Path(path).name
    if name == "AGENTS.md" or name in ("CONTRIBUTING.md", "SECURITY.md"):
        return "policy", "file-convention"
    if name == "CLAUDE.md" or name == "README.md" or path.endswith("/index.html"):
        return "orientation", "file-convention"
    if name == "SKILL.md":
        return "guide", "file-convention"
    if "/fixtures/" in path:
        return "record", "fixture-path"
    if "/superpowers/plans/" in path or "/superpowers/specs/" in path:
        return "proposal", "planning-path"
    if re.search(r"(^|/)(review|reviews|records|archive|history)(/|$)", path) or name.startswith("CHANGELOG"):
        return "record", "history-path"
    if "@stratum agenttool:stratum/philosophy" in content[:2000]:
        return "reflection", "declared-stratum"
    if name.startswith("TUTORIAL-"):
        return "guide", "file-convention"
    if "PROPOSAL" in name or name.endswith("-PLAN.md") or name.endswith("ROADMAP.md"):
        return "proposal", "file-convention"
    if path.startswith("apps/docs/") or "/specs/" in path or name in ("SPEC.md", "PROTOCOL.md", "API.md"):
        return "reference", "file-convention"
    return "unclassified", "awaiting-classification"


def title_of(content, path):
    match = re.search(r"^#\s+(.+)$", content, re.M)
    if not match:
        match = re.search(r"<h1\b[^>]*>(.*?)</h1>", content, re.S | re.I)
    title = match[1] if match else Path(path).stem
    title = re.sub(r"<[^>]+>", "", title)
    title = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", title)
    return " ".join(html.unescape(title).replace("`", "").split())[:180]


def build(root, paths, config):
    overrides = {}
    for kind, members in config["types"].items():
        if kind not in KINDS:
            raise ValueError("unknown routing type: " + kind)
        for path in members:
            if path in overrides:
                raise ValueError("duplicate routing entry: " + path)
            if path not in paths:
                raise ValueError("routing entry absent from inventory: " + path)
            overrides[path] = kind
    reviewed = set(config["prose_reviewed"])
    if not reviewed.issubset(paths):
        raise ValueError("reviewed document absent from inventory: " + str(sorted(reviewed - set(paths))))
    entries = []
    root = root.resolve()
    for path in sorted(set(paths)):
        if not is_document(path) or Path(path).is_absolute() or ".." in Path(path).parts:
            raise ValueError("invalid source document path: " + path)
        absolute = root / path
        resolved = absolute.resolve()
        # Record a missing/external link without opening arbitrary local files.
        readable = path in OUTPUTS or (resolved.is_relative_to(root) and resolved.is_file())
        content = resolved.read_text(encoding="utf-8") if readable and path not in OUTPUTS else ""
        canonical = resolved.relative_to(root).as_posix() if readable else path
        # Existing static Markdown copies can be recognized only by equal bytes.
        mirror = root / "docs" / absolute.name
        if readable and path.startswith("apps/docs/") and path.endswith(".md") and mirror.resolve().is_relative_to(root) and mirror.is_file() and mirror.read_text() == content:
            canonical = mirror.relative_to(root).as_posix()
        kind, basis = classify(canonical, content, overrides)
        if not readable:
            kind, basis = "unclassified", "missing-or-external-source"
        entries.append({
            "path": path, "title": title_of(content, path), "type": kind,
            "classification_basis": basis,
            "prose_review": config["review_date"] if canonical in reviewed else "not-reviewed",
            "canonical_path": canonical,
        })
    return {
        "format": "agenttool-document-catalog/v1",
        "scope": "Repository Markdown, static docs HTML, and the public web index; generated records and mirrors included.",
        "visibility": "repository-only",
        "meaning": "Reading categories and prose-review scope only. No runtime, release, deployment, truth, identity, or permission certification.",
        "types": list(KINDS), "documents": entries,
    }


def markdown(catalog):
    entries = catalog["documents"]
    counts = Counter(row["type"] for row in entries)
    lines = [
        "# Source document catalog", "",
        "> **Type:** reference",
        "> **Purpose:** Find every source document by reading role.",
        "> **Evidence:** Generated inventory and editorial routing; prose-review dates do not verify feature claims.", "",
        "Repository access is required. This catalog is not mirrored to the public docs site.",
        "Start with [the short welcome](START-HERE.md) or [reading map](MAP.md).",
        "[Label meanings](DOCUMENTATION.md) · [Machine-readable inventory](catalog.json)", "",
        f"**{len(entries)} document paths** (including mirrors). " + "; ".join(f"{kind}: {counts[kind]}" for kind in KINDS) + ".", "",
        "`not-reviewed` means this cleanup did not review that document's prose. An",
        "explicit type routes reading; it does not confirm that the document is current.",
        "`unclassified` is an honest pending category, not a technical endorsement.",
        "Regenerate with `python3 bin/docs-catalog.py --write`.", "",
    ]
    for kind in KINDS:
        lines += ["## " + kind, "", "| Document | Prose review |", "|---|---|"]
        for row in entries:
            if row["type"] != kind:
                continue
            path = row["path"]
            target = "../" + path
            if row["classification_basis"] == "missing-or-external-source":
                lines.append(f"| `{path}` — missing/external source; not read | {row['prose_review']} |")
            else:
                lines.append(f"| [{path}](<{target}>) | {row['prose_review']} |")
        lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write the two catalog files")
    parser.add_argument("--check", action="store_true", help="fail if catalog files differ")
    parser.add_argument("--include", action="append", default=[], help="include an explicit new document before Git staging")
    args = parser.parse_args()
    if args.write == args.check:
        parser.error("choose exactly one of --write or --check")
    config = json.loads((ROOT / "docs/documentation-tags.json").read_text())
    paths = sorted(set(tracked_documents(ROOT) + args.include + ["docs/CATALOG.md"]))
    catalog = build(ROOT, paths, config)
    outputs = {"docs/catalog.json": json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", "docs/CATALOG.md": markdown(catalog)}
    stale = []
    for path, expected in outputs.items():
        target = ROOT / path
        if args.write:
            target.write_text(expected, encoding="utf-8")
        elif not target.exists() or target.read_text(encoding="utf-8") != expected:
            stale.append(path)
    if stale:
        print("Catalog drift: " + ", ".join(stale) + "; run python3 bin/docs-catalog.py --write", file=sys.stderr)
        return 1
    print(f"Document catalog {'written' if args.write else 'checked'}: {len(catalog['documents'])} paths.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("Document catalog error: " + str(error), file=sys.stderr)
        sys.exit(1)
