/**
 * The art box of our own frame: a painterly picture drawn from the card's name, colors and types. Procedural and deterministic (the same card always
 * gets the same picture, two different cards never look identical), inline SVG over a CSS sky: no canvas, no animation, no network, a few dozen nodes.
 *
 * Red is a fiery sky, blue deep water, green a forest canopy, black smoke and a moon, white a radiant dawn; two or more colors blend in gold (one scene
 * per color, split by a golden seam); artifacts are brass plates, colorless cards pale crystal; lands are landscapes by basic type (CR 305.6) or colors.
 * Nothing here is official art (ARCHITECTURE.md "Card images" A).
 */
import { useId, useMemo, type ReactNode } from 'react';
import type { Color } from '@openmtg/engine';
import { artTypesOf, emblemTypeOf, hashString, landColorsOf, rngOf, type ArtType } from './artSeed';
import { between } from './artShapes';
import { glowAt, motifOf, overlayOf, paletteOf, skyCss, type Flavor, type Pal } from './artScenes';
import { TypeEmblem } from './TypeEmblem';

export interface CardArtProps {
  /** The seed: the card's name (or the shown face's). */
  seedName: string;
  /** The colors of what the frame shows (CR 202.2). */
  colors: readonly Color[];
  typeLine: string;
  /** Rules text: a land's scenery follows the mana it makes. */
  oracleText: string;
}

export interface ArtPlan {
  /** One scene per flavor (at most three: a card of four or five colors uses its first, middle and last). */
  flavors: Flavor[];
  land: boolean;
  /** The type the overlay and the emblem show. */
  primary: ArtType;
  /** An artifact that is also something else gets a gear in the corner. */
  gear: boolean;
}

const GOLD = 'hsl(45 95% 66%)';

/** What to draw for a card. Pure. */
export function planArt({ colors, typeLine, oracleText }: Pick<CardArtProps, 'colors' | 'typeLine' | 'oracleText'>): ArtPlan {
  const types = artTypesOf(typeLine);
  const land = types.includes('land');
  let flavors: Flavor[];
  if (land) {
    const lc = colors.length > 0 ? [...colors] : landColorsOf(typeLine, oracleText);
    flavors = lc.length > 0 ? lc : ['terra'];
  } else if (colors.length > 0) flavors = [...colors];
  else flavors = [types.includes('artifact') ? 'steel' : 'crystal'];
  if (flavors.length > 3) flavors = [flavors[0]!, flavors[Math.floor(flavors.length / 2)]!, flavors[flavors.length - 1]!];
  const primary = emblemTypeOf(typeLine);
  return { flavors, land, primary, gear: types.includes('artifact') && primary !== 'artifact' && !flavors.includes('steel') };
}

function pillarGradient(id: string, glow: string): ReactNode {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor={glow} stopOpacity="0" />
      <stop offset=".5" stopColor={glow} stopOpacity="1" />
      <stop offset="1" stopColor={glow} stopOpacity="0" />
    </linearGradient>
  );
}

function halo(id: string, glow: string, g: { x: number; y: number; r: number }): ReactNode {
  return (
    <>
      <radialGradient id={id}>
        <stop offset="0" stopColor={glow} stopOpacity=".95" />
        <stop offset=".4" stopColor={glow} stopOpacity=".35" />
        <stop offset="1" stopColor={glow} stopOpacity="0" />
      </radialGradient>
      <circle cx={g.x.toFixed(1)} cy={g.y.toFixed(1)} r={g.r} fill={`url(#${id})`} />
    </>
  );
}

/** The slanted cut between neighbouring scenes: [x at the top, x at the bottom]. */
type Seam = readonly [number, number];

function bandPolygon(seams: readonly Seam[], i: number): string {
  const l: Seam = i === 0 ? [-6, -6] : seams[i - 1]!;
  const r: Seam = i === seams.length ? [106, 106] : seams[i]!;
  return `${l[0]},-2 ${r[0]},-2 ${r[1]},72 ${l[1]},72`;
}

function build(seedName: string, typeLine: string, plan: ArtPlan, uid: string): { node: ReactNode; sky: string | undefined; palette: Pal } {
  const seed = hashString(seedName);
  const rng = rngOf(seed);
  const multi = plan.flavors.length > 1;
  const pals = plan.flavors.map((f) => paletteOf(f, between(rng, -9, 9)));
  const first = pals[0]!;
  // Spells blended from several colors share one golden light.
  const lightPal: Pal = multi ? { ...first, glow: GOLD, light: 'hsl(46 100% 80%)' } : first;

  let scenes: ReactNode;
  if (!multi) {
    const r = rngOf(seed ^ 0x9e3779b9);
    scenes = (
      <>
        {halo(`${uid}h`, first.glow, glowAt(plan.flavors[0]!, plan.land, r))}
        {motifOf(plan.flavors[0]!, plan.land, r, first)}
      </>
    );
  } else {
    const n = plan.flavors.length;
    const seams: Seam[] = Array.from({ length: n - 1 }, (_, i) => {
      const top = (100 * (i + 1)) / n + between(rng, -4, 4) + 6;
      return [top, top - between(rng, 10, 16)] as const;
    });
    scenes = (
      <>
        {plan.flavors.map((f, i) => {
          const p = pals[i]!;
          const r = rngOf(seed ^ Math.imul(i + 1, 0x85ebca6b));
          return (
            <g key={i}>
              <clipPath id={`${uid}c${i}`}>
                <polygon points={bandPolygon(seams, i)} />
              </clipPath>
              <linearGradient id={`${uid}s${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={p.sky[0]} />
                <stop offset=".55" stopColor={p.sky[1]} />
                <stop offset="1" stopColor={p.sky[2]} />
              </linearGradient>
              <g clipPath={`url(#${uid}c${i})`}>
                <rect x="-6" y="-2" width="112" height="74" fill={`url(#${uid}s${i})`} />
                {halo(`${uid}h${i}`, p.glow, glowAt(f, plan.land, r))}
                {motifOf(f, plan.land, r, p)}
              </g>
            </g>
          );
        })}
        {seams.map(([t, b], i) => (
          <path key={`seam${i}`} d={`M${t.toFixed(1)} -2L${b.toFixed(1)} 72`} stroke={GOLD} strokeWidth="1.2" fill="none" opacity=".9" />
        ))}
        {seams.map(([t, b], i) => (
          <path key={`soft${i}`} d={`M${t.toFixed(1)} -2L${b.toFixed(1)} 72`} stroke={GOLD} strokeWidth="7" fill="none" opacity=".22" />
        ))}
        <rect x="-6" y="-2" width="112" height="74" fill={GOLD} opacity=".08" />
      </>
    );
  }

  const orng = rngOf(seed ^ 0x27d4eb2f);
  const overlay = plan.land ? null : overlayOf(plan.primary, typeLine, orng, lightPal, `${uid}p`);
  const gear = plan.gear ? overlayOf('artifact', typeLine, orng, lightPal, `${uid}p`) : null;
  const node = (
    <>
      {scenes}
      {plan.primary === 'planeswalker' && !plan.land ? pillarGradient(`${uid}p`, lightPal.glow) : null}
      {overlay}
      {gear}
    </>
  );
  return { node, sky: multi ? undefined : skyCss(first), palette: first };
}

export function CardArt({ seedName, colors, typeLine, oracleText }: CardArtProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const plan = planArt({ colors, typeLine, oracleText });
  const key = `${seedName}|${plan.flavors.join('')}|${plan.land ? 'L' : ''}|${plan.primary}|${plan.gear ? 'G' : ''}`;
  // `key` captures every input of the plan.
  const art = useMemo(() => build(seedName, typeLine, plan, uid), [key, typeLine, uid]);
  return (
    <div className="frame-art" aria-hidden="true" data-art={plan.flavors.join('')} data-art-type={plan.primary} style={art.sky ? { background: art.sky } : undefined}>
      <svg className="art-svg" viewBox="0 0 100 70" preserveAspectRatio="xMidYMid slice" focusable="false">
        {art.node}
      </svg>
      <TypeEmblem type={plan.primary} className="art-emblem" />
    </div>
  );
}
