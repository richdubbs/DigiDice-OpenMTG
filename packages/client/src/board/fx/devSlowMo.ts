/**
 * Dev server only: `window.__openmtgSlowMo = n` slows every board animation n times, read at the start of each change, for checking frames by hand.
 * Production builds replace `import.meta.env.DEV` with false and drop this.
 */
export function devSlowMo(): number {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 1;
  const n = Number((window as { __openmtgSlowMo?: unknown }).__openmtgSlowMo);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
