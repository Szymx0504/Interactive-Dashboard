// QualifyingAnalysis.tsx
import { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api";
import { useApi } from "../hooks/useApi";
import type { Driver } from "../types";
import type { QSession, QualLap, QualStint, QualCarData } from "../lib/api";
import QualifyingTable from "../components/charts/QualifyingTable";
import MiniSectorMap from "../components/charts/MiniSectorMap";
import SpeedChart from "../components/charts/SpeedChart";
import EngineChart from "../components/charts/EngineChart";
import PedalChart from "../components/charts/PedalChart";

interface Session {
    session_key: number;
    session_name: string;
    session_type: string;
    country_name: string;
    circuit_short_name: string;
    date_start: string;
    year: number;
}

// One entry per race weekend — a single qualifying session_key covers all
// three Q segments (we split them via race_control "Started" events, not
// by matching separate session rows).
interface RaceGroup {
    raceKey: string;
    label: string;
    session: Session;
}

// Boundaries returned by /api/sessions/{key}/qualifying_segments
// Each segment's `end` is null for Q3 (no upper bound).
type QSegmentBounds = { start: string; end: string | null };
type QSegments = Partial<Record<QSession, QSegmentBounds>>;

function Card({
    title,
    children,
    className = "",
}: {
    title: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`bg-f1-card rounded-xl border border-f1-border p-4 ${className}`}
        >
            <h3 className="text-sm font-semibold text-f1-muted uppercase tracking-wide mb-4">
                {title}
            </h3>
            {children}
        </div>
    );
}

export default function QualifyingAnalysis() {
    const currentYear = new Date().getFullYear();
    const years = [2025, 2024, 2023].filter((y) => y <= currentYear);

    const [year, setYear] = useState<number>(years[0]);
    const [selectedRaceKey, setSelectedRaceKey] = useState<string | null>(null);
    const [qSession, setQSession] = useState<QSession>("Q3");
    const [focusDriver, setFocusDriver] = useState<number | null>(null);

    // Q1/Q2/Q3 time boundaries from race_control "Started" events
    const [qualSegments, setQualSegments] = useState<QSegments>({});
    const [segmentsLoading, setSegmentsLoading] = useState(false);

    // ── All qualifying sessions for the year ──────────────────────────────
    const {
        data: qualSessions,
        loading: sessionsLoading,
        error: sessionsError,
    } = useApi<Session[]>(() => api.getSessions(year, "Qualifying"), [year]);

    // ── Race groups: ONE qualifying session per race weekend ──────────────
    //
    // Previously the code tried to find separate "Q1"/"Q2"/"Q3" session rows
    // and map them by name.  That approach breaks because:
    //   a) Older seasons / sprint weekends return one combined "Qualifying" row.
    //   b) Even when separate rows exist, laps and car_data are sometimes only
    //      stored under the parent session_key.
    //
    // New approach: find one session per weekend, then use race_control
    // "Started" messages to determine Q1/Q2/Q3 boundaries.
    const raceGroups = useMemo<RaceGroup[]>(() => {
        if (!qualSessions?.length) return [];

        const buckets = new Map<string, RaceGroup>();

        qualSessions.forEach((s) => {
            const raceKey = `${s.year}|${s.circuit_short_name}|${s.country_name}`;
            const existing = buckets.get(raceKey);

            // Keep the "Qualifying" session over "Sprint Qualifying"; on ties
            // keep the later (higher) session_key which is more complete.
            const preferThis =
                !existing ||
                (s.session_name.toLowerCase() === "qualifying" &&
                    existing.session.session_name.toLowerCase() !==
                        "qualifying") ||
                (s.session_name.toLowerCase() ===
                    existing.session.session_name.toLowerCase() &&
                    s.session_key > existing.session.session_key);

            if (preferThis) {
                buckets.set(raceKey, {
                    raceKey,
                    label: `${s.circuit_short_name} — ${s.country_name}`,
                    session: s,
                });
            }
        });

        return [...buckets.values()].sort((a, b) =>
            a.session.date_start.localeCompare(b.session.date_start),
        );
    }, [qualSessions]);

    // Auto-select the most recent past race weekend
    useEffect(() => {
        if (!raceGroups.length) return;
        const today = new Date().toISOString();
        const past = raceGroups.filter((g) => g.session.date_start <= today);
        const target = past.length ? past[past.length - 1] : raceGroups[0];
        setSelectedRaceKey(target.raceKey);
        setFocusDriver(null);
    }, [raceGroups]);

    const currentRaceGroup =
        raceGroups.find((g) => g.raceKey === selectedRaceKey) ?? null;
    const selectedSession = currentRaceGroup?.session ?? null;
    const selectedSessionKey = selectedSession?.session_key ?? null;

    // ── Fetch Q segment boundaries whenever the session changes ───────────
    useEffect(() => {
        setQualSegments({});
        if (!selectedSessionKey) return;

        setSegmentsLoading(true);
        fetch(`/api/sessions/${selectedSessionKey}/qualifying_segments`)
            .then((r) => r.json())
            .then((data: QSegments) => {
                setQualSegments(data ?? {});
                setSegmentsLoading(false);
            })
            .catch(() => {
                // If the endpoint fails we still render — just without segment filtering.
                setQualSegments({});
                setSegmentsLoading(false);
            });
    }, [selectedSessionKey]);

    const hasSegments = Object.keys(qualSegments).length > 0;

    // Effective Q session: the one the user asked for if it has data, otherwise
    // fall back to the highest available segment.
    const effectiveQSession = useMemo<QSession>(() => {
        if (!hasSegments) return qSession; // segments not yet loaded — stay on requested
        if (qualSegments[qSession]) return qSession;
        return (
            (["Q3", "Q2", "Q1"] as QSession[]).find((q) => qualSegments[q]) ??
            qSession
        );
    }, [qualSegments, qSession, hasSegments]);

    // Convenience: start/end ISO strings for the active segment (null when unknown)
    const currentSegment: QSegmentBounds | null =
        qualSegments[effectiveQSession] ?? null;
    const segStart = currentSegment?.start ?? null;
    const segEnd = currentSegment?.end ?? null;

    // ── Per-session data ──────────────────────────────────────────────────
    const { data: drivers } = useApi<Driver[]>(
        () =>
            selectedSessionKey
                ? api.getDrivers(selectedSessionKey)
                : Promise.resolve([]),
        [selectedSessionKey],
    );

    // Fetch ALL laps for the session — we filter client-side so switching
    // Q tabs is instant without an extra network round-trip.
    const {
        data: allLaps,
        loading: lapsLoading,
        error: lapsError,
    } = useApi<QualLap[]>(
        () =>
            selectedSessionKey
                ? api.getQualifyingLaps(selectedSessionKey)
                : Promise.resolve([]),
        [selectedSessionKey],
    );

    const { data: stints } = useApi<QualStint[]>(
        () =>
            selectedSessionKey
                ? api.getQualifyingStints(selectedSessionKey)
                : Promise.resolve([]),
        [selectedSessionKey],
    );

    // ── Filter laps to the active Q segment ──────────────────────────────
    const laps = useMemo<QualLap[]>(() => {
        if (!allLaps?.length) return [];
        if (!segStart) return allLaps; // no segment info → show everything
        return allLaps.filter((l) => {
            // QualLap must have date_start; add it to the type if missing.
            const d = (l as QualLap & { date_start?: string }).date_start ?? "";
            if (!d) return false;
            return d >= segStart && (!segEnd || d <= segEnd);
        });
    }, [allLaps, segStart, segEnd]);

    // ── Car telemetry scoped to the active Q segment ──────────────────────
    const [carDataMap, setCarDataMap] = useState<Map<number, QualCarData[]>>(
        new Map(),
    );
    const [carDataLoading, setCarDataLoading] = useState(false);
    const [carDataError, setCarDataError] = useState<string | null>(null);

    const uniqueDrivers = useMemo(
        () =>
            (drivers ?? []).filter(
                (d, i, arr) =>
                    arr.findIndex(
                        (x) => x.driver_number === d.driver_number,
                    ) === i,
            ),
        [drivers],
    );

    // Re-fetch whenever session OR the active segment window changes.
    useEffect(() => {
        setCarDataMap(new Map());
        setCarDataError(null);
        if (!selectedSessionKey || !uniqueDrivers.length) return;

        setCarDataLoading(true);
        const map = new Map<number, QualCarData[]>();

        // Build query string so the backend restricts its "best lap" search to
        // the current Q segment window.  Without this it would find the best lap
        // across the entire session (e.g. a Q1 lap when Q3 is selected).
        const params = new URLSearchParams();
        if (segStart) params.set("date_after", segStart);
        if (segEnd) params.set("date_before", segEnd);
        const qs = params.toString() ? `?${params}` : "";

        Promise.all(
            uniqueDrivers.slice(0, 20).map(async (d) => {
                try {
                    const resp = await fetch(
                        `/api/sessions/${selectedSessionKey}/car_data/${d.driver_number}/best_lap${qs}`,
                    );
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = await resp.json();
                    if (Array.isArray(data) && data.length) {
                        map.set(d.driver_number, data as QualCarData[]);
                    }
                } catch (e) {
                    console.warn(
                        `[CarData] driver ${d.driver_number} failed:`,
                        e,
                    );
                }
            }),
        )
            .then(() => {
                setCarDataMap(new Map(map));
                setCarDataLoading(false);
                if (!map.size)
                    setCarDataError("No telemetry returned for any driver.");
            })
            .catch((e) => {
                setCarDataError(String(e));
                setCarDataLoading(false);
            });
        // segStart/segEnd change whenever effectiveQSession changes, so this
        // naturally re-fetches on Q tab switch.
    }, [selectedSessionKey, uniqueDrivers, segStart, segEnd]);

    const focusDriverInfo = uniqueDrivers.find(
        (d) => d.driver_number === focusDriver,
    );
    const cardTitle = hasSegments
        ? `${effectiveQSession} Results — ${currentRaceGroup?.label.split(" —")[0] ?? ""}`
        : `Qualifying Results — ${currentRaceGroup?.label.split(" —")[0] ?? ""}`;

    return (
        <div className="space-y-6">
            {/* ── Controls ── */}
            <div className="flex flex-wrap items-center gap-4">
                <h1 className="text-2xl font-bold">Qualifying Analysis</h1>

                {/* Year picker */}
                <select
                    value={year}
                    onChange={(e) => {
                        setYear(Number(e.target.value));
                        setSelectedRaceKey(null);
                        setFocusDriver(null);
                    }}
                    className="bg-f1-card border border-f1-border rounded-lg px-3 py-2 text-sm"
                >
                    {years.map((y) => (
                        <option key={y} value={y}>
                            {y}
                        </option>
                    ))}
                </select>

                {/* Race weekend picker */}
                <select
                    value={selectedRaceKey ?? ""}
                    onChange={(e) => {
                        setSelectedRaceKey(e.target.value || null);
                        setFocusDriver(null);
                    }}
                    className="bg-f1-card border border-f1-border rounded-lg px-3 py-2 text-sm min-w-[220px]"
                    disabled={!raceGroups.length}
                >
                    <option value="">Select Race Weekend…</option>
                    {raceGroups.map((g) => (
                        <option key={g.raceKey} value={g.raceKey}>
                            {g.label}
                        </option>
                    ))}
                </select>

                {selectedSession && (
                    <span className="text-f1-muted text-sm">
                        {new Date(
                            selectedSession.date_start,
                        ).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                        })}
                    </span>
                )}

                {/* Q1 / Q2 / Q3 tabs
                    • Disabled while segments are loading.
                    • A segment tab is disabled when segments loaded but that
                      segment wasn't found (e.g. Q3 absent on sprint weekends).
                    • When no segment info is available at all (race_control
                      returned nothing), all three are enabled and act as a
                      visual-only label — laps are shown unfiltered. */}
                <div className="flex gap-1 ml-auto">
                    {(["Q1", "Q2", "Q3"] as QSession[]).map((q) => {
                        const available =
                            segmentsLoading ||
                            !hasSegments ||
                            !!qualSegments[q];
                        const active =
                            effectiveQSession === q && !segmentsLoading;
                        return (
                            <button
                                key={q}
                                onClick={() => {
                                    setQSession(q);
                                    setFocusDriver(null);
                                }}
                                disabled={!available}
                                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors
                                    disabled:opacity-30 disabled:cursor-not-allowed
                                    ${
                                        active
                                            ? "bg-white text-black"
                                            : "bg-f1-card border border-f1-border text-f1-muted hover:text-white"
                                    }`}
                            >
                                {q}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Status messages ── */}
            {sessionsLoading && (
                <p className="text-f1-muted text-sm">Loading sessions…</p>
            )}
            {sessionsError && (
                <p className="text-red-400 text-sm">
                    Failed to load sessions: {String(sessionsError)}
                </p>
            )}
            {!sessionsLoading &&
                !sessionsError &&
                qualSessions?.length === 0 && (
                    <p className="text-yellow-400 text-sm">
                        No qualifying sessions found for {year}. Try a different
                        year.
                    </p>
                )}

            {/* Driver focus badge */}
            {focusDriver && (
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-f1-muted">Driver Focus:</span>
                    <span
                        className="font-bold"
                        style={{
                            color: `#${focusDriverInfo?.team_colour ?? "fff"}`,
                        }}
                    >
                        #{focusDriver} {focusDriverInfo?.name_acronym}
                    </span>
                    <button
                        onClick={() => setFocusDriver(null)}
                        className="text-f1-muted hover:text-white transition-colors text-xs border border-f1-border rounded px-2 py-0.5"
                    >
                        Clear
                    </button>
                </div>
            )}

            {/* ── Main content ── */}
            {selectedSessionKey && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card title={cardTitle}>
                            {lapsLoading || segmentsLoading ? (
                                <p className="text-f1-muted text-sm">
                                    Loading laps…
                                </p>
                            ) : lapsError ? (
                                <p className="text-red-400 text-sm">
                                    Failed to load laps: {String(lapsError)}
                                </p>
                            ) : (
                                <QualifyingTable
                                    drivers={uniqueDrivers}
                                    laps={laps}
                                    stints={stints ?? []}
                                    qSession={effectiveQSession}
                                    focusDriver={focusDriver}
                                    onFocusDriver={setFocusDriver}
                                />
                            )}
                        </Card>

                        <Card title="Mini-Sector Fastest">
                            <MiniSectorMap
                                drivers={uniqueDrivers}
                                laps={laps}
                                focusDriver={focusDriver}
                                onFocusDriver={setFocusDriver}
                            />
                        </Card>
                    </div>

                    <Card title="Speed vs Distance — Best Laps">
                        {carDataLoading ? (
                            <p className="text-f1-muted text-sm">
                                Loading telemetry…
                            </p>
                        ) : carDataError ? (
                            <p className="text-f1-muted text-sm">
                                {carDataError}
                            </p>
                        ) : (
                            <SpeedChart
                                drivers={uniqueDrivers}
                                laps={laps}
                                carDataMap={carDataMap}
                                focusDriver={focusDriver}
                                onFocusDriver={setFocusDriver}
                            />
                        )}
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card title="Engine — RPM (line) + Gear (stepped)">
                            {carDataLoading ? (
                                <p className="text-f1-muted text-sm">
                                    Loading telemetry…
                                </p>
                            ) : carDataError ? (
                                <p className="text-f1-muted text-sm">
                                    {carDataError}
                                </p>
                            ) : (
                                <EngineChart
                                    drivers={uniqueDrivers}
                                    carDataMap={carDataMap}
                                    focusDriver={focusDriver}
                                    onFocusDriver={setFocusDriver}
                                />
                            )}
                        </Card>
                        <Card title="Pedal Trace — Throttle / Brake">
                            {carDataLoading ? (
                                <p className="text-f1-muted text-sm">
                                    Loading telemetry…
                                </p>
                            ) : carDataError ? (
                                <p className="text-f1-muted text-sm">
                                    {carDataError}
                                </p>
                            ) : (
                                <PedalChart
                                    drivers={uniqueDrivers}
                                    carDataMap={carDataMap}
                                    focusDriver={focusDriver}
                                    onFocusDriver={setFocusDriver}
                                />
                            )}
                        </Card>
                    </div>
                </div>
            )}
        </div>
    );
}
