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


if __name__ == "__main__":
    unittest.main()
