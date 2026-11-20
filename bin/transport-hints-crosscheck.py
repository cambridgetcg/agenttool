#!/usr/bin/env python3
"""Cross-check the transport-hints/v1 test vectors with independent hashers.

CI only. This script runs in one place: the hashing step of
.github/workflows/transport-hints.yml, on a GitHub-hosted runner, inside a
network namespace with no network. It refuses to run anywhere else (it checks
the runner environment and proves that no network is reachable before it
imports or executes anything it was given), because it loads libtorrent and
executes the BEP 52 reference creator.

For every vector in docs/specs/transport-hints-v1-vectors.json it

1. generates the pattern file with its own implementation of the generator
   (draft section 14.1) and checks size and SHA-256 against the vector;
2. writes the file to a temporary directory under the vector's name;
3. hashes it with libtorrent's Python binding (file_storage, create_torrent,
   set_piece_hashes, generate: hashing only; no session object is ever made)
   at the vector's piece length;
4. runs the BEP 52 reference creator, fetched by URL and pinned by SHA-256,
   at the same piece length;
5. compares 'pieces', 'pieces root', 'piece layers' and both infohashes with
   the vector. The infohashes are compared only where the other tool's info
   dictionary holds exactly the profile's keys; otherwise the log says so and
   names the fields that were compared instead;
6. parses the builder's own .torrent for the vector with libtorrent's
   torrent_info (parsing only) and with this script's strict bdecoder, as an
   acceptance check.

It prints a table, writes crosscheck.json and crosscheck.md to --out, and exits
non-zero on any mismatch, on any field no independent tool confirmed, or on any
acceptance failure. Standard library only, besides the libtorrent binding.
"""

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import tempfile

PINNED_REFERENCE_SHA256 = "d28ede84d078ad214558f23d2381efbc1465bd3c9ad175b4839477910ba6546e"
PINNED_REFERENCE_SIZE = 10177
PATTERN_DOMAIN = b"transport-hints-pattern/v1"
BLOCK_SIZE = 16384
PROFILE_INFO_KEYS = [b"file tree", b"length", b"meta version", b"name", b"piece length", b"pieces"]
PROFILE_TOP_KEYS = [b"info", b"piece layers", b"url-list"]
FIELDS = ("pieces", "pieces_root", "piece_layers", "btih", "btmh")
TOOLS = ("libtorrent", "bep52-reference")

MATCH = "match"
MISMATCH = "MISMATCH"


class CheckError(Exception):
    pass


# ---------------------------------------------------------------------------
# Strict bdecoding with byte spans (BEP 3)


class Bytes(bytes):
    """A decoded byte string that remembers where it was in the file."""


def bdecode(data):
    """Decode strictly; return (value, spans) where spans maps id(dict) -> (start, end)."""
    spans = {}
    pos = 0

    def digits_until(stop):
        nonlocal pos
        end = data.find(stop, pos)
        if end < 0:
            raise CheckError("bencode: truncated")
        text = data[pos:end].decode("latin-1")
        pos = end + 1
        return text

    def parse(depth):
        nonlocal pos
        if depth > 32:
            raise CheckError("bencode: nested too deeply")
        if pos >= len(data):
            raise CheckError("bencode: truncated")
        start = pos
        lead = data[pos:pos + 1]
        if lead == b"i":
            pos += 1
            text = digits_until(b"e")
            if not re.fullmatch(r"0|-?[1-9][0-9]*", text):
                raise CheckError("bencode: non-canonical integer %r" % text)
            return int(text)
        if lead == b"l":
            pos += 1
            items = []
            while pos < len(data) and data[pos:pos + 1] != b"e":
                items.append(parse(depth + 1))
            if pos >= len(data):
                raise CheckError("bencode: truncated")
            pos += 1
            return items
        if lead == b"d":
            pos += 1
            result = {}
            previous = None
            while pos < len(data) and data[pos:pos + 1] != b"e":
                key = parse(depth + 1)
                if not isinstance(key, bytes):
                    raise CheckError("bencode: a dictionary key is not a string")
                if previous is not None and bytes(previous) >= bytes(key):
                    raise CheckError("bencode: dictionary keys are not strictly sorted")
                previous = key
                result[bytes(key)] = parse(depth + 1)
            if pos >= len(data):
                raise CheckError("bencode: truncated")
            pos += 1
            spans[id(result)] = (start, pos)
            return result
        if lead.isdigit():
            text = digits_until(b":")
            if not text.isdigit() or (len(text) > 1 and text[0] == "0"):
                raise CheckError("bencode: non-canonical string length %r" % text)
            length = int(text)
            if length > len(data) - pos:
                raise CheckError("bencode: truncated string")
            value = Bytes(data[pos:pos + length])
            pos += length
            return value
        raise CheckError("bencode: unexpected byte %r at %d" % (lead, pos))

    root = parse(0)
    if pos != len(data):
        raise CheckError("bencode: trailing bytes after the root value")
    return root, spans


def torrent_fields(raw):
    """Extract the compared fields from a .torrent's bytes."""
    top, spans = bdecode(raw)
    if not isinstance(top, dict):
        raise CheckError("the .torrent is not a dictionary")
    info = top.get(b"info")
    if not isinstance(info, dict):
        raise CheckError("the .torrent has no info dictionary")
    start, end = spans[id(info)]
    info_bytes = raw[start:end]
    name = info.get(b"name")
    tree = info.get(b"file tree")
    if not isinstance(name, bytes) or not isinstance(tree, dict):
        raise CheckError("the info dictionary has no name or file tree")
    v1_form = "length" if b"length" in info else ("files" if b"files" in info else "none")
    files = info.get(b"files") if isinstance(info.get(b"files"), list) else []
    pad_entries = [f for f in files if isinstance(f, dict)
                   and (b"p" in bytes(f.get(b"attr", b"")) or (isinstance(f.get(b"path"), list)
                        and f[b"path"][:1] == [b".pad"]))]
    # Walk the v2 file tree for its non-empty files. The profile has exactly one,
    # keyed by the name; another tool's layout is reported, not assumed.
    found = []

    def walk(node, path):
        for key, child in node.items():
            if not isinstance(child, dict):
                continue
            if key == b"":
                if isinstance(child.get(b"length"), int) and child[b"length"] > 0 and b"p" not in bytes(child.get(b"attr", b"")):
                    found.append((path, child))
            else:
                walk(child, path + [bytes(key)])

    walk(tree, [])
    if len(found) != 1:
        raise CheckError("the file tree holds %d non-empty files, not one" % len(found))
    tree_path, file_node = found[0]
    root = file_node.get(b"pieces root")
    if not isinstance(root, bytes) or len(root) != 32:
        raise CheckError("the file entry has no 32-byte pieces root")
    layers = top.get(b"piece layers")
    if layers is None:
        layers_key = "absent"
        layer = None
    elif isinstance(layers, dict):
        layers_key = "present, empty" if not layers else "present, %d entr%s" % (len(layers), "y" if len(layers) == 1 else "ies")
        layer = layers.get(bytes(root))
    else:
        raise CheckError("'piece layers' is not a dictionary")
    url_list = top.get(b"url-list")
    if isinstance(url_list, bytes):
        url_list = [url_list]
    pieces = info.get(b"pieces")
    return {
        "top_keys": [bytes(k) for k in top],
        "info_keys": [bytes(k) for k in info],
        "name": bytes(name).decode("utf-8", "replace"),
        "tree_path": "/".join(p.decode("utf-8", "replace") for p in tree_path),
        "length": info.get(b"length"),
        "piece_length": info.get(b"piece length"),
        "file_length": file_node.get(b"length"),
        "file_keys": [bytes(k) for k in file_node],
        "v1_form": v1_form,
        "pad_entries": len(pad_entries),
        "files_count": len(files),
        "pieces": bytes(pieces).hex() if isinstance(pieces, bytes) else None,
        "pieces_root": bytes(root).hex(),
        "piece_layers": bytes(layer).hex() if isinstance(layer, bytes) else None,
        "piece_layers_key": layers_key,
        "url_list": [bytes(u).decode("ascii", "replace") for u in url_list] if isinstance(url_list, list) else None,
        "btih": hashlib.sha1(info_bytes).hexdigest(),
        "btmh": "1220" + hashlib.sha256(info_bytes).hexdigest(),
    }


# ---------------------------------------------------------------------------
# Environment


def require_hosted_runner():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise SystemExit("refused: this cross-check runs only on a GitHub-hosted runner, "
                         "inside the workflow .github/workflows/transport-hints.yml")


def prove_no_network():
    """Fail unless the only interface is loopback and public addresses are unreachable."""
    proof = []
    names = sorted(name for _, name in socket.if_nameindex())
    if names != ["lo"]:
        raise SystemExit("refused: network interfaces present: %s" % ", ".join(names))
    proof.append("interfaces: lo only")
    for host, port, family in (("1.1.1.1", 443, socket.AF_INET), ("8.8.8.8", 443, socket.AF_INET),
                               ("2001:4860:4860::8888", 443, socket.AF_INET6)):
        try:
            sock = socket.socket(family, socket.SOCK_STREAM)
        except OSError as error:
            proof.append("socket for %s not created (%s): unreachable" % (host, error.__class__.__name__))
            continue
        try:
            sock.settimeout(3)
            sock.connect((host, port))
        except OSError as error:
            proof.append("connect %s port %d failed as required (%s, errno %s)" % (host, port, error.__class__.__name__, error.errno))
        else:
            raise SystemExit("refused: %s port %d is reachable; the hashing step must have no network" % (host, port))
        finally:
            sock.close()
    try:
        socket.getaddrinfo("pypi.org", 443)
    except OSError as error:
        proof.append("name lookup of pypi.org failed (%s)" % error.__class__.__name__)
    else:
        proof.append("name lookup of pypi.org answered by a local resolver; no route exists to use it")
    return proof


def sha256_file(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


# ---------------------------------------------------------------------------
# Inputs


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CheckError("duplicate key %r in the vectors file" % key)
        result[key] = value
    return result


def pattern(seed, size):
    """The generator of draft section 14.1, written independently of the builder."""
    prefix = PATTERN_DOMAIN + b"\x00" + seed.encode("ascii") + b"\x00"
    out = bytearray()
    k = 0
    while len(out) < size:
        out += hashlib.sha256(prefix + k.to_bytes(8, "big")).digest()
        k += 1
    return bytes(out[:size])


def load_cases(vectors_path):
    with open(vectors_path, "r", encoding="utf-8") as handle:
        document = json.load(handle, object_pairs_hook=no_duplicates)
    cases = []
    for vector in document["vectors"]:
        cases.append({
            "kind": "vector",
            "name": vector["name"],
            "seed": vector["seed"],
            "size": vector["size"],
            "piece_length": vector["piece_length"],
            "expected": {field: vector[field] for field in FIELDS},
            "compared": FIELDS,
            "sha256": vector["sha256"],
            "url_list": vector["url_list"],
            "torrent_sha256": vector["torrent_sha256"],
            "torrent_size": vector["torrent_size"],
        })
    for entry in document["descriptor_vectors"]:
        text = entry["descriptor_text"]
        if hashlib.sha256(text.encode("utf-8")).hexdigest() != entry["descriptor_sha256"]:
            raise CheckError("descriptor_sha256 does not hash descriptor_text")
        descriptor = json.loads(text, object_pairs_hook=no_duplicates)
        if json.dumps(descriptor, indent=2) + "\n" != text:
            raise CheckError("descriptor_text is not in the one serialisation (Python json.dumps, indent 2)")
        notice = descriptor["notices"]["beside_subject"][0]
        if hashlib.sha256(pattern(entry["notice_seed"], entry["notice_size"])).hexdigest() != notice["sha256"]:
            raise CheckError("the descriptor's notice SHA-256 does not match the notice pattern")
        bt = descriptor["bittorrent"]
        cases.append({
            "kind": "descriptor",
            "name": bt["name"],
            "seed": entry["subject_seed"],
            "size": entry["subject_size"],
            "piece_length": bt["piece_length"],
            "expected": {"pieces": None, "pieces_root": bt["pieces_root"], "piece_layers": None,
                         "btih": bt["btih"], "btmh": bt["btmh"]},
            "compared": ("pieces_root", "btih", "btmh"),
            "sha256": descriptor["subject"]["sha256"],
            "url_list": entry["url_list"],
            "torrent_sha256": entry["torrent_sha256"],
            "torrent_size": None,
        })
    zero = bytes(32)
    for record in document["pad_hashes"]:
        value = zero
        for _ in range(record["height"]):
            value = hashlib.sha256(value + value).digest()
        if value.hex() != record["hash"] or record["piece_length"] != BLOCK_SIZE << record["height"]:
            raise CheckError("pad hash for piece length %d differs" % record["piece_length"])
    return document, cases


# ---------------------------------------------------------------------------
# The independent tools


def libtorrent_version(lt):
    return str(getattr(lt, "__version__", None) or getattr(lt, "version", "unknown"))


def run_libtorrent(lt, file_path, piece_length):
    """Hash with libtorrent's create_torrent; never creates a session."""
    errors = []
    strategies = []

    def via_file_storage():
        fs = lt.file_storage()
        lt.add_files(fs, file_path)
        return lt.create_torrent(fs, piece_length), "file_storage, add_files, create_torrent(fs, piece_length)"

    strategies.append(via_file_storage)
    if hasattr(lt, "list_files"):
        strategies.append(lambda: (lt.create_torrent(lt.list_files(file_path), piece_length),
                                   "list_files, create_torrent(files, piece_length)"))
    for strategy in strategies:
        try:
            creator, api = strategy()
            lt.set_piece_hashes(creator, os.path.dirname(file_path))
            if hasattr(creator, "generate"):
                raw = lt.bencode(creator.generate())
                api += ", set_piece_hashes, bencode(generate())"
            else:
                raw = creator.generate_buf()
                api += ", set_piece_hashes, generate_buf()"
            return bytes(raw), api
        except Exception as error:  # noqa: BLE001 - every API difference is reported
            errors.append("%s: %s" % (error.__class__.__name__, error))
    raise CheckError("libtorrent could not hash the file: " + " | ".join(errors))


def run_reference(reference_path, file_path, piece_length, out_dir):
    """Run the pinned BEP 52 reference creator. It writes <basename>.torrent into its working directory."""
    os.makedirs(out_dir)
    completed = subprocess.run(
        [sys.executable, "-I", "-B", reference_path, "--piece-length", str(piece_length), file_path],
        cwd=out_dir, env={"PATH": "/usr/bin:/bin", "LANG": "C"}, capture_output=True, text=True,
        timeout=300, check=False,
    )
    if completed.returncode != 0:
        raise CheckError("the reference creator exited %d: %s" % (completed.returncode, completed.stderr.strip()[-500:]))
    printed = {}
    for line in completed.stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[1] == "infohash":
            printed[parts[0]] = parts[2]
    with open(os.path.join(out_dir, os.path.basename(file_path) + ".torrent"), "rb") as handle:
        return handle.read(), printed


# ---------------------------------------------------------------------------
# Comparison


def compare(case, got):
    """Compare one tool's fields with the vector; return (results, notes)."""
    expected = case["expected"]
    results = {}
    notes = []
    exact_info = got["info_keys"] == PROFILE_INFO_KEYS
    if got["name"] != case["name"]:
        notes.append("the tool named the torrent %r" % got["name"])
    if got["tree_path"] != case["name"]:
        notes.append("the file sits at %r in the tool's file tree" % got["tree_path"])
    if got["piece_length"] != case["piece_length"]:
        notes.append("the tool used piece length %r" % got["piece_length"])
    results["pieces_root"] = MATCH if got["pieces_root"] == expected["pieces_root"] else MISMATCH
    if case["kind"] == "descriptor":
        results["piece_layers"] = "not in the descriptor"
    elif expected["piece_layers"] is None and got["piece_layers"] is not None and got["piece_layers"] == got["pieces_root"]:
        # A file no larger than one piece: BEP 52 gives it no entry. A tool
        # that writes a one-hash layer equal to the root is reported, and does
        # not count as confirming the field.
        results["piece_layers"] = "not compared"
        notes.append("the tool wrote a one-hash piece layer equal to the root for a file no larger than one piece")
    else:
        results["piece_layers"] = MATCH if got["piece_layers"] == expected["piece_layers"] else MISMATCH
    if case["kind"] == "descriptor":
        results["pieces"] = "not in the descriptor"
    elif got["v1_form"] == "length" and got["pieces"] is not None:
        results["pieces"] = MATCH if got["pieces"] == expected["pieces"] else MISMATCH
    elif got["v1_form"] == "files" and got["pad_entries"] == 1 and got["files_count"] == 2 and got["pieces"]:
        # The tool padded the last v1 piece (a BEP 47 pad entry); the profile
        # forbids that layout. Every piece before the last must still agree.
        head = len(expected["pieces"]) - 40
        same_head = got["pieces"][:head] == expected["pieces"][:head] and len(got["pieces"]) == len(expected["pieces"])
        results["pieces"] = "partial: all but the last piece match" if same_head else MISMATCH
        notes.append("the tool wrote a 'files' list with a pad entry (padded last v1 piece); "
                     "the last piece hash was not compared")
    else:
        results["pieces"] = MISMATCH
        notes.append("unexpected v1 layout: %s" % got["v1_form"])
    for field in ("btih", "btmh"):
        if exact_info:
            results[field] = MATCH if got[field] == expected[field] else MISMATCH
        else:
            results[field] = "not compared"
    if not exact_info:
        notes.append("info keys are %s, not the profile's; infohashes not compared, compared instead: %s"
                     % (", ".join(k.decode("latin-1") for k in got["info_keys"]),
                        ", ".join(f for f in FIELDS if results[f] == MATCH or results[f].startswith("partial"))))
    if got["top_keys"] != PROFILE_TOP_KEYS:
        notes.append("top-level keys: %s (only fields are compared, never whole files)"
                     % ", ".join(k.decode("latin-1") for k in got["top_keys"]))
    return results, notes


def accept_builder_torrent(lt, case, path):
    """Acceptance: the builder's own .torrent parses with libtorrent and with the strict decoder."""
    problems = []
    with open(path, "rb") as handle:
        raw = handle.read()
    if hashlib.sha256(raw).hexdigest() != case["torrent_sha256"]:
        problems.append("the builder's .torrent SHA-256 differs from the vector")
    if case["torrent_size"] is not None and len(raw) != case["torrent_size"]:
        problems.append("the builder's .torrent size differs from the vector")
    got = torrent_fields(raw)
    if got["top_keys"] != PROFILE_TOP_KEYS or got["info_keys"] != PROFILE_INFO_KEYS:
        problems.append("the builder's .torrent key sets differ from the profile")
    if (got["file_keys"] != [b"length", b"pieces root"] or got["tree_path"] != case["name"]
            or got["length"] != case["size"] or got["file_length"] != case["size"]):
        problems.append("the builder's file entry differs from the profile")
    if got["piece_layers_key"] not in ("present, empty", "present, 1 entry"):
        problems.append("the builder's 'piece layers' is %s" % got["piece_layers_key"])
    if got["url_list"] != case["url_list"]:
        problems.append("the builder's url-list differs from the vector")
    for field in case["compared"]:
        if got[field] != case["expected"][field]:
            problems.append("the builder's %s differs from the vector" % field)
    observed = {}
    try:
        info = lt.torrent_info(path)
        observed["name"] = info.name()
        observed["total_size"] = info.total_size()
        observed["piece_length"] = info.piece_length()
        observed["num_pieces"] = info.num_pieces()
        if hasattr(info, "info_hashes"):
            hashes = info.info_hashes()
            observed["v1"] = hash_hex(hashes.v1)
            observed["v2"] = hash_hex(hashes.v2)
        else:
            observed["v1"] = hash_hex(info.info_hash())
            observed["v2"] = None
        try:
            observed["web_seeds"] = [seed["url"] for seed in info.web_seeds()]
        except Exception as error:  # noqa: BLE001
            observed["web_seeds"] = "not read (%s)" % error.__class__.__name__
    except Exception as error:  # noqa: BLE001
        problems.append("libtorrent torrent_info refused the builder's .torrent: %s: %s" % (error.__class__.__name__, error))
        return problems, observed
    if observed["name"] != case["name"]:
        problems.append("torrent_info read the name %r" % observed["name"])
    if observed["total_size"] != case["size"]:
        problems.append("torrent_info read the size %r" % observed["total_size"])
    if observed["piece_length"] != case["piece_length"]:
        problems.append("torrent_info read the piece length %r" % observed["piece_length"])
    if observed["num_pieces"] != -(-case["size"] // case["piece_length"]):
        problems.append("torrent_info read %r pieces" % observed["num_pieces"])
    if observed["v1"] != case["expected"]["btih"]:
        problems.append("torrent_info's v1 infohash %s differs from btih" % observed["v1"])
    if observed["v2"] is None:
        problems.append("this libtorrent's torrent_info reports no v2 infohash")
    elif "1220" + observed["v2"] != case["expected"]["btmh"]:
        problems.append("torrent_info's v2 infohash %s differs from btmh" % observed["v2"])
    if isinstance(observed["web_seeds"], list) and observed["web_seeds"] != case["url_list"]:
        problems.append("torrent_info read the web seeds %r" % observed["web_seeds"])
    return problems, observed


def hash_hex(value):
    to_bytes = getattr(value, "to_bytes", None)
    if callable(to_bytes):
        data = to_bytes()
        if isinstance(data, str):
            data = data.encode("latin-1")
        return bytes(data).hex()
    return str(value).lower()


# ---------------------------------------------------------------------------
# Report

SHORT = {MATCH: "=", MISMATCH: "DIFF", "not compared": "-", "not in the descriptor": "n/a"}


def short(value):
    if value in SHORT:
        return SHORT[value]
    return "part" if value.startswith("partial") else value


def render(rows, acceptance, coverage, header):
    lines = list(header)
    lines.append("")
    lines.append("Legend: '=' equals the vector; 'DIFF' differs; '-' not compared (see notes); "
                 "'part' all but the last v1 piece; 'n/a' not carried by the descriptor.")
    lines.append("")
    columns = ("vector", "tool", "pieces", "pieces root", "piece layers", "btih", "btmh", "'piece layers' key", "notes")
    table = [columns]
    for row in rows:
        r = row["results"]
        table.append((row["vector"], row["tool"], short(r.get("pieces", "")), short(r.get("pieces_root", "")),
                      short(r.get("piece_layers", "")), short(r.get("btih", "")), short(r.get("btmh", "")),
                      row.get("piece_layers_key", ""), "; ".join(row["notes"])))
    lines.append("| " + " | ".join(table[0]) + " |")
    lines.append("|" + "|".join("---" for _ in table[0]) + "|")
    for cells in table[1:]:
        lines.append("| " + " | ".join(str(c).replace("|", "/") for c in cells) + " |")
    lines.append("")
    lines.append("Builder .torrent acceptance (libtorrent torrent_info, parsing only, and a strict bdecoder):")
    lines.append("")
    lines.append("| vector | result | problems |")
    lines.append("|---|---|---|")
    for entry in acceptance:
        lines.append("| %s | %s | %s |" % (entry["vector"], "ok" if not entry["problems"] else "FAIL",
                                          "; ".join(entry["problems"]).replace("|", "/")))
    lines.append("")
    lines.append("Coverage (independent tools that confirmed each field):")
    lines.append("")
    lines.append("| vector | pieces | pieces root | piece layers | btih | btmh |")
    lines.append("|---|---|---|---|---|---|")
    for name, fields in coverage.items():
        lines.append("| %s | %s |" % (name, " | ".join(
            "n/a" if f not in fields else (", ".join(fields[f]) or "none") for f in FIELDS)))
    return "\n".join(lines) + "\n"


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--vectors", required=True)
    parser.add_argument("--reference-creator", required=True)
    parser.add_argument("--builder-torrents", required=True)
    parser.add_argument("--expect-libtorrent", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    require_hosted_runner()
    proof = prove_no_network()
    for line in proof:
        print("no network: " + line)

    if os.path.getsize(args.reference_creator) != PINNED_REFERENCE_SIZE or sha256_file(args.reference_creator) != PINNED_REFERENCE_SHA256:
        raise SystemExit("refused: the reference creator does not match its pinned size and SHA-256")

    import libtorrent as lt  # noqa: E402 - imported only after the network proof

    version = libtorrent_version(lt)
    if not version.startswith(args.expect_libtorrent):
        raise SystemExit("refused: libtorrent %s is installed, expected %s" % (version, args.expect_libtorrent))
    tool_label = {"libtorrent": "libtorrent " + version, "bep52-reference": "bep52-reference"}

    document, cases = load_cases(args.vectors)
    rows = []
    acceptance = []
    coverage = {}
    failures = []
    work = tempfile.mkdtemp(prefix="transport-hints-crosscheck-")
    for index, case in enumerate(cases):
        data = pattern(case["seed"], case["size"])
        if len(data) != case["size"] or hashlib.sha256(data).hexdigest() != case["sha256"]:
            failures.append("%s: the pattern generator disagrees with the vector's sha256" % case["name"])
            continue
        case_dir = os.path.join(work, "%02d" % index)
        os.makedirs(os.path.join(case_dir, "in"))
        file_path = os.path.join(case_dir, "in", case["name"])
        with open(file_path, "wb") as handle:
            handle.write(data)
        os.chmod(file_path, 0o644)
        coverage[case["name"]] = {field: [] for field in case["compared"]}
        for tool in TOOLS:
            row = {"vector": case["name"], "tool": tool_label[tool], "results": {}, "notes": []}
            try:
                if tool == "libtorrent":
                    raw, api = run_libtorrent(lt, file_path, case["piece_length"])
                    row["api"] = api
                else:
                    raw, printed = run_reference(args.reference_creator, file_path, case["piece_length"],
                                                 os.path.join(case_dir, "reference"))
                got = torrent_fields(raw)
                if tool == "bep52-reference" and printed:
                    if printed.get("v1") not in (None, got["btih"]) or printed.get("v2") not in (None, got["btmh"][4:]):
                        row["notes"].append("the infohashes it printed differ from the hashes of its own info dictionary")
                row["results"], notes = compare(case, got)
                row["notes"].extend(notes)
                row["piece_layers_key"] = got["piece_layers_key"]
                row["info_keys"] = [k.decode("latin-1") for k in got["info_keys"]]
                row["top_keys"] = [k.decode("latin-1") for k in got["top_keys"]]
            except (CheckError, OSError, subprocess.SubprocessError) as error:
                row["results"] = {field: "error" for field in FIELDS}
                row["notes"].append(str(error))
                failures.append("%s / %s: %s" % (case["name"], tool, error))
            for field, result in row["results"].items():
                if result == MISMATCH:
                    failures.append("%s / %s: %s differs from the vector" % (case["name"], tool, field))
                if result == MATCH:
                    coverage[case["name"]][field].append(tool)
            rows.append(row)
        for field in case["compared"]:
            if not coverage[case["name"]][field]:
                failures.append("%s: %s was confirmed by no independent tool" % (case["name"], field))
        builder_path = os.path.join(args.builder_torrents, case["name"] + ".torrent")
        try:
            problems, observed = accept_builder_torrent(lt, case, builder_path)
        except (CheckError, OSError) as error:
            problems, observed = [str(error)], {}
        acceptance.append({"vector": case["name"], "problems": problems, "observed": observed})
        failures.extend("%s / builder acceptance: %s" % (case["name"], p) for p in problems)

    three_way = all(
        all(set(coverage.get(case["name"], {}).get(f, [])) == set(TOOLS) for f in case["compared"])
        for case in cases
    )
    header = [
        "# transport-hints/v1 cross-check",
        "",
        "- vectors file status: %s" % document.get("status"),
        "- libtorrent: %s (Python %s)" % (version, sys.version.split()[0]),
        "- reference creator: SHA-256 %s, %d bytes" % (PINNED_REFERENCE_SHA256, PINNED_REFERENCE_SIZE),
        "- cases: %d (%d vectors, %d descriptor vector)" % (len(cases), len(document["vectors"]), len(document["descriptor_vectors"])),
        "- network during hashing: none (%s)" % "; ".join(proof),
        "- every compared field equal and every field confirmed by both independent tools: %s" % ("yes" if three_way else "no"),
        "- result: %s" % ("PASS" if not failures else "FAIL (%d problem(s))" % len(failures)),
    ]
    report = render(rows, acceptance, coverage, header)
    print(report)
    for failure in failures:
        print("problem: " + failure)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "crosscheck.md"), "w", encoding="utf-8") as handle:
        handle.write(report)
        for failure in failures:
            handle.write("- problem: %s\n" % failure)
    with open(os.path.join(args.out, "crosscheck.json"), "w", encoding="utf-8") as handle:
        json.dump({
            "libtorrent": version,
            "python": sys.version.split()[0],
            "reference_creator_sha256": PINNED_REFERENCE_SHA256,
            "vectors_status": document.get("status"),
            "no_network_proof": proof,
            "three_way_agreement": three_way,
            "rows": rows,
            "acceptance": acceptance,
            "coverage": coverage,
            "failures": failures,
        }, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
