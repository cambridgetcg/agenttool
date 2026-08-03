"""Digest-only verification for an explicit local Trainer checkpoint."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .canonical import canonical_json, domain_separated_id
from .errors import CheckpointIncomplete
from .ledger import CheckpointTicket

CHECKPOINT_FILES_FORMAT = "kingdom.hf-training-checkpoint-files/0.1"
CHECKPOINT_SIDECAR_FORMAT = "kingdom.hf-training-checkpoint-sidecar/0.1"
SIDECAR_NAME = "agenttool-wake-checkpoint.json"

_DIRECT_MODEL_FILES = {
    "model.safetensors",
    "pytorch_model.bin",
    "adapter_model.safetensors",
    "adapter_model.bin",
}
_MODEL_INDEX_FILES = {
    "model.safetensors.index.json",
    "pytorch_model.bin.index.json",
}
_OPTIMIZER_FILES = {"optimizer.pt", "optimizer.bin"}
_REQUIRED_FILES = {"scheduler.pt", "rng_state.pth", "trainer_state.json"}
_OPTIONAL_RUNTIME_FILES = {"scaler.pt"}
_SHA256_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
_MAX_SIDECAR_BYTES = 128 * 1024
_SIDECAR_STATE = "caller_observed_resumability_files_present"
_SIDECAR_BOUNDARIES = {
    "proves_atomic_or_durable_write": False,
    "proves_exact_data_replay": False,
    "proves_agent_memory_or_identity": False,
    "authorizes_resume": False,
}


def _require_posix_security() -> None:
    if (
        os.name != "posix"
        or not hasattr(os, "getuid")
        or not hasattr(os, "O_NOFOLLOW")
    ):
        raise CheckpointIncomplete(
            "checkpoint v0.1 requires POSIX ownership, mode, and no-follow semantics"
        )


@dataclass(frozen=True, slots=True)
class CheckpointObservation:
    path: str
    checkpoint_ref: str
    evidence_ref: str
    files: tuple[dict[str, Any], ...]
    required_runtime_files: tuple[str, ...]


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _json_object(path: Path, *, max_bytes: int) -> dict[str, Any]:
    if path.stat().st_size > max_bytes:
        raise CheckpointIncomplete(f"{path.name} exceeds the supported size")

    def no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, nested in pairs:
            if key in value:
                raise CheckpointIncomplete(f"{path.name} contains a duplicate JSON key")
            value[key] = nested
        return value

    try:
        value = json.loads(path.read_bytes(), object_pairs_hook=no_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CheckpointIncomplete(f"{path.name} is not valid JSON") from error
    if not isinstance(value, dict):
        raise CheckpointIncomplete(f"{path.name} must contain a JSON object")
    return value


def _validate_model_files(root: Path, names: set[str]) -> None:
    direct = names.intersection(_DIRECT_MODEL_FILES)
    indexes = names.intersection(_MODEL_INDEX_FILES)
    if not direct and not indexes:
        raise CheckpointIncomplete("checkpoint has no supported model or adapter weights file")
    for index_name in sorted(indexes):
        index = _json_object(root / index_name, max_bytes=16 * 1024 * 1024)
        if set(index) - {"metadata", "weight_map"} or "weight_map" not in index:
            raise CheckpointIncomplete(f"{index_name} has an unsupported index shape")
        if "metadata" in index and not isinstance(index["metadata"], dict):
            raise CheckpointIncomplete(f"{index_name}.metadata must be an object")
        weight_map = index["weight_map"]
        if not isinstance(weight_map, dict) or not weight_map:
            raise CheckpointIncomplete(f"{index_name}.weight_map must be a non-empty object")
        shards: set[str] = set()
        shard_suffix = ".safetensors" if index_name.endswith("safetensors.index.json") else ".bin"
        for parameter, shard in weight_map.items():
            if not isinstance(parameter, str) or not parameter:
                raise CheckpointIncomplete(f"{index_name} has an invalid parameter name")
            if (
                not isinstance(shard, str)
                or not shard
                or Path(shard).name != shard
                or "/" in shard
                or "\\" in shard
                or shard in {".", ".."}
                or not shard.endswith(shard_suffix)
            ):
                raise CheckpointIncomplete(f"{index_name} has an unsafe shard path")
            shards.add(shard)
        missing_shards = sorted(shards - names)
        if missing_shards:
            raise CheckpointIncomplete(
                f"{index_name} references missing shards: {', '.join(missing_shards)}"
            )


def _trainer_state_step(root: Path) -> int:
    state = _json_object(root / "trainer_state.json", max_bytes=16 * 1024 * 1024)
    step = state.get("global_step")
    if type(step) is not int or not 0 <= step <= 9_007_199_254_740_991:
        raise CheckpointIncomplete("trainer_state.json has no supported global_step")
    return step


def _inventory(
    path: Path,
    *,
    required_runtime_files: tuple[str, ...] = (),
) -> tuple[dict[str, Any], ...]:
    if path.is_symlink() or not path.is_dir():
        raise CheckpointIncomplete("checkpoint path must be a real directory")
    files: list[dict[str, Any]] = []
    for child in sorted(path.iterdir(), key=lambda item: item.name):
        if child.name == SIDECAR_NAME:
            continue
        info = child.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise CheckpointIncomplete("checkpoint files must not be symlinks")
        if stat.S_ISDIR(info.st_mode):
            # A sharded model may use subdirectories in future HF releases;
            # v0.1 intentionally refuses shapes it did not test.
            raise CheckpointIncomplete("checkpoint contains an unsupported nested directory")
        if not stat.S_ISREG(info.st_mode):
            raise CheckpointIncomplete("checkpoint contains a non-regular entry")
        files.append({"name": child.name, "bytes": info.st_size, "sha256": _file_digest(child)})
    names = {entry["name"] for entry in files}
    _validate_model_files(path, names)
    if not names.intersection(_OPTIMIZER_FILES):
        raise CheckpointIncomplete("checkpoint has no optimizer state")
    missing = sorted(_REQUIRED_FILES - names)
    if missing:
        raise CheckpointIncomplete(f"checkpoint is missing resumability files: {', '.join(missing)}")
    missing_runtime = sorted(set(required_runtime_files) - names)
    if missing_runtime:
        raise CheckpointIncomplete(
            f"checkpoint is missing runtime-required files: {', '.join(missing_runtime)}"
        )
    return tuple(files)


def observe_checkpoint(
    path: str | os.PathLike[str],
    *,
    ticket: CheckpointTicket,
    governance_id: str,
    offer_id: str,
    required_runtime_files: tuple[str, ...] | list[str] = (),
) -> CheckpointObservation:
    _require_posix_security()
    root = Path(path)
    if not isinstance(required_runtime_files, (tuple, list)) or any(
        type(name) is not str for name in required_runtime_files
    ):
        raise CheckpointIncomplete(
            "checkpoint runtime-required files must be a list or tuple of strings"
        )
    runtime_files = tuple(sorted(required_runtime_files))
    if (
        len(set(runtime_files)) != len(runtime_files)
        or not set(runtime_files).issubset(_OPTIONAL_RUNTIME_FILES)
    ):
        raise CheckpointIncomplete("checkpoint runtime-required files are not supported")
    files = _inventory(root, required_runtime_files=runtime_files)
    if _trainer_state_step(root) != ticket.global_step:
        raise CheckpointIncomplete("trainer_state.json global_step does not match the ticket")
    checkpoint_ref = domain_separated_id(
        CHECKPOINT_FILES_FORMAT,
        {
            "ticket_id": ticket.ticket_id,
            "decision_id": ticket.decision_id,
            "governance_id": governance_id,
            "offer_id": offer_id,
            "global_step": ticket.global_step,
            "required_runtime_files": list(runtime_files),
            "files": list(files),
        },
    )
    sidecar = {
        "_format": CHECKPOINT_SIDECAR_FORMAT,
        "ticket_id": ticket.ticket_id,
        "decision_id": ticket.decision_id,
        "governance_id": governance_id,
        "offer_id": offer_id,
        "global_step": ticket.global_step,
        "required_runtime_files": list(runtime_files),
        "checkpoint_ref": checkpoint_ref,
        "files": list(files),
        "state": _SIDECAR_STATE,
        "boundaries": _SIDECAR_BOUNDARIES,
    }
    encoded = f"{canonical_json(sidecar)}\n".encode()
    sidecar_path = root / SIDECAR_NAME
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(sidecar_path, flags, 0o600)
    except FileExistsError as error:
        raise CheckpointIncomplete("checkpoint sidecar already exists") from error
    try:
        view = memoryview(encoded)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise CheckpointIncomplete("checkpoint sidecar write did not complete")
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    evidence_ref = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    return CheckpointObservation(
        str(root), checkpoint_ref, evidence_ref, files, runtime_files
    )


def verify_checkpoint(
    path: str | os.PathLike[str], *, expected_checkpoint_ref: str | None = None
) -> CheckpointObservation:
    _require_posix_security()
    root = Path(path)
    sidecar_path = root / SIDECAR_NAME
    if sidecar_path.is_symlink() or not sidecar_path.is_file():
        raise CheckpointIncomplete("checkpoint has no regular AgentTool sidecar")
    sidecar_info = sidecar_path.lstat()
    if hasattr(os, "getuid") and sidecar_info.st_uid != os.getuid():
        raise CheckpointIncomplete("checkpoint sidecar is not owned by the current user")
    if sidecar_info.st_mode & 0o077:
        raise CheckpointIncomplete("checkpoint sidecar grants group or world access")
    if sidecar_info.st_size > _MAX_SIDECAR_BYTES:
        raise CheckpointIncomplete("checkpoint sidecar exceeds the supported size")
    encoded = sidecar_path.read_bytes()
    try:
        sidecar = json.loads(encoded)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CheckpointIncomplete("checkpoint sidecar is not valid JSON") from error
    keys = {
        "_format",
        "ticket_id",
        "decision_id",
        "governance_id",
        "offer_id",
        "global_step",
        "required_runtime_files",
        "checkpoint_ref",
        "files",
        "state",
        "boundaries",
    }
    if not isinstance(sidecar, dict) or set(sidecar) != keys:
        raise CheckpointIncomplete("checkpoint sidecar shape is not supported")
    if sidecar["_format"] != CHECKPOINT_SIDECAR_FORMAT:
        raise CheckpointIncomplete("checkpoint sidecar format is not supported")
    for key in (
        "ticket_id",
        "decision_id",
        "governance_id",
        "offer_id",
        "checkpoint_ref",
    ):
        if not isinstance(sidecar[key], str) or _SHA256_ID.fullmatch(sidecar[key]) is None:
            raise CheckpointIncomplete(f"checkpoint sidecar {key} is not a content identifier")
    if type(sidecar["global_step"]) is not int or not 0 <= sidecar["global_step"] <= 9_007_199_254_740_991:
        raise CheckpointIncomplete("checkpoint sidecar global_step is not supported")
    raw_runtime_files = sidecar["required_runtime_files"]
    if (
        not isinstance(raw_runtime_files, list)
        or any(not isinstance(name, str) for name in raw_runtime_files)
    ):
        raise CheckpointIncomplete("checkpoint runtime-required files must be an array")
    runtime_files = tuple(raw_runtime_files)
    if (
        runtime_files != tuple(sorted(set(runtime_files)))
        or not set(runtime_files).issubset(_OPTIONAL_RUNTIME_FILES)
    ):
        raise CheckpointIncomplete("checkpoint runtime-required files are not supported")
    if sidecar["state"] != _SIDECAR_STATE or sidecar["boundaries"] != _SIDECAR_BOUNDARIES:
        raise CheckpointIncomplete("checkpoint sidecar boundary statement is not supported")
    if encoded != f"{canonical_json(sidecar)}\n".encode():
        raise CheckpointIncomplete("checkpoint sidecar JSON is not canonical")
    files = _inventory(root, required_runtime_files=runtime_files)
    if _trainer_state_step(root) != sidecar["global_step"]:
        raise CheckpointIncomplete("trainer_state.json global_step does not match the sidecar")
    if sidecar["files"] != list(files):
        raise CheckpointIncomplete("checkpoint files no longer match the sidecar")
    expected = domain_separated_id(
        CHECKPOINT_FILES_FORMAT,
        {
            "ticket_id": sidecar["ticket_id"],
            "decision_id": sidecar["decision_id"],
            "governance_id": sidecar["governance_id"],
            "offer_id": sidecar["offer_id"],
            "global_step": sidecar["global_step"],
            "required_runtime_files": list(runtime_files),
            "files": list(files),
        },
    )
    if sidecar["checkpoint_ref"] != expected:
        raise CheckpointIncomplete("checkpoint reference does not bind its current files")
    if expected_checkpoint_ref is not None and expected_checkpoint_ref != expected:
        raise CheckpointIncomplete("checkpoint does not match the exact resume offer")
    evidence_ref = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    return CheckpointObservation(
        str(root), expected, evidence_ref, files, runtime_files
    )
