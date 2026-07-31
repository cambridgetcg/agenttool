from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import gradio as gr


ROOT = Path(__file__).resolve().parent
MAX_FILE_BYTES = 2_000_000
MAX_ROWS = 1_000
ALLOWED_DATA_FILES = {
    "data/proposal-index.jsonl",
    "data/treasure-index.jsonl",
}


def _load_manifest() -> dict[str, Any]:
    manifest_path = ROOT / "source-manifest.json"
    data = manifest_path.read_bytes()
    if len(data) > 100_000:
        raise RuntimeError("source manifest exceeds the bounded size")
    manifest = json.loads(data.decode("utf-8"))
    if manifest.get("_format") != "kingdom.hf-space-source/0.1":
        raise RuntimeError("unsupported source manifest")
    return manifest


MANIFEST = _load_manifest()
FILE_PINS = {item["path"]: item for item in MANIFEST["files"]}


def _verified_jsonl(relative_path: str) -> list[dict[str, Any]]:
    if relative_path not in ALLOWED_DATA_FILES:
        raise RuntimeError("data path is not allowlisted")
    pin = FILE_PINS.get(relative_path)
    if not pin:
        raise RuntimeError("data path is missing from the manifest")
    candidate = (ROOT / relative_path).resolve()
    if ROOT not in candidate.parents:
        raise RuntimeError("data path escaped the Space root")
    data = candidate.read_bytes()
    if len(data) > MAX_FILE_BYTES or len(data) != pin["bytes"]:
        raise RuntimeError("data file size does not match its bounded pin")
    digest = hashlib.sha256(data).hexdigest()
    if digest != pin["sha256"]:
        raise RuntimeError("data file SHA-256 does not match its pin")
    rows = []
    for line_number, line in enumerate(data.decode("utf-8").splitlines(), 1):
        if not line:
            continue
        if len(rows) >= MAX_ROWS:
            raise RuntimeError("data file exceeds the row cap")
        value = json.loads(line)
        if not isinstance(value, dict):
            raise RuntimeError(f"row {line_number} is not an object")
        rows.append(value)
    return rows


TREASURES = _verified_jsonl("data/treasure-index.jsonl")
PROPOSAL_INDEX = _verified_jsonl("data/proposal-index.jsonl")
TREASURE_BY_REPO = {row["subject"]["repo_id"]: row for row in TREASURES}
PHASES = ["all", *sorted({row["phase"]["id"] for row in TREASURES})]
CABINETS = ["all", *sorted({row["admission"]["cabinet"] for row in TREASURES})]
REPOS = sorted(TREASURE_BY_REPO)


def list_treasures(phase: str, cabinet: str, query: str) -> list[list[Any]]:
    needle = (query or "").strip().casefold()
    rows = []
    for item in TREASURES:
        if phase != "all" and item["phase"]["id"] != phase:
            continue
        if cabinet != "all" and item["admission"]["cabinet"] != cabinet:
            continue
        searchable = " ".join(
            [
                item["subject"]["repo_id"],
                item["treasure"]["overlooked_signal"],
                *item["admission"]["reason_codes"],
            ]
        ).casefold()
        if needle and needle not in searchable:
            continue
        rows.append(
            [
                item["rank"],
                item["subject"]["repo_id"],
                item["phase"]["id"],
                item["admission"]["cabinet"],
                item["subject"]["visibility"],
                item["subject"]["license_observed"],
                item["dark_continent"]["recommendation"],
            ]
        )
    return rows


def show_treasure(repo_id: str) -> str:
    item = TREASURE_BY_REPO.get(repo_id)
    if item is None:
        return json.dumps({"error": "unknown allowlisted repository"}, indent=2)
    return json.dumps(item, indent=2, ensure_ascii=False)


def compare_conflicts(left_repo: str, right_repo: str) -> str:
    left = TREASURE_BY_REPO.get(left_repo)
    right = TREASURE_BY_REPO.get(right_repo)
    if left is None or right is None:
        return "Unknown allowlisted repository."
    shared = sorted(
        set(left["admission"]["reason_codes"])
        & set(right["admission"]["reason_codes"])
    )
    shared_text = ", ".join(shared) if shared else "none"
    return (
        f"### {left_repo}\n"
        f"- Cabinet: `{left['admission']['cabinet']}`\n"
        f"- Consequence: `{left['karma']['consequence']}`\n"
        f"- Signal: {left['treasure']['overlooked_signal']}\n\n"
        f"### {right_repo}\n"
        f"- Cabinet: `{right['admission']['cabinet']}`\n"
        f"- Consequence: `{right['karma']['consequence']}`\n"
        f"- Signal: {right['treasure']['overlooked_signal']}\n\n"
        f"Shared reason codes: `{shared_text}`\n\n"
        "Comparison is advisory metadata. It does not merge, rank, authorize, or verify a wall."
    )


with gr.Blocks(title="KINGDOM Dark Continent Cartographer", analytics_enabled=False) as demo:
    gr.Markdown(
        "# 🗺️ KINGDOM Dark Continent Cartographer\n"
        "Commit-pinned metadata only. Every proposal is provisional; every wall is unverified."
    )
    gr.Image(
        value=str(ROOT / "assets/hero.png"),
        interactive=False,
        show_label=False,
        height=360,
    )
    with gr.Tab("Phase atlas"):
        with gr.Row():
            phase_input = gr.Dropdown(PHASES, value="all", label="Training phase")
            cabinet_input = gr.Dropdown(CABINETS, value="all", label="Risk cabinet")
            query_input = gr.Textbox(label="Search metadata", max_lines=1)
        search_button = gr.Button("Filter", variant="primary")
        table = gr.Dataframe(
            headers=["Rank", "Repository", "Phase", "Cabinet", "Visibility", "License", "Decision"],
            value=list_treasures("all", "all", ""),
            interactive=False,
        )
        search_button.click(list_treasures, [phase_input, cabinet_input, query_input], table)
    with gr.Tab("Provenance"):
        repo_input = gr.Dropdown(REPOS, value=REPOS[0], label="Pinned dataset")
        show_button = gr.Button("Show exact record")
        record_output = gr.Code(language="json", label="Metadata-only record")
        show_button.click(show_treasure, repo_input, record_output)
    with gr.Tab("Conflict comparison"):
        with gr.Row():
            left_input = gr.Dropdown(REPOS, value=REPOS[0], label="Left")
            right_input = gr.Dropdown(REPOS, value=REPOS[1], label="Right")
        compare_button = gr.Button("Compare risk gates")
        compare_output = gr.Markdown()
        compare_button.click(compare_conflicts, [left_input, right_input], compare_output)
    gr.Markdown(
        f"Loaded {len(TREASURES)} treasure records and {len(PROPOSAL_INDEX)} proposal-index rows. "
        "No runtime network, model, upload, graph-write, reward, trade, or Crown path."
    )


if __name__ == "__main__":
    demo.launch(mcp_server=False, show_error=True)
