/**
 * The table the battle is fought on (ui/arena): a DigiDice "grid" arena in perspective, our own art (CSS and inline SVG, no images). A neon grid floor
 * tilted steeply away from the viewer and fading into a glowing horizon behind the opponent, light streaks running along the grid, light pillars at the
 * sides, and, flat on the table's middle line (`--midline`, measured by the board), the DigiDice emblem ring and a beam between the two sides. Purely
 * decorative: it sits behind the cards, takes no pointer events and is hidden from screen readers. The fx layer lights it up on big hits (`.arena-flash`).
 */
import { memo } from 'react';

/** Memoized (ui/arena perf): it never changes, and the board draws again for every change. */
export const ArenaBackdrop = memo(function ArenaBackdrop() {
  return (
    <div className="arena-backdrop" aria-hidden="true">
      <div className="arena-room" />
      <div className="arena-horizon" />
      <div className="arena-floor">
        <div className="arena-floor-grid" />
        <div className="arena-streaks">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="arena-fog" />
      {/* Each side's play area: a dark glass mat on the floor with a lit edge and corner marks in its player's colour. */}
      <div className="arena-mat arena-mat-far">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="arena-mat-far-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a1a7a" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#6a2aa0" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          {/* the slab's front edge, seen below its near side: it stands on the floor */}
          <polygon className="mat-edge" points="0.5,100 99.5,100 99.5,104.5 0.5,104.5" />
          <polygon className="mat-plate" points="2,0 98,0 99.5,100 0.5,100" fill="url(#arena-mat-far-fill)" />
          <polygon className="mat-bevel" points="3.2,2.5 96.8,2.5 98.2,97.5 1.8,97.5" />
          <path className="mat-corners" d="M2,18 V0 H9 M91,0 H98 V18 M99.5,82 V100 H92 M8,100 H0.5 V82" />
        </svg>
      </div>
      <div className="arena-mat arena-mat-near">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="arena-mat-near-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1c5aa8" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#0d3a80" stopOpacity="0.08" />
            </linearGradient>
          </defs>
          <polygon className="mat-plate" points="0.5,0 99.5,0 100,100 0,100" fill="url(#arena-mat-near-fill)" />
          <polygon className="mat-bevel" points="1.6,2.2 98.4,2.2 99,100 1,100" />
          <path className="mat-corners" d="M0.5,18 V0 H8 M92,0 H99.5 V18" />
        </svg>
      </div>
      <div className="arena-pillar arena-pillar-l" />
      <div className="arena-pillar arena-pillar-r" />
      <div className="arena-decal">
        <svg className="arena-emblem" viewBox="0 0 800 260" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="arena-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#1fb8ff" stopOpacity="0.22" />
              <stop offset="60%" stopColor="#0a2a5a" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <filter id="arena-glow" x="-30%" y="-60%" width="160%" height="220%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <ellipse cx="400" cy="130" rx="300" ry="120" fill="url(#arena-core)" />
          <g fill="none" filter="url(#arena-glow)">
            <ellipse cx="400" cy="130" rx="250" ry="100" stroke="rgba(31,184,255,0.55)" strokeWidth="2.5" />
            <ellipse cx="400" cy="130" rx="286" ry="114" stroke="rgba(31,184,255,0.2)" strokeWidth="9" strokeDasharray="2 24" />
            {/* the chip: the DigiDice mark's chamfered square, lying flat on the table */}
            <path d="M330 104 H470 L494 116 V144 L470 156 H330 L306 144 V116 Z" stroke="rgba(31,184,255,0.55)" strokeWidth="2.5" />
            <path d="M306 124 H276 L262 116 M306 136 H276 L262 144 M494 124 H524 L538 116 M494 136 H524 L538 144" stroke="rgba(245,0,245,0.5)" strokeWidth="2" />
          </g>
        </svg>
        {/* The running dashes, apart from the emblem above: its blur filter is painted once, and only this thin ring is painted again as the dashes move. */}
        <svg className="arena-emblem arena-emblem-ring" viewBox="0 0 800 260" preserveAspectRatio="xMidYMid meet">
          <ellipse cx="400" cy="130" rx="214" ry="86" stroke="rgba(245,0,245,0.18)" strokeWidth="7" strokeDasharray="5 12" className="arena-ring-spin" />
          <ellipse cx="400" cy="130" rx="214" ry="86" stroke="rgba(245,0,245,0.42)" strokeWidth="2" strokeDasharray="5 12" className="arena-ring-spin" />
        </svg>
        <div className="arena-beam" />
      </div>
      <div className="arena-vignette" />
      <div className="arena-flash" />
    </div>
  );
});
