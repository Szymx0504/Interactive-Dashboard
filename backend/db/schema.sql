-- F1 Analyzer — Postgres schema (minimal: season-wide + track_map cache)
-- Run once:  psql $DATABASE_URL -f schema.sql
-- Or let the app auto-create on startup via init_schema().

-- 1. Sessions list (tiny, ~200 rows/year)
CREATE TABLE IF NOT EXISTS sessions (
    session_key        INTEGER PRIMARY KEY,
    session_name       TEXT,
    session_type       TEXT,
    date_start         TEXT,
    date_end           TEXT,
    gmt_offset         TEXT,
    country_name       TEXT,
    country_code       TEXT,
    circuit_key        INTEGER,
    circuit_short_name TEXT,
    location           TEXT,
    year               INTEGER,
    meeting_key        INTEGER,
    meeting_name       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_year_type ON sessions (year, session_type);

-- 2. Drivers per session (~20 rows/session)
CREATE TABLE IF NOT EXISTS drivers (
    session_key     INTEGER NOT NULL,
    driver_number   INTEGER NOT NULL,
    full_name       TEXT,
    name_acronym    TEXT,
    broadcast_name  TEXT,
    team_name       TEXT,
    team_colour     TEXT,
    country_code    TEXT,
    headshot_url    TEXT,
    first_name      TEXT,
    last_name       TEXT,
    PRIMARY KEY (session_key, driver_number)
);

-- 3. Session results (race finishing order, ~20 rows/session)
CREATE TABLE IF NOT EXISTS session_results (
    session_key     INTEGER NOT NULL,
    driver_number   INTEGER NOT NULL,
    position        INTEGER,
    points          DOUBLE PRECISION,
    grid_position   INTEGER,
    status          TEXT,
    full_name       TEXT,
    name_acronym    TEXT,
    broadcast_name  TEXT,
    team_name       TEXT,
    team_colour     TEXT,
    PRIMARY KEY (session_key, driver_number)
);

-- 4. Driver championship standings (per race, ~20 rows)
CREATE TABLE IF NOT EXISTS championship_drivers (
    session_key       INTEGER NOT NULL,
    meeting_key       INTEGER,
    driver_number     INTEGER NOT NULL,
    position_start    INTEGER,
    position_current  INTEGER,
    points_start      DOUBLE PRECISION,
    points_current    DOUBLE PRECISION,
    PRIMARY KEY (session_key, driver_number)
);

-- 5. Constructor championship standings (per race, ~10 rows)
CREATE TABLE IF NOT EXISTS championship_teams (
    session_key       INTEGER NOT NULL,
    meeting_key       INTEGER,
    team_name         TEXT NOT NULL,
    position_start    INTEGER,
    position_current  INTEGER,
    points_start      DOUBLE PRECISION,
    points_current    DOUBLE PRECISION,
    PRIMARY KEY (session_key, team_name)
);

-- 6. Laps per session (~300-400 rows for qualifying, ~1200 for races)
CREATE TABLE IF NOT EXISTS laps (
    session_key        INTEGER NOT NULL,
    meeting_key        INTEGER,
    driver_number      INTEGER NOT NULL,
    lap_number         INTEGER NOT NULL,
    date_start         TEXT,
    lap_duration       DOUBLE PRECISION,
    duration_sector_1  DOUBLE PRECISION,
    duration_sector_2  DOUBLE PRECISION,
    duration_sector_3  DOUBLE PRECISION,
    i1_speed           DOUBLE PRECISION,
    i2_speed           DOUBLE PRECISION,
    st_speed           DOUBLE PRECISION,
    is_pit_out_lap     BOOLEAN,
    segments_sector_1  JSONB,
    segments_sector_2  JSONB,
    segments_sector_3  JSONB,
    PRIMARY KEY (session_key, driver_number, lap_number)
);
CREATE INDEX IF NOT EXISTS idx_laps_session ON laps (session_key);

-- 7. Stints / tyre data (~80-120 rows per session)
CREATE TABLE IF NOT EXISTS stints (
    session_key        INTEGER NOT NULL,
    meeting_key        INTEGER,
    driver_number      INTEGER NOT NULL,
    stint_number       INTEGER NOT NULL,
    lap_start          INTEGER,
    lap_end            INTEGER,
    compound           TEXT,
    tyre_age_at_start  INTEGER,
    PRIMARY KEY (session_key, driver_number, stint_number)
);

-- 8. Race control messages (flags, starts, safety cars — ~30-80 per session)
CREATE TABLE IF NOT EXISTS race_control (
    id                 SERIAL PRIMARY KEY,
    session_key        INTEGER NOT NULL,
    meeting_key        INTEGER,
    date               TEXT NOT NULL,
    category           TEXT,
    flag               TEXT,
    message            TEXT,
    scope              TEXT,
    driver_number      INTEGER,
    lap_number         INTEGER,
    UNIQUE (session_key, date, message)
);
CREATE INDEX IF NOT EXISTS idx_race_control_session ON race_control (session_key);

-- 9. Track map cache (downsampled location data, ~1.5-2 MB per session)
CREATE TABLE IF NOT EXISTS track_map_cache (
    session_key     INTEGER PRIMARY KEY,
    data            JSONB NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Weather samples (~20-60 per session)
CREATE TABLE IF NOT EXISTS weather (
    session_key        INTEGER NOT NULL,
    date               TEXT NOT NULL,
    air_temperature    DOUBLE PRECISION,
    track_temperature  DOUBLE PRECISION,
    humidity           DOUBLE PRECISION,
    pressure           DOUBLE PRECISION,
    rainfall           DOUBLE PRECISION,
    wind_direction     INTEGER,
    wind_speed         DOUBLE PRECISION,
    PRIMARY KEY (session_key, date)
);
CREATE INDEX IF NOT EXISTS idx_weather_session ON weather (session_key);

-- 11. Intervals / gaps (~1000-3000 per session)
CREATE TABLE IF NOT EXISTS intervals (
    session_key        INTEGER NOT NULL,
    driver_number      INTEGER NOT NULL,
    date               TEXT NOT NULL,
    gap_to_leader      DOUBLE PRECISION,
    interval           DOUBLE PRECISION,
    PRIMARY KEY (session_key, driver_number, date)
);
CREATE INDEX IF NOT EXISTS idx_intervals_session ON intervals (session_key);

-- Tracks which sessions have been fully seeded (for the seed script)
CREATE TABLE IF NOT EXISTS seed_status (
    session_key     INTEGER NOT NULL,
    table_name      TEXT NOT NULL,
    seeded_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_key, table_name)
);
