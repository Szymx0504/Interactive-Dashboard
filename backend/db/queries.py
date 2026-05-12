"""
DB read/write helpers for cached tables.

Only caches: sessions, drivers, session_results, championship_drivers,
championship_teams, and track_map_cache.  Everything else stays on-demand.
"""

from __future__ import annotations
import json
from db.pool import get_pool


# ─── Helpers ──────────────────────────────────────────────────────────

async def _fetch_rows(query: str, *args) -> list[dict]:
    pool = await get_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *args)
        return [dict(r) for r in rows]


async def _execute(query: str, *args) -> None:
    pool = await get_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(query, *args)


async def _executemany(query: str, args: list[tuple]) -> None:
    pool = await get_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.executemany(query, args)


async def is_seeded(session_key: int, table_name: str) -> bool:
    rows = await _fetch_rows(
        "SELECT 1 FROM seed_status WHERE session_key=$1 AND table_name=$2",
        session_key, table_name,
    )
    return len(rows) > 0


async def mark_seeded(session_key: int, table_name: str) -> None:
    await _execute(
        "INSERT INTO seed_status (session_key, table_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        session_key, table_name,
    )


# ─── Sessions ────────────────────────────────────────────────────────

async def get_sessions(year: int | None = None, session_type: str | None = None) -> list[dict]:
    q = "SELECT * FROM sessions WHERE 1=1"
    args: list = []
    idx = 0
    if year is not None:
        idx += 1
        q += f" AND year=${idx}"
        args.append(year)
    if session_type is not None:
        idx += 1
        q += f" AND session_type=${idx}"
        args.append(session_type)
    q += " ORDER BY date_start"
    return await _fetch_rows(q, *args)


async def insert_sessions(rows: list[dict]) -> None:
    if not rows:
        return
    await _executemany(
        """INSERT INTO sessions (session_key, session_name, session_type,
           date_start, date_end, gmt_offset, country_name, country_code,
           circuit_key, circuit_short_name, location, year, meeting_key, meeting_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT DO NOTHING""",
        [
            (
                r.get("session_key"), r.get(
                    "session_name"), r.get("session_type"),
                r.get("date_start"), r.get("date_end"), r.get("gmt_offset"),
                r.get("country_name"), r.get(
                    "country_code"), r.get("circuit_key"),
                r.get("circuit_short_name"), r.get("location"), r.get("year"),
                r.get("meeting_key"), r.get("meeting_name"),
            )
            for r in rows
        ],
    )


# ─── Drivers ─────────────────────────────────────────────────────────

async def get_drivers(session_key: int) -> list[dict]:
    return await _fetch_rows(
        "SELECT * FROM drivers WHERE session_key=$1 ORDER BY driver_number", session_key
    )


async def insert_drivers(session_key: int, rows: list[dict]) -> None:
    if not rows:
        return
    await _executemany(
        """INSERT INTO drivers (session_key, driver_number, full_name, name_acronym,
           broadcast_name, team_name, team_colour, country_code, headshot_url,
           first_name, last_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT DO NOTHING""",
        [
            (
                session_key, r.get("driver_number"), r.get("full_name"),
                r.get("name_acronym"), r.get(
                    "broadcast_name"), r.get("team_name"),
                r.get("team_colour"), r.get(
                    "country_code"), r.get("headshot_url"),
                r.get("first_name"), r.get("last_name"),
            )
            for r in rows
        ],
    )


# ─── Session Results ─────────────────────────────────────────────────

async def get_session_results(session_key: int) -> list[dict]:
    return await _fetch_rows(
        "SELECT * FROM session_results WHERE session_key=$1 ORDER BY position", session_key
    )


async def insert_session_results(session_key: int, rows: list[dict]) -> None:
    if not rows:
        return
    await _executemany(
        """INSERT INTO session_results (session_key, driver_number, position, points,
           grid_position, status, full_name, name_acronym, broadcast_name,
           team_name, team_colour)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING""",
        [
            (
                session_key, r.get("driver_number"), r.get("position"),
                r.get("points"), r.get("grid_position"), r.get("status"),
                r.get("full_name"), r.get(
                    "name_acronym"), r.get("broadcast_name"),
                r.get("team_name"), r.get("team_colour"),
            )
            for r in rows
        ],
    )


# ─── Championship Drivers ────────────────────────────────────────────

async def get_championship_drivers(session_key: int, driver_number: int | None = None) -> list[dict]:
    if driver_number:
        return await _fetch_rows(
            "SELECT * FROM championship_drivers WHERE session_key=$1 AND driver_number=$2",
            session_key, driver_number,
        )
    return await _fetch_rows(
        "SELECT * FROM championship_drivers WHERE session_key=$1 ORDER BY position_current",
        session_key,
    )


async def insert_championship_drivers(session_key: int, rows: list[dict]) -> None:
    if not rows:
        return
    await _executemany(
        """INSERT INTO championship_drivers (session_key, meeting_key, driver_number,
           position_start, position_current, points_start, points_current)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING""",
        [
            (
                session_key, r.get("meeting_key"), r.get("driver_number"),
                r.get("position_start"), r.get("position_current"),
                r.get("points_start"), r.get("points_current"),
            )
            for r in rows
        ],
    )


# ─── Championship Teams ─────────────────────────────────────────────

async def get_championship_teams(session_key: int, team_name: str | None = None) -> list[dict]:
    if team_name:
        return await _fetch_rows(
            "SELECT * FROM championship_teams WHERE session_key=$1 AND team_name=$2",
            session_key, team_name,
        )
    return await _fetch_rows(
        "SELECT * FROM championship_teams WHERE session_key=$1 ORDER BY position_current",
        session_key,
    )


async def insert_championship_teams(session_key: int, rows: list[dict]) -> None:
    if not rows:
        return
    await _executemany(
        """INSERT INTO championship_teams (session_key, meeting_key, team_name,
           position_start, position_current, points_start, points_current)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING""",
        [
            (
                session_key, r.get("meeting_key"), r.get("team_name"),
                r.get("position_start"), r.get("position_current"),
                r.get("points_start"), r.get("points_current"),
            )
            for r in rows
        ],
    )


# ─── Track Map Cache ─────────────────────────────────────────────────

async def get_track_map(session_key: int) -> dict | None:
    """Return cached processed track_map data, or None on miss."""
    rows = await _fetch_rows(
        "SELECT data FROM track_map_cache WHERE session_key=$1", session_key
    )
    if rows:
        data = rows[0]["data"]
        # asyncpg returns jsonb as already-parsed Python dict/list
        return data if isinstance(data, dict) else json.loads(data)
    return None


async def insert_track_map(session_key: int, data: dict) -> None:
    """Store the processed track_map result (outline + drivers)."""
    await _execute(
        """INSERT INTO track_map_cache (session_key, data)
           VALUES ($1, $2::jsonb) ON CONFLICT (session_key)
           DO UPDATE SET data = EXCLUDED.data, created_at = NOW()""",
        session_key, json.dumps(data),
    )
