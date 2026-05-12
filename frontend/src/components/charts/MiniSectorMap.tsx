import { useMemo, useEffect, useState } from "react";
import type { Driver, TrackMapData } from "../../types";
import type { QualLap, QualCarData } from "../../lib/api";
import { api, fmt, bestLapsByDriver } from "../../lib/api";

/* ── Constants ──────────────────────────────────────────────────────── */

const NUM_MINI = 25;
const W = 500;
const H = 400;
const PAD = 30;
const TRACK_STROKE = 6;

/* ── Helpers ────────────────────────────────────────────────────────── */

function computeDistances(data: QualCarData[]): number[] {
    if (!data.length) return [];
    const d = [0];
    for (let i = 1; i < data.length; i++) {
        const dt = Math.max(
            (new Date(data[i].date).getTime() -
                new Date(data[i - 1].date).getTime()) /
                1000,
            0,
        );
        d.push(d[i - 1] + ((data[i - 1].speed + data[i].speed) / 2 / 3.6) * dt);
    }
    return d;
}

function arcLengths(pts: { x: number; y: number }[]): number[] {
    const d = [0];
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        d.push(d[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    return d;
}

type Pt = { x: number; y: number };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function computeBounds(pts: Pt[]): Bounds {
    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
}

function toCanvas(x: number, y: number, b: Bounds): { px: number; py: number } {
    const rx = b.maxX - b.minX || 1;
    const ry = b.maxY - b.minY || 1;
    const scale = Math.min((W - PAD * 2) / rx, (H - PAD * 2) / ry);
    return {
        px: W / 2 + (x - (b.minX + b.maxX) / 2) * scale,
        py: H / 2 - (y - (b.minY + b.maxY) / 2) * scale,
    };
}

/** Interpolate time at a given distance along a driver's telemetry */
function timeAtDistance(
    distances: number[],
    data: QualCarData[],
    targetDist: number,
): number | null {
    if (!distances.length) return null;
    if (targetDist <= distances[0]) return new Date(data[0].date).getTime();
    if (targetDist >= distances[distances.length - 1])
        return new Date(data[data.length - 1].date).getTime();
    let lo = 0,
        hi = distances.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (distances[mid] <= targetDist) lo = mid;
        else hi = mid;
    }
    const frac =
        (targetDist - distances[lo]) / (distances[hi] - distances[lo] || 1);
    const tLo = new Date(data[lo].date).getTime();
    const tHi = new Date(data[hi].date).getTime();
    return tLo + (tHi - tLo) * frac;
}

/* ── Props ──────────────────────────────────────────────────────────── */

interface Props {
    drivers: Driver[];
    laps: QualLap[];
    carDataMap: Map<number, QualCarData[]>;
    sessionKey: number;
    focusDriver: number | null;
    onFocusDriver: (n: number | null) => void;
}

/* ── Component ──────────────────────────────────────────────────────── */

export default function MiniSectorMap({
    drivers,
    laps,
    carDataMap,
    sessionKey,
    focusDriver,
    onFocusDriver,
}: Props) {
    /* ── 3 main sectors ─────────────────────────────────────────────── */

    const sectors = useMemo(() => {
        const bestByDriver = bestLapsByDriver(laps);
        const sectorKeys: (keyof QualLap)[] = [
            "duration_sector_1",
            "duration_sector_2",
            "duration_sector_3",
        ];
        return sectorKeys.map((key, idx) => {
            let bestNum: number | null = null;
            let bestTime = Infinity;
            bestByDriver.forEach((lap, num) => {
                const t = lap[key] as number | null;
                if (t != null && t < bestTime) {
                    bestTime = t;
                    bestNum = num;
                }
            });
            const driver = drivers.find((d) => d.driver_number === bestNum);
            return {
                label: `S${idx + 1}`,
                driverNumber: bestNum,
                time: bestTime === Infinity ? null : bestTime,
                color: `#${driver?.team_colour ?? "888888"}`,
                name: driver?.name_acronym ?? String(bestNum),
                fullName: driver
                    ? `${driver.first_name} ${driver.last_name}`
                    : String(bestNum),
            };
        });
    }, [laps, drivers]);

    /* ── Fetch track outline ────────────────────────────────────────── */

    const [trackData, setTrackData] = useState<TrackMapData | null>(null);
    useEffect(() => {
        if (!sessionKey) return;
        let cancelled = false;
        api.getTrackMap(sessionKey)
            .then((d) => {
                if (!cancelled) setTrackData(d);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [sessionKey]);

    /* ── Minisector analysis from telemetry ──────────────────────────── */

    const miniSectorData = useMemo(() => {
        if (!carDataMap.size) return null;

        // Build per-driver distance arrays + find max total distance
        const driverData: {
            num: number;
            data: QualCarData[];
            distances: number[];
            totalDist: number;
        }[] = [];
        let maxDist = 0;
        carDataMap.forEach((data, num) => {
            const distances = computeDistances(data);
            const totalDist = distances[distances.length - 1] ?? 0;
            if (totalDist > 0) {
                driverData.push({ num, data, distances, totalDist });
                if (totalDist > maxDist) maxDist = totalDist;
            }
        });
        if (!driverData.length || maxDist <= 0) return null;

        // Create minisector boundaries
        const boundaries: number[] = [];
        for (let i = 0; i <= NUM_MINI; i++)
            boundaries.push((i / NUM_MINI) * maxDist);

        // For each minisector, find fastest driver
        const results: {
            idx: number;
            bestNum: number | null;
            bestTime: number | null;
            color: string;
            name: string;
        }[] = [];

        for (let i = 0; i < NUM_MINI; i++) {
            const dStart = boundaries[i];
            const dEnd = boundaries[i + 1];
            let bestNum: number | null = null;
            let bestTime = Infinity;

            for (const dd of driverData) {
                if (dd.totalDist < dEnd * 0.9) continue; // skip if driver didn't cover this sector
                const tStart = timeAtDistance(dd.distances, dd.data, dStart);
                const tEnd = timeAtDistance(dd.distances, dd.data, dEnd);
                if (tStart != null && tEnd != null) {
                    const elapsed = tEnd - tStart;
                    if (elapsed > 0 && elapsed < bestTime) {
                        bestTime = elapsed;
                        bestNum = dd.num;
                    }
                }
            }

            const driver = drivers.find((d) => d.driver_number === bestNum);
            results.push({
                idx: i,
                bestNum,
                bestTime: bestTime === Infinity ? null : bestTime,
                color: `#${driver?.team_colour ?? "888888"}`,
                name: driver?.name_acronym ?? "",
            });
        }

        return { results, maxDist };
    }, [carDataMap, drivers]);

    /* ── Track outline split into minisector segments for SVG ────────── */

    const trackSegments = useMemo(() => {
        if (!trackData?.outline.length || !miniSectorData) return null;

        const outline = trackData.outline;
        const bounds = computeBounds(outline);
        const arcs = arcLengths(outline);
        const totalArc = arcs[arcs.length - 1];

        // Convert outline to canvas coords
        const canvasPts = outline.map((p) => toCanvas(p.x, p.y, bounds));

        // Split outline into NUM_MINI segments
        const segments: {
            points: { px: number; py: number }[];
            color: string;
        }[] = [];

        for (let i = 0; i < NUM_MINI; i++) {
            const arcStart = (i / NUM_MINI) * totalArc;
            const arcEnd = ((i + 1) / NUM_MINI) * totalArc;
            const color = miniSectorData.results[i]?.color ?? "#333";

            const segPts: { px: number; py: number }[] = [];

            for (let j = 0; j < outline.length; j++) {
                if (arcs[j] >= arcStart && arcs[j] <= arcEnd) {
                    segPts.push(canvasPts[j]);
                }
            }

            // Interpolate start point if needed
            if (
                segPts.length === 0 ||
                (segPts.length > 0 && arcs[0] > arcStart)
            ) {
                // Find surrounding points for arcStart
                for (let j = 1; j < arcs.length; j++) {
                    if (arcs[j] >= arcStart) {
                        const frac =
                            (arcStart - arcs[j - 1]) /
                            (arcs[j] - arcs[j - 1] || 1);
                        segPts.unshift({
                            px:
                                canvasPts[j - 1].px +
                                (canvasPts[j].px - canvasPts[j - 1].px) * frac,
                            py:
                                canvasPts[j - 1].py +
                                (canvasPts[j].py - canvasPts[j - 1].py) * frac,
                        });
                        break;
                    }
                }
            }

            segments.push({ points: segPts, color });
        }

        return { segments, bounds };
    }, [trackData, miniSectorData]);

    /* ── Render ──────────────────────────────────────────────────────── */

    if (!sectors.length)
        return <p className="text-f1-muted text-sm">No sector data.</p>;

    return (
        <div className="space-y-4">
            {/* Track map with minisector coloring */}
            {trackSegments && (
                <div className="flex justify-center">
                    <svg
                        viewBox={`0 0 ${W} ${H}`}
                        style={{ width: "100%", maxWidth: 500 }}
                        preserveAspectRatio="xMidYMid meet"
                    >
                        {/* Dark track background (thicker) */}
                        {trackData?.outline &&
                            (() => {
                                const bounds = computeBounds(trackData.outline);
                                const pts = trackData.outline.map((p) =>
                                    toCanvas(p.x, p.y, bounds),
                                );
                                const d =
                                    pts
                                        .map(
                                            (p, i) =>
                                                `${i === 0 ? "M" : "L"}${p.px.toFixed(1)},${p.py.toFixed(1)}`,
                                        )
                                        .join(" ") + " Z";
                                return (
                                    <path
                                        d={d}
                                        fill="none"
                                        stroke="#1a1a2e"
                                        strokeWidth={TRACK_STROKE + 4}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                );
                            })()}

                        {/* Colored minisector segments */}
                        {trackSegments.segments.map((seg, i) => {
                            if (seg.points.length < 2) return null;
                            const d = seg.points
                                .map(
                                    (p, j) =>
                                        `${j === 0 ? "M" : "L"}${p.px.toFixed(1)},${p.py.toFixed(1)}`,
                                )
                                .join(" ");
                            return (
                                <path
                                    key={i}
                                    d={d}
                                    fill="none"
                                    stroke={seg.color}
                                    strokeWidth={TRACK_STROKE}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            );
                        })}

                        {/* Sector boundary labels (S1, S2, S3) */}
                        {trackData?.outline &&
                            (() => {
                                const outline = trackData.outline;
                                const bounds = computeBounds(outline);
                                const arcs = arcLengths(outline);
                                const totalArc = arcs[arcs.length - 1];
                                const canvasPts = outline.map((p) =>
                                    toCanvas(p.x, p.y, bounds),
                                );

                                return [0, 1, 2].map((sIdx) => {
                                    // Label at the midpoint of each third
                                    const midArc =
                                        ((sIdx + 0.5) / 3) * totalArc;
                                    let labelPt = canvasPts[0];
                                    for (let j = 1; j < arcs.length; j++) {
                                        if (arcs[j] >= midArc) {
                                            const frac =
                                                (midArc - arcs[j - 1]) /
                                                (arcs[j] - arcs[j - 1] || 1);
                                            labelPt = {
                                                px:
                                                    canvasPts[j - 1].px +
                                                    (canvasPts[j].px -
                                                        canvasPts[j - 1].px) *
                                                        frac,
                                                py:
                                                    canvasPts[j - 1].py +
                                                    (canvasPts[j].py -
                                                        canvasPts[j - 1].py) *
                                                        frac,
                                            };
                                            break;
                                        }
                                    }
                                    return (
                                        <text
                                            key={sIdx}
                                            x={labelPt.px}
                                            y={labelPt.py - 14}
                                            fontSize={11}
                                            fill="#9ca3af"
                                            textAnchor="middle"
                                            fontWeight="bold"
                                        >
                                            SEC {sIdx + 1}
                                        </text>
                                    );
                                });
                            })()}
                    </svg>
                </div>
            )}

            {/* 3 main sector cards */}
            <div className="flex gap-3 flex-wrap">
                {sectors.map((s) => {
                    const muted =
                        focusDriver !== null && focusDriver !== s.driverNumber;
                    const focused = focusDriver === s.driverNumber;
                    return (
                        <button
                            key={s.label}
                            onClick={() =>
                                onFocusDriver(focused ? null : s.driverNumber)
                            }
                            className={`flex-1 min-w-[90px] rounded-lg border p-3 text-left transition-all ${muted ? "opacity-30" : ""} ${focused ? "ring-1 ring-white/30" : "hover:brightness-110"}`}
                            style={{ borderColor: s.color }}
                        >
                            <p className="text-[10px] text-f1-muted uppercase tracking-wider mb-1">
                                {s.label} Best
                            </p>
                            <p
                                className="text-base font-black"
                                style={{ color: s.color }}
                            >
                                {fmt(s.time)}
                            </p>
                            <p className="text-[10px] text-f1-muted mt-1">
                                #{s.driverNumber} {s.name}
                            </p>
                        </button>
                    );
                })}
            </div>

            {/* Minisector table */}
            {miniSectorData && (
                <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                        <thead>
                            <tr className="border-b border-f1-border text-f1-muted uppercase tracking-wider">
                                <th className="py-1 text-left font-medium">
                                    Sector
                                </th>
                                <th className="py-1 text-left font-medium">
                                    Driver
                                </th>
                                <th className="py-1 text-right font-medium">
                                    Time
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {miniSectorData.results.map((ms) => {
                                const muted =
                                    focusDriver !== null &&
                                    focusDriver !== ms.bestNum;
                                return (
                                    <tr
                                        key={ms.idx}
                                        className={`border-b border-f1-border/30 cursor-pointer hover:bg-white/5 transition-all ${muted ? "opacity-30" : ""}`}
                                        onClick={() =>
                                            onFocusDriver(
                                                focusDriver === ms.bestNum
                                                    ? null
                                                    : ms.bestNum,
                                            )
                                        }
                                    >
                                        <td className="py-1">
                                            <span
                                                className="inline-block w-3 h-2 rounded-sm mr-1.5"
                                                style={{
                                                    backgroundColor: ms.color,
                                                }}
                                            />
                                            {ms.idx + 1}
                                        </td>
                                        <td
                                            className="py-1 font-bold"
                                            style={{ color: ms.color }}
                                        >
                                            {ms.name}
                                        </td>
                                        <td className="py-1 text-right font-mono">
                                            {ms.bestTime != null
                                                ? `${(ms.bestTime / 1000).toFixed(3)}s`
                                                : "–"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="text-[10px] text-f1-muted">
                Track colored by fastest driver per minisector ({NUM_MINI}{" "}
                segments). Click a sector card or table row to focus.
            </p>
        </div>
    );
}
