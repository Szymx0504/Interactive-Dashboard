import { useMemo } from "react";
import type { Driver, SessionResultRow } from "../../types";

interface RaceResultTableProps {
    results: SessionResultRow[];
    drivers: Driver[];
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

function positionPoints(pos: number): number {
    return POINTS_MAP[pos] ?? 0;
}

function getSurname(driver: Driver | undefined): string {
    const name =
        driver?.full_name ?? driver?.broadcast_name ?? driver?.name_acronym;
    if (!name) return "Unknown";
    const parts = name.trim().split(" ");
    return parts[parts.length - 1] || name;
}

/** Normalise classified_status into a display token. */
type ClassifiedStatus = "Finished" | "DNF" | "DNS" | "DSQ";

function resolveStatus(row: SessionResultRow): ClassifiedStatus {
    const raw = ((row as any).classified_status ?? "").toUpperCase();
    if (raw === "DNS") return "DNS";
    if (raw === "DSQ" || raw === "DISQUALIFIED") return "DSQ";
    if (raw === "DNF" || raw === "WDDNF" || raw === "RETIRED") return "DNF";
    // "FINISHED" or blank → treat as a classified finisher
    return "Finished";
}

const STATUS_LABEL: Record<ClassifiedStatus, string> = {
    Finished: "",      // position shown in Pos column
    DNF: "DNF",
    DNS: "DNS",
    DSQ: "DSQ",
};

const STATUS_COLOR: Record<ClassifiedStatus, string> = {
    Finished: "text-white",
    DNF:      "text-red-400",
    DNS:      "text-gray-400",
    DSQ:      "text-purple-400",
};

const STATUS_TITLE: Record<ClassifiedStatus, string> = {
    Finished: "",
    DNF:      "Did Not Finish",
    DNS:      "Did Not Start",
    DSQ:      "Disqualified",
};

export default function RaceResultTable({
    results,
    drivers,
}: RaceResultTableProps) {
    const data = useMemo(() => {
        // Include ALL drivers from the result set regardless of finishing position,
        // but sort classified finishers first (by position), then non-finishers.
        const rows = results
            .filter((r) => r.position !== undefined && r.position !== null)
            .map((row) => {
                const driver = drivers.find(
                    (d) => d.driver_number === row.driver_number,
                );
                const status = resolveStatus(row);
                const finished = status === "Finished";
                return {
                    position:     row.position,
                    driverNumber: row.driver_number,
                    surname:      getSurname(driver),
                    teamName:     driver?.team_name ?? "",
                    color:        `#${driver?.team_colour || "ffffff"}`,
                    points:       finished ? positionPoints(row.position) : 0,
                    status,
                    finished,
                };
            });

        // Classified finishers (P1–P20) sorted by position, then non-finishers
        const finishers    = rows.filter((r) => r.finished).sort((a, b) => a.position - b.position);
        const nonFinishers = rows.filter((r) => !r.finished).sort((a, b) => a.position - b.position);
        return [...finishers, ...nonFinishers];
    }, [results, drivers]);

    if (!data.length)
        return (
            <p className="text-f1-muted text-sm">
                No session result data available.
            </p>
        );

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono border-collapse">
                <thead>
                    <tr>
                        <th className="sticky left-0 z-10 bg-f1-card text-left py-2 pr-3 pl-1 text-[10px] font-semibold text-f1-muted uppercase tracking-wider w-[40px]">
                            #
                        </th>
                        <th className="sticky left-8 z-10 bg-f1-card text-left py-2 pr-4 text-[10px] font-semibold text-f1-muted uppercase tracking-wider min-w-[140px]">
                            Driver
                        </th>
                        <th className="py-2 px-3 text-left text-[10px] font-semibold text-f1-muted uppercase tracking-wider min-w-[160px]">
                            Team
                        </th>
                        <th className="py-2 px-3 text-center text-[10px] font-semibold text-f1-muted uppercase tracking-wider min-w-[56px]">
                            Pos
                        </th>
                        <th className="py-2 px-3 text-right text-[10px] font-semibold text-white uppercase tracking-wider min-w-[56px]">
                            Pts
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, i) => (
                        <tr
                            key={row.driverNumber}
                            className="border-t border-f1-border hover:bg-f1-border/20 transition-colors"
                        >
                            <td className="sticky left-0 z-10 bg-f1-card py-2 pr-3 pl-1 text-f1-muted">
                                {i + 1}
                            </td>
                            <td className="sticky left-8 z-10 bg-f1-card py-2 pr-4">
                                <span
                                    className="font-bold"
                                    style={{ color: row.color }}
                                >
                                    #{row.driverNumber} {row.surname}
                                </span>
                            </td>
                            <td className="py-2 px-3 text-left text-f1-muted">
                                {row.teamName}
                            </td>
                            <td
                                className={`py-2 px-3 text-center font-bold ${STATUS_COLOR[row.status]}`}
                                title={STATUS_TITLE[row.status] || undefined}
                            >
                                {row.finished
                                    ? `P${row.position}`
                                    : STATUS_LABEL[row.status]}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-white">
                                {row.finished ? row.points : "—"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
