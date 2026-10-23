/**
 * The LCARS template's background scene behind the Home screen (profiles/battle.ts): a canvas under the screen's content, decorative only (hidden from
 * screen readers, no pointer events). It runs while it is on screen; with the profile's backgrounds still, or when the system asks for reduced motion,
 * it draws one moment of the battle and stops.
 */
import { useEffect, useRef } from 'react';
import { createBattle, drawBattle, drawNebula, resizeBattle, seeded, stepBattle, type Battle } from './battle';

/** Longest step of the simulation: after a pause (a hidden tab) the battle resumes instead of jumping ahead. */
const MAX_STEP = 0.05;

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export function SpaceBattle({ still = false }: { still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      ctx = null;
    }
    if (!canvas || !ctx) return;
    const paint = ctx;
    const frozen = still || reducedMotion();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let battle: Battle | null = null;
    let nebula: HTMLCanvasElement | null = null;

    const fit = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      if (battle && battle.w === w && battle.h === h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      paint.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (battle) resizeBattle(battle, w, h);
      else battle = createBattle(w, h);
      nebula = document.createElement('canvas');
      nebula.width = canvas.width;
      nebula.height = canvas.height;
      const n = nebula.getContext('2d');
      if (n) {
        n.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawNebula(n, w, h, seeded(47));
      } else nebula = null;
    };

    fit();
    if (frozen) {
      // A moment with the battle under way: a few seconds in, with a beam on a shield.
      for (let i = 0; i < 600 && (battle!.t < 3 || battle!.beams.length === 0); i++) stepBattle(battle!, 1 / 60);
      drawBattle(paint, battle!, nebula);
    }

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(MAX_STEP, (now - last) / 1000) : 0;
      last = now;
      fit();
      stepBattle(battle!, dt);
      drawBattle(paint, battle!, nebula);
      frame = requestAnimationFrame(tick);
    };
    if (!frozen) frame = requestAnimationFrame(tick);

    const onResize = () => {
      fit();
      if (frozen) drawBattle(paint, battle!, nebula);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [still]);
  return <canvas ref={ref} className="space-battle" aria-hidden="true" />;
}
