import { useMemo } from "react";
import type { Driver } from "../../types";
import type { QualLap, QualCarData } from "../../lib/api";
import { bestLapsByDriver } from "../../lib/api";

interface Props {
    drivers: Driver[];
    laps: QualLap[];
    carDataMap: Map<number, QualCarData[]>;
    focusDriver: number | null;
    onFocusDriver: (n: number | null) => void;
}

const W = 600, H = 200, PAD = { t: 10, r: 10, b: 30, l: 44 };

export default function SpeedChart({ drivers, laps, carDataMap, focusDriver, onFocusDriver }: Props) {
    const series = useMemo(() => {
        const bestByDriver = bestLapsByDriver(laps);
        return [...bestByDriver.keys()].map((num) => {
            const data = carDataMap.get(num) ?? [];
            const driver = drivers.find((d) => d.driver_number === num);
            return { num, color: `#${driver?.team_colour ?? "888888"}`, name: driver?.name_acronym ?? String(num), speeds: data.map((d) => d.speed) };
        }).filter((s) => s.speeds.length > 1);
    }, [laps, carDataMap, drivers]);

    if (!series.length) return <p className="text-f1-muted text-sm">No speed telemetry available.</p>;

    const maxX = Math.max(...series.map((s) => s.speeds.length - 1), 1);
    const maxY = Math.max(...series.flatMap((s) => s.speeds), 350);
    const scaleX = (x: number) => PAD.l + (x / maxX) * (W - PAD.l - PAD.r);
    const scaleY = (y: number) => PAD.t + (1 - y / maxY) * (H - PAD.t - PAD.b);
    const toPath = (speeds: number[]) => speeds.map((v, i) => `${i === 0 ? "M" : "L"}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`).join(" ");
    const yTicks = [0, 100, 200, 300].filter((v) => v <= maxY);

    return (
        <div className="space-y-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
                {yTicks.map((v) => (
                    <g key={v}>
                        <line x1={PAD.l} x2={W - PAD.r} y1={scaleY(v)} y2={scaleY(v)} stroke="#333" strokeWidth={0.5} />
                        <text x={PAD.l - 4} y={scaleY(v) + 3} fontSize={8} fill="#888" textAnchor="end">{v}</text>
                    </g>
                ))}
                <text x={PAD.l - 36} y={H / 2} fontSize={9} fill="#888" textAnchor="middle" transform={`rotate(-90,${PAD.l - 36},${H / 2})`}>Speed km/h</text>
                <text x={W / 2} y={H - 4} fontSize={9} fill="#888" textAnchor="middle">Distance (samples)</text>
                {series.map((s) => {
                    const muted = focusDriver !== null && focusDriver !== s.num;
                    return (
                        <path
                            key={s.num}
                            d={toPath(s.speeds)}
                            fill="none"
                            stroke={s.color}
                            strokeWidth={muted ? 0.7 : 1.8}
                            opacity={muted ? 0.15 : 1}
                            strokeLinejoin="round"
                            style={{ cursor: "pointer" }}
                            onClick={() => onFocusDriver(focusDriver === s.num ? null : s.num)}
                        />
                    );
                })}
            </svg>
            <div className="flex flex-wrap gap-3">
                {series.map((s) => {
                    const muted = focusDriver !== null && focusDriver !== s.num;
                    const focused = focusDriver === s.num;
                    return (
                        <button
                            key={s.num}
                            onClick={() => onFocusDriver(focused ? null : s.num)}
                            className={`flex items-center gap-1.5 text-[10px] transition-opacity ${muted ? "opacity-30" : ""}`}
                        >
                            <span className="w-3 h-0.5 inline-block rounded" style={{ background: s.color }} />
                            <span style={{ color: s.color }}>{s.name}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
