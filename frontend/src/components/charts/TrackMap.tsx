import { useEffect, useRef, useState, useMemo } from "react";
import { api } from "../../lib/api";
import type { Driver, Lap, TrackMapData } from "../../types";

interface Props {
    sessionKey: number;
    drivers: Driver[];
    laps: Lap[];
    currentLap: number;
    speed: number;
    isPlaying: boolean;
    highlightDriver: number | null;
}

// ── Types & constants ────────────────────────────────────────────────────────

interface Sample { x: number; y: number; time: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type Pt = { x: number; y: number };

const W = 500;
const H = 400;
const PAD = 30;
const SNAP_PTS = 200; // outline points used for snap (perf)

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeBounds(pts: Pt[]): Bounds {
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
function interpolate(samples: Sample[], time: number): Pt | null {
    const n = samples.length;
    if (!n) return null;
    if (time <= samples[0].time) return samples[0];
    if (time >= samples[n - 1].time) return samples[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].time <= time) lo = mid; else hi = mid;
    }
    const a = samples[lo], b = samples[hi];
    const t = (time - a.time) / (b.time - a.time || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Project a point onto the nearest segment of a polyline (incl. closing seg) */
function snapToTrack(pos: Pt, segs: Pt[]): Pt {
    let bestD2 = Infinity, best = pos;
    const len = segs.length;
    for (let i = 0; i < len; i++) {
        const a = segs[i], b = segs[(i + 1) % len];
        const abx = b.x - a.x, aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        if (len2 < 1) continue;
        const t = Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (pos.y - a.y) * aby) / len2));
        const px = a.x + t * abx, py = a.y + t * aby;
        const dx = pos.x - px, dy = pos.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = { x: px, y: py }; }
    }
    return best;
}

/** Downsample an array to ~target points, keeping first & last */
function downsample(arr: Pt[], target: number): Pt[] {
    if (arr.length <= target) return arr;
    const step = (arr.length - 1) / (target - 1);
    const out: Pt[] = [];
    for (let i = 0; i < target; i++) out.push(arr[Math.round(i * step)]);
    return out;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TrackMap({
    sessionKey,
    drivers,
    laps,
    currentLap,
    speed,
    isPlaying,
    highlightDriver,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [trackData, setTrackData] = useState<TrackMapData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rafRef = useRef(0);

    // Accumulation-based timing
    const raceTimeRef = useRef(0);
    const lastTickRef = useRef(0);
    const rateRef = useRef(0); // race-ms per wall-ms

    // ── Fetch once per session ───────────────────────────────────────────────

    useEffect(() => {
        if (!sessionKey) return;
        let cancelled = false;
        setLoading(true); setError(null); setTrackData(null);
        api.getTrackMap(sessionKey)
            .then((d) => { if (!cancelled) setTrackData(d); })
            .catch((e) => { if (!cancelled) setError(e.message ?? "Failed to load"); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [sessionKey]);

    // ── Memos ─────────────────────────────────────────────────────────────────

    const parsed = useMemo(() => {
        if (!trackData) return new Map<number, Sample[]>();
        const m = new Map<number, Sample[]>();
        for (const [dn, pts] of Object.entries(trackData.drivers))
            m.set(Number(dn), pts.map((p) => ({ x: p.x, y: p.y, time: new Date(p.date).getTime() })));
        return m;
    }, [trackData]);

    const bounds = useMemo(() => {
        const allPts: Pt[] = [];
        if (trackData?.outline.length) allPts.push(...trackData.outline);
        // Include a few driver samples so bounds work even without outline
        for (const samples of parsed.values()) {
            if (samples.length) {
                allPts.push(samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]);
            }
        }
        if (!allPts.length) return null;
        return computeBounds(allPts);
    }, [trackData, parsed]);

    const outlinePath = useMemo(() => {
        if (!trackData?.outline.length || !bounds) return null;
        const path = new Path2D();
        let first = true;
        for (const pt of trackData.outline) {
            const { px, py } = toCanvas(pt.x, pt.y, bounds);
            if (first) { path.moveTo(px, py); first = false; } else path.lineTo(px, py);
        }
        path.closePath();
        return path;
    }, [trackData, bounds]);

    // Downsampled outline for snap lookups (200 pts vs 2000 → 10× cheaper)
    const snapOutline = useMemo(() => {
        if (!trackData?.outline.length) return [];
        return downsample(trackData.outline, SNAP_PTS);
    }, [trackData]);

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

    // Average lap duration (for speed → race-time conversion)
    const avgLapDur = useMemo(() => {
        if (!lapRanges.size) return 90_000;
        let sum = 0;
        for (const r of lapRanges.values()) sum += r.end - r.start;
        return sum / lapRanges.size;
    }, [lapRanges]);

    const retiredAt = useMemo(() => {
        const map = new Map<number, number>();
        for (const [dn, samples] of parsed) {
            if (samples.length < 10) continue;
            let lastMovingIdx = 0;
            for (let i = 1; i < samples.length; i++) {
                const dx = samples[i].x - samples[i - 1].x;
                const dy = samples[i].y - samples[i - 1].y;
                if (dx * dx + dy * dy > 2500) lastMovingIdx = i;
            }
            if (samples.length - lastMovingIdx > 10) {
                const staticMs = samples[samples.length - 1].time - samples[lastMovingIdx].time;
                if (staticMs > 180_000) map.set(dn, samples[lastMovingIdx].time + 5_000);
            }
        }
        return map;
    }, [parsed]);

    // ── Sync race time when currentLap / speed / playing changes ────────────

    useEffect(() => {
        const range = lapRanges.get(currentLap);
        if (!range) return;

        // Rate: 0 when paused → freezes in place
        rateRef.current = isPlaying ? avgLapDur * speed / 1000 : 0;

        // Jump only on first load or slider scrub (gap > 2 laps)
        const gap = Math.abs(raceTimeRef.current - range.start);
        if (raceTimeRef.current === 0 || gap > avgLapDur * 2) {
            raceTimeRef.current = range.start;
            lastTickRef.current = 0;
        }
    }, [currentLap, speed, isPlaying, lapRanges, avgLapDur]);

    // ── Persistent rAF loop ──────────────────────────────────────────────────

    useEffect(() => {
        if (!bounds || !parsed.size) return;
        const hasSnap = snapOutline.length > 0;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;

        const snap = snapOutline; // captured for closure
        let running = true;

        function tick(now: number) {
            if (!running) return;

            // Advance race time (rate=0 when paused → no advancement)
            const dt = lastTickRef.current ? Math.min(now - lastTickRef.current, 50) : 16;
            lastTickRef.current = now;
            raceTimeRef.current += dt * rateRef.current;
            const raceTime = raceTimeRef.current;

            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx!.clearRect(0, 0, W, H);

            // Track outline (if available)
            if (outlinePath) {
                ctx!.strokeStyle = "#374151";
                ctx!.lineWidth = 6;
                ctx!.lineCap = "round";
                ctx!.lineJoin = "round";
                ctx!.stroke(outlinePath);
                ctx!.strokeStyle = "#4b5563";
                ctx!.lineWidth = 2;
                ctx!.stroke(outlinePath);
            }

            // Drivers
            for (const drv of drivers) {
                const samples = parsed.get(drv.driver_number);
                if (!samples?.length) continue;

                const retire = retiredAt.get(drv.driver_number);
                if (retire && raceTime > retire) continue;
                if (raceTime > samples[samples.length - 1].time + 30_000) continue;

                const raw = interpolate(samples, raceTime);
                if (!raw) continue;

                // Snap to track if outline available, otherwise use raw position
                const pos = hasSnap ? snapToTrack(raw, snap) : raw;

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

                if (hl) { ctx!.strokeStyle = "#fff"; ctx!.lineWidth = 2; ctx!.stroke(); }
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
    }, [bounds, outlinePath, drivers, parsed, highlightDriver, retiredAt, snapOutline]);

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
