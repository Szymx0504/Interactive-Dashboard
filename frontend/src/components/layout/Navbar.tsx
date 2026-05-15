import { NavLink, useSearchParams } from "react-router-dom";

const links = [
    { to: "/", label: "Race Replay" },
    { to: "/season", label: "Season Overview" },
    { to: "/driver", label: "Driver Analysis" },
    { to: "/qualifying", label: "Qualifying" },
    { to: "/about", label: "About" },
];

export default function Navbar() {
    const [searchParams] = useSearchParams();

    // Carry year + session params across page navigations
    const carryParams = (basePath: string) => {
        const carried = new URLSearchParams();
        const year = searchParams.get("year");
        const session = searchParams.get("session");
        if (year) carried.set("year", year);
        if (session) carried.set("session", session);
        const qs = carried.toString();
        return qs ? `${basePath}?${qs}` : basePath;
    };

    return (
        <nav className="navbar-f1 border-b border-f1-border px-6 py-4 flex items-center gap-10">
            <a
                href="https://www.youtube.com/embed/ZtiQk-vqmBA?autoplay=1"
                target="_blank"
                className="navbar-brand flex items-center gap-3"
            >
                <img
                    src="/images/F1_PUTwall.PNG"
                    alt="Formula 1 logo"
                    className="h-10 w-auto object-contain"
                />
            </a>

            <div className="flex items-center gap-4">
                {links.map(({ to, label }) => (
                    <NavLink
                        key={to}
                        to={carryParams(to)}
                        className={({ isActive }) =>
                            `navbar-link ${isActive ? "active" : "inactive"}`
                        }
                    >
                        {label}
                    </NavLink>
                ))}
            </div>

            <div className="navbar-end ml-auto flex items-center gap-4 border-l border-f1-border pl-6">
                <a href="https://put.poznan.pl/" target="_blank">
                    <img
                        src="/images/PP_logo.png"
                        alt="PP logo"
                        className="h-10 w-auto object-contain"
                    />
                </a>
            </div>
        </nav>
    );
}
