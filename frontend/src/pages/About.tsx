import { ExternalLink, Database, Zap } from 'lucide-react';

export default function About() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 text-3xl font-bold mb-4">
          <span className="bg-f1-red text-white px-3 py-1 rounded text-xl font-black">F1</span>
          <span>Analyzer</span>
        </div>
        <p className="text-f1-muted text-lg">
          Interactive Formula 1 data visualization dashboard
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-f1-card rounded-xl border border-f1-border p-6">
          <div className="flex items-center gap-3 mb-3">
            <Database size={20} className="text-f1-red" />
            <h3 className="font-semibold">Data Source</h3>
          </div>
          <p className="text-sm text-f1-muted">
            Powered by the{' '}
            <a href="https://openf1.org" target="_blank" rel="noreferrer" className="text-f1-red hover:underline">
              OpenF1 API <ExternalLink size={12} className="inline" />
            </a>{' '}
            — free, open-source Formula 1 data including lap times, telemetry,
            tire strategy, weather, and more.
          </p>
        </div>

        <div className="bg-f1-card rounded-xl border border-f1-border p-6">
          <div className="flex items-center gap-3 mb-3">
            <Zap size={20} className="text-f1-red" />
            <h3 className="font-semibold">Tech Stack</h3>
          </div>
          <ul className="text-sm text-f1-muted space-y-1">
            <li>React + TypeScript + Vite</li>
            <li>FastAPI (Python) backend</li>
            <li>WebSocket race replay</li>
            <li>Recharts visualizations</li>
            <li>TailwindCSS styling</li>
          </ul>
        </div>
      </div>

      <div className="bg-f1-card rounded-xl border border-f1-border p-6">
        <h3 className="font-semibold mb-3">Features</h3>
        <ul className="text-sm text-f1-muted space-y-2">
          <li><strong>Race Replay</strong> — Play through any race lap-by-lap with animated charts</li>
          <li><strong>Season Overview</strong> — Browse the race calendar and driver standings</li>
          <li><strong>Driver Analysis</strong> — Deep dive into individual driver performance</li>
          <li><strong>9 Interactive Visualizations</strong> — Position chart, lap times, gap analysis, tire strategy, weather, speed telemetry, sector heatmap, and more</li>
          <li><strong>Cross-filtering</strong> — Select a driver to highlight across all charts</li>
        </ul>
      </div>

      <div className="text-center text-f1-muted text-sm">
        <p>University project — Data Visualization, Semester 4</p>
      </div>
    </div>
  );
}
