"""Offline release tests. No installed Hub SDK, credentials, or network required."""
import base64
import contextlib
import copy
from email.message import Message
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import urllib.parse
import urllib.response

HELPER = Path(__file__).absolute().parents[1] / "care-before-learning-hf-release.py"
spec = importlib.util.spec_from_file_location("care_release", HELPER)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
SOURCE = "a" * 40
SECRET = "secret-must-never-appear-1234567890"
ENV = {
    "GITHUB_SHA": SOURCE,
    "GITHUB_REPOSITORY": "cambridgetcg/agenttool",
    "GITHUB_REF": "refs/heads/main",
    "GITHUB_EVENT_NAME": "workflow_dispatch",
    "ACTIONS_ID_TOKEN_REQUEST_URL": "https://pipelines.actions.githubusercontent.com/token?x=1&audience=old",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN": SECRET,
}


class FakeNetwork:
    """Provider protocol with immutable snapshots, conditional writes and faults."""
    json = r.Network.json

    def __init__(self, files):
        self.files = files
        self.calls = []
        self.commits = []
        self.heads = {kind: r.BOOTSTRAP[kind][0] for kind in r.TARGETS}
        self.trees = {}
        self.bootstrap = {}
        for kind in r.TARGETS:
            raw = {name: (kind + ":" + name).encode() for name in r.BOOTSTRAP[kind][1]}
            self.trees[(kind, self.heads[kind])] = raw
            self.bootstrap[kind] = (self.heads[kind], {name: (len(data), r.sha(data)) for name, data in raw.items()})
        self.private = {kind: True for kind in r.TARGETS}
        self.denied = None
        self.denied_auth = None
        self.fail_commit = None
        self.ambiguous = None
        self.malformed_commit = None
        self.bad_readback = None
        self.preupload_mode = "regular"
        self.ignore = False
        self.redirect = None
        self.metadata_hook = None

    def published(self, kind):
        head = ("b" if kind == "dataset" else "c") * 40
        self.heads[kind] = head
        self.trees[(kind, head)] = dict(self.files[kind]) | {
            ".gitattributes": (kind + ":.gitattributes").encode(),
        }
        return head

    def request(self, method, url, token=None, body=None, content_type="application/json", limit=r.JSON_LIMIT):
        self.calls.append((method, url))
        parsed = urllib.parse.urlsplit(url)
        path = parsed.path
        if parsed.hostname == "pipelines.actions.githubusercontent.com":
            if urllib.parse.parse_qs(parsed.query).get("audience") != [r.ORIGIN]:
                raise AssertionError("wrong audience")
            return 200, json.dumps({"value": SECRET}).encode(), None
        if path == "/oauth/token":
            request = json.loads(body)
            kind = request["resource"].split("/")[0][:-1]
            if self.denied == kind:
                return 403, json.dumps({"error": SECRET}).encode(), None
            return 200, json.dumps({"access_token": SECRET + kind}).encode(), None
        if path == "/api/validate-yaml":
            return 200, b'{"warnings": [], "errors": []}', None
        kind = next(kind for kind in r.TARGETS if f"/{kind}s/{r.REPOS[kind]}" in path)
        if token != SECRET + kind:
            raise AssertionError("wrong scoped token")
        if path.endswith("/auth-check/write"):
            return (403 if self.denied_auth == kind else 200), b"{}", None
        if "/revision/" in path:
            revision = path.split("/revision/")[1]
            if self.metadata_hook:
                self.metadata_hook(kind, revision)
            head = self.heads[kind] if revision == "main" else revision
            info = {"id": r.REPOS[kind], "private": self.private[kind], "sha": head,
                    "sdk": "static", "siblings": [{"rfilename": name} for name in self.trees[(kind, head)]]}
            return 200, json.dumps(info).encode(), None
        if "/resolve/" in path or "/api/resolve-cache/" in path:
            if self.redirect:
                return 307, b"", self.redirect
            if "/resolve/" in path:
                revision, name = path.split("/resolve/")[1].split("/", 1)
            else:
                revision, name = path.split(r.REPOS[kind] + "/")[1].split("/", 1)
            raw = self.trees[(kind, revision)][name]
            if kind == self.bad_readback and revision != r.BOOTSTRAP[kind][0] and name != ".gitattributes":
                raw = b"bad"
            r.require(len(raw) <= limit, "response_bound")
            return 200, raw, None
        if "/preupload/" in path:
            request = json.loads(body)
            rows = [{"path": row["path"], "uploadMode": self.preupload_mode,
                     "shouldIgnore": self.ignore, "oid": "d" * 40 if row["path"] in
                     self.trees[(kind, self.heads[kind])] else None} for row in request["files"]]
            return 200, json.dumps({"files": rows}).encode(), None
        if "/commit/" in path:
            self.commits.append(kind)
            if self.fail_commit == kind:
                return 409, SECRET.encode(), None
            rows = [json.loads(line) for line in body.splitlines()]
            if rows[0]["value"]["parentCommit"] != self.heads[kind]:
                return 409, SECRET.encode(), None
            payload = {row["value"]["path"]: base64.b64decode(row["value"]["content"]) for row in rows[1:]}
            if payload != self.files[kind]:
                raise AssertionError("wrong snapshot")
            head = self.published(kind)
            if self.ambiguous == kind:
                raise TimeoutError(SECRET)
            if self.malformed_commit == kind:
                return 200, b"{}", None
            return 200, json.dumps({"commitOid": head, "commitUrl": f"{r.ORIGIN}/{kind}s/{r.REPOS[kind]}/commit/{head}"}).encode(), None
        raise AssertionError("unexpected endpoint")


def fake_modules():
    """Small protocol fake, not an import/install of candidate or provider code."""
    httpx = types.ModuleType("httpx")
    httpx.BaseTransport = object
    httpx.Response = lambda status, content, request: types.SimpleNamespace(content=content)

    class Client:
        def __init__(self, **kwargs):
            self.transport = kwargs["transport"]
            if kwargs["trust_env"] or kwargs["follow_redirects"]:
                raise AssertionError("ambient transport")
        def close(self):
            pass
        def send(self, method, url, token, body=b""):
            request = types.SimpleNamespace(method=method, url=url,
                                            headers={"Authorization": "Bearer " + token}, content=body)
            return self.transport.handle_request(request).content
    httpx.Client = Client
    hub = types.ModuleType("huggingface_hub")
    hub.__version__ = r.SDK_VERSION
    hub.set_client_factory = lambda factory: setattr(hub, "client", factory())
    hub.CommitOperationAdd = lambda **kwargs: types.SimpleNamespace(**kwargs)

    class HfApi:
        def __init__(self, **kwargs):
            if kwargs != {"endpoint": r.ORIGIN, "token": False}:
                raise AssertionError("implicit token")
        def auth_check(self, repo, *, repo_type, token, write):
            if write is not True:
                raise AssertionError("not write check")
            hub.client.send("GET", f"{r.ORIGIN}/api/{repo_type}s/{repo}/auth-check/write", token)
        def create_commit(self, **kwargs):
            for name, expected in {"revision": "main", "create_pr": False, "num_threads": 1, "run_as_future": False}.items():
                if kwargs[name] != expected:
                    raise AssertionError("wrong commit parameter")
            token = kwargs["token"]
            prefix = f'{r.ORIGIN}/api/{kwargs["repo_type"]}s/{kwargs["repo_id"]}'
            operations = kwargs["operations"]
            if not all(type(op.path_or_fileobj) is bytes for op in operations):
                raise AssertionError("reopened upload path")
            hub.client.send("POST", r.ORIGIN + "/api/validate-yaml", token, b"{}")
            preupload = {"files": [{"path": op.path_in_repo} for op in operations]}
            hub.client.send("POST", prefix + "/preupload/main", token, json.dumps(preupload).encode())
            rows = [{"key": "header", "value": {"parentCommit": kwargs["parent_commit"]}}]
            rows += [{"key": "file", "value": {"path": op.path_in_repo, "encoding": "base64",
                      "content": base64.b64encode(op.path_or_fileobj).decode()}} for op in operations]
            response = hub.client.send("POST", prefix + "/commit/main", token,
                                       b"\n".join(json.dumps(row).encode() for row in rows))
            return types.SimpleNamespace(oid=json.loads(response)["commitOid"])
    hub.HfApi = HfApi
    return {"httpx": httpx, "huggingface_hub": hub}


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        shutil.copytree(r.REPO_ROOT / r.BASE, self.root / r.BASE)
        self.addCleanup(patch.stopall)
        patch.object(r, "REPO_ROOT", self.root).start()

    def test_pins_and_counts(self):
        data = r.snapshot()
        self.assertEqual([len(data[kind]) for kind in r.TARGETS], [15, 14])
        self.assertEqual(sum(map(len, data["dataset"].values())), 103222)
        with self.assertRaises(TypeError):
            data["dataset"]["README.md"] = b"bad"

    def test_tampered_bytes_and_manifest(self):
        for name, reason in [("README.md", "bytes"), ("hash-manifest.json", "manifest")]:
            path = self.root / r.BASE / "dataset" / name
            original = path.read_bytes()
            path.write_bytes(original + b" ")
            with self.assertRaisesRegex(r.ReleaseError, reason):
                r.snapshot()
            path.write_bytes(original)

    def test_missing_extra_directory_and_file(self):
        path = self.root / r.BASE / "dataset" / "unexpected"
        for directory in (False, True):
            path.mkdir() if directory else path.write_bytes(b"x")
            with self.assertRaisesRegex(r.ReleaseError, "inventory"):
                r.snapshot()
            path.rmdir() if directory else path.unlink()
        (self.root / r.BASE / "dataset" / "README.md").unlink()
        with self.assertRaisesRegex(r.ReleaseError, "inventory"):
            r.snapshot()

    def test_symlink_file_directory_and_ancestor(self):
        for relative in ("dataset/README.md", "dataset/profile", "dataset", ""):
            path = self.root / r.BASE / relative
            parked = path.with_name(path.name + "-parked")
            path.rename(parked)
            path.symlink_to(parked, target_is_directory=parked.is_dir())
            with self.assertRaises(r.ReleaseError):
                r.snapshot()
            path.unlink()
            parked.rename(path)

    def test_actual_file_bound(self):
        (self.root / r.BASE / "dataset" / "README.md").write_bytes(b"x" * (r.FILE_LIMIT + 1))
        with self.assertRaisesRegex(r.ReleaseError, "file_bound"):
            r.snapshot()

    def test_actual_aggregate_bound(self):
        with patch.object(r, "ARTIFACT_LIMIT", 100):
            with self.assertRaisesRegex(r.ReleaseError, "artifact_bound"):
                r.snapshot()

    def test_manifest_paths_cannot_escape_even_with_test_pin(self):
        path = self.root / r.BASE / "dataset" / "hash-manifest.json"
        original = json.loads(path.read_bytes())
        for name in ("../secret", "/secret", "profile//x", "profile/./x", "hash-manifest.json", "README.md"):
            manifest = copy.deepcopy(original)
            manifest["files"][0]["path"] = name
            raw = json.dumps(manifest).encode()
            path.write_bytes(raw)
            roots = dict(r.ROOTS, dataset=(15, r.sha(raw)))
            with patch.object(r, "ROOTS", roots), self.assertRaises(r.ReleaseError):
                r.snapshot()

    def test_snapshot_not_reopened(self):
        data = r.snapshot()
        path = self.root / r.BASE / "dataset" / "README.md"
        original = data["dataset"]["README.md"]
        path.write_bytes(b"changed after verification")
        self.assertEqual(data["dataset"]["README.md"], original)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.files = r.snapshot()
        self.network = FakeNetwork(self.files)
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, ENV, clear=True).start()
        patch.object(r, "BOOTSTRAP", self.network.bootstrap).start()
        patch.dict(sys.modules, fake_modules()).start()
        self.sdk = r.SDK(self.network)
        self.addCleanup(self.sdk.close)
        self.output = io.StringIO()
        patch("sys.stdout", self.output).start()

    def run_publish(self):
        r.publish(self.files, SOURCE, self.network, self.sdk)

    def test_both_preflight_before_dataset_then_space(self):
        original = self.network.request
        def check_receipt(method, url, *args, **kwargs):
            if "/commit/" in url:
                latest = json.loads(self.output.getvalue().splitlines()[-1])
                self.assertEqual(latest["event"], "submission_attempt")
            return original(method, url, *args, **kwargs)
        with patch.object(self.network, "request", check_receipt):
            self.run_publish()
        self.assertEqual(self.network.commits, ["dataset", "space"])
        first_write = next(i for i, call in enumerate(self.network.calls) if "/commit/" in call[1])
        for kind in r.TARGETS:
            self.assertTrue(any(f"{kind}s/{r.REPOS[kind]}/auth-check/write" in url for _, url in self.network.calls[:first_write]))
        events = [json.loads(line)["event"] for line in self.output.getvalue().splitlines()]
        self.assertEqual(events, ["submission_attempt", "commit_returned", "private_verified",
                                  "submission_attempt", "commit_returned", "private_verified"])

    def test_second_preflight_nonprivate_zero_writes(self):
        self.network.private["space"] = False
        with self.assertRaisesRegex(r.ReleaseError, "privacy"):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_denied_exchange_zero_writes(self):
        self.network.denied = "space"
        with self.assertRaisesRegex(r.ReleaseError, "http"):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_denied_write_auth_zero_writes(self):
        self.network.denied_auth = "space"
        with self.assertRaisesRegex(r.ReleaseError, "http"):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_unexpected_bootstrap_file_zero_writes(self):
        self.network.trees[("space", self.network.heads["space"])]["unexpected"] = b"bad"
        with self.assertRaisesRegex(r.ReleaseError, "remote_inventory"):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_bootstrap_bytes_zero_writes(self):
        self.network.trees[("space", self.network.heads["space"])]["README.md"] = b"bad"
        with self.assertRaises(r.ReleaseError):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_wrong_bootstrap_revision_zero_writes(self):
        old = self.network.heads["space"]
        self.network.heads["space"] = "e" * 40
        self.network.trees[("space", "e" * 40)] = self.network.trees[("space", old)]
        with self.assertRaisesRegex(r.ReleaseError, "remote_inventory"):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_concurrent_head_change_zero_writes(self):
        reads = 0
        def mutate(kind, revision):
            nonlocal reads
            if kind == "dataset" and revision == "main":
                reads += 1
                if reads == 3:
                    self.network.published(kind)
        self.network.metadata_hook = mutate
        with self.assertRaisesRegex(r.ReleaseError, "revision"):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_conditional_conflict_not_retried(self):
        self.network.fail_commit = "dataset"
        with self.assertRaisesRegex(r.ReleaseError, "http"):
            self.run_publish()
        self.assertEqual(self.network.commits, ["dataset"])
        events = [json.loads(line) for line in self.output.getvalue().splitlines()]
        self.assertEqual([event["event"] for event in events], ["submission_attempt", "submission_rejected"])
        self.assertEqual(events[-1]["http_status"], 409)
        self.assertNotIn(SECRET, self.output.getvalue())

    def test_partial_second_commit_failure_keeps_first_receipt(self):
        self.network.fail_commit = "space"
        with self.assertRaisesRegex(r.ReleaseError, "http"):
            self.run_publish()
        self.assertEqual(self.network.commits, ["dataset", "space"])
        self.assertIn('"event": "private_verified"', self.output.getvalue())
        events = [json.loads(line) for line in self.output.getvalue().splitlines()]
        self.assertFalse(any(event["artifact"] == "space" and event["event"] == "private_verified" for event in events))
        self.assertEqual(events[-1]["event"], "submission_rejected")

    def test_ambiguous_write_stops_then_fresh_run_reconciles(self):
        self.network.ambiguous = "dataset"
        with self.assertRaises(TimeoutError):
            self.run_publish()
        self.assertEqual(self.network.commits, ["dataset"])
        events = [json.loads(line) for line in self.output.getvalue().splitlines()]
        self.assertEqual([event["event"] for event in events], ["submission_attempt", "outcome_unknown"])
        self.assertEqual(events[0]["source"], SOURCE)
        self.assertEqual(events[0]["parent"], self.network.bootstrap["dataset"][0])
        self.assertEqual(events[0]["target"], r.REPOS["dataset"])
        self.assertEqual(events[0]["attempt"], 1)
        self.assertNotIn(SECRET, self.output.getvalue())
        self.network.ambiguous = None
        self.sdk = r.SDK(self.network)
        self.addCleanup(self.sdk.close)
        self.run_publish()
        self.assertEqual(self.network.commits, ["dataset", "space"])
        self.assertIn('"event": "noop_verified"', self.output.getvalue())

    def test_malformed_successful_commit_response_is_unknown(self):
        self.network.malformed_commit = "dataset"
        with self.assertRaises(KeyError):
            self.run_publish()
        self.assertEqual(self.network.commits, ["dataset"])
        events = [json.loads(line)["event"] for line in self.output.getvalue().splitlines()]
        self.assertEqual(events, ["submission_attempt", "outcome_unknown"])
        self.assertNotIn(SECRET, self.output.getvalue())

    def test_noop_both_exact_has_no_writes(self):
        for kind in r.TARGETS:
            self.network.published(kind)
        self.run_publish()
        self.assertEqual(self.network.commits, [])
        self.assertEqual(self.output.getvalue().count("noop_verified"), 2)

    def test_wrong_published_readback_zero_writes(self):
        self.network.published("dataset")
        self.network.bad_readback = "dataset"
        with self.assertRaises(r.ReleaseError):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_new_readback_failure_emits_oid_and_stops_space(self):
        self.network.bad_readback = "dataset"
        with self.assertRaises(r.ReleaseError):
            self.run_publish()
        self.assertEqual(self.network.commits, ["dataset"])
        self.assertIn('"event": "commit_returned"', self.output.getvalue())
        self.assertNotIn("private_verified", self.output.getvalue())

    def test_provider_file_must_stay_exact_in_noop(self):
        head = self.network.published("space")
        self.network.trees[("space", head)][".gitattributes"] = b"bad"
        with self.assertRaises(r.ReleaseError):
            self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_lfs_or_ignored_preupload_refused_before_commit(self):
        for mode, ignored in [("lfs", False), ("regular", True)]:
            self.network.preupload_mode, self.network.ignore = mode, ignored
            self.sdk = r.SDK(self.network)
            self.addCleanup(self.sdk.close)
            with self.assertRaisesRegex(r.ReleaseError, "upload_mode"):
                self.run_publish()
        self.assertEqual(self.network.commits, [])

    def test_sdk_route_and_repeat_guard(self):
        self.sdk.auth("dataset", SECRET + "dataset")
        with self.assertRaisesRegex(r.ReleaseError, "sdk_retry"):
            self.sdk.auth("dataset", SECRET + "dataset")
        before = len(self.network.calls)
        for url in (r.ORIGIN + "/api/repos/create", "https://evil.example/commit", r.ORIGIN + "/api/datasets/other/repo/commit/main"):
            with self.assertRaisesRegex(r.ReleaseError, "sdk_route"):
                self.sdk.request("POST", url, "Bearer " + SECRET + "dataset", b"{}")
        self.assertEqual(len(self.network.calls), before)

    def test_redirect_cannot_leave_origin_or_revision(self):
        for redirect in ("https://evil.example/secret", "http://huggingface.co/secret", "/datasets/other/repo/resolve/main/README.md"):
            self.network.redirect = redirect
            with self.assertRaisesRegex(r.ReleaseError, "sdk_route"):
                self.run_publish()
            self.sdk = r.SDK(self.network)
            self.addCleanup(self.sdk.close)
        self.assertEqual(self.network.commits, [])

    def test_immutable_cache_redirect_and_finite_loop(self):
        kind = "dataset"
        head = self.network.heads[kind]
        location = f"/api/resolve-cache/datasets/{r.REPOS[kind]}/{head}/.gitattributes"
        original = self.network.request
        first = True
        def request(*args, **kwargs):
            nonlocal first
            if first:
                first = False
                return 307, b"", location
            return original(*args, **kwargs)
        with patch.object(self.network, "request", request):
            data = r.remote_file(self.network, kind, SECRET + kind, head, ".gitattributes", self.network.bootstrap[kind][1][".gitattributes"][0])
        self.assertEqual(data, b"dataset:.gitattributes")
        self.network.redirect = location
        with self.assertRaisesRegex(r.ReleaseError, "sdk_route"):
            r.remote_file(self.network, kind, SECRET + kind, head, ".gitattributes", len(data))


class CLITests(unittest.TestCase):
    def test_verify_does_not_import_sdk_or_use_network_or_credentials(self):
        out = io.StringIO()
        with patch.dict(os.environ, {"GITHUB_SHA": SOURCE, "HF_TOKEN": SECRET}, clear=True), \
             patch.object(r, "source_sha", return_value=SOURCE), \
             patch.object(r, "SDK", side_effect=AssertionError("SDK used")), \
             patch.object(r, "Network", side_effect=AssertionError("network used")), \
             contextlib.redirect_stdout(out):
            self.assertEqual(r.main(["verify"]), 0)
        self.assertNotIn(SECRET, out.getvalue())
        self.assertEqual(len(out.getvalue().splitlines()), 2)

    def test_wrong_repository_ref_event_stop_before_snapshot_and_credentials(self):
        for key in ("GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_EVENT_NAME"):
            with patch.dict(os.environ, ENV | {key: "wrong"}, clear=True), \
                 patch.object(r, "snapshot", side_effect=AssertionError("snapshot")), \
                 patch.object(r, "SDK", side_effect=AssertionError("SDK")), \
                 contextlib.redirect_stderr(io.StringIO()) as error:
                self.assertEqual(r.main(["publish"]), 1)
                self.assertEqual(json.loads(error.getvalue()), {"error": "context"})

    def test_no_arbitrary_commands_or_inputs(self):
        for args in ([], ["publish", "other/repo"], ["verify", "../other"], ["upload"], ["--help"]):
            with patch.object(r, "source_sha", side_effect=AssertionError("source called")), \
                 contextlib.redirect_stderr(io.StringIO()) as error:
                self.assertEqual(r.main(args), 1)
                self.assertEqual(json.loads(error.getvalue()), {"error": "usage"})

    def test_sha_required_exact_git_head(self):
        for supplied in ("", "main", "A" * 40, SOURCE):
            with patch.dict(os.environ, {"GITHUB_SHA": supplied}, clear=True), \
                 patch.object(r.subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stdout=b"b" * 40 + b"\n")):
                with self.assertRaisesRegex(r.ReleaseError, "source"):
                    r.source_sha()
        with patch.dict(os.environ, {"GITHUB_SHA": SOURCE}, clear=True), \
             patch.object(r.subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stdout=(SOURCE + "\n").encode())):
            self.assertEqual(r.source_sha(), SOURCE)

    def test_raw_exceptions_and_http_bodies_are_never_printed(self):
        for exception, expected in [(RuntimeError(SECRET), {"error": "runtime"}),
                                    (r.ReleaseError(SECRET, 403), {"error": "runtime", "http_status": 403})]:
            with patch.object(r, "source_sha", side_effect=exception), \
                 contextlib.redirect_stderr(io.StringIO()) as error:
                self.assertEqual(r.main(["verify"]), 1)
                self.assertEqual(json.loads(error.getvalue()), expected)
                self.assertNotIn(SECRET, error.getvalue())

    def test_publish_runtime_exception_sanitized_and_dependency_before_oidc(self):
        order = []
        def sdk(_network):
            order.append("dependency")
            raise RuntimeError(SECRET)
        with patch.dict(os.environ, ENV, clear=True), patch.object(r, "source_sha", return_value=SOURCE), \
             patch.object(r, "SDK", side_effect=sdk), patch.object(r, "exchange", side_effect=AssertionError("auth")), \
             contextlib.redirect_stderr(io.StringIO()) as error:
            self.assertEqual(r.main(["publish"]), 1)
        self.assertEqual(order, ["dependency"])
        self.assertEqual(json.loads(error.getvalue()), {"error": "runtime"})

    def test_oidc_origin_restrictions_and_no_hf_token_fallback(self):
        for url in ("http://pipelines.actions.githubusercontent.com/token", "https://evil.example/token",
                    "https://pipelines.actions.githubusercontent.com.evil.example/token",
                    "https://user@pipelines.actions.githubusercontent.com/token",
                    "https://pipelines.actions.githubusercontent.com:444/token"):
            network = types.SimpleNamespace(json=lambda *args, **kwargs: self.fail("network called"))
            with patch.dict(os.environ, ENV | {"ACTIONS_ID_TOKEN_REQUEST_URL": url}, clear=True), \
                 self.assertRaises(r.ReleaseError):
                r.exchange(network, "dataset")
        with patch.dict(os.environ, {"HF_TOKEN": SECRET}, clear=True), self.assertRaises(r.ReleaseError):
            r.exchange(network, "dataset")


class NetworkTests(unittest.TestCase):
    def response(self, data=b"{}", status=200, headers=None):
        response = io.BytesIO(data)
        response.status = status
        response.headers = headers or {}
        return response

    def test_redirect_responses_never_send_a_second_request(self):
        url = r.ORIGIN + "/offline-redirect-probe"
        location = "https://other.invalid/never-contact"
        for method in ("GET", "POST"):
            for status in (301, 302, 303, 307, 308):
                with self.subTest(method=method, status=status):
                    calls = []
                    body = b"{}" if method == "POST" else None

                    def https_open(_handler, request):
                        calls.append((request.full_url, request.get_method(), request.data,
                                      request.get_header("Authorization"), request.timeout, request.host))
                        headers = Message()
                        headers["Location"] = location
                        response = urllib.response.addinfourl(io.BytesIO(b"redirect"), headers, url, status)
                        response.msg = "Redirect"
                        return response

                    with patch.dict(os.environ, {"https_proxy": "http://proxy.invalid:8080", "no_proxy": ""}), \
                         patch("socket.socket.connect", side_effect=AssertionError("live network forbidden")), \
                         patch.object(r.urllib.request.HTTPSHandler, "https_open", https_open):
                        result = r.Network().request(method, url, SECRET, body)
                    self.assertEqual(result, (status, b"redirect", location))
                    self.assertEqual(calls, [(url, method, body, "Bearer " + SECRET, 15, "huggingface.co")])

    def test_actual_response_read_bound(self):
        network = r.Network()
        with patch.object(r, "open_no_redirect", return_value=self.response(b"12345")), \
             self.assertRaisesRegex(r.ReleaseError, "response_bound"):
            network.request("GET", r.ORIGIN, limit=4)

    def test_request_and_total_byte_bounds(self):
        network = r.Network()
        network.requests = r.REQUEST_LIMIT
        with patch.object(r, "open_no_redirect", side_effect=AssertionError("network")), \
             self.assertRaisesRegex(r.ReleaseError, "network_bound"):
            network.request("GET", r.ORIGIN)
        network.requests = 0
        network.received = r.NETWORK_BYTES
        with patch.object(r, "open_no_redirect", return_value=self.response()), \
             self.assertRaisesRegex(r.ReleaseError, "network_bound"):
            network.request("GET", r.ORIGIN)

    def test_no_compression_pagination_or_retry(self):
        for headers in ({"Content-Encoding": "gzip"}, {"Link": "evil"}):
            network = r.Network()
            with patch.object(r, "open_no_redirect", return_value=self.response(headers=headers)), \
                 self.assertRaisesRegex(r.ReleaseError, "response_bound"):
                network.request("GET", r.ORIGIN)
        network = r.Network()
        with patch.object(r, "open_no_redirect", side_effect=TimeoutError(SECRET)) as call, \
             self.assertRaisesRegex(r.ReleaseError, "transport"):
            network.request("GET", r.ORIGIN)
        self.assertEqual(call.call_count, 1)

    def test_finite_deadline(self):
        network = r.Network()
        network.started -= r.DEADLINE + 1
        with self.assertRaisesRegex(r.ReleaseError, "deadline"):
            network.request("GET", r.ORIGIN)

    def test_http_failure_sanitized(self):
        network = r.Network()
        with patch.object(r, "open_no_redirect", return_value=self.response(SECRET.encode(), 403)):
            with self.assertRaises(r.ReleaseError) as error:
                network.json("POST", r.ORIGIN)
        self.assertEqual(str(error.exception), "http")
        self.assertEqual(error.exception.status, 403)


class RealSDKTests(unittest.TestCase):
    def test_installed_pinned_sdk_with_fake_upstream(self):
        # Credentialless CI runs this again after hash-locked installation. The
        # stdlib-only run explicitly skips this single optional integration test.
        if importlib.util.find_spec("huggingface_hub") is None:
            self.skipTest("optional pinned SDK integration: huggingface_hub not installed")
        import huggingface_hub as hub
        import httpx
        self.assertEqual(hub.__version__, r.SDK_VERSION)
        files = r.snapshot()
        network = FakeNetwork(files)
        output = io.StringIO()
        with patch.dict(os.environ, ENV, clear=True), patch.object(r, "BOOTSTRAP", network.bootstrap), \
             patch.object(httpx.HTTPTransport, "handle_request", side_effect=AssertionError("live HTTP forbidden")), \
             patch.object(r.urllib.request.OpenerDirector, "open", side_effect=AssertionError("live urllib forbidden")), \
             contextlib.redirect_stdout(output):
            sdk = r.SDK(network)
            try:
                r.publish(files, SOURCE, network, sdk)
            finally:
                sdk.close()
        self.assertEqual(network.commits, ["dataset", "space"])
        self.assertEqual(output.getvalue().count("private_verified"), 2)


if __name__ == "__main__":
    unittest.main()
