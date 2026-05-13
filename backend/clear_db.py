import asyncio
import sys
from db.pool import get_pool, close_pool, DATABASE_URL


async def main():
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set in .env")
        sys.exit(1)

    print(f"Connecting to DB to clear tables...")
    pool = await get_pool()

    async with pool.acquire() as conn:
        await conn.execute('''
            DROP TABLE IF EXISTS sessions, drivers, session_results, 
            championship_drivers, championship_teams, laps, stints,
            race_control, track_map_cache, seed_status CASCADE
        ''')
        print("Database cleared successfully (All tables dropped)!")

    await close_pool()

if __name__ == "__main__":
    asyncio.run(main())
