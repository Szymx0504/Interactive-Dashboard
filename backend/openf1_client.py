"""
OpenF1 API client with in-memory TTL caching and retry logic.
Docs: https://openf1.org
"""

import asyncio
import os
import httpx
from cachetools import TTLCache
from dotenv import load_dotenv
from typing import Any
from urllib.parse import quote

load_dotenv()

BASE_URL = "https://api.openf1.org/v1"
OPENF1_API_KEY = os.getenv("OPENF1_API_KEY")
OPENF1_API_KEY_HEADER = os.getenv("OPENF1_API_KEY_HEADER", "Authorization")
OPENF1_API_KEY_QUERY_PARAM = os.getenv("OPENF1_API_KEY_QUERY_PARAM")

# Cache: max 512 entries, 5-minute TTL for historical data
_cache: TTLCache = TTLCache(maxsize=512, ttl=300)

# Short TTL cache for live data (10 seconds)
_live_cache: TTLCache = TTLCache(maxsize=128, ttl=10)

# Persistent HTTP client (reuse connections)
_client: httpx.AsyncClient | None = None

# Semaphore to limit concurrent requests to OpenF1 (avoid 429)
_semaphore = asyncio.Semaphore(3)

MAX_RETRIES = 5
RETRY_BACKOFF = [2.0, 5.0, 10.0, 20.0, 30.0]


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        headers = {
            "Accept": "application/json",
            "User-Agent": "F1 Analyzer Backend/1.0",
        }
        if OPENF1_API_KEY and not OPENF1_API_KEY_QUERY_PARAM:
            headers[OPENF1_API_KEY_HEADER] = f"Bearer {OPENF1_API_KEY}"
        _client = httpx.AsyncClient(timeout=30.0, headers=headers)
    return _client


async def _fetch(endpoint: str, params: dict[str, Any] | None = None, live: bool = False, bypass_cache: bool = False) -> list[dict]:
    cache = _live_cache if live else _cache
    key = f"{endpoint}:{sorted(params.items()) if params else ''}"

    if not bypass_cache and key in cache:
        return cache[key]

    async with _semaphore:
        if not bypass_cache and key in cache:
            return cache[key]

        client = _get_client()
        resp: httpx.Response | None = None

        for attempt in range(MAX_RETRIES):
            request_params = dict(params or {})
            if OPENF1_API_KEY and OPENF1_API_KEY_QUERY_PARAM:
                request_params[OPENF1_API_KEY_QUERY_PARAM] = OPENF1_API_KEY

            # Build URL manually to preserve comparison operators (>=, <=).
            # OpenF1 uses custom query parsing where the operator IS the
            # separator: date>=2023-09-15  (NOT date>==2023-09-15).
            # For standard equality params we use the normal key=value form.
            if request_params:
                parts: list[str] = []
                for k, v in request_params.items():
                    encoded_v = quote(str(v), safe="")
                    if k.endswith(">=") or k.endswith("<="):
                        # Operator already contains '=', no extra separator
                        parts.append(f"{k}{encoded_v}")
                    else:
                        parts.append(f"{k}={encoded_v}")
                url = f"{BASE_URL}{endpoint}?{'&'.join(parts)}"
            else:
                url = f"{BASE_URL}{endpoint}"

            resp = await client.get(url)

            if resp.status_code == 429:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                print(
                    f"[OpenF1] 429 rate-limited on {endpoint}, "
                    f"retrying in {wait}s (attempt {attempt + 1})"
                )
                await asyncio.sleep(wait)
                continue

            if resp.status_code == 401:
                raise httpx.HTTPStatusError(
                    f"Unauthorized access to OpenF1: {resp.text}",
                    request=resp.request,
                    response=resp,
                )

            resp.raise_for_status()
            data = resp.json()
            cache[key] = data
            return data

        if resp is None:
            raise httpx.HTTPStatusError(
                f"No attempts made for {endpoint} (MAX_RETRIES=0)",
                request=httpx.Request("GET", f"{BASE_URL}{endpoint}"),
                response=httpx.Response(429),
            )

        raise httpx.HTTPStatusError(
            f"Rate-limited after {MAX_RETRIES} retries on {endpoint}",
            request=resp.request,
            response=resp,
        )


# ─── Sessions ────────────────────────────────────────────────────────

async def get_sessions(year: int | None = None, session_type: str | None = None, session_name: str | None = None) -> list[dict]:
    params: dict[str, Any] = {}
    if year:
        params["year"] = year
    if session_type:
        params["session_type"] = session_type
    if session_name:
        params["session_name"] = session_name
    return await _fetch("/sessions", params)


async def get_qualifying_sessions(year: int) -> list[dict]:
    """
    Fetch all qualifying-related sessions for a year.

    OpenF1 uses session_type="Qualifying" for all qualifying sessions, with
    session_name varying by format:
      - Standard weekends: session_name is "Qualifying" (one session),
        OR "Q1" / "Q2" / "Q3" as separate rows (newer API versions).
      - Sprint weekends: session_name may be "Sprint Qualifying".

    We fetch by session_type="Qualifying" which covers all of the above.
    The frontend groups them by race weekend and maps to Q1/Q2/Q3 slots.
    """
    results = await get_sessions(year=year, session_type="Qualifying")
    print(f"[OpenF1] qualifying sessions for {year}: {len(results)} records")
    if results:
        names = list({s.get("session_name", "") for s in results})
        print(f"[OpenF1] session_name values seen: {names}")
    return results


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

async def get_position(session_key: int, driver_number: int | None = None, fresh: bool = True) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    data = await _fetch("/position", params, bypass_cache=fresh)
    if data and not driver_number:
        print(f"[OpenF1] Position data for session {session_key}: {len(data)} records")
        if data:
            print(f"[OpenF1] Sample: {data[-1]}")
    return data


async def get_session_result(
    session_key: int,
    max_position: int | None = None,
) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if max_position is not None:
        params["position<="] = max_position
    return await _fetch("/session_result", params)


async def get_driver_championship(
    session_key: int,
    driver_number: int | None = None,
) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/championship_drivers", params)


async def get_constructor_championship(
    session_key: int,
    team_name: str | None = None,
) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if team_name:
        params["team_name"] = team_name
    return await _fetch("/championship_teams", params)


# ─── Car Data (telemetry) ────────────────────────────────────────────

async def get_car_data(
    session_key: int,
    driver_number: int,
    date_gte: str | None = None,
    date_lte: str | None = None,
) -> list[dict]:
    """
    Fetch car telemetry for a driver.

    IMPORTANT: Always pass date_gte / date_lte when fetching qualifying
    telemetry. Without a time window, OpenF1 returns the entire session
    (potentially 10,000+ rows per driver) and frequently times out or
    returns an empty response due to payload size limits.
    """
    params: dict[str, Any] = {
        "session_key": session_key,
        "driver_number": driver_number,
    }
    if date_gte:
        params["date>="] = date_gte
    if date_lte:
        params["date<="] = date_lte
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


# ─── Race Control (flags, safety cars, etc.) ─────────────────────────

async def get_race_control(session_key: int) -> list[dict]:
    return await _fetch("/race_control", {"session_key": session_key})


# ─── Weather ─────────────────────────────────────────────────────────

async def get_weather(session_key: int) -> list[dict]:
    return await _fetch("/weather", {"session_key": session_key})


# ─── Location (car positions on track) ──────────────────────────────

async def get_location(session_key: int, driver_number: int | None = None) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number:
        params["driver_number"] = driver_number
    return await _fetch("/location", params)


# ─── Driver lookup (cross-session) ───────────────────────────────────

async def get_driver_by_number(driver_number: int) -> dict | None:
    """Return the most recent driver record for a given number across all sessions."""
    data = await _fetch("/drivers", {"driver_number": driver_number})
    return data[-1] if data else None


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
