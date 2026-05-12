"""
Seed script: fetches season-wide data from OpenF1 and stores it in Postgres.

Usage:
    python seed.py                  # seed all years (2023-2025)
    python seed.py --year 2024      # seed only 2024
    python seed.py --year 2024 --force  # re-seed even if already done

Only seeds: sessions, drivers, session_results, championship_drivers,
championship_teams.  Track map is lazy-cached on first request.
"""

import argparse
import asyncio
import sys
import time

import openf1_client as api
from db.pool import get_pool, close_pool, DATABASE_URL
from db import queries as db


YEARS = [2023, 2024, 2025]

# Tables to seed per session  (table_name, fetch_fn, insert_fn)
# fetch_fn takes session_key, insert_fn takes session_key + rows
CORE_TABLES: list[tuple[str, str, str]] = [
    ("drivers",              "get_drivers",                "insert_drivers"),
    ("session_results",      "get_session_result",         "insert_session_results"),
    ("championship_drivers", "get_driver_championship",
     "insert_championship_drivers"),
    ("championship_teams",   "get_constructor_championship",
     "insert_championship_teams"),
    ("track_map_cache",      "get_processed_track_map",    "insert_track_map"),
]


async def init_schema() -> None:
    """Create tables if they don't exist."""
    pool = await get_pool()
    if pool is None:
        print("ERROR: DATABASE_URL not set. Cannot seed.")
        sys.exit(1)

    import pathlib
    schema_path = pathlib.Path(__file__).parent / "db" / "schema.sql"
    sql = schema_path.read_text()
    async with pool.acquire() as conn:
        await conn.execute(sql)
    print("[seed] Schema initialized.")


async def seed_session(session_key: int, session_label: str, session_type: str, force: bool) -> None:
    """Seed all core tables for a single session."""
    for table_name, fetch_name, insert_name in CORE_TABLES:
        # Only seed track map for actual races (Race and Sprint)
        if table_name == "track_map_cache" and session_type not in ["Race", "Sprint"]:
            continue

        if not force and await db.is_seeded(session_key, table_name):
            continue

        fetch_fn = getattr(api, fetch_name)
        insert_fn = getattr(db, insert_name)

        try:
            rows = await fetch_fn(session_key)
            if rows:
                await insert_fn(session_key, rows)
            await db.mark_seeded(session_key, table_name)
            count = len(rows) if rows else 0
            print(f"  {table_name}: {count} rows")
        except Exception as e:
            print(f"  {table_name}: FAILED — {e}")

        # Brief pause between tables to stay under rate limit
        await asyncio.sleep(1.0)


async def seed_year(year: int, force: bool) -> None:
    """Seed all sessions for a year."""
    print(f"\n{'='*60}")
    print(f" Seeding {year}")
    print(f"{'='*60}")

    # Fetch and store sessions list
    sessions = await api.get_sessions(year=year)
    if not sessions:
        print(f"  No sessions found for {year}")
        return

    await db.insert_sessions(sessions)
    print(f"  {len(sessions)} sessions found")

    for i, s in enumerate(sessions):
        sk = s["session_key"]
        label = f"{s.get('session_name', '?')} — {s.get('circuit_short_name', '?')} ({s.get('country_name', '?')})"
        print(f"\n[{i+1}/{len(sessions)}] {label}  (session_key={sk})")

        t0 = time.time()
        await seed_session(sk, label, s.get("session_type", ""), force)
        elapsed = time.time() - t0
        print(f"  Done in {elapsed:.1f}s")

        # Pause between sessions to avoid rate-limit bursts
        await asyncio.sleep(2.0)


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed OpenF1 data into Postgres")
    parser.add_argument("--year", type=int, help="Seed only this year")
    parser.add_argument("--force", action="store_true",
                        help="Re-seed even if already done")
    args = parser.parse_args()

    if not DATABASE_URL:
        print("ERROR: Set DATABASE_URL in your .env file.")
        print("Example: DATABASE_URL=postgresql://user:pass@host:5432/dbname")
        sys.exit(1)

    print(f"[seed] Connecting to: {DATABASE_URL[:40]}...")
    await init_schema()

    years = [args.year] if args.year else YEARS
    for y in years:
        await seed_year(y, args.force)

    await close_pool()
    print("\n[seed] Done!")


if __name__ == "__main__":
    asyncio.run(main())
