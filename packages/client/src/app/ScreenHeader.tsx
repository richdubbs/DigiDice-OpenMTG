/** The header of every screen except Home: Back, the title, and optional actions on the right. */
import type { ReactNode } from 'react';
import { useNav } from './nav';

export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  const nav = useNav();
  return (
    <header className="screen-header">
      <button type="button" className="screen-back" onClick={nav.back} aria-label="Back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M15 4l-8 8 8 8" />
        </svg>
        Back
      </button>
      <h1 className="neon-title">{title}</h1>
      {children}
    </header>
  );
}
