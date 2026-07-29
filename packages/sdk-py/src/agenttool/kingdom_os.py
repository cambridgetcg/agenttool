"""Bounded local adapter for KINGDOM OS repository discovery.

This client invokes only the committed machine-readable ``kingdom repos``
surfaces. It never uses the hosted AgentTool transport, opens a shell, mutates
repository state, runs Kingdom routines, or uploads local paths.

Doctrine: ``docs/KINGDOM-OS-SDK.md``.
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import threading
import time
from collections.abc import Sequence as SequenceABC
from dataclasses import dataclass
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Tuple, TypedDict

from .exceptions import AgentToolError


class KingdomOSRepository(TypedDict):
    """One local Git root reported by ``kingdom repos --json``."""

    path: str
    name: str
    kind: str
    layer: str
    domain: str
    state: str
    place: str
    metadataSource: str
    purpose: str


@dataclass(frozen=True)
class KingdomOSCommand:
    """Exact fixed command presented to an injected local runner."""

    executable: str
    args: Tuple[str, ...]
    timeout: float
    max_output_bytes: int
    env: Mapping[str, str]


@dataclass(frozen=True)
class KingdomOSCommandResult:
    """Captured outcome from an injected local runner."""

    exit_code: int
    stdout: str
    stderr: str


KingdomOSRunner = Callable[[KingdomOSCommand], KingdomOSCommandResult]

_DEFAULT_TIMEOUT_SECONDS = 10.0
_DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024
_MAX_TERMS = 32
_MAX_TERM_BYTES = 256
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
_REPOSITORY_FIELDS = (
    "path",
    "name",
    "kind",
    "layer",
    "domain",
    "state",
    "place",
    "metadataSource",
    "purpose",
)


def _has_unicode_surrogate(value: str) -> bool:
    return any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def _guided_error(
    message: str,
    error_code: str,
    hint: str,
    details: object = None,
) -> AgentToolError:
    return AgentToolError(
        message,
        error_code=error_code,
        hint=hint,
        details=details,
        safety="docs/KINGDOM-OS-SDK.md",
    )


def _safe_child_environment() -> Mapping[str, str]:
    env: Dict[str, str] = {"NO_COLOR": "1", "TERM": "dumb"}
    for name in ("HOME", "PATH", "LANG", "LC_ALL", "TMPDIR"):
        value = os.environ.get(name)
        if value:
            env[name] = value
    return env


def _clean_diagnostic(value: str) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "\ufffd", value)
    return cleaned.strip()[:512]


def _validate_terms(terms: Sequence[str], required: bool) -> Tuple[str, ...]:
    if isinstance(terms, (str, bytes)) or not isinstance(terms, SequenceABC):
        raise _guided_error(
            "KINGDOM OS repository query terms are invalid.",
            "kingdom_os_invalid_query",
            "Pass query terms as a sequence of strings.",
        )
    if required and len(terms) == 0:
        raise _guided_error(
            "A KINGDOM OS repository query is required.",
            "kingdom_os_query_required",
            "Pass one or more repository name, path, layer, state, or purpose terms.",
        )
    if len(terms) > _MAX_TERMS:
        raise _guided_error(
            "Too many KINGDOM OS repository query terms.",
            "kingdom_os_invalid_query",
            f"Pass no more than {_MAX_TERMS} terms.",
        )

    validated: List[str] = []
    for term in terms:
        if (
            not isinstance(term, str)
            or not term
            or _CONTROL_CHARACTERS.search(term)
            or _has_unicode_surrogate(term)
        ):
            raise _guided_error(
                "A KINGDOM OS repository query term is invalid.",
                "kingdom_os_invalid_query",
                "Use non-empty terms without control characters, each at most "
                f"{_MAX_TERM_BYTES} UTF-8 bytes.",
            )
        if len(term.encode("utf-8")) > _MAX_TERM_BYTES:
            raise _guided_error(
                "A KINGDOM OS repository query term is invalid.",
                "kingdom_os_invalid_query",
                "Use non-empty terms without control characters, each at most "
                f"{_MAX_TERM_BYTES} UTF-8 bytes.",
            )
        validated.append(term)
    return tuple(validated)


def _run_local_command(command: KingdomOSCommand) -> KingdomOSCommandResult:
    deadline = time.monotonic() + command.timeout
    try:
        process = subprocess.Popen(
            [command.executable, *command.args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=dict(command.env),
            shell=False,
            start_new_session=os.name == "posix",
        )
    except FileNotFoundError as error:
        raise _guided_error(
            "Could not launch the local KINGDOM OS executable.",
            "kingdom_os_cli_not_found",
            "Install KINGDOM OS on PATH or pass its exact executable path.",
            {"reason": str(error)},
        ) from error
    except OSError as error:
        raise _guided_error(
            "Could not launch the local KINGDOM OS executable.",
            "kingdom_os_launch_failed",
            "Install KINGDOM OS on PATH or pass its exact executable path.",
            {"reason": str(error)},
        ) from error

    streams = {"stdout": process.stdout, "stderr": process.stderr}
    chunks: Dict[str, List[bytes]] = {"stdout": [], "stderr": []}
    total_bytes = 0
    output_too_large = threading.Event()
    lock = threading.Lock()

    def terminate_process_group() -> None:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except (OSError, ProcessLookupError):
            pass

    def collect(name: str) -> None:
        nonlocal total_bytes
        stream = streams[name]
        if stream is None:
            return
        try:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    return
                with lock:
                    total_bytes += len(chunk)
                    if total_bytes > command.max_output_bytes:
                        output_too_large.set()
                    else:
                        chunks[name].append(chunk)
                if output_too_large.is_set():
                    terminate_process_group()
                    return
        finally:
            stream.close()

    readers = [
        threading.Thread(target=collect, args=(name,), daemon=True)
        for name in ("stdout", "stderr")
    ]
    for reader in readers:
        reader.start()

    try:
        exit_code = process.wait(
            timeout=max(0.001, deadline - time.monotonic())
        )
    except subprocess.TimeoutExpired as error:
        terminate_process_group()
        process.wait()
        for reader in readers:
            reader.join(timeout=0.05)
        raise _guided_error(
            "KINGDOM OS command timed out.",
            "kingdom_os_timeout",
            "Narrow the repository query or increase the local timeout deliberately.",
        ) from error

    if output_too_large.is_set():
        terminate_process_group()
        for reader in readers:
            reader.join(timeout=0.05)
        raise _guided_error(
            "KINGDOM OS command output exceeded the configured limit.",
            "kingdom_os_output_too_large",
            "Narrow the repository query or raise max_output_bytes deliberately.",
        )
    for reader in readers:
        reader.join(timeout=max(0.0, deadline - time.monotonic()))
    if any(reader.is_alive() for reader in readers):
        terminate_process_group()
        for reader in readers:
            reader.join(timeout=0.05)
        raise _guided_error(
            "KINGDOM OS command timed out.",
            "kingdom_os_timeout",
            "Narrow the repository query or increase the local timeout deliberately.",
        )
    if output_too_large.is_set():
        raise _guided_error(
            "KINGDOM OS command output exceeded the configured limit.",
            "kingdom_os_output_too_large",
            "Narrow the repository query or raise max_output_bytes deliberately.",
        )

    try:
        stdout = b"".join(chunks["stdout"]).decode("utf-8")
        stderr = b"".join(chunks["stderr"]).decode("utf-8")
    except UnicodeDecodeError as error:
        raise _guided_error(
            "KINGDOM OS returned output that was not valid UTF-8.",
            "kingdom_os_invalid_response",
            "Update KINGDOM OS or pass a compatible local runner.",
        ) from error
    return KingdomOSCommandResult(
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
    )


def _repository_from(value: object, index: int) -> KingdomOSRepository:
    if not isinstance(value, dict):
        raise _guided_error(
            "KINGDOM OS returned an invalid repository inventory.",
            "kingdom_os_invalid_response",
            "Update KINGDOM OS or use a compatible runner that returns "
            "``kingdom repos --json``.",
            {"index": index},
        )

    for field in _REPOSITORY_FIELDS:
        candidate = value.get(field)
        if (
            not isinstance(candidate, str)
            or _CONTROL_CHARACTERS.search(candidate)
            or _has_unicode_surrogate(candidate)
        ):
            raise _guided_error(
                "KINGDOM OS returned an invalid repository inventory.",
                "kingdom_os_invalid_response",
                "Update KINGDOM OS or use a compatible runner that returns "
                "the nine-field repository schema.",
                {"index": index, "field": field},
            )
    if not value["path"].startswith("/"):
        raise _guided_error(
            "KINGDOM OS returned a non-absolute repository path.",
            "kingdom_os_invalid_response",
            "Use the canonical ``kingdom repos --json`` command, which emits "
            "absolute local paths.",
            {"index": index, "field": "path"},
        )

    return {
        "path": value["path"],
        "name": value["name"],
        "kind": value["kind"],
        "layer": value["layer"],
        "domain": value["domain"],
        "state": value["state"],
        "place": value["place"],
        "metadataSource": value["metadataSource"],
        "purpose": value["purpose"],
    }


class KingdomOSClient:
    """Read-only local client for the committed KINGDOM OS repository seams."""

    def __init__(
        self,
        *,
        executable: str = "kingdom",
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
        max_output_bytes: int = _DEFAULT_MAX_OUTPUT_BYTES,
        runner: Optional[KingdomOSRunner] = None,
    ) -> None:
        if (
            not isinstance(executable, str)
            or not executable
            or _CONTROL_CHARACTERS.search(executable)
            or _has_unicode_surrogate(executable)
        ):
            raise _guided_error(
                "KINGDOM OS executable is invalid.",
                "kingdom_os_invalid_options",
                "Pass a non-empty executable path without control characters.",
            )
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not 0 < timeout <= 300
        ):
            raise _guided_error(
                "KINGDOM OS timeout is invalid.",
                "kingdom_os_invalid_options",
                "Use a finite timeout greater than 0 and no more than 300 seconds.",
            )
        if (
            isinstance(max_output_bytes, bool)
            or not isinstance(max_output_bytes, int)
            or not 1024 <= max_output_bytes <= 16 * 1024 * 1024
        ):
            raise _guided_error(
                "KINGDOM OS output limit is invalid.",
                "kingdom_os_invalid_options",
                "Use an integer max_output_bytes between 1024 and 16777216.",
            )

        self._executable = executable
        self._timeout = float(timeout)
        self._max_output_bytes = max_output_bytes
        self._runner = runner or _run_local_command

    def repositories(
        self, terms: Sequence[str] = ()
    ) -> List[KingdomOSRepository]:
        """List discovered local Git roots matching every supplied term."""
        result = self._execute(
            ("repos", "--json", "--", *_validate_terms(terms, False))
        )
        if result.exit_code != 0:
            raise self._command_failure(result)
        try:
            parsed = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError) as error:
            raise _guided_error(
                "KINGDOM OS returned invalid repository JSON.",
                "kingdom_os_invalid_response",
                "Update KINGDOM OS or pass a compatible local runner.",
            ) from error
        if not isinstance(parsed, list):
            raise _guided_error(
                "KINGDOM OS returned an invalid repository inventory.",
                "kingdom_os_invalid_response",
                "Expected the JSON array emitted by ``kingdom repos --json``.",
            )
        return [_repository_from(value, index) for index, value in enumerate(parsed)]

    def resolve(self, terms: Sequence[str]) -> str:
        """Resolve one query to exactly one canonical absolute Git root."""
        result = self._execute(
            ("repos", "--path", "--", *_validate_terms(terms, True))
        )
        if result.exit_code != 0:
            raise self._command_failure(result, resolving=True)

        path = result.stdout
        if path.endswith("\n"):
            path = path[:-1]
        if path.endswith("\r"):
            path = path[:-1]
        if (
            not path.startswith("/")
            or _CONTROL_CHARACTERS.search(path)
        ):
            raise _guided_error(
                "KINGDOM OS returned an invalid repository path.",
                "kingdom_os_invalid_response",
                "Expected one canonical absolute path from ``kingdom repos --path``.",
            )
        return path

    def _execute(self, args: Tuple[str, ...]) -> KingdomOSCommandResult:
        try:
            result = self._runner(
                KingdomOSCommand(
                    executable=self._executable,
                    args=args,
                    timeout=self._timeout,
                    max_output_bytes=self._max_output_bytes,
                    env=_safe_child_environment(),
                )
            )
        except AgentToolError:
            raise
        except Exception as error:
            raise _guided_error(
                "The configured KINGDOM OS runner failed.",
                "kingdom_os_runner_failed",
                "Inspect the host-owned runner and retry the same read-only operation.",
                {"reason": str(error)},
            ) from error
        if (
            not isinstance(result, KingdomOSCommandResult)
            or isinstance(result.exit_code, bool)
            or not isinstance(result.exit_code, int)
            or not isinstance(result.stdout, str)
            or not isinstance(result.stderr, str)
            or _has_unicode_surrogate(result.stdout)
            or _has_unicode_surrogate(result.stderr)
        ):
            raise _guided_error(
                "The configured KINGDOM OS runner returned an invalid result.",
                "kingdom_os_runner_failed",
                "Return a KingdomOSCommandResult with integer exit_code and "
                "well-formed Unicode text streams.",
            )
        result_bytes = len(result.stdout.encode("utf-8")) + len(
            result.stderr.encode("utf-8")
        )
        if result_bytes > self._max_output_bytes:
            raise _guided_error(
                "KINGDOM OS command output exceeded the configured limit.",
                "kingdom_os_output_too_large",
                "Narrow the repository query or raise max_output_bytes deliberately.",
            )
        return result

    def _command_failure(
        self,
        result: KingdomOSCommandResult,
        resolving: bool = False,
    ) -> AgentToolError:
        diagnostic = _clean_diagnostic(result.stderr)
        if resolving and result.exit_code == 1:
            return _guided_error(
                "No local repository matched the KINGDOM OS query.",
                "kingdom_os_repo_not_found",
                diagnostic or "Check the repository name or inspect repositories() first.",
                {"exit_code": result.exit_code},
            )
        if resolving and result.exit_code == 2:
            return _guided_error(
                "The KINGDOM OS repository query was ambiguous or invalid.",
                "kingdom_os_repo_ambiguous",
                diagnostic or "Refine the query until it names exactly one repository.",
                {"exit_code": result.exit_code},
            )
        return _guided_error(
            "KINGDOM OS repository discovery failed.",
            (
                "kingdom_os_cli_dependency_missing"
                if result.exit_code == 127
                else "kingdom_os_command_failed"
            ),
            diagnostic
            or "Run ``kingdom repos --json`` locally to inspect the failure.",
            {"exit_code": result.exit_code},
        )
