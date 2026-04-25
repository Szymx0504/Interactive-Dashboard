import { useMemo } from 'react';
import type { Lap, Driver } from '../../types';

interface Props {
  laps: Lap[];
  drivers: Driver[];
  highlightDriver: number | null;
}

function getColor(value: number, min: number, max: number): string {
  if (max === min) return '#22c55e';
  const ratio = (value - min) / (max - min);
  // Green (best) → Yellow → Red (worst)
  if (ratio < 0.5) {
    const g = Math.round(200 + 55 * (1 - ratio * 2));
    const r = Math.round(234 * ratio * 2);
    return `rgb(${r}, ${g}, 50)`;
  } else {
    const r = Math.round(200 + 55 * ((ratio - 0.5) * 2));
    const g = Math.round(234 * (1 - (ratio - 0.5) * 2));
    return `rgb(${r}, ${g}, 50)`;
  }
}

export default function SectorHeatmap({ laps, drivers, highlightDriver }: Props) {
  const heatmapData = useMemo(() => {
    return drivers.map(driver => {
      const driverLaps = laps.filter(
        l => l.driver_number === driver.driver_number && l.duration_sector_1 != null
      );
      const bestS1 = driverLaps.length
        ? Math.min(...driverLaps.map(l => l.duration_sector_1!).filter(Boolean))
        : null;
      const bestS2 = driverLaps.length
        ? Math.min(...driverLaps.map(l => l.duration_sector_2!).filter(Boolean))
        : null;
      const bestS3 = driverLaps.length
        ? Math.min(...driverLaps.map(l => l.duration_sector_3!).filter(Boolean))
        : null;

      return {
        driver,
        bestS1,
        bestS2,
        bestS3,
      };
    }).filter(d => d.bestS1 != null);
  }, [laps, drivers]);

  // Global min/max for color scale
  const allS1 = heatmapData.map(d => d.bestS1!).filter(Boolean);
  const allS2 = heatmapData.map(d => d.bestS2!).filter(Boolean);
  const allS3 = heatmapData.map(d => d.bestS3!).filter(Boolean);
  const minS1 = Math.min(...allS1), maxS1 = Math.max(...allS1);
  const minS2 = Math.min(...allS2), maxS2 = Math.max(...allS2);
  const minS3 = Math.min(...allS3), maxS3 = Math.max(...allS3);

  return (
    <div className="bg-f1-card rounded-xl border border-f1-border p-4">
      <h3 className="text-sm font-semibold mb-3 text-f1-muted uppercase tracking-wide">
        Best Sector Times
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-f1-muted text-xs">
              <th className="text-left py-1 px-2">Driver</th>
              <th className="text-right py-1 px-2">S1</th>
              <th className="text-right py-1 px-2">S2</th>
              <th className="text-right py-1 px-2">S3</th>
              <th className="text-right py-1 px-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {heatmapData.map(row => {
              const total = (row.bestS1 ?? 0) + (row.bestS2 ?? 0) + (row.bestS3 ?? 0);
              const isHighlighted = highlightDriver === row.driver.driver_number;
              return (
                <tr
                  key={row.driver.driver_number}
                  className={`transition-opacity ${
                    highlightDriver && !isHighlighted ? 'opacity-30' : ''
                  }`}
                >
                  <td className="py-1 px-2 font-medium">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{ backgroundColor: `#${row.driver.team_colour}` }}
                    />
                    {row.driver.name_acronym}
                  </td>
                  <td
                    className="py-1 px-2 text-right font-mono rounded"
                    style={{ backgroundColor: row.bestS1 ? getColor(row.bestS1, minS1, maxS1) + '30' : undefined }}
                  >
                    {row.bestS1?.toFixed(3)}
                  </td>
                  <td
                    className="py-1 px-2 text-right font-mono rounded"
                    style={{ backgroundColor: row.bestS2 ? getColor(row.bestS2, minS2, maxS2) + '30' : undefined }}
                  >
                    {row.bestS2?.toFixed(3)}
                  </td>
                  <td
                    className="py-1 px-2 text-right font-mono rounded"
                    style={{ backgroundColor: row.bestS3 ? getColor(row.bestS3, minS3, maxS3) + '30' : undefined }}
                  >
                    {row.bestS3?.toFixed(3)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono font-semibold">
                    {total.toFixed(3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
