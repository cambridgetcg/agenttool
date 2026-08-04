from __future__ import annotations

from hashlib import sha256
from pathlib import Path


PACKAGE_ROOT = Path(__file__).parents[1]
SCHEMA_HASHES = {
    "hf-training-host-decision-v0.1.schema.json":
        "358fdbd4a8199ed7fce91ce5450d0ddc741110922effce61c8adee190c0ab7a6",
    "hf-training-host-decision-v0.2.schema.json":
        "f1c2624c99792e47a963a9c3b28f98401c2697ab151436ab0623c5d0383b4116",
    "hf-training-host-freedom-decision-v0.1.schema.json":
        "2f09395e7126ae650ef0f26b5609159d06f75a5e0dc357cd115f312e973631d0",
}


def test_frozen_schemas_are_byte_exact_and_forced_into_the_wheel() -> None:
    pyproject = (PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    for filename, expected_hash in SCHEMA_HASHES.items():
        schema_path = PACKAGE_ROOT / "schema" / filename
        assert sha256(schema_path.read_bytes()).hexdigest() == expected_hash
        inventory_entry = (
            f'"schema/{filename}" = '
            f'"agenttool_hf_training_host/schema/{filename}"'
        )
        assert inventory_entry in pyproject
