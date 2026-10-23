/**
 * Screen shake for a hit (ui/arena): 1 damage barely moves the table, 20 or more is a big jolt, everything in between scales smoothly, and
 * every shake is quick (well under half a second), never a long wobble. Pure math, so the scale is tested on its own.
 */
export interface Shake {
  /** Largest offset in CSS pixels. */
  amplitude: number;
  /** Milliseconds (before the animation speed setting scales it). */
  duration: number;
  /** Largest turn in degrees. */
  rotation: number;
  /** Extra scale at the moment of the hit (a punch toward the viewer). */
  zoom: number;
}

export const NO_SHAKE: Shake = { amplitude: 0, duration: 0, rotation: 0, zoom: 0 };

/** 0 at 1 damage, 1 at 20 and more. */
export function shakeLevel(amount: number): number {
  if (amount <= 1) return 0;
  return Math.min(1, (amount - 1) / 19);
}

export function shakeFor(amount: number): Shake {
  if (!(amount > 0)) return NO_SHAKE;
  const e = Math.pow(shakeLevel(amount), 0.85);
  return {
    amplitude: 1.2 + 26.8 * e,
    duration: Math.round(150 + 270 * e),
    rotation: 1.6 * e * e,
    zoom: 0.035 * e * e,
  };
}

/** Keyframes of a decaying jolt (about 30 changes a second), deterministic for a seed; starts and ends at rest. */
export function shakeKeyframes(s: Shake, seed = 7): Keyframe[] {
  const frames = Math.max(4, Math.round(s.duration / 32));
  let r = (seed % 2147483646) + 1;
  const rnd = () => {
    r = (r * 16807) % 2147483647;
    return (r / 2147483647) * 2 - 1;
  };
  const out: Keyframe[] = [{ offset: 0, transform: 'translate(0px, 0px) rotate(0deg) scale(1)' }];
  for (let i = 1; i < frames; i++) {
    const k = i / frames;
    const decay = (1 - k) * (1 - k);
    // The first frame is the hardest hit: a full-size kick in a random direction.
    const strength = i === 1 ? 1 : decay;
    const x = rnd() * s.amplitude * strength;
    const y = rnd() * s.amplitude * strength * 0.8;
    const rot = rnd() * s.rotation * strength;
    const sc = 1 + s.zoom * (i === 1 ? 1 : decay * 0.5);
    out.push({ offset: k, transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})` });
  }
  out.push({ offset: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)' });
  return out;
}

/** How hard a hit card or disc itself recoils (px), smaller than the screen shake. */
export function recoilFor(amount: number): number {
  return 3 + 9 * Math.pow(shakeLevel(amount), 0.7);
}
