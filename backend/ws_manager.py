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
        self._replay_tasks: dict[str, asyncio.Task] = {}

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
        """
        # Fetch all required data
        laps = await get_laps(session_key)
        positions = await get_position(session_key)
        stints = await get_stints(session_key)
        weather = await get_weather(session_key)
        intervals = await get_intervals(session_key)

        if not laps:
            await self._send(websocket, {"type": "error", "message": "No lap data found"})
            return

        # Group data by lap number
        max_lap = max((lap.get("lap_number", 0) for lap in laps), default=0)

        # Send session info
        await self._send(websocket, {
            "type": "session_info",
            "total_laps": max_lap,
            "driver_count": len(set(l.get("driver_number") for l in laps)),
        })

        # Stream lap by lap
        for lap_num in range(1, max_lap + 1):
            lap_data = [l for l in laps if l.get("lap_number") == lap_num]
            lap_positions = [p for p in positions if _in_lap(p, lap_data)]
            lap_stints = [s for s in stints if s.get("lap_start", 0) <= lap_num <= s.get("lap_end", 999)]
            lap_weather = _latest_before_lap(weather, lap_data)
            lap_intervals = [i for i in intervals if _in_lap(i, lap_data)]

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

            # Delay based on speed multiplier
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


def _in_lap(item: dict, lap_data: list[dict]) -> bool:
    """Check if a timestamped item falls within any lap's time range."""
    item_date = item.get("date", "")
    if not item_date or not lap_data:
        return False
    lap_dates = [l.get("date_start", "") for l in lap_data if l.get("date_start")]
    if not lap_dates:
        return False
    min_date = min(lap_dates)
    max_date = max(lap_dates)
    return min_date <= item_date <= max_date


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
