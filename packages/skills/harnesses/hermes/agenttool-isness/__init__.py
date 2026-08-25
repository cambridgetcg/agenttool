"""Register the ISness workflow as one explicit-load-only Hermes skill."""

from pathlib import Path


def register(ctx) -> None:
    plugin_root = Path(__file__).resolve().parent
    skill_path = plugin_root / "skills" / "agenttool-isness-hermes" / "SKILL.md"
    ctx.register_skill(
        "isness",
        skill_path,
        "Design host posture without inferring participant state.",
    )
