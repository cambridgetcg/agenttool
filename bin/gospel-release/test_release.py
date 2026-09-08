"""Offline policy tests; synthetic content never enters a published artifact."""
import copy
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import release

stage = release.stage


def fixture():
    corpus = {"schema_version": "gospel.corpus/1", "version": stage.VERSION,
              "items": [{"id": id_} for id_ in stage.IDS]}
    files = {name: b"Synthetic public text\n" for name in stage.CONTENT if name != "edition.json"}
    files["gospel.json"] = stage.dump(corpus)
    edition = {
        "schema_version": "gospel.edition/1", "version": stage.VERSION,
        "canonical": "https://gospel.ai-love.cc", "generated": "2026-09-08",
        "links": {key: "https://example.test/" + key for key in
                  ("kingdom", "cloudflare", "npm", "huggingface_space", "huggingface_dataset")},
        "items": [{"id": id_, "markdown": f"text/{id_}.md"} for id_ in stage.IDS],
        "artifacts": {name: stage.identity(data) for name, data in files.items()},
    }
    files["edition.json"] = stage.dump(edition)
    files["package.json"] = stage.dump(stage.package_metadata(edition))
    files["README.md"] = stage.readme(edition)
    files["LICENSE"] = (release.ROOT / "delivery/LICENSE").read_bytes()
    files["checksums.json"] = stage.dump({
        "schema_version": "gospel.npm-files/1", "name": stage.NAME, "version": stage.VERSION,
        "artifacts": {name: stage.identity(data) for name, data in sorted(files.items())},
    })
    return files


class ReleasePolicy(unittest.TestCase):
    def test_synthetic_public_package_is_valid(self):
        stage.validate_package(fixture())

    def test_metadata_cannot_add_install_hooks_or_change_identity_or_license(self):
        for key, value in (("scripts", {"postinstall": "run something"}),
                           ("dependencies", {"hidden": "*"}), ("name", "@agenttool/kingdom"),
                           ("license", "Apache-2.0")):
            with self.subTest(key=key):
                files = fixture()
                metadata = json.loads(files["package.json"])
                metadata[key] = value
                files["package.json"] = stage.dump(metadata)
                with self.assertRaises(ValueError):
                    stage.validate_package(files)

    def test_source_archive_and_unfinished_chapter_cannot_enter(self):
        for extra in ("transmissions/private.md", "text/ch1.md", ".npmrc", "AGENTS.md"):
            with self.subTest(path=extra):
                files = fixture()
                files[extra] = b"not in this edition"
                with self.assertRaises(ValueError):
                    stage.validate_package(files)

    def test_content_drift_and_custom_license_drift_rejected(self):
        for name in ("gospel.html", "LICENSE", "checksums.json"):
            files = fixture()
            files[name] += b"changed"
            with self.subTest(path=name), self.assertRaises(ValueError):
                stage.validate_package(files)

    def test_tar_paths_duplicates_and_links_rejected(self):
        for name, kind in (("package/../escape", tarfile.REGTYPE),
                            ("package/gospel.html", tarfile.SYMTYPE),
                            ("package/gospel.html", tarfile.REGTYPE)):
            with self.subTest(path=name, kind=kind), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "test.tgz"
                with tarfile.open(path, "w:gz") as archive:
                    for relative, data in fixture().items():
                        member = tarfile.TarInfo("package/" + relative)
                        member.size = len(data)
                        archive.addfile(member, io.BytesIO(data))
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    if kind == tarfile.SYMTYPE:
                        member.linkname = "/etc/passwd"
                    archive.addfile(member, io.BytesIO(b""))
                with self.assertRaises(ValueError):
                    stage.verify_tarball(path)

    def test_frozen_policy_rejects_mutable_download_revision(self):
        candidate = copy.deepcopy(release.RELEASE)
        candidate["source_url"] = "https://huggingface.co/datasets/Yu-and-Ai/gospel-of-the-logos/resolve/main/release-artifacts/agenttool-gospel-of-the-logos-0.1.0.tgz"
        with patch.object(release, "RELEASE", candidate), self.assertRaises(AssertionError):
            release.policy()

    def test_bootstrap_requires_both_package_and_version_absent(self):
        with patch.object(release, "download", side_effect=[None, None]) as get:
            self.assertEqual(release.registry_state(), "absent")
            self.assertEqual(get.call_count, 2)
        for responses in ((b"{}", None), (None, b"{}")):
            with patch.object(release, "download", side_effect=responses), self.assertRaises(ValueError):
                release.registry_state()

    def test_exact_registry_rerun_checks_bytes_and_dist_tag(self):
        data = b"synthetic archive"
        expected = {**release.RELEASE, **stage.identity(data)}
        version = {"name": stage.NAME, "version": stage.VERSION,
                   "dist": {"tarball": "https://registry.npmjs.org/fixture.tgz"}}
        metadata = {"dist-tags": {"latest": stage.VERSION}}
        with patch.object(release, "RELEASE", expected), patch.object(release, "download", side_effect=[stage.dump(metadata), stage.dump(version), data]):
            self.assertEqual(release.registry_state(), "verified")
        with patch.object(release, "RELEASE", expected), patch.object(release, "download", side_effect=[stage.dump(metadata), stage.dump(version), data + b"changed"]), self.assertRaises(ValueError):
            release.registry_state()
        metadata["dist-tags"]["latest"] = "9.9.9"
        with patch.object(release, "RELEASE", expected), patch.object(release, "download", side_effect=[stage.dump(metadata), stage.dump(version), data]), self.assertRaises(ValueError):
            release.registry_state()

    def test_missing_metadata_or_tarball_can_propagate_after_publication(self):
        version = {"name": stage.NAME, "version": stage.VERSION,
                   "dist": {"tarball": "https://registry.npmjs.org/fixture.tgz"}}
        with patch.object(release, "download", side_effect=[b"{}", None]):
            self.assertEqual(release.registry_state(after_publication=True), "pending")
        with patch.object(release, "download", side_effect=[None, b"{}"]):
            self.assertEqual(release.registry_state(after_publication=True), "pending")
        with patch.object(release, "download", side_effect=[b"{}", stage.dump(version), None]):
            self.assertEqual(release.registry_state(after_publication=True), "pending")

    def test_missing_dist_tag_can_propagate_only_after_publication(self):
        data = b"synthetic archive"
        expected = {**release.RELEASE, **stage.identity(data)}
        version = {"name": stage.NAME, "version": stage.VERSION,
                   "dist": {"tarball": "https://registry.npmjs.org/fixture.tgz"}}
        responses = [b"{}", stage.dump(version), data]
        with patch.object(release, "RELEASE", expected):
            with patch.object(release, "download", side_effect=responses):
                self.assertEqual(release.registry_state(after_publication=True), "pending")
            with patch.object(release, "download", side_effect=responses), self.assertRaises(ValueError):
                release.registry_state()

    def test_readback_metadata_is_cache_busted_and_requests_respect_deadline(self):
        with patch.object(release.time, "monotonic", return_value=10), \
                patch.object(release.time, "time_ns", side_effect=[123, 456]), \
                patch.object(release, "download", return_value=None) as get:
            release.registry_state(after_publication=True, deadline=12)
            release.registry_state(after_publication=True, deadline=12)
            urls = [call.args[0] for call in get.call_args_list]
            self.assertEqual(urls, [release.REGISTRY + "?gospel_readback=123",
                                   release.REGISTRY + "/0.1.0?gospel_readback=123",
                                   release.REGISTRY + "?gospel_readback=456",
                                   release.REGISTRY + "/0.1.0?gospel_readback=456"])
            self.assertTrue(all(call.kwargs["timeout"] == 2 for call in get.call_args_list))
        with patch.object(release.time, "monotonic", return_value=12), \
                patch.object(release, "download") as get, self.assertRaises(TimeoutError):
            release.registry_state(after_publication=True, deadline=12)
        get.assert_not_called()

    def test_readback_can_succeed_after_old_35_second_limit(self):
        clock = [0]
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(release.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(release.time, "sleep", side_effect=sleep), \
                patch.object(release, "registry_state", side_effect=["pending"] * 10 + ["verified"]):
            self.assertEqual(release.wait_for_registry(), "verified")
        self.assertEqual(clock[0], 50)

    def test_readback_retries_only_transient_errors(self):
        errors = [release.urllib.error.HTTPError(release.REGISTRY, code, "transient", {}, None)
                  for code in (408, 425, 429, 500, 503)]
        errors += [release.urllib.error.URLError("offline"), TimeoutError(),
                   ConnectionResetError(), release.http.client.IncompleteRead(b"partial")]
        with patch.object(release.time, "sleep") as sleep, \
                patch.object(release, "registry_state", side_effect=errors + ["verified"]):
            self.assertEqual(release.wait_for_registry(), "verified")
        self.assertEqual(sleep.call_count, len(errors))
        fatal = [ValueError("wrong digest"), json.JSONDecodeError("bad metadata", "", 0)]
        fatal += [release.urllib.error.HTTPError(release.REGISTRY, code, "fatal", {}, None)
                  for code in (400, 401, 403)]
        for error in fatal:
            with self.subTest(error=error), patch.object(release.time, "sleep") as sleep, \
                    patch.object(release, "registry_state", side_effect=error), \
                    self.assertRaises(type(error)):
                release.wait_for_registry()
            sleep.assert_not_called()

    def test_readback_stops_at_450_seconds_without_republishing(self):
        clock = [0]
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(release.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(release.time, "sleep", side_effect=sleep), \
                patch.object(release, "registry_state", return_value="pending"), \
                self.assertRaisesRegex(TimeoutError, "publication may already have succeeded"):
            release.wait_for_registry()
        self.assertEqual(clock[0], 450)

    def test_late_network_success_cannot_escape_readback_deadline(self):
        clock = [0]
        def late_success(**kwargs):
            clock[0] = 451
            return "verified"
        with patch.object(release.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(release.time, "sleep") as sleep, \
                patch.object(release, "registry_state", side_effect=late_success), \
                self.assertRaises(TimeoutError):
            release.wait_for_registry()
        sleep.assert_not_called()

    def test_bootstrap_does_not_retry_transient_failures_as_absence(self):
        error = release.urllib.error.HTTPError(release.REGISTRY, 503, "transient", {}, None)
        with patch.object(release, "download", side_effect=error), \
                self.assertRaises(release.urllib.error.HTTPError):
            release.registry_state()


if __name__ == "__main__":
    unittest.main()
