import type { RaceSelectorState } from "../../hooks/useRaceSelector";

interface Props extends RaceSelectorState {
  /** Page title shown to the left of the dropdowns */
  title: string;
  /** Optional extra controls rendered after the race dropdown */
  children?: React.ReactNode;
}

export default function RaceSelector({
  title,
  years,
  year,
  setYear,
  sessions,
  sessionsLoading,
  sessionKey,
  setSessionKey,
  selectedSession,
  children,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>

      <select
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
        className="bg-f1-card border border-f1-border rounded-lg px-3 py-2 text-sm"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <select
        value={sessionKey ?? ""}
        onChange={(e) =>
          setSessionKey(e.target.value ? Number(e.target.value) : null)
        }
        className="bg-f1-card border border-f1-border rounded-lg px-3 py-2 text-sm min-w-[220px]"
        disabled={sessionsLoading || !sessions?.length}
      >
        <option value="">Select Race…</option>
        {sessions?.map((s) => (
          <option
            key={s.session_key}
            value={s.session_key}
            disabled={s.has_data === false}
            className={s.has_data === false ? "text-gray-500" : ""}
          >
            {s.circuit_short_name} — {s.country_name}
            {s.session_name === "Sprint" ? " (Sprint)" : ""}
            {s.has_data === false ? " (No data)" : ""}
          </option>
        ))}
      </select>

      {selectedSession && (
        <span className="text-f1-muted text-sm">
          {new Date(selectedSession.date_start).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
      )}

      {children}
    </div>
  );
}
