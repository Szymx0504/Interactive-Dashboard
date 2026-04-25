import { useMemo } from 'react';
import type { Lap, Driver } from '../../types';

interface Props {
  laps: Lap[];
  drivers: Driver[];
  selectedDriver: number | null;
  onSelectDriver: (driverNumber: number | null) => void;
}

export default function DriverStandings({ laps, drivers, selectedDriver, onSelectDriver }: Props) {
  // Build standings from fastest lap per driver
  const standings = useMemo(() => {
    return drivers
      .map(driver => {
        const driverLaps = laps.filter(
          l => l.driver_number === driver.driver_number && l.lap_duration != null && !l.is_pit_out_lap
        );
        const bestLap = driverLaps.length
          ? Math.min(...driverLaps.map(l => l.lap_duration!))
          : null;
        const avgLap = driverLaps.length
          ? driverLaps.reduce((s, l) => s + (l.lap_duration ?? 0), 0) / driverLaps.length
          : null;
        const totalLaps = driverLaps.length;

        return { driver, bestLap, avgLap, totalLaps };
      })
      .sort((a, b) => (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity));
  }, [laps, drivers]);

  return (
    <div className="bg-f1-card rounded-xl border border-f1-border p-4">
      <h3 className="text-sm font-semibold mb-3 text-f1-muted uppercase tracking-wide">
        Driver Standings
      </h3>

      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-f1-card">
            <tr className="text-f1-muted text-xs border-b border-f1-border">
              <th className="text-left py-2 px-2">#</th>
              <th className="text-left py-2 px-2">Driver</th>
              <th className="text-left py-2 px-2">Team</th>
              <th className="text-right py-2 px-2">Best Lap</th>
              <th className="text-right py-2 px-2">Avg Lap</th>
              <th className="text-right py-2 px-2">Laps</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const isSelected = selectedDriver === row.driver.driver_number;
              return (
                <tr
                  key={row.driver.driver_number}
                  onClick={() => onSelectDriver(isSelected ? null : row.driver.driver_number)}
                  className={`cursor-pointer transition-colors border-b border-f1-border/30 ${
                    isSelected
                      ? 'bg-f1-red/10'
                      : 'hover:bg-f1-border/20'
                  } ${
                    selectedDriver && !isSelected ? 'opacity-40' : ''
                  }`}
                >
                  <td className="py-2 px-2 font-semibold">{i + 1}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-full min-h-[20px] rounded-sm"
                        style={{ backgroundColor: `#${row.driver.team_colour}` }}
                      />
                      <div>
                        <span className="font-medium">{row.driver.name_acronym}</span>
                        <span className="text-f1-muted ml-2 text-xs">#{row.driver.driver_number}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-f1-muted text-xs">{row.driver.team_name}</td>
                  <td className="py-2 px-2 text-right font-mono">
                    {row.bestLap ? `${row.bestLap.toFixed(3)}s` : '—'}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-f1-muted">
                    {row.avgLap ? `${row.avgLap.toFixed(3)}s` : '—'}
                  </td>
                  <td className="py-2 px-2 text-right">{row.totalLaps}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
