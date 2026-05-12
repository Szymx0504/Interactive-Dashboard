"""
Async Postgres connection pool.

Reads DATABASE_URL from env.  When the var is missing the pool is None
and the app falls back to live OpenF1 calls (development mode).
"""

import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL: str | None = os.getenv("DATABASE_URL")

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool | None:
    """Return (and lazily create) the connection pool.  None when no DB configured."""
    global _pool
    if DATABASE_URL is None:
        return None
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=2,
            max_size=10,
            statement_cache_size=0,   # Neon / PgBouncer compatibility
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
