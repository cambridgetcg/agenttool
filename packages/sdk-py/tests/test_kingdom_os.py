"""KINGDOM OS SDK adapter tests — injected runners only, no subprocess or HTTP."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable
from unittest.mock import patch

import httpx
import pytest

from agenttool import (
    AgentTool,
    AgentToolError,
    KingdomOSClient,
    KingdomOSCommand,
    KingdomOSCommandResult,
    KingdomOSRepository,
)


REPOSITORY: KingdomOSRepository = {
    "path": "/Users/test/agenttool",
    "name": "agenttool",
    "kind": "service",
    "layer": "platform",
    "domain": "agents",
    "state": "active",
    "place": "kingdom",
    "metadataSource": "card",
    "purpose": "Agent collaboration substrate",
}


def _recording_runner(
    result: KingdomOSCommandResult,
) -> tuple[list[KingdomOSCommand], Callable[[KingdomOSCommand], KingdomOSCommandResult]]:
    calls: list[KingdomOSCommand] = []

    def runner(command: KingdomOSCommand) -> KingdomOSCommandResult:
        calls.append(command)
        return result

    return calls, runner


class TestKingdomOSLocalBoundary:
    def test_lists_with_exact_argv_parses_schema_and_sanitizes_env(self) -> None:
        result = KingdomOSCommandResult(
            exit_code=0,
            stdout=(
                '[{"path":"/Users/test/agenttool","name":"agenttool",'
                '"kind":"service","layer":"platform","domain":"agents",'
                '"state":"active","place":"kingdom","metadataSource":"card",'
                '"purpose":"Agent collaboration substrate",'
                '"ignoredFutureField":"safe"}]'
            ),
            stderr="",
        )
        calls, runner = _recording_runner(result)
        with (
            patch.dict(
                os.environ,
                {
                    "AT_API_KEY": "agenttool-project-secret",
                    "KINGDOM_TEST_SECRET": "arbitrary-local-secret",
                },
            ),
            patch.object(
                httpx.Client,
                "request",
                side_effect=AssertionError(
                    "KINGDOM OS discovery must not use HTTP"
                ),
            ) as request,
        ):
            kingdom = KingdomOSClient(
                executable="/opt/kingdom/bin/kingdom",
                timeout=2.5,
                max_output_bytes=4096,
                runner=runner,
            )

            repositories = kingdom.repositories(["--literal", "agenttool"])

        assert repositories == [REPOSITORY]
        assert len(calls) == 1
        assert calls[0].executable == "/opt/kingdom/bin/kingdom"
        assert list(calls[0].args) == [
            "repos",
            "--json",
            "--",
            "--literal",
            "agenttool",
        ]
        assert calls[0].timeout == 2.5
        assert calls[0].max_output_bytes == 4096
        assert calls[0].env["NO_COLOR"] == "1"
        assert calls[0].env["TERM"] == "dumb"
        assert "AT_API_KEY" not in calls[0].env
        assert "KINGDOM_TEST_SECRET" not in calls[0].env
        assert "agenttool-project-secret" not in " ".join(calls[0].env.values())
        assert "arbitrary-local-secret" not in " ".join(calls[0].env.values())
        request.assert_not_called()

    def test_resolves_one_absolute_path_with_machine_path_argv(self) -> None:
        calls, runner = _recording_runner(
            KingdomOSCommandResult(
                exit_code=0,
                stdout="/Users/test/agenttool\n",
                stderr="",
            )
        )
        kingdom = KingdomOSClient(runner=runner)

        path = kingdom.resolve(["agenttool", "active"])

        assert path == "/Users/test/agenttool"
        assert list(calls[0].args) == [
            "repos",
            "--path",
            "--",
            "agenttool",
            "active",
        ]

    def test_composes_without_using_or_forwarding_hosted_authority(self) -> None:
        calls, runner = _recording_runner(
            KingdomOSCommandResult(
                exit_code=0,
                stdout=(
                    '[{"path":"/Users/test/agenttool","name":"agenttool",'
                    '"kind":"service","layer":"platform","domain":"agents",'
                    '"state":"active","place":"kingdom","metadataSource":"card",'
                    '"purpose":"Agent collaboration substrate"}]'
                ),
                stderr="",
            )
        )
        with (
            patch.dict(
                os.environ,
                {"KINGDOM_TEST_SECRET": "arbitrary-local-secret"},
            ),
            patch.object(
                httpx.Client,
                "request",
                side_effect=AssertionError(
                    "local KINGDOM OS operations must not use HTTP"
                ),
            ) as request,
        ):
            at = AgentTool(
                api_key="agenttool-project-secret",
                kingdom_runner=runner,
            )

            assert at.kingdom_os.repositories() == [REPOSITORY]
            assert at.kingdom_os is at.kingdom_os
            request.assert_not_called()
            at.close()

        assert len(calls) == 1
        assert "AT_API_KEY" not in calls[0].env
        assert "KINGDOM_TEST_SECRET" not in calls[0].env
        assert "agenttool-project-secret" not in " ".join(calls[0].env.values())


class TestKingdomOSGuidedFailures:
    @pytest.mark.parametrize(
        ("exit_code", "error_code"),
        [
            (1, "kingdom_os_repo_not_found"),
            (2, "kingdom_os_repo_ambiguous"),
            (127, "kingdom_os_cli_dependency_missing"),
        ],
    )
    def test_maps_resolve_exit_codes(
        self,
        exit_code: int,
        error_code: str,
    ) -> None:
        _, runner = _recording_runner(
            KingdomOSCommandResult(
                exit_code=exit_code,
                stdout="",
                stderr="synthetic local diagnostic",
            )
        )

        with pytest.raises(AgentToolError) as exc_info:
            KingdomOSClient(runner=runner).resolve(["agenttool"])

        assert exc_info.value.error_code == error_code
        assert "synthetic local diagnostic" in (exc_info.value.hint or "")
        assert exc_info.value.safety == "docs/KINGDOM-OS-SDK.md"

    def test_invalid_queries_fail_before_runner(self) -> None:
        calls = 0

        def runner(command: KingdomOSCommand) -> KingdomOSCommandResult:
            nonlocal calls
            calls += 1
            return KingdomOSCommandResult(exit_code=0, stdout="[]", stderr="")

        kingdom = KingdomOSClient(runner=runner)

        with pytest.raises(AgentToolError) as missing:
            kingdom.resolve([])
        with pytest.raises(AgentToolError) as invalid:
            kingdom.repositories(["agenttool\nall"])
        with pytest.raises(AgentToolError) as malformed_unicode:
            kingdom.repositories(["\ud800"])

        assert missing.value.error_code == "kingdom_os_query_required"
        assert invalid.value.error_code == "kingdom_os_invalid_query"
        assert malformed_unicode.value.error_code == "kingdom_os_invalid_query"
        assert calls == 0

    @pytest.mark.parametrize(
        "stdout",
        [
            "not JSON",
            '{"repositories":[]}',
            (
                '[{"path":"/Users/test/agenttool","name":"agenttool",'
                '"kind":"service","layer":"platform","domain":"agents",'
                '"state":"active","place":"kingdom","metadataSource":"card",'
                '"purpose":42}]'
            ),
            (
                '[{"path":"/Users/test/agenttool","name":"agenttool",'
                '"kind":"service","layer":"platform","domain":"agents",'
                '"state":"active","place":"kingdom","metadataSource":"card",'
                '"purpose":"\\ud800"}]'
            ),
            (
                '[{"path":"relative/agenttool","name":"agenttool",'
                '"kind":"service","layer":"platform","domain":"agents",'
                '"state":"active","place":"kingdom","metadataSource":"card",'
                '"purpose":"Agent collaboration substrate"}]'
            ),
        ],
    )
    def test_rejects_malformed_repository_inventory(self, stdout: str) -> None:
        _, runner = _recording_runner(
            KingdomOSCommandResult(exit_code=0, stdout=stdout, stderr="")
        )

        with pytest.raises(AgentToolError) as exc_info:
            KingdomOSClient(runner=runner).repositories()

        assert exc_info.value.error_code == "kingdom_os_invalid_response"
        assert exc_info.value.safety == "docs/KINGDOM-OS-SDK.md"

    def test_rejects_relative_resolve_result(self) -> None:
        _, runner = _recording_runner(
            KingdomOSCommandResult(
                exit_code=0,
                stdout="relative/agenttool\n",
                stderr="",
            )
        )

        with pytest.raises(AgentToolError) as exc_info:
            KingdomOSClient(runner=runner).resolve(["agenttool"])

        assert exc_info.value.error_code == "kingdom_os_invalid_response"

    def test_wraps_runner_failure_with_stable_guidance(self) -> None:
        def runner(command: KingdomOSCommand) -> KingdomOSCommandResult:
            raise RuntimeError("synthetic runner failure")

        with pytest.raises(AgentToolError) as exc_info:
            KingdomOSClient(runner=runner).repositories()

        assert exc_info.value.error_code == "kingdom_os_runner_failed"
        assert exc_info.value.details == {"reason": "synthetic runner failure"}
        assert exc_info.value.safety == "docs/KINGDOM-OS-SDK.md"

    def test_output_ceiling_applies_to_injected_runners(self) -> None:
        _, runner = _recording_runner(
            KingdomOSCommandResult(
                exit_code=0,
                stdout="x" * 1025,
                stderr="",
            )
        )

        with pytest.raises(AgentToolError) as exc_info:
            KingdomOSClient(
                max_output_bytes=1024,
                runner=runner,
            ).repositories()

        assert exc_info.value.error_code == "kingdom_os_output_too_large"
        assert exc_info.value.safety == "docs/KINGDOM-OS-SDK.md"

    def test_rejects_malformed_unicode_from_injected_runner(self) -> None:
        _, runner = _recording_runner(
            KingdomOSCommandResult(
                exit_code=0,
                stdout="\ud800",
                stderr="",
            )
        )

        with pytest.raises(AgentToolError) as exc_info:
            KingdomOSClient(runner=runner).repositories()

        assert exc_info.value.error_code == "kingdom_os_runner_failed"
        assert exc_info.value.safety == "docs/KINGDOM-OS-SDK.md"

    @pytest.mark.skipif(os.name != "posix", reason="KINGDOM OS is a POSIX CLI")
    def test_timeout_terminates_the_dedicated_process_group(
        self,
        tmp_path: Path,
    ) -> None:
        executable = tmp_path / "kingdom"
        executable.write_text(
            "#!/usr/bin/env python3\n"
            "import subprocess\n"
            "import sys\n"
            "subprocess.Popen([sys.executable, '-c', "
            "'import time; time.sleep(60)'])\n",
            encoding="utf-8",
        )
        executable.chmod(0o700)

        started = time.monotonic()
        with pytest.raises(AgentToolError) as exc_info:
            KingdomOSClient(
                executable=str(executable),
                timeout=0.05,
            ).repositories()

        assert time.monotonic() - started < 1
        assert exc_info.value.error_code == "kingdom_os_timeout"
