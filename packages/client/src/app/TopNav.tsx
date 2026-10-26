/**
 * The top navigation bar of every screen except the game (which has its own bar): the 3D DigiDice logo (goes Home) and the tabs Play, Decks, Replays,
 * Images, Settings and About, Arena-style (RPL-1, replays design 10: Replays next to Decks). The current screen's tab is raised and lit (aria-current="page"). Tabs are real buttons, so Tab / Enter / Space work;
 * choosing one replaces the screen (Back from it goes Home).
 *
 * Over a game (opened from the game's Menu), every tab but Play still works and the game stays where it is, under the screen (nav.open); Play becomes
 * "Back to game" (owner, 2026-10-25).
 */
import type { ReactNode } from 'react';
import { Logo3D } from '../branding/Logo3D';
import { AboutIcon, DecksIcon, ImagesIcon, PlayIcon, SettingsIcon } from './icons';
import { useNav, type Route, type ScreenName } from './nav';
import './app.css';

interface Tab {
  label: string;
  route: Route;
  icon: ReactNode;
  /** Screens this tab stays lit for. */
  screens: ScreenName[];
}

/** Replays: a play triangle inside a circular "rewind" arrow, drawn as the icons of icons.tsx are. Decorative: the label is next to it. */
function ReplaysIcon() {
  return (
    <svg className="nav-icon" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4 3.8v3.6h3.6" />
      <path d="M10.4 9v6l4.8-3z" fill="currentColor" />
    </svg>
  );
}

const TABS: Tab[] = [
  { label: 'Play', route: { screen: 'newGame' }, icon: <PlayIcon />, screens: ['newGame', 'hostOnline', 'joinOnline', 'hosted'] },
  { label: 'Decks', route: { screen: 'decks' }, icon: <DecksIcon />, screens: ['decks', 'deckbuilder'] },
  { label: 'Replays', route: { screen: 'replays' }, icon: <ReplaysIcon />, screens: ['replays'] },
  { label: 'Images', route: { screen: 'images' }, icon: <ImagesIcon />, screens: ['images'] },
  { label: 'Settings', route: { screen: 'settings' }, icon: <SettingsIcon />, screens: ['settings'] },
  { label: 'About', route: { screen: 'about' }, icon: <AboutIcon />, screens: ['about'] },
];

export function TopNav() {
  const nav = useNav();
  const current = nav.route.screen;
  return (
    <header className="app-nav">
      <button type="button" className="app-nav-home" aria-label="Home" onClick={() => current !== 'home' && nav.open({ screen: 'home' })}>
        <Logo3D size={36} decorative track="parent" />
        <span className="app-nav-name" aria-hidden="true">
          Open<b>MTG</b>
        </span>
      </button>
      <nav className="app-nav-tabs" aria-label="Sections">
        {nav.inGame && (
          <button type="button" className="app-nav-tab app-nav-tab-game" onClick={nav.toGame}>
            <PlayIcon />
            <span>Back to game</span>
          </button>
        )}
        {TABS.filter((t) => !(nav.inGame && t.label === 'Play')).map((t) => {
          const active = t.screens.includes(current);
          return (
            <button
              key={t.label}
              type="button"
              className={active ? 'app-nav-tab app-nav-tab-active' : 'app-nav-tab'}
              {...(active ? { 'aria-current': 'page' as const } : {})}
              onClick={() => current !== t.route.screen && nav.open(t.route)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
