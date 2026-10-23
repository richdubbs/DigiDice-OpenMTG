/**
 * The fx layer (ui/arena): an overlay over the whole board for ghosts, floating numbers, banners and the canvas of flying spell effects, plus the animator that
 * plays each change for the game screen's pacing connection. It takes no pointer events and is hidden from screen readers (the log and the board say what
 * happened). Without a pacer, or in a browser without the Web Animations API (tests), nothing is animated (the game screen then gives each change its
 * condensed sound, connection/PacedConnection.ts `unanimated`).
 */
import { useEffect, useRef } from 'react';
import type { BoardPacer } from '../../connection/PacedConnection';
import type { StagedStack } from '../GameBoard';
import { gamePlayer } from '../../game/sound';
import { Animator } from './Animator';
import { devSlowMo } from './devSlowMo';
import { Vfx } from './vfx';

export function FxLayer({ pacer, scale, stage }: { pacer?: BoardPacer | undefined; scale: number; stage?: (s: StagedStack | null) => Promise<void> }) {
  const layer = useRef<HTMLDivElement>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const canvas = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const ghosts = layer.current;
    const over = canvas.current;
    const root = ghosts?.closest<HTMLElement>('.game-board');
    const arena = root?.querySelector<HTMLElement>('[data-fx="arena"]');
    const under = root?.querySelector<HTMLCanvasElement>('[data-fx="under"]');
    if (!pacer || !ghosts || !over || !root || !arena || !under || typeof root.animate !== 'function' || !over.getContext) return;
    if (!over.getContext('2d')) return;
    const animator = new Animator({
      root,
      arena,
      layer: ghosts,
      under: new Vfx(under),
      over: new Vfx(over),
      scale: () => scaleRef.current * devSlowMo(),
      sound: gamePlayer,
      stage: (s) => stageRef.current?.(s) ?? Promise.resolve(),
    });
    const detach = pacer.attach(animator);
    return () => {
      detach();
      animator.finish();
    };
  }, [pacer]);

  return (
    <div className="fx-overlay" aria-hidden="true">
      <canvas className="fx-over" ref={canvas} />
      <div className="fx-ghosts" ref={layer} />
    </div>
  );
}
