import { useMemo } from "react";
import type { Driver } from "../../types";
import type { QualCarData } from "../../lib/api";

interface Props {
    drivers: Driver[];
    carDataMap: Map<number, QualCarData[]>;
    focusDriver: number | null;
    onFocusDriver: (n: number | null) => void;
}

const W = 600, H = 200, PAD = { t: 10, r: 44, b: 30, l: 44 };

export default function EngineChart({ drivers, carDataMap, focusDriver, onFocusDriver }: Props) {
    const series = useMemo(() =>
        [...carDataMap.entries()].map(([num, data]) => {
            const driver = drivers.find((d) => d.driver_number === num);
            return { num, color: `#${driver?.team_colour ?? "888888"}`, name: driver?.name_acronym ?? String(num), data };
        }).filter((s) => s.data.length > 1),
        [carDataMap, drivers]);

    if (!series.length) return <p className="text-f1-muted text-sm">No engine telemetry available.</p>;

    const maxX = Math.max(...series.map((s) => s.data.length - 1), 1);
    const maxRpm = Math.max(...series.flatMap((s) => s.data.map((d) => d.rpm)), 15000);
    const maxGear = 8;

    const scaleX = (x: number) => PAD.l + (x / maxX) * (W - PAD.l - PAD.r);
    const scaleRpm = (v: number) => PAD.t + (1 - v / maxRpm) * (H - PAD.t - PAD.b);
    const scaleGear = (v: number) => PAD.t + (1 - v / maxGear) * (H - PAD.t - PAD.b);

    return (
        <div className="space-y-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
                {[0, 5000, 10000, 15000].filter((v) => v <= maxRpm).map((v) => (
                    <g key={v}>
                        <line x1={PAD.l} x2={W - PAD.r} y1={scaleRpm(v)} y2={scaleRpm(v)} stroke="#333" strokeWidth={0.5} />
                        <text x={PAD.l - 4} y={scaleRpm(v) + 3} fontSize={8} fill="#888" textAnchor="end">{v / 1000}k</text>
                    </g>
                ))}
                {[1, 2, 3, 4, 5, 6, 7, 8].map((g) => (
                    <text key={g} x={W - PAD.r + 4} y={scaleGear(g) + 3} fontSize={8} fill="#60a5fa" textAnchor="start">{g}</text>
                ))}
                <text x={PAD.l - 36} y={H / 2} fontSize={9} fill="#888" textAnchor="middle" transform={`rotate(-90,${PAD.l - 36},${H / 2})`}>RPM</text>
                <text x={W - PAD.r + 36} y={H / 2} fontSize={9} fill="#60a5fa" textAnchor="middle" transform={`rotate(90,${W - PAD.r + 36},${H / 2})`}>Gear</text>
                {series.map((s) => {
                    const muted = focusDriver !== null && focusDriver !== s.num;
                    const rpmPath = s.data.map((d, i) => `${i === 0 ? "M" : "L"}${scaleX(i).toFixed(1)},${scaleRpm(d.rpm).toFixed(1)}`).join(" ");
                    const gearPath = s.data.map((d, i) => {
                        const x = scaleX(i).toFixed(1);
                        const y = scaleGear(d.n_gear).toFixed(1);
                        if (i === 0) return `M${x},${y}`;
                        const prevY = scaleGear(s.data[i - 1].n_gear).toFixed(1);
                        return `L${x},${prevY}L${x},${y}`;
                    }).join(" ");
                    return (
                        <g key={s.num} opacity={muted ? 0.12 : 1} style={{ cursor: "pointer" }} onClick={() => onFocusDriver(focusDriver === s.num ? null : s.num)}>
                            <path d={rpmPath} fill="none" stroke={s.color} strokeWidth={muted ? 0.6 : 1.4} strokeLinejoin="round" />
                            <path d={gearPath} fill="none" stroke="#60a5fa" strokeWidth={muted ? 0.3 : 0.8} strokeDasharray="3,2" />
                        </g>
                    );
                })}
            </svg>
            <div className="flex flex-wrap gap-3">
                {series.map((s) => {
                    const muted = focusDriver !== null && focusDriver !== s.num;
                    const focused = focusDriver === s.num;
                    return (
                        <button key={s.num} onClick={() => onFocusDriver(focused ? null : s.num)} className={`flex items-center gap-1.5 text-[10px] transition-opacity ${muted ? "opacity-30" : ""}`}>
                            <span className="w-3 h-0.5 inline-block rounded" style={{ background: s.color }} />
                            <span style={{ color: s.color }}>{s.name}</span>
                        </button>
                    );
                })}
                <span className="flex items-center gap-1.5 text-[10px] text-f1-muted">
                    <span className="w-3 h-0.5 inline-block rounded bg-blue-400 opacity-60" style={{ borderTop: "1px dashed #60a5fa" }} />
                    Gear
                </span>
            </div>
        </div>
    );
}
