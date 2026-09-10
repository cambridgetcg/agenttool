#!/usr/bin/env python3
"""Fixed private HF release; never executes candidates or reads credential stores.

Installation and credentialless reference execution belong to the workflow.
No creation, deletion, visibility change, rollback, or blind retry happens here.
"""
import base64
import hashlib
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import subprocess
import sys
import time
from types import MappingProxyType
import urllib.error
import urllib.parse
import urllib.request
import warnings

REPO_ROOT = Path(__file__).absolute().parent.parent
BASE = "packages/hf-listening-room/hf"
ORIGIN = "https://huggingface.co"
FILE_LIMIT = 204800
ARTIFACT_LIMIT = 1048576
JSON_LIMIT = 65536
REQUEST_LIMIT = 160
NETWORK_BYTES = 8 * 1048576
WRITE_LIMIT = 2 * 1048576
DEADLINE = 480
SDK_VERSION = "1.29.0"
TARGETS = ("dataset", "space")  # Deliberately Dataset first.
REPOS = {
    "dataset": "Yu-and-Ai/isness-host-conformance",
    "space": "Yu-and-Ai/isness-listening-room",
}
ROOTS = {
    "dataset": (15, "e573ac0674d947d3b5afbdb0e0d7d3ec44b4eaa561c6feec95190305da2a9044"),
    "space": (14, "95ebec847b597d71f212f317884882d261ad3b9605a7629f2ee5df4392d5c92e"),
}
BOOTSTRAP = {
    "dataset": ("0b2d95280a361d8456c22b7a238a13d2571c9115", {
        ".gitattributes": (2504, "9e75dd981de037ec3769f24f790e126bc5a160b6871f510214e68dc70649aeeb"),
    }),
    "space": ("2a75551860890428a7de87d6ff8415d71f44c924", {
        ".gitattributes": (1519, "11ad7efa24975ee4b0c3c3a38ed18737f0658a5f75a0a96787b576a78a023361"),
        "README.md": (206, "e001eb0b27748e189d26147ea69d585d97cca8db44f204d9115d0ad599b6cd9d"),
        "index.html": (546, "fef10b4e06879d75c496c1ce3e89410bff1b77bf51220f21570255d1f214580e"),
        "style.css": (388, "789bfd541c9f06658ac410d968e9c39fa8c63a48a08643b36071b984c699a9f4"),
    }),
}
REASONS = frozenset("usage source context inventory file_bound artifact_bound manifest bytes path "
                    "transport http response_bound network_bound deadline json token oidc_endpoint "
                    "metadata privacy revision remote_inventory remote_bytes sdk sdk_route sdk_retry "
                    "sdk_payload upload_mode runtime".split())


class ReleaseError(Exception):
    def __init__(self, reason, status=None):
        self.reason = reason if reason in REASONS else "runtime"
        self.status = status if type(status) is int and 100 <= status <= 599 else None
        super().__init__(self.reason)


def require(condition, reason):
    if not condition:
        raise ReleaseError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def oid(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value), "revision")
    return value


def parse_json(raw):
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        raise ReleaseError("json") from None


def source_sha():
    supplied = os.environ.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", supplied), "source")
    # No shell, git auth, candidate imports, user Git config, or inherited GIT_*.
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], capture_output=True,
        timeout=10, check=False,
        env={"PATH": os.defpath, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
    )
    require(result.returncode == 0 and result.stdout == (supplied + "\n").encode(), "source")
    return supplied


def publish_context():
    for key, expected in {
        "GITHUB_REPOSITORY": "cambridgetcg/agenttool",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
    }.items():
        require(os.environ.get(key) == expected, "context")


def open_dir(parts):
    """Descriptor-relative traversal: no symlink ancestors or reopen-by-path race."""
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts:
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_file(directory, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "path")
        require(before.st_size <= FILE_LIMIT, "file_bound")
        data = stream.read(FILE_LIMIT + 1)
        after = os.fstat(stream.fileno())
        require(len(data) <= FILE_LIMIT and len(data) == before.st_size, "file_bound")
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "bytes")
        return data


def snapshot():
    """Return only pinned, bounded immutable bytes; uploads never reopen files."""
    snapshots = {}
    for kind in TARGETS:
        fd = None
        try:
            fd = open_dir((REPO_ROOT / BASE / kind).parts[1:])
            manifest_bytes = read_file(fd, "hash-manifest.json")
            count, digest = ROOTS[kind]
            require(sha(manifest_bytes) == digest, "manifest")
            manifest = parse_json(manifest_bytes)
            rows = manifest["files"]
            require(isinstance(rows, list) and len(rows) == count - 1, "manifest")
            entries = {}
            for row in rows:
                name = row["path"]
                require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_./-]{1,150}", name), "path")
                require(all(part not in ("", ".", "..") for part in name.split("/")), "path")
                require(not name.startswith("/") and name not in entries and name != "hash-manifest.json", "path")
                entries[name] = row
            expected = set(entries) | {"hash-manifest.json"}
            dirs = {str(p) for name in expected for p in PurePosixPath(name).parents if str(p) != "."}
            data = {}
            total = 0

            def inspect(directory, prefix=""):
                nonlocal total
                with os.scandir(directory) as items:
                    for index, item in enumerate(items):
                        require(index < 32, "inventory")
                        name = prefix + item.name
                        mode = item.stat(follow_symlinks=False).st_mode
                        if stat.S_ISDIR(mode):
                            require(name in dirs, "inventory")
                            child = os.open(item.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                            try:
                                inspect(child, name + "/")
                            finally:
                                os.close(child)
                        else:
                            require(stat.S_ISREG(mode) and name in expected, "inventory")
                            raw = read_file(directory, item.name)
                            total += len(raw)
                            require(total <= ARTIFACT_LIMIT, "artifact_bound")
                            if name == "hash-manifest.json":
                                require(raw == manifest_bytes, "manifest")
                            else:
                                require(len(raw) == entries[name]["bytes"] and sha(raw) == entries[name]["sha256"], "bytes")
                            data[name] = raw

            inspect(fd)
            require(set(data) == expected and len(data) == count, "inventory")
            snapshots[kind] = MappingProxyType(data)
        except (OSError, KeyError, TypeError, ValueError):
            raise ReleaseError("path") from None
        finally:
            if fd is not None:
                os.close(fd)
    return MappingProxyType(snapshots)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def open_no_redirect(request, *, timeout):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    return opener.open(request, timeout=timeout)


class Network:
    """No proxies, retries, response decompression, or implicit redirect auth."""
    def __init__(self):
        self.requests = 0
        self.received = 0
        self.started = time.monotonic()

    def request(self, method, url, token=None, body=None, content_type="application/json", limit=JSON_LIMIT):
        require(time.monotonic() - self.started < DEADLINE, "deadline")
        self.requests += 1
        require(self.requests <= REQUEST_LIMIT, "network_bound")
        require(body is None or len(body) <= WRITE_LIMIT, "sdk_payload")
        headers = {"Accept-Encoding": "identity", "Content-Type": content_type}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            try:
                response = open_no_redirect(request, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                require(response.headers.get("Content-Encoding", "identity") == "identity", "response_bound")
                raw = response.read(limit + 1)
                self.received += len(raw)
                require(len(raw) <= limit, "response_bound")
                require(self.received <= NETWORK_BYTES, "network_bound")
                require(not response.headers.get("Link"), "response_bound")
                return response.status, raw, response.headers.get("Location")
        except ReleaseError:
            raise
        except Exception:
            raise ReleaseError("transport") from None

    def json(self, method, url, token=None, body=None):
        raw = None if body is None else json.dumps(body).encode()
        status, data, _ = self.request(method, url, token, raw)
        require_http(status)
        value = parse_json(data)
        require(isinstance(value, dict), "json")
        return value


def require_http(status):
    if status != 200:
        raise ReleaseError("http", status)


def token_field(data, field):
    value = data.get(field)
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.~-]{20,20000}", value), "token")
    return value


def exchange(network, kind):
    url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    require(len(url) <= 4096, "oidc_endpoint")
    endpoint = urllib.parse.urlsplit(url)
    require(endpoint.scheme == "https" and (endpoint.hostname or "").endswith(".actions.githubusercontent.com")
            and endpoint.port in (None, 443) and not endpoint.username and not endpoint.password
            and not endpoint.fragment, "oidc_endpoint")
    query = [(k, v) for k, v in urllib.parse.parse_qsl(endpoint.query) if k != "audience"]
    query.append(("audience", ORIGIN))
    url = urllib.parse.urlunsplit(endpoint._replace(query=urllib.parse.urlencode(query)))
    request_token = token_field({"value": os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}, "value")
    github = network.json("GET", url, request_token)
    response = network.json("POST", ORIGIN + "/oauth/token", body={
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
        "subject_token": token_field(github, "value"),
        "resource": f"{kind}s/{REPOS[kind]}",
    })
    return token_field(response, "access_token")


def metadata(network, kind, token, revision="main"):
    require(revision == "main" or re.fullmatch(r"[0-9a-f]{40}", revision), "revision")
    info = network.json("GET", f"{ORIGIN}/api/{kind}s/{REPOS[kind]}/revision/{revision}?blobs=true", token)
    require(info.get("id") == REPOS[kind], "metadata")
    require(info.get("private") is True, "privacy")
    if kind == "space":
        require(info.get("sdk") == "static", "metadata")
    head = oid(info.get("sha"))
    require(revision == "main" or head == revision, "revision")
    siblings = info.get("siblings")
    require(isinstance(siblings, list) and len(siblings) <= ROOTS[kind][0] + 1, "remote_inventory")
    names = []
    for row in siblings:
        require(isinstance(row, dict) and isinstance(row.get("rfilename"), str), "metadata")
        require(row.get("lfs") is None, "upload_mode")
        names.append(row["rfilename"])
    require(len(names) == len(set(names)), "remote_inventory")
    return head, set(names)


def remote_file(network, kind, token, revision, name, size):
    oid(revision)
    resource = f"{kind}s/{REPOS[kind]}"
    path = f"/{resource}/resolve/{revision}/{name}"
    cache = f"/api/resolve-cache/{resource}/{revision}/{name}"
    url = ORIGIN + path
    # Only exact same-origin, immutable resolve/cache paths may carry the token.
    for _ in range(3):
        status, raw, location = network.request("GET", url, token, limit=size)
        if status == 200:
            require(len(raw) == size, "remote_bytes")
            return raw
        if status not in (301, 302, 303, 307, 308):
            raise ReleaseError("http", status)
        require(isinstance(location, str) and len(location) <= 2048, "sdk_route")
        redirected = urllib.parse.urlsplit(urllib.parse.urljoin(url, location))
        require(redirected.scheme == "https" and redirected.netloc == "huggingface.co"
                and not redirected.fragment and redirected.path in (path, cache), "sdk_route")
        url = urllib.parse.urlunsplit(redirected)
    raise ReleaseError("sdk_route")


def verify_remote(network, kind, token, head, expected):
    observed, names = metadata(network, kind, token, head)
    require(observed == head and names == set(expected), "remote_inventory")
    for name, (size, digest) in sorted(expected.items()):
        raw = remote_file(network, kind, token, head, name, size)
        require(sha(raw) == digest, "remote_bytes")
    current, current_names = metadata(network, kind, token)
    require(current == head and current_names == names, "revision")


def published_files(kind, files):
    expected = {name: (len(raw), sha(raw)) for name, raw in files.items()}
    expected[".gitattributes"] = BOOTSTRAP[kind][1][".gitattributes"]
    return expected


class SDK:
    """Lazy pinned SDK behind a one-shot bounded transport, including its internals.

    Inspected 1.29.0: create_commit uses validate-yaml, preupload, then
    _send_commit(retry_on_error=False). preupload uses http_backoff. Our errors
    are not httpx retryable errors; repeated routes are refused before I/O.
    """
    def __init__(self, network):
        import huggingface_hub as hub
        import httpx
        require(hub.__version__ == SDK_VERSION, "sdk")
        self.hub = hub
        self.network = network
        self.tokens = {}
        self.files = {}
        self.parents = {}
        self.sources = {}
        self.submitted = set()
        self.called = set()
        owner = self

        class Transport(httpx.BaseTransport):
            def handle_request(self, request):
                raw = owner.request(request.method, str(request.url),
                                    request.headers.get("Authorization"), request.content)
                return httpx.Response(200, content=raw, request=request)

        # No default HF/httpx hooks, env proxies, implicit auth, redirects or retries.
        self.client = httpx.Client(transport=Transport(), trust_env=False,
                                   follow_redirects=False, timeout=15)
        hub.set_client_factory(lambda: self.client)
        self.api = hub.HfApi(endpoint=ORIGIN, token=False)

    def close(self):
        self.client.close()

    def request(self, method, url, authorization, body):
        matches = [kind for kind, token in self.tokens.items() if authorization == "Bearer " + token]
        require(len(matches) == 1, "token")
        kind = matches[0]
        prefix = f"{ORIGIN}/api/{kind}s/{REPOS[kind]}"
        routes = {
            ("GET", prefix + "/auth-check/write"): "auth",
            ("POST", ORIGIN + "/api/validate-yaml"): "yaml",
            ("POST", prefix + "/preupload/main"): "preupload",
            ("POST", prefix + "/commit/main"): "commit",
        }
        route = routes.get((method, url))
        require(route is not None, "sdk_route")
        key = (kind, route)
        require(key not in self.called, "sdk_retry")
        self.called.add(key)  # Consumed before request, including ambiguous failures.
        require(len(body) <= WRITE_LIMIT, "sdk_payload")
        if route != "auth":
            require(kind in self.parents, "sdk_payload")
        if route == "commit":
            rows = [parse_json(line) for line in body.splitlines()]
            require(len(rows) == len(self.files[kind]) + 1, "sdk_payload")
            require(rows[0].get("key") == "header" and
                    rows[0].get("value", {}).get("parentCommit") == self.parents[kind], "sdk_payload")
            sent = {}
            for row in rows[1:]:
                require(row.get("key") == "file", "sdk_payload")
                value = row.get("value", {})
                name = value.get("path")
                require(name in self.files[kind] and name not in sent and value.get("encoding") == "base64", "sdk_payload")
                try:
                    sent[name] = base64.b64decode(value["content"], validate=True)
                except (ValueError, KeyError, TypeError):
                    raise ReleaseError("sdk_payload") from None
            require(sent == self.files[kind], "sdk_payload")
        if route == "commit":
            self.receipt("submission_attempt", kind)
            self.submitted.add(kind)
        status, raw, _ = self.network.request(method, url, self.tokens[kind], body or None,
                                             "application/x-ndjson" if route == "commit" else "application/json")
        require_http(status)  # Never give retry/status handlers remote error text.
        if route == "preupload":
            info = parse_json(raw)
            rows = info.get("files", [])
            require(isinstance(rows, list) and len(rows) == len(self.files[kind]), "upload_mode")
            names = set()
            for row in rows:
                require(isinstance(row, dict) and row.get("path") in self.files[kind]
                        and row["path"] not in names and row.get("uploadMode") == "regular"
                        and row.get("shouldIgnore") is False, "upload_mode")
                remote_oid = row.get("oid")
                if remote_oid is not None:
                    oid(remote_oid)
                    content = self.files[kind][row["path"]]
                    local_oid = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
                    # Existing bootstrap blobs may have OIDs, but no expected file
                    # may be removed by the SDK's implicit no-op filtering.
                    require(remote_oid != local_oid, "upload_mode")
                names.add(row["path"])
        return raw

    def auth(self, kind, token):
        self.tokens[kind] = token
        self.api.auth_check(REPOS[kind], repo_type=kind, token=token, write=True)

    def receipt(self, event, kind, status=None):
        result = {"event": event, "artifact": kind, "target": REPOS[kind],
                  "source": self.sources[kind], "parent": self.parents[kind], "attempt": 1}
        if status is not None:
            result["http_status"] = status
        print(json.dumps(result, sort_keys=True), flush=True)

    def commit(self, kind, files, parent, source):
        self.files[kind] = files
        self.parents[kind] = oid(parent)
        self.sources[kind] = oid(source)
        operations = [self.hub.CommitOperationAdd(path_in_repo=name, path_or_fileobj=raw)
                      for name, raw in sorted(files.items())]
        try:
            result = self.api.create_commit(
                repo_id=REPOS[kind], repo_type=kind, token=self.tokens[kind],
                operations=operations, revision="main", create_pr=False,
                parent_commit=parent, run_as_future=False, num_threads=1,
                commit_message="Care Before Learning reference " + source,
            )
            return oid(result.oid)
        except BaseException as error:
            if kind in self.submitted:
                status = error.status if isinstance(error, ReleaseError) else None
                rejected = status in (400, 401, 403, 404, 409, 412, 422)
                self.receipt("submission_rejected" if rejected else "outcome_unknown", kind, status)
            raise


def emit(event, kind, revision):
    print(json.dumps({"event": event, "artifact": kind, "revision": oid(revision)}, sort_keys=True), flush=True)


def publish(files, source, network, sdk):
    admitted = {}
    tokens = {}
    # BOTH write grants, private metadata and complete byte states before any commit.
    for kind in TARGETS:
        token = exchange(network, kind)
        tokens[kind] = token
        sdk.auth(kind, token)
        head, names = metadata(network, kind, token)
        bootstrap_head, bootstrap_files = BOOTSTRAP[kind]
        expected = published_files(kind, files[kind])
        if head == bootstrap_head:
            require(names == set(bootstrap_files), "remote_inventory")
            verify_remote(network, kind, token, head, bootstrap_files)
            mode = "bootstrap"
        else:
            require(names == set(expected), "remote_inventory")
            verify_remote(network, kind, token, head, expected)
            mode = "noop"
        admitted[kind] = (head, mode)
    for kind in TARGETS:
        head, mode = admitted[kind]
        current, _ = metadata(network, kind, tokens[kind])
        require(current == head, "revision")
        if mode == "bootstrap":
            head = sdk.commit(kind, files[kind], head, source)
            # First durable observation: print before any readback that could fail.
            emit("commit_returned", kind, head)
        verify_remote(network, kind, tokens[kind], head, published_files(kind, files[kind]))
        emit("noop_verified" if mode == "noop" else "private_verified", kind, head)


def deadline(_signum, _frame):
    raise ReleaseError("deadline")


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    sdk = None
    try:
        require(args in (["verify"], ["publish"]), "usage")
        if args == ["publish"]:
            publish_context()
        source = source_sha()
        files = snapshot()
        if args == ["verify"]:
            for kind in TARGETS:
                print(json.dumps({"artifact": kind, "files": len(files[kind]),
                                  "bytes": sum(map(len, files[kind].values())),
                                  "reviewed_hashes": "matched", "source": source}, sort_keys=True))
            return 0
        # SDK warnings/logs can contain provider-supplied text. Do not expose them.
        logging.disable(logging.CRITICAL)
        warnings.filterwarnings("ignore")
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(DEADLINE)
        network = Network()
        sdk = SDK(network)  # Dependency import/version check precedes token acquisition.
        publish(files, source, network, sdk)
        sdk.close()
        sdk = None
        return 0
    except ReleaseError as error:
        result = {"error": error.reason}
        if error.status is not None:
            result["http_status"] = error.status
        print(json.dumps(result, sort_keys=True), file=sys.stderr, flush=True)
        return 1
    except (Exception, KeyboardInterrupt):
        print('{"error": "runtime"}', file=sys.stderr, flush=True)
        return 1
    finally:
        if args == ["publish"]:
            signal.alarm(0)
        if sdk is not None:
            try:
                sdk.close()
            except Exception:
                print('{"error": "runtime"}', file=sys.stderr, flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
