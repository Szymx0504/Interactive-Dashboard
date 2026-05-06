import { useEffect, useMemo, useReducer, useRef } from "react";

interface Session {
    session_key: number;
    session_name: string;
    country_name: string;
    circuit_short_name: string;
    date_start: string;
    year: number;
}

interface RaceResult {
    driver_number: number;
    position: number | null;
    classified_status?: string; // "Finished" | "DNF" | "WDDNF" | "DNS" | "DSQ" | ...
    full_name?: string;
    name_acronym?: string;
    team_name?: string;
    team_colour?: string;
}

interface ChampionshipEntry {
    driver_number: number;
    points_current?: number;
    points_start?: number;
    full_name?: string;
    name_acronym?: string;
    broadcast_name?: string;
    team_name?: string;
    team_colour?: string;
}

interface GridEntry {
    driverNumber: number;
    surname: string;
    acronym: string;
    teamName: string;
    color: string;
    // null  = wasn't an F1 driver / didn't participate at all
    // "DNF" | "DNS" | "DSQ" = classified status for non-finishers
    // number = finishing position
    positions: (number | "DNF" | "DNS" | "DSQ" | null)[];
    totalPoints: number;
}

interface SeasonGridProps {
    year: number;
    selectedSessionKey: number;
    apiBase?: string;
}

const MEDAL: Record<number, string> = { 1: "#ffd700", 2: "#c0c0c0", 3: "#cd7f32" };

function cellBg(pos: GridEntry["positions"][number]): string {
    if (pos === null)    return "transparent";
    if (pos === "DNF")   return "rgba(239,68,68,0.12)";
    if (pos === "DNS")   return "rgba(156,163,175,0.10)";
    if (pos === "DSQ")   return "rgba(168,85,247,0.12)";
    if (pos === 1)       return "rgba(255,215,0,0.15)";
    if (pos === 2)       return "rgba(192,192,192,0.12)";
    if (pos === 3)       return "rgba(205,127,50,0.12)";
    if (pos <= 10)       return "rgba(34,197,94,0.08)";
    return "rgba(255,255,255,0.03)";
}

function cellColor(pos: GridEntry["positions"][number]): string {
    if (pos === null)    return "transparent";
    if (pos === "DNF")   return "#f87171";
    if (pos === "DNS")   return "#9ca3af";
    if (pos === "DSQ")   return "#c084fc";
    if (pos <= 3)        return MEDAL[pos];
    if (pos <= 10)       return "#86efac";
    return "#6b7280";
}

function cellLabel(pos: GridEntry["positions"][number]): string {
    if (pos === null)  return "";
    if (pos === "DNF") return "DNF";
    if (pos === "DNS") return "DNS";
    if (pos === "DSQ") return "DSQ";
    return String(pos);
}

/** Normalise the raw classified_status string from OpenF1 into a display value. */
function resolveStatus(row: RaceResult): number | "DNF" | "DNS" | "DSQ" {
    const status = (row.classified_status ?? "").toUpperCase();
    if (status === "DNS") return "DNS";
    if (status === "DSQ" || status === "DISQUALIFIED") return "DSQ";
    // WDDNF = Withdrew/Did Not Finish, treat as DNF
    if (status === "DNF" || status === "WDDNF" || status === "RETIRED") return "DNF";
    // "Finished" or a numeric position — use the position field
    const pos = row.position;
    if (pos !== null && pos !== undefined && pos >= 1) return pos;
    // Fallback: if status is present but unrecognised, show DNF
    if (status && status !== "FINISHED") return "DNF";
    return pos ?? "DNF";
}

function getSurname(fullName?: string): string | null {
    if (!fullName) return null;
    const parts = fullName.trim().split(" ");
    return parts[parts.length - 1] || null;
}

// ─── State machine ───────────────────────────────────────────────────

interface SeasonData {
    sessions: Session[];
    results: Record<string, RaceResult[]>;
}

type State =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; data: SeasonData; championship: ChampionshipEntry[] }
    | { status: "error"; message: string };

type Action =
    | { type: "fetch_start" }
    | { type: "data"; data: SeasonData; championship: ChampionshipEntry[] }
    | { type: "error"; message: string };

function reducer(_state: State, action: Action): State {
    switch (action.type) {
        case "fetch_start": return { status: "loading" };
        case "data":        return { status: "done", data: action.data, championship: action.championship };
        case "error":       return { status: "error", message: action.message };
        default:            return _state;
    }
}

// ─── Component ───────────────────────────────────────────────────────

export default function SeasonGrid({ year, selectedSessionKey, apiBase = "/api" }: SeasonGridProps) {
    const [state, dispatch] = useReducer(reducer, { status: "idle" });
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!year) return;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        dispatch({ type: "fetch_start" });

        const seasonUrl      = `${apiBase}/season/${year}/results`;
        const champUrl       = `${apiBase}/championship/drivers/by-year?year=${year}` +
                               (selectedSessionKey ? `&after_session_key=${selectedSessionKey}` : "");

        Promise.all([
            fetch(seasonUrl, { signal: ctrl.signal }).then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json() as Promise<SeasonData>;
            }),
            fetch(champUrl, { signal: ctrl.signal }).then((r) => {
                if (!r.ok) return [] as ChampionshipEntry[];
                return r.json() as Promise<ChampionshipEntry[]>;
            }),
        ])
            .then(([data, championship]) => {
                if (ctrl.signal.aborted) return;
                dispatch({ type: "data", data, championship: championship ?? [] });
            })
            .catch((err) => {
                if (err.name !== "AbortError") dispatch({ type: "error", message: err.message });
            });

        return () => ctrl.abort();
    }, [year, selectedSessionKey, apiBase]);

    // Sessions visible up to the selected one
    const visibleSessions = useMemo(() => {
        if (state.status !== "done") return [];
        const idx = state.data.sessions.findIndex((s) => s.session_key === selectedSessionKey);
        return idx >= 0 ? state.data.sessions.slice(0, idx + 1) : state.data.sessions;
    }, [state, selectedSessionKey]);

    // Championship lookup: driver_number → points_current
    const champPoints = useMemo(() => {
        if (state.status !== "done") return new Map<number, number>();
        return new Map(
            state.championship.map((e) => [
                Number(e.driver_number),
                e.points_current ?? e.points_start ?? 0,
            ]),
        );
    }, [state]);

    // Build the grid rows
    const driverGrid = useMemo((): GridEntry[] => {
        if (state.status !== "done") return [];

        // Collect every driver_number that appears in ANY visible race
        // so we can show blank cells (not DNF) for races before they joined F1.
        const driverFirstRace = new Map<number, number>(); // driver_number → first raceIdx they appear

        visibleSessions.forEach((session, raceIdx) => {
            const results: RaceResult[] = state.data.results[String(session.session_key)] ?? [];
            results.forEach((r) => {
                if (!driverFirstRace.has(r.driver_number)) {
                    driverFirstRace.set(r.driver_number, raceIdx);
                }
            });
        });

        const driverMap = new Map<number, GridEntry>();

        // Initialise every known driver with all-null positions
        driverFirstRace.forEach((firstRace, driverNumber) => {
            driverMap.set(driverNumber, {
                driverNumber,
                surname:     String(driverNumber),
                acronym:     String(driverNumber),
                teamName:    "",
                color:       "#ffffff",
                positions:   Array(visibleSessions.length).fill(null) as (number | "DNF" | "DNS" | "DSQ" | null)[],
                totalPoints: 0,
            });
        });

        // Fill in results per race
        visibleSessions.forEach((session, raceIdx) => {
            const results: RaceResult[] = state.data.results[String(session.session_key)] ?? [];

            // Build a set of driver numbers that PARTICIPATED (i.e. are in the result list)
            // regardless of whether they finished.
            const participatedSet = new Set(results.map((r) => r.driver_number));

            results.forEach((r) => {
                const entry = driverMap.get(r.driver_number);
                if (!entry) return;

                const resolvedPos = resolveStatus(r);
                entry.positions[raceIdx] = resolvedPos;

                // Update identity info from the latest available data
                if (r.team_colour) entry.color    = `#${r.team_colour}`;
                if (r.team_name)   entry.teamName = r.team_name;
                if (r.full_name) {
                    entry.surname = getSurname(r.full_name) ?? entry.surname;
                }
                if (r.name_acronym) entry.acronym = r.name_acronym;
            });

            // Drivers who exist in our map but are NOT in this race's result set:
            // if they appeared in a PREVIOUS race they were presumably still on the grid
            // but didn't participate (DNF before start, or late withdrawal) — leave null
            // so the cell stays blank. We never infer a status we don't have.
            // (The null-initialisation above already handles this correctly.)
        });

        // Apply championship points (or fall back to 0 if not in standings)
        driverMap.forEach((entry) => {
            entry.totalPoints = champPoints.get(entry.driverNumber) ?? 0;
        });

        return Array.from(driverMap.values())
            .filter((d) => d.positions.some((p) => p !== null))
            .sort((a, b) => b.totalPoints - a.totalPoints);
    }, [state, visibleSessions, champPoints]);

    // ─── Render ──────────────────────────────────────────────────────

    if (state.status === "idle" || state.status === "loading") {
        return (
            <div className="flex items-center gap-2 py-6 text-f1-muted text-sm">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                Loading season results…
            </div>
        );
    }

    if (state.status === "error") {
        return <p className="text-red-400 text-sm py-4">Failed to load season grid: {state.message}</p>;
    }

    if (!visibleSessions.length || !driverGrid.length) {
        return <p className="text-f1-muted text-sm">No data available.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table
                className="w-full text-[11px] font-mono border-collapse"
                style={{ minWidth: visibleSessions.length * 36 + 240 }}
            >
                <thead>
                    <tr>
                        <th className="sticky left-0 z-10 bg-f1-card text-left py-2 pr-3 pl-1 text-[10px] font-semibold text-f1-muted uppercase tracking-wider w-[32px]">
                            #
                        </th>
                        <th className="sticky left-8 z-10 bg-f1-card text-left py-2 pr-6 text-[10px] font-semibold text-f1-muted uppercase tracking-wider min-w-[140px]">
                            Driver
                        </th>
                        {visibleSessions.map((r) => (
                            <th
                                key={r.session_key}
                                className="py-2 px-0 text-center text-[10px] font-semibold text-f1-muted uppercase tracking-wider w-[36px]"
                                title={`${r.country_name} — ${new Date(r.date_start).toLocaleDateString()}`}
                            >
                                <span
                                    className="block mx-auto"
                                    style={{
                                        writingMode: "vertical-rl",
                                        transform: "rotate(180deg)",
                                        whiteSpace: "nowrap",
                                        maxHeight: 72,
                                        overflow: "hidden",
                                    }}
                                >
                                    {r.circuit_short_name}
                                </span>
                            </th>
                        ))}
                        <th className="py-2 px-3 text-right text-[10px] font-semibold text-white uppercase tracking-wider min-w-[56px]">
                            Pts
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {driverGrid.map((driver, i) => (
                        <tr
                            key={driver.driverNumber}
                            className="border-t border-f1-border hover:bg-f1-border/20 transition-colors"
                        >
                            <td className="sticky left-0 z-10 bg-f1-card py-2 pr-3 pl-1 text-f1-muted">
                                {i + 1}
                            </td>
                            <td className="sticky left-8 z-10 bg-f1-card py-2 pr-6">
                                <span className="font-bold" style={{ color: driver.color }}>
                                    #{driver.driverNumber} {driver.surname}
                                </span>
                            </td>
                            {driver.positions.map((pos, raceIdx) => (
                                <td
                                    key={raceIdx}
                                    className="py-1 px-0 text-center"
                                    title={
                                        pos === null   ? "Did not participate" :
                                        pos === "DNF"  ? "Did Not Finish" :
                                        pos === "DNS"  ? "Did Not Start" :
                                        pos === "DSQ"  ? "Disqualified" :
                                        `P${pos}`
                                    }
                                >
                                    <span
                                        className="inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-bold"
                                        style={{
                                            backgroundColor: cellBg(pos),
                                            color: cellColor(pos),
                                        }}
                                    >
                                        {cellLabel(pos)}
                                    </span>
                                </td>
                            ))}
                            <td className="py-2 px-3 text-right font-bold text-white">
                                {driver.totalPoints}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
