"""
OpenF1 API client with in-memory TTL caching.
Docs: https://openf1.org
"""

import httpx
from cachetools import TTLCache
from typing import Any

BASE_URL = "https://api.openf1.org/v1"

# Cache: max 512 entries, 5-minute TTL for historical data
_cache: TTLCache = TTLCache(maxsize=512, ttl=300)

# Short TTL cache for live data (10 seconds)
_live_cache: TTLCache = TTLCache(maxsize=128, ttl=10)


async def _fetch(endpoint: str, params: dict[str, Any] | None = None, live: bool = False) -> list[dict]:
    """Fetch from OpenF1 API with caching."""
    cache = _live_cache if live else _cache
    key = f"{endpoint}:{sorted(params.items()) if params else ''}"

    if key in cache:
        return cache[key]

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{BASE_URL}{endpoint}", params=params)
        resp.raise_for_status()
        data = resp.json()

    cache[key] = data
    return data


# ─── Sessions ────────────────────────────────────────────────────────

async def get_sessions(year: int | None = None, session_type: str | None = None) -> list[dict]:
    params = {}
    if year:
        params["year"] = year
    if session_type:
        params["session_type"] = session_type
    return await _fetch("/sessions", params)


async def get_session(session_key: int) -> dict | None:
    data = await _fetch("/sessions", {"session_key": session_key})
    return data[0] if data else None


# ─── Drivers ─────────────────────────────────────────────────────────

async def get_drivers(session_key: int) -> list[dict]:
    return await _fetch("/drivers", {"session_key": session_key})


# ─── Laps ────────────────────────────────────────────────────────────

async def get_laps(session_key: int, driver_number: int | None = None) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/laps", params)


# ─── Position ────────────────────────────────────────────────────────

async def get_position(session_key: int, driver_number: int | None = None) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/position", params)


# ─── Car Data (telemetry) ────────────────────────────────────────────

async def get_car_data(
    session_key: int,
    driver_number: int,
    speed: bool = True,
) -> list[dict]:
    params: dict[str, Any] = {
        "session_key": session_key,
        "driver_number": driver_number,
    }
    if speed:
        params["speed>="] = 0  # filter out invalid
    return await _fetch("/car_data", params)


# ─── Pit Stops ───────────────────────────────────────────────────────

async def get_pit_stops(session_key: int, driver_number: int | None = None) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/pit", params)


# ─── Stints (tire data) ─────────────────────────────────────────────

async def get_stints(session_key: int, driver_number: int | None = None) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/stints", params)


# ─── Intervals (gap to leader) ──────────────────────────────────────

async def get_intervals(session_key: int, driver_number: int | None = None) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/intervals", params)


# ─── Weather ─────────────────────────────────────────────────────────

async def get_weather(session_key: int) -> list[dict]:
    return await _fetch("/weather", {"session_key": session_key})


# ─── Location (car positions on track) ──────────────────────────────

async def get_location(session_key: int, driver_number: int | None = None) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/location", params)


# ─── Live helpers ────────────────────────────────────────────────────

async def get_latest_session() -> dict | None:
    """Get the most recent session."""
    data = await _fetch("/sessions", {"session_key": "latest"}, live=True)
    return data[0] if data else None


async def get_live_position(session_key: int) -> list[dict]:
    """Get latest position data (short cache)."""
    return await _fetch("/position", {"session_key": session_key}, live=True)


async def get_live_car_data(session_key: int, driver_number: int) -> list[dict]:
    return await _fetch(
        "/car_data",
        {"session_key": session_key, "driver_number": driver_number},
        live=True,
    )
