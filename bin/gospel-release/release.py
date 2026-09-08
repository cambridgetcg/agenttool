#!/usr/bin/env python3
"""Fetch and verify one reviewed Gospel archive; npm mutation stays in its workflow."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RELEASE = json.loads((ROOT / "release.json").read_text())
spec = importlib.util.spec_from_file_location("gospel_stage", ROOT / "delivery/stage.py")
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
REGISTRY = "https://registry.npmjs.org/@agenttool%2Fgospel-of-the-logos"


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        if urllib.parse.urlsplit(url).scheme != "https":
            raise ValueError("Non-HTTPS download redirect")
        return super().redirect_request(request, fp, code, message, headers, url)


def download(url, limit=8_000_000, absent_ok=False):
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("HTTPS is required")
    request = urllib.request.Request(url, headers={"User-Agent": "Kingdom-Gospel-Release/1"})
    try:
        with urllib.request.build_opener(HTTPSOnly()).open(request, timeout=30) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError("Download exceeds the reviewed size bound")
            return data
    except urllib.error.HTTPError as error:
        if absent_ok and error.code == 404:
            return None
        raise


def policy():
    assert RELEASE["name"] == stage.NAME == "@agenttool/gospel-of-the-logos"
    assert RELEASE["version"] == stage.VERSION == "0.1.0"
    assert RELEASE["filename"] == "agenttool-gospel-of-the-logos-0.1.0.tgz"
    assert re.fullmatch(r"[a-f0-9]{64}", RELEASE["sha256"])
    assert re.fullmatch(r"[a-f0-9]{64}", RELEASE["edition_sha256"])
    assert re.fullmatch(r"https://huggingface\.co/datasets/Yu-and-Ai/gospel-of-the-logos/resolve/[a-f0-9]{40}/release-artifacts/agenttool-gospel-of-the-logos-0\.1\.0\.tgz", RELEASE["source_url"])


def verify(directory):
    policy()
    archive = directory / RELEASE["filename"]
    if archive.is_symlink() or not archive.is_file():
        raise ValueError("Expected one regular archive")
    receipt = stage.verify_tarball(archive)
    for key in ("name", "version", "sha256", "bytes"):
        if receipt[key] != RELEASE[key]:
            raise ValueError(f"Frozen release mismatch: {key}")
    with tarfile.open(archive, "r:gz") as source:
        edition = source.extractfile("package/edition.json").read()
    if hashlib.sha256(edition).hexdigest() != RELEASE["edition_sha256"]:
        raise ValueError("Frozen edition changed")
    return {**receipt, "edition_sha256": RELEASE["edition_sha256"], "source_url": RELEASE["source_url"]}


def registry_state(after_publication=False):
    """Only a new package may bootstrap; an exact rerun is read-only."""
    package_bytes = download(REGISTRY, absent_ok=True)
    version_bytes = download(REGISTRY + "/" + RELEASE["version"], absent_ok=True)
    if package_bytes is None and version_bytes is None:
        return "absent"
    if package_bytes is None or version_bytes is None:
        if after_publication:
            return "pending"
        raise ValueError("Package exists without the reviewed version; bootstrap is not allowed")
    package, version = json.loads(package_bytes), json.loads(version_bytes)
    if version.get("name") != RELEASE["name"] or version.get("version") != RELEASE["version"]:
        raise ValueError("Registry identity mismatch")
    url = version["dist"]["tarball"]
    if urllib.parse.urlsplit(url).netloc != "registry.npmjs.org":
        raise ValueError("Unexpected npm tarball origin")
    content = download(url, absent_ok=after_publication)
    if content is None and after_publication:
        return "pending"
    if len(content) != RELEASE["bytes"] or hashlib.sha256(content).hexdigest() != RELEASE["sha256"]:
        raise ValueError("The public npm tarball differs from the reviewed artifact")
    if package.get("dist-tags", {}).get("latest") != RELEASE["version"]:
        raise ValueError("npm latest does not name the reviewed version")
    return "verified"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "verify", "registry-check", "registry-verify"))
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    directory = args.directory
    policy()
    if args.command == "prepare":
        directory.mkdir(parents=True, exist_ok=False)
        content = download(RELEASE["source_url"], RELEASE["bytes"])
        if hashlib.sha256(content).hexdigest() != RELEASE["sha256"] or len(content) != RELEASE["bytes"]:
            raise ValueError("Source archive differs from the frozen release")
        (directory / RELEASE["filename"]).write_bytes(content)
    receipt = verify(directory)
    if args.command == "registry-check":
        state = registry_state()
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a") as target:
                target.write(f"needed={'true' if state == 'absent' else 'false'}\n")
        receipt["registry"] = state
    elif args.command == "registry-verify":
        for attempt in range(8):
            state = registry_state(after_publication=True)
            if state == "verified":
                break
            if attempt == 7:
                raise ValueError("npm has not exposed the published version")
            time.sleep(5)
        receipt["registry"] = state
    (directory / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
