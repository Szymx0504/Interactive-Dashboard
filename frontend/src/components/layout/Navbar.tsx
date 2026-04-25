import { NavLink } from 'react-router-dom';
import { Flag, BarChart3, User, Info } from 'lucide-react';

const links = [
  { to: '/', label: 'Race Replay', icon: Flag },
  { to: '/season', label: 'Season Overview', icon: BarChart3 },
  { to: '/driver', label: 'Driver Analysis', icon: User },
  { to: '/about', label: 'About', icon: Info },
];

export default function Navbar() {
  return (
    <nav className="bg-f1-card border-b border-f1-border px-6 py-3 flex items-center gap-8">
      {/* Logo */}
      <NavLink to="/" className="flex items-center gap-2 text-f1-red font-bold text-xl tracking-tight">
        <span className="bg-f1-red text-white px-2 py-0.5 rounded text-sm font-black">F1</span>
        <span className="text-f1-text">Analyzer</span>
      </NavLink>

      {/* Nav links */}
      <div className="flex items-center gap-1 ml-4">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-f1-red/10 text-f1-red'
                  : 'text-f1-muted hover:text-f1-text hover:bg-f1-border/30'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
