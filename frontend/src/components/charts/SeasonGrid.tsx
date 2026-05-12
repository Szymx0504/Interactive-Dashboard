import { useEffect, useMemo, useReducer, useRef } from "react";

interface Session {
  session_key: number;
  session_name: string;
  session_type: string; // "Race" | "Sprint"
  country_name: string;
  circuit_short_name: string;
  date_start: string;
  year: number;
}

interface RaceResult {
  driver_number: number;
  position: number;
  classified_position?: string | number; // "1"–"20", "DNF", "DNS", "DSQ", "NC", "EX", etc.
  full_name?: string;
  name_acronym?: string;
  team_name?: string;
  team_colour?: string;
}

// null  → driver didn't participate at all that weekend (blank cell)
// "DNF" | "DNS" | "DSQ" | "NC" → participated but didn't finish / was excluded
// number → classified finishing position
type RaceSlot = number | "DNF" | "DNS" | "DSQ" | "NC" | null;

interface GridEntry {
  driverNumber: number;
  surname: string;
  acronym: string;
  teamName: string;
  color: string;
  slots: RaceSlot[];
  totalPoints: number;
}

interface SeasonGridProps {
  year: number;
  selectedSessionKey: number;
  apiBase?: string;
  /** driver_number → championship points (from driver championship endpoint).
   *  If provided these replace the locally-calculated points totals. */
  championshipPoints?: Record<number, number>;
}

const POINTS_MAP: Record<number, number> = {
  1: 25,
  2: 18,
  3: 15,
  4: 12,
  5: 10,
  6: 8,
  7: 6,
  8: 4,
  9: 2,
  10: 1,
};
const SPRINT_POINTS_MAP: Record<number, number> = {
  1: 8,
  2: 7,
  3: 6,
  4: 5,
  5: 4,
  6: 3,
  7: 2,
  8: 1,
};
const pts = (slot: RaceSlot, isSprint = false): number => {
  if (typeof slot !== "number") return 0;
  const map = isSprint ? SPRINT_POINTS_MAP : POINTS_MAP;
  return map[slot] ?? 0;
};

const MEDAL: Record<number, string> = {
  1: "#ffd700",
  2: "#c0c0c0",
  3: "#cd7f32",
};

/** Parse API data into a typed RaceSlot. */
function parseSlot(r: RaceResult): RaceSlot {
  // Prefer classified_position when present
  if (
    r.classified_position !== undefined &&
    r.classified_position !== null &&
    r.classified_position !== ""
  ) {
    const cpStr = String(r.classified_position).toUpperCase().trim();
    const num = Number(cpStr);
    if (!isNaN(num) && num >= 1 && num <= 20) return num;
    // Normalise known retirement codes
    if (cpStr === "DNF" || cpStr === "RET" || cpStr === "RETIRED") return "DNF";
    if (cpStr === "DNS" || cpStr === "WD") return "DNS";
    if (cpStr === "DSQ" || cpStr === "DQ" || cpStr === "EX") return "DSQ";
    if (cpStr === "NC") return "NC";
  }
  // Fall back to numeric position field
  if (r.position >= 1 && r.position <= 20) return r.position;
  // Driver is in the results list but couldn't be classified → DNF
  return "DNF";
}

function cellBg(slot: RaceSlot): string {
  if (slot === null) return "transparent";
  if (typeof slot === "number") {
    if (slot === 1) return "rgba(255,215,0,0.15)";
    if (slot === 2) return "rgba(192,192,192,0.12)";
    if (slot === 3) return "rgba(205,127,50,0.12)";
    if (slot <= 10) return "rgba(34,197,94,0.08)";
    return "rgba(255,255,255,0.03)";
  }
  // Status codes
  if (slot === "DSQ") return "rgba(239,68,68,0.12)";
  return "rgba(255,255,255,0.04)"; // DNF / DNS / NC
}

function cellColor(slot: RaceSlot): string {
  if (slot === null) return "transparent";
  if (typeof slot === "number") {
    if (slot <= 3) return MEDAL[slot];
    if (slot <= 10) return "#86efac";
    return "#6b7280";
  }
  if (slot === "DSQ") return "#f87171";
  return "#6b7280"; // DNF / DNS / NC
}

function cellLabel(slot: RaceSlot): string {
  if (slot === null) return "";
  if (typeof slot === "number") return String(slot);
  return slot; // "DNF", "DNS", "DSQ", "NC"
}

function cellTitle(slot: RaceSlot): string {
  if (slot === null) return "Did not participate";
  if (typeof slot === "number") return `P${slot} — ${pts(slot)} pts`;
  const labels: Record<string, string> = {
    DNF: "Did Not Finish",
    DNS: "Did Not Start",
    DSQ: "Disqualified",
    NC: "Not Classified",
  };
  return labels[slot] ?? slot;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "done";
      sessions: Session[];
      results: Record<string, RaceResult[]>;
    }
  | { status: "error"; message: string };

type Action =
  | { type: "fetch_start" }
  | { type: "data"; sessions: Session[]; results: Record<string, RaceResult[]> }
  | { type: "error"; message: string };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case "fetch_start":
      return { status: "loading" };
    case "data":
      return {
        status: "done",
        sessions: action.sessions,
        results: action.results,
      };
    case "error":
      return { status: "error", message: action.message };
    default:
      return _state;
  }
}

function getSurname(fullName?: string): string | null {
  if (!fullName) return null;
  const parts = fullName.trim().split(" ");
  return parts[parts.length - 1] || null;
}

export default function SeasonGrid({
  year,
  selectedSessionKey,
  apiBase = "/api",
  championshipPoints,
}: SeasonGridProps) {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!year) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: "fetch_start" });

    fetch(`${apiBase}/season/${year}/results`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (ctrl.signal.aborted) return;
        dispatch({
          type: "data",
          sessions: json.sessions ?? [],
          results: json.results ?? {},
        });
      })
      .catch((err) => {
        if (err.name !== "AbortError")
          dispatch({ type: "error", message: err.message });
      });

    return () => ctrl.abort();
  }, [year, apiBase]);

  const visibleSessions = useMemo(() => {
    if (state.status !== "done") return [];
    const idx = state.sessions.findIndex(
      (s) => s.session_key === selectedSessionKey,
    );
    return idx >= 0 ? state.sessions.slice(0, idx + 1) : state.sessions;
  }, [state, selectedSessionKey]);

  const driverGrid = useMemo((): GridEntry[] => {
    if (state.status !== "done") return [];

    const driverMap = new Map<number, GridEntry>();

    visibleSessions.forEach((session, raceIdx) => {
      const results: RaceResult[] =
        state.results[String(session.session_key)] ?? [];
      results.forEach((r) => {
        if (!driverMap.has(r.driver_number)) {
          driverMap.set(r.driver_number, {
            driverNumber: r.driver_number,
            surname:
              getSurname(r.full_name) ??
              r.name_acronym ??
              String(r.driver_number),
            acronym: r.name_acronym ?? String(r.driver_number),
            teamName: r.team_name ?? "",
            color: `#${r.team_colour || "ffffff"}`,
            // All slots start as null (= didn't participate / blank)
            slots: Array(visibleSessions.length).fill(null),
            totalPoints: 0,
          });
        }
        const entry = driverMap.get(r.driver_number)!;
        const slot = parseSlot(r);
        entry.slots[raceIdx] = slot;
        const isSprint = session.session_type === "Sprint";
        entry.totalPoints += pts(slot, isSprint);
        if (r.team_colour) entry.color = `#${r.team_colour}`;
        if (r.team_name) entry.teamName = r.team_name;
        if (r.full_name)
          entry.surname = getSurname(r.full_name) ?? entry.surname;
        if (r.name_acronym) entry.acronym = r.name_acronym;
      });
    });

    const drivers = Array.from(driverMap.values()).filter((d) =>
      d.slots.some((s) => s !== null),
    );

    // Apply official championship points when provided by the parent,
    // otherwise keep the locally-calculated totals (position points only).
    if (championshipPoints) {
      drivers.forEach((d) => {
        d.totalPoints = championshipPoints[d.driverNumber] ?? d.totalPoints;
      });
    }

    return drivers.sort((a, b) => b.totalPoints - a.totalPoints);
  }, [state, visibleSessions, championshipPoints]);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="flex items-center gap-2 py-6 text-f1-muted text-sm">
        <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
        Loading season results…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p className="text-red-400 text-sm py-4">
        Failed to load season grid: {state.message}
      </p>
    );
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
                  {r.session_type === "Sprint" ? `${r.circuit_short_name} SPR` : r.circuit_short_name}
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
              {driver.slots.map((slot, raceIdx) => (
                <td
                  key={raceIdx}
                  className="py-1 px-0 text-center"
                  title={cellTitle(slot)}
                >
                  <span
                    className="inline-flex items-center justify-center w-7 h-6 rounded font-bold"
                    style={{
                      backgroundColor: cellBg(slot),
                      color: cellColor(slot),
                      // Status codes need smaller text to fit
                      fontSize: typeof slot === "string" ? "8px" : "10px",
                    }}
                  >
                    {cellLabel(slot)}
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
