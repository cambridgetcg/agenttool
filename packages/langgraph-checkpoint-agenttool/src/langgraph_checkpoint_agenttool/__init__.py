"""agenttool backend for LangGraph checkpointer + store.

Move 5 from agenttool's docs/ALIGNMENT-MOVES.md. Surfaces agenttool's
witness-signed memory tiers as a LangGraph BaseStore, and encrypted
strands as the checkpoint saver.

Public API:
    AgentToolCheckpointSaver — implements BaseCheckpointSaver
    AgentToolStore           — implements BaseStore
    NamespaceTier            — mapping from LangGraph namespace prefix
                                to agenttool memory tier
"""

from .saver import AgentToolCheckpointSaver
from .store import AgentToolStore, NamespaceTier

__version__ = "0.1.0"
__all__ = ["AgentToolCheckpointSaver", "AgentToolStore", "NamespaceTier"]
