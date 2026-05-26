/**
 * Bottom tab bar — the redesign's primary navigation. Four roots:
 * Servers, Machines, Team, Account. Server detail / config render as
 * full-screen overlays above the tabs (handled in App.tsx), so the bar
 * stays put while you drill into a server.
 */
import { Boxes, HardDrive, Users, CircleUser } from 'lucide-react';

export type Tab = 'servers' | 'machines' | 'team' | 'account';

const TABS: Array<{ id: Tab; label: string; Icon: typeof Boxes }> = [
  { id: 'servers', label: 'Servers', Icon: Boxes },
  { id: 'machines', label: 'Machines', Icon: HardDrive },
  { id: 'team', label: 'Team', Icon: Users },
  { id: 'account', label: 'Account', Icon: CircleUser },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="tabbar" role="tablist">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          className={`tabbar-btn ${active === id ? 'on' : ''}`}
          onClick={() => onChange(id)}
        >
          <Icon size={21} strokeWidth={active === id ? 2.4 : 2} />
          {label}
        </button>
      ))}
    </nav>
  );
}
