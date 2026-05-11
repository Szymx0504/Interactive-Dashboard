#main.py
"""
F1 Analyzer — FastAPI Backend
Serves OpenF1 data via REST + WebSocket for race replay.
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import asyncio
import httpx
import json

from openf1_client import (
    get_sessions,
    get_qualifying_sessions,
    get_session,
    get_drivers,
    get_laps,
    get_position,
    get_session_result,
    get_driver_championship,
    get_constructor_championship,
    get_car_data,
    get_pit_stops,
    get_stints,
    get_intervals,
    get_race_control,
    get_weather,
    get_location,
    get_latest_session,
    get_driver_by_number,
)
from ws_manager import replay_manager

app = FastAPI(title="F1 Analyzer API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(httpx.HTTPStatusError)
async def openf1_http_error(request: Request, exc: httpx.HTTPStatusError):
    status_code = 502
    detail = "OpenF1 API request failed."
    if exc.response is not None:
        body = exc.response.text
        if exc.response.status_code == 401:
            detail = "OpenF1 API returned 401 Unauthorized. Check OPENF1_API_KEY and service availability."
        else:
            detail = f"OpenF1 API returned {exc.response.status_code}."
        return JSONResponse(status_code=status_code, content={"error": detail, "body": body})
    return JSONResponse(status_code=status_code, content={"error": detail})


# ─── Health ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ─── Sessions ────────────────────────────────────────────────────────

@app.get("/api/sessions")
async def sessions(year: int | None = None, session_type: str | None = None):
    if session_type and session_type.lower() == "qualifying":
        results = await get_qualifying_sessions(year) if year else await get_sessions(session_type=session_type)
    else:
        results = await get_sessions(year, session_type)
    return results


@app.get("/api/sessions/latest")
async def latest_session():
    data = await get_latest_session()
    if not data:
        return {"error": "No session found"}
    return data


@app.get("/api/sessions/{session_key}")
async def session_detail(session_key: int):
    data = await get_session(session_key)
    if not data:
        return {"error": "Session not found"}
    return data


# ─── Qualifying segments ─────────────────────────────────────────────
#
# OpenF1 often returns one combined "Qualifying" session row instead of
# separate Q1/Q2/Q3 rows.  The correct way to split Q1/Q2/Q3 is to look
# at the race_control feed for "Started" messages:
#   • 1st "Started"  → Q1 begins
#   • 2nd "Started"  → Q2 begins (Q1 ends)
#   • 3rd "Started"  → Q3 begins (Q2 ends)
#   • Q3 ends at session close (no upper bound)
#
# Returns: { "Q1": {"start": ISO, "end": ISO|null},
#            "Q2": {"start": ISO, "end": ISO|null},
#            "Q3": {"start": ISO, "end": null} }
# Missing keys mean that segment didn't occur (e.g. sprint weekends).

@app.get("/api/sessions/{session_key}/qualifying_segments")
async def qualifying_segments(session_key: int):
    rc = await get_race_control(session_key)

    # Find every "Started" message, sorted chronologically.
    # OpenF1 uses message text like "Q1 STARTED", "Q2 STARTED", "Q3 STARTED".
    started = sorted(
        [r for r in rc if "started" in (r.get("message") or "").lower()],
        key=lambda r: r.get("date", ""),
    )

    if not started:
        print(f"[qualifying_segments] No 'Started' events found for session {session_key}. "
              f"RC message sample: {[r.get('message') for r in rc[:10]]}")
        return {}

    segments: dict[str, dict] = {}
    labels = ["Q1", "Q2", "Q3"]
    for i, ev in enumerate(started[:3]):
        end = started[i + 1]["date"] if i + 1 < len(started) else None
        segments[labels[i]] = {"start": ev["date"], "end": end}

    print(f"[qualifying_segments] session {session_key}: {list(segments.keys())}")
    return segments


# ─── Season Results (bulk) ───────────────────────────────────────────

@app.get("/api/season/{year}/results")
async def season_results(year: int):
    async def safe_get_sessions(yr: int, stype: str) -> list[dict]:
        try:
            result = await get_sessions(year=yr, session_type=stype)
            return result or []
        except Exception as e:
            print(f"[season_results] Failed to fetch {stype} sessions for {yr}: {e}")
            return []

    race_sessions, sprint_sessions = await asyncio.gather(
        safe_get_sessions(year, "Race"),
        safe_get_sessions(year, "Sprint"),
    )
    all_sessions = sorted(
        race_sessions + sprint_sessions,
        key=lambda s: s.get("date_start", ""),
    )
    if not all_sessions:
        return {"sessions": [], "results": {}}

    async def fetch_result(s: dict) -> tuple[int, list[dict]]:
        try:
            data = await get_session_result(s["session_key"])
            return s["session_key"], data or []
        except Exception:
            return s["session_key"], []

    CHUNK = 3
    pairs: list[tuple[int, list[dict]]] = []
    for i in range(0, len(all_sessions), CHUNK):
        chunk = all_sessions[i : i + CHUNK]
        chunk_results = await asyncio.gather(*(fetch_result(s) for s in chunk))
        pairs.extend(chunk_results)
        if i + CHUNK < len(all_sessions):
            await asyncio.sleep(0.5)

    sessions_with_results = [s for s in all_sessions
                              if any(sk == s["session_key"] for sk, data in pairs if data)]
    driver_cache: dict[int, dict] = {}

    async def fetch_drivers_for_session(s: dict) -> list[dict]:
        try:
            return await get_drivers(s["session_key"])
        except Exception:
            return []

    for i in range(0, len(sessions_with_results), CHUNK):
        chunk = sessions_with_results[i : i + CHUNK]
        driver_lists = await asyncio.gather(*(fetch_drivers_for_session(s) for s in chunk))
        for drivers_list in driver_lists:
            for d in drivers_list:
                dn = d.get("driver_number")
                if dn and dn not in driver_cache:
                    driver_cache[dn] = d
        if i + CHUNK < len(sessions_with_results):
            await asyncio.sleep(0.3)

    enriched_results: dict[str, list[dict]] = {}
    for sk, rows in pairs:
        enriched_rows = []
        for row in rows:
            dn = row.get("driver_number")
            driver = driver_cache.get(dn, {})
            enriched_rows.append({
                **row,
                "full_name": row.get("full_name") or driver.get("full_name"),
                "name_acronym": row.get("name_acronym") or driver.get("name_acronym"),
                "broadcast_name": row.get("broadcast_name") or driver.get("broadcast_name"),
                "team_name": row.get("team_name") or driver.get("team_name"),
                "team_colour": row.get("team_colour") or driver.get("team_colour"),
            })
        enriched_results[str(sk)] = enriched_rows

    return {
        "sessions": [
            {
                "session_key": s["session_key"],
                "session_name": s.get("session_name", "Race"),
                "session_type": s.get("session_type", "Race"),
                "country_name": s.get("country_name", ""),
                "circuit_short_name": s.get("circuit_short_name", ""),
                "date_start": s.get("date_start", ""),
                "year": s.get("year", year),
            }
            for s in all_sessions
        ],
        "results": enriched_results,
    }


# ─── Drivers ─────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_key}/drivers")
async def drivers(session_key: int):
    return await get_drivers(session_key)


@app.get("/api/sessions/{session_key}/result")
async def session_result(session_key: int, max_position: int | None = None):
    return await get_session_result(session_key, max_position)


# ─── Championship ────────────────────────────────────────────────────

@app.get("/api/championship/drivers")
async def driver_championship(
    session_key: int,
    driver_number: int | None = None,
):
    standings, drivers_list = await asyncio.gather(
        get_driver_championship(session_key, driver_number),
        get_drivers(session_key),
    )
    drivers_map = {d["driver_number"]: d for d in drivers_list}
    for entry in standings:
        dn = entry.get("driver_number")
        if dn in drivers_map:
            entry.setdefault("team_colour", drivers_map[dn].get("team_colour"))
            entry.setdefault("name_acronym", drivers_map[dn].get("name_acronym"))
            entry.setdefault("full_name", drivers_map[dn].get("full_name"))
    return standings


@app.get("/api/championship/teams")
async def constructor_championship(
    session_key: int,
    team_name: str | None = None,
):
    standings, drivers_list = await asyncio.gather(
        get_constructor_championship(session_key, team_name),
        get_drivers(session_key),
    )
    team_colours = {
        d["team_name"]: d["team_colour"]
        for d in drivers_list
        if d.get("team_name") and d.get("team_colour")
    }
    for entry in standings:
        if entry.get("team_name") in team_colours:
            entry["team_colour"] = team_colours[entry["team_name"]]
    return standings


@app.get("/api/championship/drivers/by-year")
async def driver_championship_by_year(year: int, after_session_key: int | None = None):
    all_sessions = await get_sessions(year=year, session_type="Race")
    if not all_sessions:
        return []

    today = __import__("datetime").datetime.utcnow().isoformat()
    past = [s for s in all_sessions if s.get("date_start", "") <= today]
    if not past:
        return []

    if after_session_key:
        candidates = [s for s in past if s["session_key"] <= after_session_key]
        target_session = candidates[-1] if candidates else past[-1]
    else:
        target_session = past[-1]

    return await driver_championship(target_session["session_key"])


@app.get("/api/championship/teams/by-year")
async def constructor_championship_by_year(year: int, after_session_key: int | None = None):
    all_sessions = await get_sessions(year=year, session_type="Race")
    if not all_sessions:
        return []

    today = __import__("datetime").datetime.utcnow().isoformat()
    past = [s for s in all_sessions if s.get("date_start", "") <= today]
    if not past:
        return []

    if after_session_key:
        candidates = [s for s in past if s["session_key"] <= after_session_key]
        target_session = candidates[-1] if candidates else past[-1]
    else:
        target_session = past[-1]

    return await constructor_championship(target_session["session_key"])


# ─── Laps ────────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_key}/laps")
async def laps(
    session_key: int,
    driver_number: int | None = None,
    date_after: str | None = Query(None, description="ISO datetime — return laps with date_start >= this value"),
    date_before: str | None = Query(None, description="ISO datetime — return laps with date_start <= this value"),
):
    """
    Return laps for a session, optionally filtered to a Q segment window.
    date_after / date_before correspond to the start/end of a Q1|Q2|Q3
    segment as returned by /qualifying_segments.
    """
    data = await get_laps(session_key, driver_number)
    if date_after:
        data = [l for l in data if (l.get("date_start") or "") >= date_after]
    if date_before:
        data = [l for l in data if (l.get("date_start") or "") <= date_before]
    return data


# ─── Position ────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_key}/position")
async def position(session_key: int, driver_number: int | None = None, fresh: bool = True):
    return await get_position(session_key, driver_number, fresh)


# ─── Car Data (telemetry) ────────────────────────────────────────────

@app.get("/api/sessions/{session_key}/car_data/{driver_number}")
async def car_data(session_key: int, driver_number: int):
    return await get_car_data(session_key, driver_number)


@app.get("/api/sessions/{session_key}/car_data/{driver_number}/best_lap")
async def car_data_best_lap(
    session_key: int,
    driver_number: int,
    date_after: str | None = Query(None, description="Q segment start (ISO) — only consider laps after this time"),
    date_before: str | None = Query(None, description="Q segment end (ISO) — only consider laps before this time"),
):
    """
    Return car telemetry trimmed to the driver's fastest lap within the
    requested Q segment window (date_after / date_before).

    Without date_after/date_before the endpoint falls back to the overall
    fastest lap across the whole session — useful when race_control
    segment detection fails.

    Flow:
      1. Fetch lap list (small payload).
      2. If a segment window is provided, restrict candidate laps to that window.
      3. Find the fastest valid lap in the window.
      4. Pass date>= / date<= for only that lap's narrow time window to OpenF1
         /car_data, returning ~100-300 rows instead of the full session payload.
    """
    from datetime import datetime, timedelta

    all_laps = await get_laps(session_key, driver_number)
    if not all_laps:
        return []

    # ── Step 1: restrict to the Q segment window if provided ─────────
    candidate_laps = all_laps
    if date_after or date_before:
        seg_laps = [
            l for l in all_laps
            if (not date_after  or (l.get("date_start") or "") >= date_after)
            and (not date_before or (l.get("date_start") or "") <= date_before)
        ]
        if seg_laps:
            candidate_laps = seg_laps
        # If the filter yields nothing (e.g. race_control dates slightly off),
        # fall through to the full session so we always return something.

    # ── Step 2: find fastest valid lap ───────────────────────────────
    valid_laps = [
        l for l in candidate_laps
        if l.get("lap_duration") and not l.get("is_pit_out_lap")
    ]
    if not valid_laps:
        return []

    best_lap = min(valid_laps, key=lambda l: l["lap_duration"])
    lap_num = best_lap.get("lap_number")
    t0_str = best_lap.get("date_start", "")
    if not t0_str:
        return []

    # ── Step 3: determine the end of the lap window ───────────────────
    # Prefer the NEXT lap's date_start as the precise boundary so we don't
    # clip telemetry recorded during the last portion of the lap.
    next_lap = next(
        (l for l in all_laps if l.get("lap_number") == lap_num + 1 and l.get("date_start")),
        None,
    )
    if next_lap:
        t1_str = next_lap["date_start"]
    else:
        try:
            t0_dt = datetime.fromisoformat(t0_str)
            t1_dt = t0_dt + timedelta(seconds=float(best_lap["lap_duration"]) + 2)
            t1_str = t1_dt.isoformat()
        except Exception:
            t1_str = ""

    # ── Step 4: fetch ONLY the narrow telemetry window ────────────────
    sliced = await get_car_data(
        session_key,
        driver_number,
        date_gte=t0_str,
        date_lte=t1_str if t1_str else None,
    )

    return sliced


# ─── Pit Stops ───────────────────────────────────────────────────────

@app.get("/api/sessions/{session_key}/pit_stops")
async def pit_stops(session_key: int, driver_number: int | None = None):
    return await get_pit_stops(session_key, driver_number)


# ─── Stints (tires) ─────────────────────────────────────────────────

@app.get("/api/sessions/{session_key}/stints")
async def stints(session_key: int, driver_number: int | None = None):
    return await get_stints(session_key, driver_number)


# ─── Intervals (gap to leader) ──────────────────────────────────────

@app.get("/api/sessions/{session_key}/intervals")
async def intervals(session_key: int, driver_number: int | None = None):
    return await get_intervals(session_key, driver_number)


# ─── Race Control (flags, SC, VSC) ──────────────────────────────────

@app.get("/api/sessions/{session_key}/race_control")
async def race_control(session_key: int):
    return await get_race_control(session_key)


# ─── Weather ─────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_key}/weather")
async def weather(session_key: int):
    return await get_weather(session_key)


# ─── Location (car positions on track) ──────────────────────────────

@app.get("/api/sessions/{session_key}/location")
async def location(session_key: int, driver_number: int | None = None):
    return await get_location(session_key, driver_number)


@app.get("/api/sessions/{session_key}/track_map")
async def track_map(session_key: int):
    """Return downsampled location data for every driver."""
    drivers_list = await get_drivers(session_key)
    if not drivers_list:
        return {"outline": [], "drivers": {}}

    driver_numbers = list({d["driver_number"] for d in drivers_list})
    DRIVER_TARGET = 3000

    async def fetch_one(dn: int) -> tuple[int, list[dict]]:
        try:
            raw = await get_location(session_key, dn)
            return dn, raw or []
        except Exception:
            return dn, []

    results = await asyncio.gather(*(fetch_one(dn) for dn in driver_numbers))

    outline: list[dict] = []
    drivers_data: dict[int, list[dict]] = {}

    for dn, raw in results:
        if not raw:
            continue

        raw.sort(key=lambda p: p.get("date", ""))

        if not outline:
            try:
                dn_laps = await get_laps(session_key, dn)
                for try_lap in [3, 2, 4, 5, 1]:
                    lap_s = next(
                        (l for l in dn_laps if l.get("lap_number") == try_lap), None)
                    lap_e = next(
                        (l for l in dn_laps if l.get("lap_number") == try_lap + 1), None)
                    if lap_s and lap_e:
                        t0, t1 = lap_s["date_start"], lap_e["date_start"]
                        candidate = [
                            {"x": p["x"], "y": p["y"]}
                            for p in raw
                            if t0 <= p.get("date", "") <= t1 and p.get("x") is not None
                        ]
                        if len(candidate) > 20:
                            outline = candidate
                            break
            except Exception:
                pass
            if not outline:
                step = max(1, len(raw) // 2000)
                outline = [
                    {"x": p["x"], "y": p["y"]}
                    for p in raw[::step]
                    if p.get("x") is not None
                ]

        step = max(1, len(raw) // DRIVER_TARGET)
        drivers_data[dn] = [
            {"x": p["x"], "y": p["y"], "date": p["date"]}
            for p in raw[::step]
            if p.get("x") is not None
        ]

    return {"outline": outline, "drivers": drivers_data}


# ─── WebSocket: Race Replay ─────────────────────────────────────────

@app.websocket("/ws/replay/{session_key}")
async def ws_replay(websocket: WebSocket, session_key: int):
    await replay_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            cmd = msg.get("command")

            if cmd == "start":
                speed = msg.get("speed", 1.0)
                await replay_manager.start_replay(websocket, session_key, speed)
            elif cmd == "load_full":
                await replay_manager.send_full_race_data(websocket, session_key)
            elif cmd == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        replay_manager.disconnect(websocket)
    except Exception as e:
        print(f"[ws_replay] Unexpected error: {e}")
        replay_manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
