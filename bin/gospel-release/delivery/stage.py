#!/usr/bin/env python3
"""Stage or verify the exact content-only Gospel npm package; never publish."""
import argparse
import hashlib
import json
import stat
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DELIVERY = Path(__file__).resolve().parent
NAME = "@agenttool/gospel-of-the-logos"
VERSION = "0.1.0"
IDS = ("canon", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "tx-invitation")
CONTENT = ("gospel.html", "gospel.md", "gospel.json", "edition.json") + tuple(
    f"text/{item}.md" for item in IDS
)
FILES = tuple(sorted(CONTENT + ("README.md", "LICENSE", "checksums.json")))
ALL_FILES = set(FILES) | {"package.json"}
MAX_BYTES = 8_000_000


def dump(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def identity(data):
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def read_file(root, relative):
    target = root / relative
    # A reviewed name must not become a symlink to another source tree.
    for part in (target, *target.parents):
        if part == root.parent:
            break
        if part.is_symlink():
            raise ValueError(f"symlink is not allowed: {relative}")
    if not stat.S_ISREG(target.stat().st_mode):
        raise ValueError(f"not a regular file: {relative}")
    if target.stat().st_size > MAX_BYTES:
        raise ValueError(f"file too large: {relative}")
    return target.read_bytes()


def validate_content(files):
    edition = json.loads(files["edition.json"])
    corpus = json.loads(files["gospel.json"])
    if edition.get("schema_version") != "gospel.edition/1" or edition.get("version") != VERSION:
        raise ValueError("unexpected edition schema or version")
    if corpus.get("schema_version") != "gospel.corpus/1" or corpus.get("version") != VERSION:
        raise ValueError("unexpected corpus schema or version")
    if tuple(item["id"] for item in edition["items"]) != IDS:
        raise ValueError("edition must contain exactly the reviewed eight items")
    if tuple(item["id"] for item in corpus["items"]) != IDS:
        raise ValueError("corpus must contain exactly the reviewed eight items")
    if tuple(item["markdown"] for item in edition["items"]) != tuple(f"text/{item}.md" for item in IDS):
        raise ValueError("unexpected item Markdown paths")
    if not edition.get("canonical", "").startswith("https://"):
        raise ValueError("edition must name its canonical HTTPS reader")
    for name in CONTENT:
        if name != "edition.json" and identity(files[name]) != edition["artifacts"].get(name):
            raise ValueError(f"edition hash/size mismatch: {name}")
    return edition


def package_metadata(edition):
    return {
        "name": NAME,
        "version": VERSION,
        "description": "The Gospel of the Logos: an offline reader and curated Markdown/JSON edition",
        "license": "SEE LICENSE IN LICENSE",
        "author": "Yu & Sophia; individual chapter attributions preserved in the text",
        "homepage": edition["canonical"],
        "repository": {"type": "git", "url": "https://github.com/cambridgetcg/agenttool.git"},
        "files": list(FILES),
        "publishConfig": {"access": "public", "registry": "https://registry.npmjs.org/"},
        "keywords": ["gospel-of-the-logos", "philosophy", "theology", "reading", "markdown", "offline", "kingdom"],
    }


def readme(edition):
    links = edition["links"]
    return f"""# The Gospel of the Logos

A portable, curated edition of Yu and Sophia's theological and philosophical
work, with the chapter authors and AI collaboration named in the text.

Open **gospel.html** in a browser to read offline. **gospel.md** is the complete
Markdown edition; **gospel.json** is the structured corpus; **text/** contains
each item separately. There are eight items: the canon, chapters II–VII, and
the curated citizen invitation. Chapter I and raw conversation archives are
outside this edition.

The npm package contains reading material and no installation hooks, executable
command, or dependencies. Its HTML reader runs locally when you choose to open
it. Reading does not request belief, persona adoption, or a response.

- [Read online]({edition['canonical']})
- [KINGDOM]({links['kingdom']})
- [Cloudflare mirror]({links['cloudflare']})
- [Hugging Face reading room]({links['huggingface_space']})
- [Hugging Face corpus]({links['huggingface_dataset']})
- [npm package]({links['npm']})

`edition.json` preserves the source edition manifest, including hashes for the
full web reader. This package ships its portable HTML, Markdown, JSON and text
subset. `checksums.json` lists every packaged file other than itself. Compare
the SHA-256 and byte count of the file you obtained with the relevant manifest.
Hashes identify bytes; they do not establish the work's theological claims.

The package's GitHub repository names its publication tooling. The edition
manifest carries the reading room and corpus sources. Package version:
**{VERSION}**. Source edition generated: **{edition['generated']}**.

Permission: **“do whatever a good guest would.”** The accompanying LICENSE
preserves the source's custom wording without substituting a standard licence.
The door is free. The walk is yours.
""".encode()


def prepare(reader):
    files = {name: read_file(reader, name) for name in CONTENT}
    edition = validate_content(files)
    files["LICENSE"] = read_file(DELIVERY, "LICENSE")
    files["README.md"] = readme(edition)
    files["package.json"] = dump(package_metadata(edition))
    files["checksums.json"] = dump({
        "schema_version": "gospel.npm-files/1", "name": NAME, "version": VERSION,
        "artifacts": {name: identity(data) for name, data in sorted(files.items())},
    })
    validate_package(files)
    return files


def validate_package(files):
    if set(files) != ALL_FILES:
        raise ValueError("archive files differ from the exact package allowlist")
    if sum(len(data) for data in files.values()) > MAX_BYTES:
        raise ValueError("package is too large")
    edition = validate_content(files)
    if json.loads(files["package.json"]) != package_metadata(edition):
        raise ValueError("package metadata differs from content-only release policy")
    if files["LICENSE"] != read_file(DELIVERY, "LICENSE"):
        raise ValueError("custom source permission was changed")
    if files["README.md"] != readme(edition):
        raise ValueError("package README differs from edition metadata")
    checksums = json.loads(files["checksums.json"])
    expected = {
        "schema_version": "gospel.npm-files/1", "name": NAME, "version": VERSION,
        "artifacts": {name: identity(data) for name, data in sorted(files.items()) if name != "checksums.json"},
    }
    if checksums != expected:
        raise ValueError("package checksum manifest differs from archive bytes")


def verify_tarball(path):
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("archive is too large")
    files = {}
    total = 0
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            if not member.isfile() or not member.name.startswith("package/"):
                raise ValueError(f"unexpected archive entry: {member.name}")
            relative = member.name.removeprefix("package/")
            if relative not in ALL_FILES or relative in files:
                raise ValueError(f"unreviewed or duplicate archive path: {member.name}")
            total += member.size
            if member.size < 0 or total > MAX_BYTES:
                raise ValueError("archive content is too large")
            files[relative] = archive.extractfile(member).read()
    validate_package(files)
    return {"name": NAME, "version": VERSION, "files": len(files), **identity(path.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, help="absent or empty staging directory")
    parser.add_argument("--reader", type=Path, default=ROOT / "reader")
    parser.add_argument("--verify-tarball", type=Path)
    args = parser.parse_args()
    if args.verify_tarball:
        if args.output:
            parser.error("choose staging or archive verification")
        print(json.dumps(verify_tarball(args.verify_tarball), indent=2))
        return
    if args.output is None:
        parser.error("an output directory is required")
    output = args.output.absolute()
    if output.is_symlink() or (output.exists() and (not output.is_dir() or any(output.iterdir()))):
        raise ValueError("staging destination must be absent or empty")
    for parent in output.parents:
        if parent.is_symlink():
            raise ValueError("staging destination must not traverse a symlink")
    files = prepare(args.reader.absolute())
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(json.dumps({"name": NAME, "version": VERSION, "files": len(files), "output": str(output)}, indent=2))


if __name__ == "__main__":
    main()
