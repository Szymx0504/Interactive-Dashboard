import { useEffect } from "react";
import { api } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { useRaceSelector } from "../hooks/useRaceSelector";
import type {
    Driver,
    SessionResultRow,
    DriverChampionshipEntry,
    ConstructorChampionshipEntry,
} from "../types";
import RaceResultTable from "../components/charts/RaceResultTable";
import DriverChampionshipTable from "../components/charts/DriverChampionshipTable";
import ConstructorChampionshipTable from "../components/charts/ConstructorChampionshipTable";
import SeasonGrid from "../components/charts/SeasonGrid";
import PointsProgressionChart from "../components/charts/PointsProgressionChart";
import RaceSelector from "../components/shared/RaceSelector";

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

export default function SeasonOverview() {
    const selector = useRaceSelector("Race");
    const { year, sessionKey: selectedSessionKey, setSessionKey: setSelectedSessionKey, sessions: raceSessions, sessionsLoading } = selector;

    // Auto-select latest past race when sessions load and none is selected
    useEffect(() => {
        if (selectedSessionKey || !raceSessions?.length) return;
        const today = new Date().toISOString();
        const past = raceSessions.filter((s) => s.date_start <= today);
        const target = past.length ? past[past.length - 1] : raceSessions[0];
        setSelectedSessionKey(target.session_key);
    }, [raceSessions, selectedSessionKey, setSelectedSessionKey]);

    const selectedSession = selector.selectedSession;

    const { data: selectedDrivers } = useApi<Driver[]>(
        () =>
            selectedSessionKey
                ? api.getDrivers(selectedSessionKey)
                : Promise.resolve([]),
        [selectedSessionKey],
    );

    const { data: selectedSessionResult } = useApi<SessionResultRow[]>(
        () =>
            selectedSessionKey
                ? api.getSessionResult(selectedSessionKey)
                : Promise.resolve([]),
        [selectedSessionKey],
    );

    const { data: driverChampionship, loading: driverChampionshipLoading } =
        useApi<DriverChampionshipEntry[]>(
            () =>
                selectedSessionKey
                    ? api.getDriverChampionshipByYear(year, selectedSessionKey)
                    : Promise.resolve([]),
            [year, selectedSessionKey],
        );
    const {
        data: constructorChampionship,
        loading: constructorChampionshipLoading,
    } = useApi<ConstructorChampionshipEntry[]>(
        () =>
            selectedSessionKey
                ? api.getConstructorChampionshipByYear(year, selectedSessionKey)
                : Promise.resolve([]),
        [year, selectedSessionKey],
    );

    const uniqueSelectedDrivers = selectedDrivers
        ? selectedDrivers.filter(
              (d, i, arr) =>
                  arr.findIndex((x) => x.driver_number === d.driver_number) ===
                  i,
          )
        : [];

    return (
        <div className="space-y-6">
            <RaceSelector title="Season Overview" {...selector} />

            {sessionsLoading && (
                <p className="text-f1-muted text-sm">Loading sessions…</p>
            )}

            {selectedSessionKey && (
                <div className="space-y-6">
                    {/* Row 1: Race Result & Constructor Championship */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card
                            title={`Race Result — ${selectedSession?.circuit_short_name ?? ""}${selectedSession?.country_name ? ` · ${selectedSession.country_name}` : ""}`}
                        >
                            {selectedSessionResult &&
                            selectedSessionResult.length &&
                            uniqueSelectedDrivers.length ? (
                                <RaceResultTable
                                    results={selectedSessionResult}
                                    drivers={uniqueSelectedDrivers}
                                />
                            ) : (
                                <p className="text-f1-muted text-sm">
                                    Loading…
                                </p>
                            )}
                        </Card>

                        <Card
                            title={`Constructor Championship — ${year} (after ${selectedSession?.circuit_short_name ?? "…"})`}
                        >
                            {constructorChampionshipLoading ? (
                                <p className="text-f1-muted text-sm">
                                    Loading championship points…
                                </p>
                            ) : constructorChampionship?.length ? (
                                <ConstructorChampionshipTable
                                    standings={constructorChampionship}
                                    allDrivers={selectedDrivers ?? []}
                                />
                            ) : (
                                <p className="text-f1-muted text-sm">
                                    No championship data available.
                                </p>
                            )}
                        </Card>
                    </div>

                    {/* Row 2: Driver Championship & Points Progression */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card
                            title={`Driver Championship — ${year} (after ${selectedSession?.circuit_short_name ?? "…"})`}
                        >
                            {driverChampionshipLoading ? (
                                <p className="text-f1-muted text-sm">
                                    Loading championship points…
                                </p>
                            ) : driverChampionship?.length ? (
                                <DriverChampionshipTable
                                    standings={driverChampionship}
                                    allDrivers={selectedDrivers ?? []}
                                />
                            ) : (
                                <p className="text-f1-muted text-sm">
                                    No championship data available.
                                </p>
                            )}
                        </Card>

                        <PointsProgressionChart
                            year={year}
                            selectedSessionKey={selectedSessionKey}
                            selectedSession={selectedSession}
                        />
                    </div>

                    {/* Row 3: Season Results Grid */}
                    <Card
                        title={`Season Results Grid — ${year}`}
                        className="overflow-x-auto"
                    >
                        <SeasonGrid
                            year={year}
                            selectedSessionKey={selectedSessionKey}
                        />
                    </Card>
                </div>
            )}
        </div>
    );
}
