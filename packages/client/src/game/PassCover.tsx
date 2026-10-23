/**
 * Hot-seat pass screen (docs/design/m8-client.md "Data flow"): whenever the player who must act changes, this full-screen cover hides everything until
 * the next player clicks, so nothing of either player's hidden information (CR 400.2) is on screen while the device changes hands. Nothing else of the
 * game is rendered meanwhile: the only controls are the bar passed in `children` (Concede, CR 104.3a: at any time, and Leave) and the continue button,
 * all inside this modal dialog.
 *
 * The button is not focused and stays disabled for a moment after the cover appears: a player who is still pressing Space to pass priority must not
 * click straight through the cover and show the next player's hand to the wrong person.
 *
 * It sounds as it appears (game.handoff), so the players hear that the device changes hands.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Logo3D } from '../branding/Logo3D';
import { gameSfx } from './sound';

export function PassCover({ name, onAccept, armDelayMs, children }: { name: string; onAccept: () => void; armDelayMs: number; children?: ReactNode }) {
  const [armed, setArmed] = useState(armDelayMs <= 0);
  // Once per cover (StrictMode runs a mount effect twice; the ref survives).
  const heard = useRef(false);
  useEffect(() => {
    if (heard.current) return;
    heard.current = true;
    gameSfx('game.handoff');
  }, []);
  useEffect(() => {
    // Whatever had the keyboard focus belongs to the previous player's table.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (armDelayMs <= 0) return;
    const t = setTimeout(() => setArmed(true), armDelayMs);
    return () => clearTimeout(t);
  }, [armDelayMs]);
  return (
    <div className="pass-cover" role="dialog" aria-modal="true" aria-labelledby="pass-cover-title">
      {children}
      <div className="pass-cover-body">
        <Logo3D size={132} track="window" shadow />
        <h2 id="pass-cover-title" className="pass-cover-title neon-title">
          Pass to {name}
        </h2>
        <p className="pass-cover-text">Hand the screen to {name}. Everything stays hidden until {name} continues.</p>
        <button type="button" className="button-primary pass-cover-button" disabled={!armed} onClick={onAccept}>
          I am {name}: continue
        </button>
      </div>
    </div>
  );
}
