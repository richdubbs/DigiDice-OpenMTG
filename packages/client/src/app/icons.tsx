/** Navigation icons, drawn here as inline SVG (24x24, stroke only, `currentColor`), so they take the tab's color and glow. Decorative: the label is next to them. */
import type { ReactNode } from 'react';
import './app.css';

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="nav-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Play: a play triangle in a hexagonal ring. */
export function PlayIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size ? { size } : {})}>
      <path d="M8 3.5h8l4.5 8.5-4.5 8.5H8L3.5 12z" />
      <path d="M10.2 8.6v6.8l5.2-3.4z" fill="currentColor" />
    </Icon>
  );
}

/** Decks: a fanned stack of cards. */
export function DecksIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size ? { size } : {})}>
      <rect x="3.5" y="6" width="10" height="14" rx="1.6" transform="rotate(-12 8.5 13)" />
      <rect x="9.5" y="4.5" width="10" height="14" rx="1.6" transform="rotate(8 14.5 11.5)" />
      <path d="M13 9.5l1.4 2.2-1.4 2.2-1.4-2.2z" />
    </Icon>
  );
}

/** Images: a picture frame with a sun and a mountain. */
export function ImagesIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size ? { size } : {})}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4" />
    </Icon>
  );
}

/** Settings: three sliders. */
export function SettingsIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size ? { size } : {})}>
      <path d="M4 7h7M15 7h5M4 12h3M11 12h9M4 17h9M17 17h3" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="17" r="2" />
    </Icon>
  );
}

/** About: an "i" in a ring. */
export function AboutIcon({ size }: { size?: number }) {
  return (
    <Icon {...(size ? { size } : {})}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.8v.2" strokeWidth="2.4" />
    </Icon>
  );
}
