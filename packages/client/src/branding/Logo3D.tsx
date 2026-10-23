/**
 * The DigiDice mark as a real 3D object: the transparent logo image stacked in layers along the Z axis (a CSS 3D extrusion), the back layers darker so the
 * sides read as metal, a neon glow behind it, a gentle idle sway and a pointer parallax tilt. All of it is drawn with CSS transforms on our own logo, so the
 * filters used on the layers never touch anything else (card pictures are never inside this component).
 *
 * `size` is the box in CSS pixels. Big logos get more layers (a smooth extrusion at hero size, ~200-240 px); small ones few (a cheap version for the
 * navigation bar and the game bar, ~28-36 px). `track` picks what the tilt follows: the pointer anywhere in the window (the hero), the element's parent
 * (a button the logo sits on) or the logo itself. `prefers-reduced-motion` turns the sway and the tilt off and leaves the logo posed at a slight angle.
 *
 * Accessibility: the front layer is the only image with a name ("DigiDice logo"); the others are decorative. `decorative` hides even that one, for a logo
 * inside a button or link that already has its own label.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { brandAsset } from './brand';
import './branding.css';

export type LogoTrack = 'window' | 'parent' | 'self';

export interface Logo3DProps {
  /** The box in CSS pixels (width = height). */
  size?: number;
  /** Number of stacked layers; by default from the size (14 at hero size, a few when small). */
  layers?: number;
  /** Hide the logo from assistive technology (it sits in a control that is labelled by other means). */
  decorative?: boolean;
  /** What the tilt follows. */
  track?: LogoTrack;
  /** A glowing pool of light under the logo (the hero). */
  shadow?: boolean;
  /** No idle sway (still follows the pointer). */
  still?: boolean;
  className?: string;
}

/** Layers by size: smooth at hero size, cheap when small. */
export function defaultLayers(size: number): number {
  if (size >= 160) return 14;
  if (size >= 80) return 10;
  if (size >= 48) return 7;
  return 5;
}

const MAX_TILT_DEG = 20;

export function Logo3D({ size = 64, layers, decorative = false, track = 'self', shadow = false, still = false, className }: Logo3DProps) {
  const root = useRef<HTMLSpanElement>(null);
  const n = Math.max(2, Math.round(layers ?? defaultLayers(size)));
  const depth = size * 0.12;
  const step = depth / (n - 1);
  const src = brandAsset('logoSquareTransparent');

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const target: EventTarget | null = track === 'window' ? window : track === 'parent' ? el.parentElement : el;
    if (!target) return;
    let frame = 0;
    const apply = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--logo-ry', `${(x * MAX_TILT_DEG).toFixed(1)}deg`);
        el.style.setProperty('--logo-rx', `${(-y * MAX_TILT_DEG * 0.8).toFixed(1)}deg`);
      });
    };
    const move = (e: Event) => {
      const p = e as PointerEvent;
      if (track === 'window') {
        apply((p.clientX / window.innerWidth) * 2 - 1, (p.clientY / window.innerHeight) * 2 - 1);
        return;
      }
      const r = (track === 'parent' ? el.parentElement! : el).getBoundingClientRect();
      apply(Math.max(-1, Math.min(1, ((p.clientX - r.left) / r.width) * 2 - 1)), Math.max(-1, Math.min(1, ((p.clientY - r.top) / r.height) * 2 - 1)));
    };
    const leave = () => apply(0, 0);
    target.addEventListener('pointermove', move);
    if (track !== 'window') target.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerleave', leave);
    };
  }, [track]);

  const classes = ['logo3d', size < 64 ? 'logo3d-small' : '', still ? 'logo3d-still' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span ref={root} className={classes} style={{ '--logo-size': `${size}px` } as CSSProperties}>
      <span className="logo3d-glow" aria-hidden="true" />
      {shadow && <span className="logo3d-shadow" aria-hidden="true" />}
      <span className="logo3d-tilt" aria-hidden={decorative ? 'true' : undefined}>
        <span className="logo3d-sway">
          {Array.from({ length: n }, (_, i) => {
            const front = i === n - 1;
            const z = (i - (n - 1) / 2) * step;
            // Back layers are dark and a little purple (the metal side), brightening toward the front face.
            const t = i / (n - 1);
            const style: CSSProperties = front
              ? { transform: `translateZ(${z.toFixed(2)}px)` }
              : { transform: `translateZ(${z.toFixed(2)}px)`, filter: `brightness(${(0.16 + 0.42 * t).toFixed(2)}) saturate(1.5) hue-rotate(${Math.round((1 - t) * 22)}deg)` };
            return (
              <img
                key={i}
                className={front ? 'logo3d-layer logo3d-front' : 'logo3d-layer'}
                src={src}
                width={size}
                height={size}
                draggable={false}
                style={style}
                {...(front && !decorative ? { alt: 'DigiDice logo' } : { alt: '', 'aria-hidden': true })}
              />
            );
          })}
        </span>
      </span>
    </span>
  );
}
