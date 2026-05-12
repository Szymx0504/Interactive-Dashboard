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
    session_key     INTEGER NOT NULL,
    driver_number   INTEGER NOT NULL,
    position        INTEGER,
    points          DOUBLE PRECISION,
    wins            INTEGER,
    full_name       TEXT,
    name_acronym    TEXT,
    broadcast_name  TEXT,
    team_name       TEXT,
    team_colour     TEXT,
    PRIMARY KEY (session_key, driver_number)
);

-- 5. Constructor championship standings (per race, ~10 rows)
CREATE TABLE IF NOT EXISTS championship_teams (
    session_key     INTEGER NOT NULL,
    team_name       TEXT NOT NULL,
    position        INTEGER,
    points          DOUBLE PRECISION,
    wins            INTEGER,
    team_colour     TEXT,
    PRIMARY KEY (session_key, team_name)
);

-- 6. Track map cache (downsampled location data, ~1.5-2 MB per session)
CREATE TABLE IF NOT EXISTS track_map_cache (
    session_key     INTEGER PRIMARY KEY,
    data            JSONB NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks which sessions have been fully seeded (for the seed script)
CREATE TABLE IF NOT EXISTS seed_status (
    session_key     INTEGER NOT NULL,
    table_name      TEXT NOT NULL,
    seeded_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_key, table_name)
);
