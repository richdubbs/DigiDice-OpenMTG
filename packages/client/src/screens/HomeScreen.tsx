/**
 * Title screen (branding slot 1, docs/design/m8-client.md screen 1): the big 3D DigiDice logo, "OpenMTG by DigiDice", a big Play slab and the other menu
 * entries; the disclaimer is in the footer below. Behind it the room comes alive (HomeBackdrop): light cycles on the grid, pulses, flares and motes; sparks
 * orbit the logo's rings and a glint sweeps the Play slab. A UI profile on the LCARS template shows its space battle instead (profiles/SpaceBattle.tsx),
 * one on Reality Fracture its broken mirror (profiles/FractureScene.tsx).
 * On the left, how many cards the rules engine plays fully (HomeProgress); on the right, what is coming (HomeRoadmap).
 */
import type { ReactNode } from 'react';
import { AboutIcon, DecksIcon, ImagesIcon, PlayIcon, SettingsIcon } from '../app/icons';
import { useNav, type Route } from '../app/nav';
import { AppTitle, DonateLink } from '../branding/Branding';
import { Logo3D } from '../branding/Logo3D';
import { HomeBackdrop } from './HomeBackdrop';
import { HomeProgress } from './HomeProgress';
import { HomeRoadmap } from './HomeRoadmap';
import { FractureScene } from '../profiles/FractureScene';
import { SpaceBattle } from '../profiles/SpaceBattle';
import { useActiveProfile } from '../profiles/useProfiles';
import './screens.css';

const SECONDARY: { label: string; route: Route; icon: ReactNode }[] = [
  { label: 'Decks', route: { screen: 'decks' }, icon: <DecksIcon /> },
  { label: 'Images', route: { screen: 'images' }, icon: <ImagesIcon /> },
  { label: 'Settings', route: { screen: 'settings' }, icon: <SettingsIcon /> },
  { label: 'About', route: { screen: 'about' }, icon: <AboutIcon /> },
];

export function HomeScreen() {
  const nav = useNav();
  const { look } = useActiveProfile();
  return (
    <div className="screen home">
      {look.template === 'lcars' ? (
        look.scene && <SpaceBattle still={!look.motion} />
      ) : look.template === 'fracture' ? (
        look.scene && <FractureScene colors={{ mind: look.colors.mind!, echo: look.colors.echo!, memory: look.colors.memory!, void: look.colors.void! }} still={!look.motion} />
      ) : (
        <HomeBackdrop />
      )}
      <div className="home-hero">
        <div className="home-emblem">
          <Logo3D size={232} track="window" shadow className="home-logo" />
          <span className="home-orbit home-orbit-inner" aria-hidden="true" />
          <span className="home-orbit home-orbit-outer" aria-hidden="true" />
        </div>
        <AppTitle as="h1" className="home-title neon-title" />
        <p className="home-tagline">A free, open-source fan implementation of the Magic: The Gathering rules. Hot-seat play for two, or play against the computer.</p>
      </div>
      <nav className="home-menu" aria-label="Main menu">
        <button type="button" className="button-primary home-play" onClick={() => nav.go({ screen: 'newGame' })}>
          <PlayIcon size={26} />
          Play
        </button>
        <div className="home-secondary">
          {SECONDARY.map((m) => (
            <button key={m.label} type="button" onClick={() => nav.go(m.route)}>
              {m.icon}
              {m.label}
            </button>
          ))}
          <DonateLink />
        </div>
      </nav>
      <HomeProgress />
      <HomeRoadmap />
    </div>
  );
}
