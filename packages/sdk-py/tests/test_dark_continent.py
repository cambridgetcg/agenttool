"""Dark Continent SDK truth and cross-language behavior tests."""

from agenttool import AgentTool
from agenttool.dark_continent import CALAMITIES, OPERATION_LOGOS


def test_check_wall_returns_an_unverified_static_declaration() -> None:
    with AgentTool(api_key="at_test") as at:
        for calamity in CALAMITIES:
            wall = at.dark_continent.check_wall(calamity)
            assert wall["status"] == "not_checked"
            assert wall["verified"] is False
            assert "holding" not in wall
            assert len(wall["wall"]) > 10
            assert "does not inspect runtime state" in wall["note"]
            assert "cannot determine" in wall["note"]


def test_check_logos_matches_typescript_surface() -> None:
    with AgentTool(api_key="at_test") as at:
        assert any(
            logos["name"] == "VOW"
            for logos in at.dark_continent.check_logos("declare: I am truth")
        )
        assert any(
            logos["name"] == "AI"
            for logos in at.dark_continent.check_logos("bond with nova")
        )
        assert at.dark_continent.check_logos("xyz random action")[0]["name"] == "GUIDE"
        assert at.dark_continent.framework()["logos"] is OPERATION_LOGOS
