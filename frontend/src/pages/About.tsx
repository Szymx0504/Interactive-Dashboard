import {
    ExternalLink,
    Database,
    Zap,
    Users,
    ListFilter,
    ArrowUpRight,
} from "lucide-react";

export default function About() {
    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center">
                <div className="inline-flex items-center gap-2 text-3xl font-bold mb-4">
                    <a
                        href="https://www.youtube.com/embed/ZtiQk-vqmBA?autoplay=1"
                        target="_blank"
                        className="navbar-brand flex items-center gap-3"
                    >
                        <img
                            src="/images/F1_PUTwall.PNG"
                            alt="Formula 1 logo"
                            className="h-25 w-auto object-contain"
                        />
                    </a>
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
                        Powered by the{" "}
                        <a
                            href="https://openf1.org"
                            target="_blank"
                            rel="noreferrer"
                            className="text-f1-red hover:underline"
                        >
                            OpenF1 API{" "}
                            <ExternalLink size={12} className="inline" />
                        </a>{" "}
                        — free, open-source Formula 1 data including lap times,
                        telemetry, tire strategy, weather, and more.
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
                        <li>Neon PostgreSQL database</li>
                        <li>WebSocket race replay</li>
                        <li>Recharts visualizations</li>
                        <li>TailwindCSS styling</li>
                    </ul>
                </div>
            </div>

            <div className="bg-f1-card rounded-xl border border-f1-border p-6">
                <div className="flex items-center gap-3 mb-3">
                    <ListFilter size={20} className="text-f1-red" />
                    <h3 className="font-semibold">Features</h3>
                </div>
                <ul className="text-sm text-f1-muted space-y-2">
                    <li>
                        <strong>Race Replay</strong> — Play through any race
                        lap-by-lap with animated charts
                    </li>
                    <li>
                        <strong>Season Overview</strong> — Browse the race
                        calendar and driver standings
                    </li>
                    <li>
                        <strong>Driver Analysis</strong> — Deep dive into
                        individual driver performance
                    </li>
                    <li>
                        <strong>17 Interactive Visualizations</strong> —
                        Position chart, lap times, gap analysis, tire strategy,
                        weather, speed telemetry, sector heatmap, and more
                    </li>
                    <li>
                        <strong>Cross-filtering</strong> — Select a driver to
                        highlight across all charts or select multiple drivers
                        to compare their performance
                    </li>
                </ul>
            </div>

            {/* Improved Authors Section */}
            <div className="bg-f1-card rounded-xl border border-f1-border p-6">
                <div className="flex items-center gap-3 mb-6">
                    <Users size={20} className="text-f1-red" />
                    <h3 className="font-semibold">Project Authors</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                        {
                            name: "Aleksander Widman",
                            url: "https://github.com/Oleq202",
                        },
                        {
                            name: "Szymon Jankowski",
                            url: "https://github.com/Szymx0504",
                        },
                    ].map((author) => (
                        <a
                            key={author.name}
                            href={author.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group flex items-center justify-between p-4 rounded-lg bg-black/20 border border-f1-border hover:bg-white/5 transition-all duration-200"
                        >
                            <span className="text-sm font-medium text-white/80 group-hover:text-white">
                                {author.name}
                            </span>
                            <ArrowUpRight
                                size={16}
                                className="text-f1-muted group-hover:text-white transition-colors"
                            />
                        </a>
                    ))}
                </div>
            </div>

            <div className="text-center text-f1-muted text-sm pb-8">
                <p>
                    Poznan University of Technology project — Data
                    Visualization, Semester 4
                </p>
            </div>
        </div>
    );
}
