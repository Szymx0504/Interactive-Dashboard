import { useEffect, useRef, useState, useMemo } from "react";
import { api } from "../../lib/api";
import type { Driver, Lap, TrackMapData } from "../../types";

interface Props {
    sessionKey: number;
    drivers: Driver[];
    laps: Lap[];
    currentLap: number;
    speed: number;
    highlightDriver: number | null;
}

// ── Types & constants ────────────────────────────────────────────────────────

interface Sample { x: number; y: number; time: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

const W = 500;
const H = 400;
const PAD = 30;

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeBounds(pts: { x: number; y: number }[]): Bounds {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
}

function toCanvas(x: number, y: number, b: Bounds) {
    const rx = b.maxX - b.minX || 1;
    const ry = b.maxY - b.minY || 1;
    const scale = Math.min((W - PAD * 2) / rx, (H - PAD * 2) / ry);
    return {
        px: W / 2 + (x - (b.minX + b.maxX) / 2) * scale,
        py: H / 2 - (y - (b.minY + b.maxY) / 2) * scale,
    };
}

/** Binary-search + linear interpolation between two surrounding samples */
function interpolate(samples: Sample[], time: number): { x: number; y: number } | null {
    const n = samples.length;
    if (!n) return null;
    if (time <= samples[0].time) return samples[0];
    if (time >= samples[n - 1].time) return samples[n - 1];

    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].time <= time) lo = mid;
        else hi = mid;
    }

    const a = samples[lo], b = samples[hi];
    const t = (time - a.time) / (b.time - a.time || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Project a point onto the nearest segment of the track outline polyline */
function snapToTrack(
    pos: { x: number; y: number },
    outline: { x: number; y: number }[],
): { x: number; y: number } {
    let bestD2 = Infinity;
    let best = pos;
    for (let i = 0; i < outline.length - 1; i++) {
        const a = outline[i], b = outline[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        if (len2 === 0) continue;
        const t = Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (pos.y - a.y) * aby) / len2));
        const px = a.x + t * abx, py = a.y + t * aby;
        const dx = pos.x - px, dy = pos.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = { x: px, y: py }; }
    }
    return best;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TrackMap({
    sessionKey,
    drivers,
    laps,
    currentLap,
    speed,
    highlightDriver,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [trackData, setTrackData] = useState<TrackMapData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rafRef = useRef(0);

    // Continuous race time — always advances forward, never resets per lap
    const raceTimeRef = useRef(0);
    const lastTickRef = useRef(0);
    const animRef = useRef({ target: 0, raceDur: 90_000, lapMs: 1000 });

    // ── Fetch once per session ───────────────────────────────────────────────

    useEffect(() => {
        if (!sessionKey) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTrackData(null);

        api.getTrackMap(sessionKey)
            .then((d) => { if (!cancelled) setTrackData(d); })
            .catch((e) => { if (!cancelled) setError(e.message ?? "Failed to load"); })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [sessionKey]);

    // ── Pre-parse all driver sample timestamps (once when data arrives) ──────

    const parsed = useMemo(() => {
        if (!trackData) return new Map<number, Sample[]>();
        const m = new Map<number, Sample[]>();
        for (const [dn, pts] of Object.entries(trackData.drivers)) {
            m.set(
                Number(dn),
                pts.map((p) => ({ x: p.x, y: p.y, time: new Date(p.date).getTime() })),
            );
        }
        return m;
    }, [trackData]);

    const bounds = useMemo(() => {
        if (!trackData?.outline.length) return null;
        return computeBounds(trackData.outline);
    }, [trackData]);

    // ── Pre-build outline Path2D (avoids rebuilding each frame) ──────────────

    const outlinePath = useMemo(() => {
        if (!trackData?.outline.length || !bounds) return null;
        const path = new Path2D();
        let first = true;
        for (const pt of trackData.outline) {
            const { px, py } = toCanvas(pt.x, pt.y, bounds);
            if (first) { path.moveTo(px, py); first = false; }
            else path.lineTo(px, py);
        }
        path.closePath();
        return path;
    }, [trackData, bounds]);

    // ── Compute time range per lap (once when laps data arrives) ─────────────

    const lapRanges = useMemo(() => {
        const starts = new Map<number, number[]>();
        for (const l of laps) {
            const t = new Date(l.date_start).getTime();
            starts.set(l.lap_number, [...(starts.get(l.lap_number) ?? []), t]);
        }
        const nums = [...starts.keys()].sort((a, b) => a - b);
        const ranges = new Map<number, { start: number; end: number }>();
        for (let i = 0; i < nums.length; i++) {
            const s = Math.min(...starts.get(nums[i])!);
            const e = i < nums.length - 1 ? Math.min(...starts.get(nums[i + 1])!) : s + 100_000;
            ranges.set(nums[i], { start: s, end: e });
        }
        return ranges;
    }, [laps]);

    // ── Pre-compute retirement times (detect stationary/crashed drivers) ─────

    const retiredAt = useMemo(() => {
        const map = new Map<number, number>();
        for (const [dn, samples] of parsed) {
            if (samples.length < 10) continue;

            // Find the last sample where the driver was clearly moving
            let lastMovingIdx = 0;
            for (let i = 1; i < samples.length; i++) {
                const dx = samples[i].x - samples[i - 1].x;
                const dy = samples[i].y - samples[i - 1].y;
                if (dx * dx + dy * dy > 2500) lastMovingIdx = i; // > 50m
            }

            // If the static tail is > 3 minutes of real race time → retired
            if (samples.length - lastMovingIdx > 10) {
                const staticMs = samples[samples.length - 1].time - samples[lastMovingIdx].time;
                if (staticMs > 180_000) {
                    map.set(dn, samples[lastMovingIdx].time + 5_000);
                }
            }
        }
        return map;
    }, [parsed]);

    // ── Update animation config (ref only — rAF loop never restarts) ─────────

    useEffect(() => {
        const range = lapRanges.get(currentLap);
        if (!range) return;
        const lapDur = range.end - range.start;

        // Jump only on first load or manual scrub (gap > 5 laps)
        const gap = Math.abs(raceTimeRef.current - range.start);
        if (raceTimeRef.current === 0 || gap > lapDur * 5) {
            raceTimeRef.current = range.start;
            lastTickRef.current = 0;
        }

        animRef.current = {
            target: range.end,
            raceDur: lapDur,
            lapMs: Math.max(50, 1000 / speed),
        };
    }, [currentLap, speed, lapRanges]);

    // ── Persistent rAF loop — never restarts between laps ────────────────────

    useEffect(() => {
        if (!bounds || !outlinePath || !parsed.size || !trackData) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;

        const outline = trackData.outline;
        let running = true;

        function tick(now: number) {
            if (!running) return;

            // Advance race time continuously (never resets between laps)
            const dt = lastTickRef.current ? Math.min(now - lastTickRef.current, 100) : 16;
            lastTickRef.current = now;

            const { target, raceDur, lapMs } = animRef.current;
            if (target > 0) {
                raceTimeRef.current += dt * (raceDur / lapMs);
            }

            const raceTime = raceTimeRef.current;

            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx!.clearRect(0, 0, W, H);

            // Track outline
            ctx!.strokeStyle = "#374151";
            ctx!.lineWidth = 6;
            ctx!.lineCap = "round";
            ctx!.lineJoin = "round";
            ctx!.stroke(outlinePath!);
            ctx!.strokeStyle = "#4b5563";
            ctx!.lineWidth = 2;
            ctx!.stroke(outlinePath!);

            // Drivers
            for (const drv of drivers) {
                const samples = parsed.get(drv.driver_number);
                if (!samples?.length) continue;

                // Hide retired/crashed drivers
                const retire = retiredAt.get(drv.driver_number);
                if (retire && raceTime > retire) continue;
                // Hide if data ended 30+ seconds ago (fallback)
                if (raceTime > samples[samples.length - 1].time + 30_000) continue;

                const raw = interpolate(samples, raceTime);
                if (!raw) continue;

                // Snap to nearest track segment so drivers never appear off-track
                const pos = snapToTrack(raw, outline);

                const { px, py } = toCanvas(pos.x, pos.y, bounds!);
                const col = `#${drv.team_colour || "fff"}`;
                const hl = highlightDriver === drv.driver_number;
                const dim = highlightDriver != null && !hl;
                const r = hl ? 7 : 5;

                ctx!.globalAlpha = dim ? 0.15 : 1;
                ctx!.beginPath();
                ctx!.arc(px, py, r, 0, Math.PI * 2);
                ctx!.fillStyle = col;
                ctx!.fill();

                if (hl) {
                    ctx!.strokeStyle = "#fff";
                    ctx!.lineWidth = 2;
                    ctx!.stroke();
                }

                if (!dim) {
                    ctx!.font = "bold 9px monospace";
                    ctx!.fillStyle = col;
                    ctx!.textAlign = "center";
                    ctx!.fillText(drv.name_acronym, px, py - r - 3);
                }
                ctx!.globalAlpha = 1;
            }

            rafRef.current = requestAnimationFrame(tick);
        }

        rafRef.current = requestAnimationFrame(tick);
        return () => { running = false; cancelAnimationFrame(rafRef.current); };
    }, [bounds, outlinePath, drivers, parsed, highlightDriver, retiredAt, trackData]);

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="bg-f1-card rounded-xl border border-f1-border p-4">
            <h3 className="text-sm font-semibold mb-3 text-f1-muted uppercase tracking-wide">
                Track Map
            </h3>
            {loading ? (
                <div className="flex items-center justify-center text-f1-muted" style={{ height: H }}>
                    <div className="text-center">
                        <div className="inline-block w-6 h-6 border-2 border-f1-border border-t-f1-red rounded-full animate-spin mb-2" />
                        <p className="text-sm">Loading track data...</p>
                    </div>
                </div>
            ) : error ? (
                <div className="flex items-center justify-center text-f1-muted" style={{ height: H }}>
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            ) : !trackData ? (
                <div className="flex items-center justify-center text-f1-muted" style={{ height: H }}>
                    <p className="text-sm">No track data available</p>
                </div>
            ) : (
                <div className="flex justify-center">
                    <canvas
                        ref={canvasRef}
                        style={{ width: W, height: H }}
                        className="rounded-lg"
                    />
                </div>
            )}
        </div>
    );
}
