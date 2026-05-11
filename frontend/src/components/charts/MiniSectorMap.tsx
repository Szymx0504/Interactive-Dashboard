import { useMemo } from "react";
import type { Driver } from "../../types";
import type { QualLap } from "../../lib/api";
import { fmt, bestLapsByDriver } from "../../lib/api";

interface Props {
    drivers: Driver[];
    laps: QualLap[];
    focusDriver: number | null;
    onFocusDriver: (n: number | null) => void;
}

export default function MiniSectorMap({ drivers, laps, focusDriver, onFocusDriver }: Props) {
    const sectors = useMemo(() => {
        const bestByDriver = bestLapsByDriver(laps);
        const sectorKeys: (keyof QualLap)[] = ["duration_sector_1", "duration_sector_2", "duration_sector_3"];

        return sectorKeys.map((key, idx) => {
            let bestNum: number | null = null;
            let bestTime = Infinity;
            bestByDriver.forEach((lap, num) => {
                const t = lap[key] as number | null;
                if (t != null && t < bestTime) { bestTime = t; bestNum = num; }
            });
            const driver = drivers.find((d) => d.driver_number === bestNum);
            return {
                label: `S${idx + 1}`,
                driverNumber: bestNum,
                time: bestTime === Infinity ? null : bestTime,
                color: `#${driver?.team_colour ?? "888888"}`,
                name: driver?.name_acronym ?? String(bestNum),
            };
        });
    }, [laps, drivers]);

    if (!sectors.length) return <p className="text-f1-muted text-sm">No sector data.</p>;

    return (
        <div className="space-y-3">
            <div className="flex gap-3 flex-wrap">
                {sectors.map((s) => {
                    const muted = focusDriver !== null && focusDriver !== s.driverNumber;
                    const focused = focusDriver === s.driverNumber;
                    return (
                        <button
                            key={s.label}
                            onClick={() => onFocusDriver(focused ? null : s.driverNumber)}
                            className={`flex-1 min-w-[90px] rounded-lg border p-3 text-left transition-all ${muted ? "opacity-30" : ""} ${focused ? "ring-1 ring-white/30" : "hover:brightness-110"}`}
                            style={{ borderColor: s.color }}
                        >
                            <p className="text-[10px] text-f1-muted uppercase tracking-wider mb-1">{s.label} Best</p>
                            <p className="text-base font-black" style={{ color: s.color }}>{fmt(s.time)}</p>
                            <p className="text-[10px] text-f1-muted mt-1">#{s.driverNumber} {s.name}</p>
                        </button>
                    );
                })}
            </div>
            <p className="text-[10px] text-f1-muted">Click a sector card or table row to focus a driver.</p>
        </div>
    );
}
