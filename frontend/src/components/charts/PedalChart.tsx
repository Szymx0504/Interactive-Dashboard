import { useMemo } from "react";
import type { Driver } from "../../types";
import type { QualCarData } from "../../lib/api";

interface Props {
    drivers: Driver[];
    carDataMap: Map<number, QualCarData[]>;
    focusDriver: number | null;
    onFocusDriver: (n: number | null) => void;
}

const W = 600, H = 180, PAD = { t: 10, r: 10, b: 30, l: 44 };

export default function PedalChart({ drivers, carDataMap, focusDriver, onFocusDriver }: Props) {
    const series = useMemo(() =>
        [...carDataMap.entries()].map(([num, data]) => {
            const driver = drivers.find((d) => d.driver_number === num);
            return { num, color: `#${driver?.team_colour ?? "888888"}`, name: driver?.name_acronym ?? String(num), data };
        }).filter((s) => s.data.length > 1),
        [carDataMap, drivers]);

    if (!series.length) return <p className="text-f1-muted text-sm">No pedal telemetry available.</p>;

    const maxX = Math.max(...series.map((s) => s.data.length - 1), 1);
    const scaleX = (x: number) => PAD.l + (x / maxX) * (W - PAD.l - PAD.r);
    const scaleY = (v: number) => PAD.t + (1 - v / 100) * (H - PAD.t - PAD.b);

    // Use the first series colour for the legend throttle swatch, or a neutral
    // grey, since each driver's throttle line is drawn in their team colour.
    const legendThrottleColor = series[0]?.color ?? "#888888";

    return (
        <div className="space-y-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
                {[0, 50, 100].map((v) => (
                    <g key={v}>
                        <line x1={PAD.l} x2={W - PAD.r} y1={scaleY(v)} y2={scaleY(v)} stroke="#333" strokeWidth={0.5} />
                        <text x={PAD.l - 4} y={scaleY(v) + 3} fontSize={8} fill="#888" textAnchor="end">{v}%</text>
                    </g>
                ))}
                <text x={PAD.l - 36} y={H / 2} fontSize={9} fill="#888" textAnchor="middle" transform={`rotate(-90,${PAD.l - 36},${H / 2})`}>%</text>
                <text x={W / 2} y={H - 4} fontSize={9} fill="#888" textAnchor="middle">Distance (samples)</text>
                {series.map((s) => {
                    const muted = focusDriver !== null && focusDriver !== s.num;
                    const throttlePath = s.data.map((d, i) => `${i === 0 ? "M" : "L"}${scaleX(i).toFixed(1)},${scaleY(d.throttle).toFixed(1)}`).join(" ");
                    const brakePath = s.data.map((d, i) => `${i === 0 ? "M" : "L"}${scaleX(i).toFixed(1)},${scaleY(d.brake ? 100 : 0).toFixed(1)}`).join(" ");
                    return (
                        <g key={s.num} opacity={muted ? 0.12 : 1} style={{ cursor: "pointer" }} onClick={() => onFocusDriver(focusDriver === s.num ? null : s.num)}>
                            {/* Throttle drawn in team colour so drivers stay distinguishable */}
                            <path d={throttlePath} fill="none" stroke={s.color} strokeWidth={muted ? 0.8 : 1.6} strokeLinejoin="round" />
                            <path d={brakePath} fill="none" stroke="#e8002d" strokeWidth={muted ? 0.4 : 1} strokeLinejoin="round" opacity={0.7} />
                        </g>
                    );
                })}
                {/* Legend — throttle swatch shows team colour, not a fixed green */}
                <g>
                    <rect x={PAD.l + 4} y={PAD.t + 4} width={90} height={28} rx={3} fill="#111" fillOpacity={0.8} />
                    <line x1={PAD.l + 8} x2={PAD.l + 22} y1={PAD.t + 12} y2={PAD.t + 12} stroke={legendThrottleColor} strokeWidth={1.5} />
                    <text x={PAD.l + 25} y={PAD.t + 15} fontSize={8} fill="#888">Throttle (team)</text>
                    <line x1={PAD.l + 8} x2={PAD.l + 22} y1={PAD.t + 24} y2={PAD.t + 24} stroke="#e8002d" strokeWidth={1.5} />
                    <text x={PAD.l + 25} y={PAD.t + 27} fontSize={8} fill="#888">Brake</text>
                </g>
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
            </div>
        </div>
    );
}
