/**
 * The Reality Fracture template's background scene behind the Home screen (profiles/fracture.ts): a canvas under the screen's content, decorative only
 * (hidden from screen readers, no pointer events). The hole in the mirror is centered on the logo (`.home-emblem`, measured now and then). The sky and
 * the broken mirror are painted once per size and palette into canvases of their own; each frame lays them down and draws what moves, at most 40 times
 * a second and at no more than 1.25 device pixels per pixel (it is a soft, slow background: more would only cost the computer). The pointer tilts the
 * view a little (parallax). It runs while it is on screen; with the profile's backgrounds still, or when the system asks for reduced motion, it draws
 * one moment and stops.
 */
import { useEffect, useRef } from 'react';
import { createScene, drawScene, paintMirror, paintSky, resizeScene, stepScene, type Pt, type Scene, type SceneColors } from './fracture';

/** Longest step of the simulation: after a pause (a hidden tab) the scene resumes instead of jumping ahead. */
const MAX_STEP = 0.05;
/** The shortest time between two frames (ms): about 40 a second. */
const FRAME_MS = 24;
/** The most device pixels drawn per CSS pixel. */
const MAX_DPR = 1.25;

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** The logo's middle in screen fractions of the canvas, or the usual place when Home has no logo yet. */
function logoCenter(canvas: HTMLCanvasElement): Pt {
  const fallback = { x: 0.5, y: 0.33 };
  try {
    const logo = document.querySelector('.home-emblem');
    const box = canvas.getBoundingClientRect();
    if (!logo || box.width < 1 || box.height < 1) return fallback;
    const r = logo.getBoundingClientRect();
    const x = (r.left + r.width / 2 - box.left) / box.width;
    const y = (r.top + r.height / 2 - box.top) / box.height;
    return Number.isFinite(x) && Number.isFinite(y) && x > 0 && x < 1 && y > 0 && y < 1 ? { x: Math.round(x * 200) / 200, y: Math.round(y * 200) / 200 } : fallback;
  } catch {
    return fallback;
  }
}

export function FractureScene({ colors, still = false }: { colors: SceneColors; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { mind, echo, memory } = colors;
  const voidColor = colors.void;
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
    const palette: SceneColors = { mind, echo, memory, void: voidColor };
    const frozen = still || reducedMotion();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    let scene: Scene | null = null;
    let sky: HTMLCanvasElement | null = null;
    let light: HTMLCanvasElement | null = null;

    /** A canvas the size of the scene with `draw` painted on it once, or null when the browser gives none. */
    const layer = (s: Scene, draw: (c: CanvasRenderingContext2D, s: Scene, colors: SceneColors) => void): HTMLCanvasElement | null => {
      const c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const g = c.getContext('2d');
      if (!g) return null;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(g, s, palette);
      return c;
    };

    // The logo is measured now and then (a layout read every frame would cost more than the scene), and only a real move breaks the mirror again.
    let measured = -Infinity;
    const fit = (now = performance.now()) => {
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      let center = scene?.center ?? logoCenter(canvas);
      if (scene && now - measured > 700) {
        measured = now;
        const found = logoCenter(canvas);
        if (Math.abs(found.x - center.x) > 0.015 || Math.abs(found.y - center.y) > 0.015) center = found;
      }
      if (scene && scene.w === w && scene.h === h && scene.center === center) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      paint.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (scene) resizeScene(scene, w, h, center);
      else scene = createScene(w, h, 2026, center);
      sky = layer(scene, paintSky);
      light = layer(scene, paintMirror);
    };

    fit();
    if (frozen) {
      // A moment with everything under way: the frame's first echoes out and a light running along an edge.
      for (let i = 0; i < 900 && (scene!.t < 4 || !scene!.run || scene!.run.k < 0.4); i++) stepScene(scene!, 1 / 60);
      drawScene(paint, scene!, palette, sky, light);
    }

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last && now - last < FRAME_MS) return;
      const dt = last ? Math.min(MAX_STEP, (now - last) / 1000) : 0;
      last = now;
      fit(now);
      stepScene(scene!, dt);
      drawScene(paint, scene!, palette, sky, light);
    };
    if (!frozen) frame = requestAnimationFrame(tick);

    const onResize = () => {
      measured = -Infinity;
      fit();
      if (frozen) drawScene(paint, scene!, palette, sky, light);
    };
    const onPointer = (e: PointerEvent) => {
      if (!scene || frozen) return;
      scene.pointer.x = Math.max(-1, Math.min(1, (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1));
      scene.pointer.y = Math.max(-1, Math.min(1, (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
    };
  }, [still, mind, echo, memory, voidColor]);
  return <canvas ref={ref} className="fracture-scene" aria-hidden="true" />;
}
