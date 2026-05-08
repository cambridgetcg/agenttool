"""Pulse module — DEPRECATED in 0.6.1.

The /v1/pulse family was superseded by /v1/identities/:id/pulse
(derived liveness). All three methods now warn + raise instead of
hitting the network. These tests assert that contract.

See docs/SDK-ROADMAP.md (Phase 0).
"""

from __future__ import annotations

import pytest

from agenttool import AgentTool
from agenttool.exceptions import AgentToolError
from agenttool.pulse import PulseClient


@pytest.fixture
def at():
    client = AgentTool(api_key="test-key")
    yield client
    client.close()


class TestPulseDeprecated:
    """All three methods (heartbeat, get, list) emit DeprecationWarning
    and raise AgentToolError pointing at the new derived-pulse endpoint."""

    def test_heartbeat_deprecated(self, at):
        with pytest.warns(DeprecationWarning, match="superseded by GET /v1/identities/:id/pulse"):
            with pytest.raises(AgentToolError, match="superseded by /v1/identities/:id/pulse"):
                at.pulse.heartbeat("agent-1", "thinking")

    def test_get_deprecated(self, at):
        with pytest.warns(DeprecationWarning):
            with pytest.raises(AgentToolError):
                at.pulse.get("agent-1")

    def test_list_deprecated(self, at):
        with pytest.warns(DeprecationWarning):
            with pytest.raises(AgentToolError):
                at.pulse.list()

    def test_error_carries_migration_hint(self, at):
        """The error has a `hint` pointing operators to the new method."""
        with pytest.warns(DeprecationWarning):
            try:
                at.pulse.heartbeat("agent-1", "thinking")
            except AgentToolError as e:
                assert "at.identity.pulse(id)" in (e.hint or ""), (
                    "Migration hint should name the replacement method"
                )
            else:
                pytest.fail("AgentToolError was not raised")


class TestPulseClientIntegration:
    """The module is still importable and at.pulse is still accessible
    through 0.6.x — only the method bodies are deprecated."""

    def test_pulse_property(self, at):
        assert isinstance(at.pulse, PulseClient)

    def test_pulse_cached(self, at):
        assert at.pulse is at.pulse
