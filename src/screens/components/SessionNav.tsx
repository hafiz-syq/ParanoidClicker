import type { FC, ReactNode } from 'react';
import { ListMusic, SlidersHorizontal, Timer, Users } from 'lucide-react';

export type Tab = 'metronome' | 'setlist' | 'tracks' | 'sync';

export interface SessionNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'metronome', label: 'Metronome', icon: <Timer className="bottom-nav-icon" /> },
  { id: 'setlist', label: 'Setlist', icon: <ListMusic className="bottom-nav-icon" /> },
  { id: 'tracks', label: 'Tracks & MIDI', icon: <SlidersHorizontal className="bottom-nav-icon" /> },
  { id: 'sync', label: 'Band Sync', icon: <Users className="bottom-nav-icon" /> },
];

export const SessionNav: FC<SessionNavProps> = ({ active, onChange }) => (
  <nav className="bottom-nav" aria-label="Navigasi utama">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        className={`bottom-nav-item${active === tab.id ? ' active' : ''}`}
        onClick={() => onChange(tab.id)}
        aria-current={active === tab.id ? 'page' : undefined}
      >
        {tab.icon}
        <span className="bottom-nav-label">{tab.label}</span>
      </button>
    ))}
  </nav>
);
