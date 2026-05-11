"""
WebSocket manager for race replay streaming.
Controls the "clock" and pushes lap-by-lap frames to connected clients.
"""

import asyncio
import json
from typing import Any
from fastapi import WebSocket

from openf1_client import get_laps, get_position, get_stints, get_weather, get_intervals


class ReplayManager:
    """Manages race replay state and streams data to WebSocket clients."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._replay_tasks: dict[int, asyncio.Task] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def _send(self, websocket: WebSocket, data: dict):
        try:
            await websocket.send_json(data)
        except Exception:
            self.disconnect(websocket)

    async def broadcast(self, data: dict):
        disconnected = []
        for ws in self.active_connections:
            try:
                await ws.send_json(data)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws)

    async def start_replay(self, websocket: WebSocket, session_key: int, speed: float = 1.0):
        """
        Fetch all lap data for a session, then stream it lap by lap.
        speed: playback multiplier (1.0 = ~1s per lap, 5.0 = ~0.2s per lap)

        FIX: If a replay is already in progress for this websocket (identified
        by object id), cancel it before starting a new one. Without this, two
        concurrent 'start' commands would race and double-send every frame.
        """
        ws_id = id(websocket)
        existing = self._replay_tasks.get(ws_id)
        if existing and not existing.done():
            existing.cancel()
            try:
                await existing
            except (asyncio.CancelledError, Exception):
                pass

        # Run the actual replay in a task so it can be cancelled later.
        task = asyncio.create_task(
            self._run_replay(websocket, session_key, speed)
        )
        self._replay_tasks[ws_id] = task

        try:
            await task
        except asyncio.CancelledError:
            pass
        finally:
            self._replay_tasks.pop(ws_id, None)

    async def _run_replay(self, websocket: WebSocket, session_key: int, speed: float):
        """Inner replay coroutine — cancellable."""
        laps = await get_laps(session_key)
        positions = await get_position(session_key)
        stints = await get_stints(session_key)
        weather = await get_weather(session_key)
        intervals = await get_intervals(session_key)

        if not laps:
            await self._send(websocket, {"type": "error", "message": "No lap data found"})
            return

        max_lap = max((lap.get("lap_number", 0) for lap in laps), default=0)

        # Sort laps once so we can find the next-lap start for boundary calc
        laps_sorted = sorted(laps, key=lambda l: (l.get("driver_number", 0), l.get("lap_number", 0)))

        # Build a quick lookup: (driver_number, lap_number) -> date_start
        lap_start_index: dict[tuple[int, int], str] = {
            (l["driver_number"], l["lap_number"]): l["date_start"]
            for l in laps_sorted
            if l.get("driver_number") and l.get("lap_number") and l.get("date_start")
        }

        await self._send(websocket, {
            "type": "session_info",
            "total_laps": max_lap,
            "driver_count": len(set(l.get("driver_number") for l in laps)),
        })

        for lap_num in range(1, max_lap + 1):
            lap_data = [l for l in laps if l.get("lap_number") == lap_num]

            # FIX: _in_lap used max(lap_data date_starts) as the window end,
            # but that is just the start of the last lap in the group — so
            # telemetry at the END of that lap was excluded. Instead, use each
            # lap's next-lap start (or fall back to its own date_start + duration)
            # to build a per-lap window, then union them.
            lap_positions = [p for p in positions if _in_lap_window(p, lap_data, lap_start_index)]
            lap_stints = [s for s in stints if s.get("lap_start", 0) <= lap_num <= s.get("lap_end", 999)]
            lap_weather = _latest_before_lap(weather, lap_data)
            lap_intervals = [i for i in intervals if _in_lap_window(i, lap_data, lap_start_index)]

            frame = {
                "type": "lap_frame",
                "lap_number": lap_num,
                "total_laps": max_lap,
                "laps": lap_data,
                "positions": lap_positions,
                "stints": lap_stints,
                "weather": lap_weather,
                "intervals": lap_intervals,
            }

            await self._send(websocket, frame)

            delay = max(0.05, 1.0 / speed)
            await asyncio.sleep(delay)

        await self._send(websocket, {"type": "replay_complete"})

    async def send_full_race_data(self, websocket: WebSocket, session_key: int):
        """Send all race data at once for client-side replay control."""
        laps = await get_laps(session_key)
        positions = await get_position(session_key)
        stints = await get_stints(session_key)
        weather = await get_weather(session_key)
        intervals = await get_intervals(session_key)

        await self._send(websocket, {
            "type": "full_race_data",
            "laps": laps,
            "positions": positions,
            "stints": stints,
            "weather": weather,
            "intervals": intervals,
        })


def _in_lap_window(
    item: dict,
    lap_data: list[dict],
    lap_start_index: dict[tuple[int, int], str],
) -> bool:
    """
    Check if a timestamped item falls within any lap in lap_data.

    FIX over original _in_lap: instead of using max(lap_data.date_start) as
    the window end (which is only the START of the last lap), we look up the
    NEXT lap's date_start to get the true end of each lap.  This ensures
    telemetry recorded during the final portion of a lap isn't dropped.
    """
    item_date = item.get("date", "")
    if not item_date or not lap_data:
        return False

    for lap in lap_data:
        t0 = lap.get("date_start", "")
        if not t0:
            continue

        dn = lap.get("driver_number")
        ln = lap.get("lap_number")
        duration = lap.get("lap_duration")

        # Prefer the next lap's date_start as the precise window end
        t1 = lap_start_index.get((dn, ln + 1), "") if dn and ln else ""

        if not t1 and duration:
            # Fall back: estimate end from lap_duration (ISO string arithmetic)
            try:
                from datetime import datetime, timedelta
                t0_dt = datetime.fromisoformat(t0)
                t1 = (t0_dt + timedelta(seconds=duration)).isoformat()
            except Exception:
                t1 = ""

        if t1:
            if t0 <= item_date <= t1:
                return True
        else:
            # No end boundary available — accept anything after t0
            if item_date >= t0:
                return True

    return False


# Keep the original name as an alias so any external callers aren't broken.
def _in_lap(item: dict, lap_data: list[dict]) -> bool:
    """Legacy wrapper — uses the fixed implementation with an empty index."""
    return _in_lap_window(item, lap_data, {})


def _latest_before_lap(weather_data: list[dict], lap_data: list[dict]) -> dict | None:
    """Get the latest weather reading before/during a lap."""
    if not lap_data or not weather_data:
        return None
    lap_dates = [l.get("date_start", "") for l in lap_data if l.get("date_start")]
    if not lap_dates:
        return None
    target = min(lap_dates)
    candidates = [w for w in weather_data if w.get("date", "") <= target]
    return candidates[-1] if candidates else weather_data[0] if weather_data else None


replay_manager = ReplayManager()
