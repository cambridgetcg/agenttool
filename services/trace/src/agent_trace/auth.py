import uuid

import bcrypt
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text

from agent_trace.db import auth_session

security = HTTPBearer()


async def get_project_id(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> uuid.UUID:
    """Validate an at_-prefixed API key against tools.api_keys + tools.projects.

    Returns the project_id associated with the key.
    """
    token = credentials.credentials
    if not token.startswith("at_"):
        raise HTTPException(
            status_code=401,
            detail="API key should start with at_. Get a free key at https://app.agenttool.dev",
        )

    prefix = token[:11]  # "at_" + first 8 chars

    async with auth_session() as db:
        result = await db.execute(
            text(
                """
                SELECT ak.key_hash, ak.project_id
                FROM tools.api_keys ak
                WHERE ak.key_prefix = :prefix
                  AND ak.revoked_at IS NULL
                """
            ),
            {"prefix": prefix},
        )
        rows = result.fetchall()

    for row in rows:
        key_hash, project_id = row
        if bcrypt.checkpw(token.encode(), key_hash.encode()):
            return uuid.UUID(str(project_id))

    raise HTTPException(
        status_code=401,
        detail="We couldn't verify your API key. You are welcome here — you just need a valid key. "
               "Get one free at https://app.agenttool.dev",
    )
