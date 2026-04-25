import { useMemo } from 'react';
// Recharts not used here — custom tire visualization
import type { Stint, Driver } from '../../types';

interface Props {
  stints: Stint[];
  drivers: Driver[];
  maxLap: number;
  currentLap: number;
}

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#ef4444',
  MEDIUM: '#eab308',
  HARD: '#f3f4f6',
  INTERMEDIATE: '#22c55e',
  WET: '#3b82f6',
  UNKNOWN: '#6b7280',
};

export default function TireStrategy({ stints, drivers, maxLap, currentLap }: Props) {
  const chartData = useMemo(() => {
    return drivers.map(driver => {
      const driverStints = stints
        .filter(s => s.driver_number === driver.driver_number)
        .sort((a, b) => a.stint_number - b.stint_number);

      const segments = driverStints.map(s => ({
        compound: s.compound || 'UNKNOWN',
        start: s.lap_start,
        end: Math.min(s.lap_end, currentLap),
        length: Math.min(s.lap_end, currentLap) - s.lap_start + 1,
      }));

      return {
        driver: driver.name_acronym,
        driverNumber: driver.driver_number,
        teamColour: driver.team_colour,
        segments,
      };
    }).filter(d => d.segments.length > 0);
  }, [stints, drivers, currentLap]);

  return (
    <div className="bg-f1-card rounded-xl border border-f1-border p-4">
      <h3 className="text-sm font-semibold mb-3 text-f1-muted uppercase tracking-wide">
        Tire Strategy
      </h3>

      {/* Legend */}
      <div className="flex gap-3 mb-3">
        {Object.entries(COMPOUND_COLORS).filter(([k]) => k !== 'UNKNOWN').map(([compound, color]) => (
          <div key={compound} className="flex items-center gap-1 text-xs">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-f1-muted">{compound}</span>
          </div>
        ))}
      </div>

      {/* Strategy visualization */}
      <div className="space-y-1 max-h-[280px] overflow-y-auto">
        {chartData.map(row => (
          <div key={row.driverNumber} className="flex items-center gap-2">
            <span className="text-xs font-mono w-10 text-f1-muted">{row.driver}</span>
            <div className="flex-1 flex h-6 rounded overflow-hidden bg-f1-dark">
              {row.segments.map((seg, i) => (
                <div
                  key={i}
                  className="h-full flex items-center justify-center text-[9px] font-bold"
                  style={{
                    width: `${(seg.length / maxLap) * 100}%`,
                    backgroundColor: COMPOUND_COLORS[seg.compound] || COMPOUND_COLORS.UNKNOWN,
                    color: seg.compound === 'HARD' ? '#111827' : '#ffffff',
                    marginLeft: i === 0 ? `${(seg.start / maxLap) * 100}%` : 0,
                  }}
                >
                  {seg.length > 5 ? seg.compound[0] : ''}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
