/**
 * What the board draws ON a permanent's card (replacing the chips under the card for these): the current power and toughness on
 * the card's own P/T corner, coloured when they differ from the printed values, the current loyalty or defense the same way, and every other counter as a
 * small icon with its number on the card's left edge. +1/+1 and -1/-1 counters are in a creature's P/T (CR 122.1a, 613.4c) and also get their own badge,
 * first and in green or red. The
 * text stays for screen readers and in each item's tooltip.
 *
 * Nothing here covers the artist and copyright line at the bottom edge of a picture (ARCHITECTURE.md "Card images"): the plate sits on the P/T box above
 * it and the counters on the art's left edge.
 */
import type { CardDef, Chars, GameObject } from '@openmtg/engine';

export type Tone = 'up' | 'down' | 'same';

export interface StatValue {
  text: string;
  tone: Tone;
}

export interface Overlay {
  /** Creatures: current power and toughness (CR 208.3, 613.4). */
  pt?: { power: StatValue; toughness: StatValue; title: string };
  /** Planeswalkers and battles: current loyalty (CR 306.5b) or defense (CR 310.4b) from their counters. */
  stat?: { kind: 'loyalty' | 'defense'; value: StatValue; title: string };
  counters: { name: string; n: number; icon: string; count: string; title: string }[];
}

/** A small glyph per common counter (text presentation, never a colour emoji); others use their initial. */
const ICON: Record<string, string> = {
  charge: '⚡︎',
  time: '⧗',
  oil: '◉',
  shield: '◈',
  stun: '✕',
  lore: '❡',
  fade: '◌',
  age: '⌛︎',
  ice: '❄︎',
  page: '❏',
  quest: '★',
  level: '▲',
  '+1/+1': '+1/+1',
  '-1/-1': '−1/−1',
};

/** +1/+1 and -1/-1 counters show their name as the icon and a count only past one ("+1/+1 ×2"); others show their count always. */
const PT_COUNTERS = new Set(['+1/+1', '-1/-1']);

export function counterIcon(name: string): string {
  return ICON[name] ?? (name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '•');
}

const num = (v: string | undefined): number | null => (v !== undefined && /^-?\d+$/.test(v.trim()) ? Number(v) : null);

function tone(current: number | null, printed: number | null): Tone {
  if (current === null || printed === null || current === printed) return 'same';
  return current > printed ? 'up' : 'down';
}

const plural = (n: number, what: string) => `${n} ${what} counter${n === 1 ? '' : 's'}`;

/**
 * The printed values to compare with are the shown face's, and only while the permanent still has that face's name: a copy (CR 707.2) or a face-down
 * permanent (CR 708.2a, a 2/2 with no name) has other base values, so its numbers are drawn without a colour (the face-down 2/2 is compared with 2/2).
 */
export function overlayOf(o: GameObject, def: CardDef | null, face: number, chars: Chars | null, isCreature: boolean): Overlay {
  const f = def?.faces[face] ?? def?.faces[0];
  const own = !!f && (o.faceDown ? false : !chars?.name || chars.name === f.name);
  const counters = Object.entries(o.counters).filter(([, n]) => n > 0);
  const out: Overlay = { counters: [] };
  const inPt = new Set<string>();
  if (isCreature && chars?.power !== undefined && chars.toughness !== undefined) {
    const basePower = o.faceDown ? 2 : own ? num(f!.power) : null;
    const baseToughness = o.faceDown ? 2 : own ? num(f!.toughness) : null;
    const power = num(chars.power);
    const toughness = num(chars.toughness);
    const changed = basePower !== null && baseToughness !== null && (power !== basePower || toughness !== baseToughness);
    const notes = counters.filter(([k]) => PT_COUNTERS.has(k)).map(([k, n]) => plural(n, k));
    out.pt = {
      power: { text: chars.power, tone: tone(power, basePower) },
      toughness: { text: chars.toughness, tone: tone(toughness, baseToughness) },
      title: `Power/toughness ${chars.power}/${chars.toughness}${notes.length ? ` (${notes.join(', ')})` : ''}${changed ? `, printed ${basePower}/${baseToughness}` : ''} (CR 208, 613)`,
    };
  } else if (chars?.types.includes('Planeswalker') || chars?.types.includes('Battle')) {
    const kind = chars.types.includes('Planeswalker') ? 'loyalty' : 'defense';
    const n = o.counters[kind] ?? 0;
    const printed = own ? num(kind === 'loyalty' ? f!.loyalty : f!.defense) : null;
    inPt.add(kind);
    out.stat = {
      kind,
      value: { text: String(n), tone: tone(n, printed) },
      title: `${kind === 'loyalty' ? 'Loyalty' : 'Defense'} ${n}${printed !== null && printed !== n ? `, printed ${printed}` : ''} (${kind === 'loyalty' ? 'CR 306.5b' : 'CR 310.4b'})`,
    };
  }
  const ordered = [...counters.filter(([k]) => PT_COUNTERS.has(k)), ...counters.filter(([k]) => !PT_COUNTERS.has(k))];
  for (const [name, n] of ordered) {
    if (inPt.has(name)) continue;
    const count = PT_COUNTERS.has(name) ? (n > 1 ? `×${n}` : '') : String(n);
    out.counters.push({ name, n, icon: counterIcon(name), count, title: `${plural(n, name)} (CR 122.1)` });
  }
  return out;
}

/** The plate's glow: green when only raised, red when only lowered, amber when one is raised and the other lowered. */
function plateTone(a: Tone, b: Tone = 'same'): Tone | 'mixed' {
  if (a === b) return a;
  if (a === 'same') return b;
  if (b === 'same') return a;
  return 'mixed';
}

/** True when `CardOverlay` draws something (with `pt` as passed to it). */
export function hasOverlay(overlay: Overlay | null, pt = true): overlay is Overlay {
  return !!overlay && (!!(pt && overlay.pt) || !!overlay.stat || overlay.counters.length > 0);
}

/**
 * The overlay itself, drawn inside the card's image box so it turns with the card when it is tapped (CR 701.26a). `id` lets the card's control name it in
 * `aria-describedby`, with the marker strip.
 */
export function CardOverlay({ overlay, pt = true, id }: { overlay: Overlay; /** Off where the card's own face already shows the current P/T (CompactFace). */ pt?: boolean; id?: string }) {
  const { counters, stat } = overlay;
  const plate = pt ? overlay.pt : undefined;
  if (!hasOverlay(overlay, pt)) return null;
  return (
    <div className="card-overlay" id={id}>
      {counters.length > 0 && (
        <ul className="card-counters" aria-label="Counters">
          {counters.map((c) => (
            <li key={c.name} className="card-counter" data-counter={c.name} title={c.title}>
              <span className="card-counter-icon" aria-hidden="true">
                {c.icon}
              </span>
              {c.count && (
                <span className="card-counter-n" aria-hidden="true">
                  {c.count}
                </span>
              )}
              <span className="sr-only">{c.title}</span>
            </li>
          ))}
        </ul>
      )}
      {plate && (
        <span className="card-pt" title={plate.title} data-pt={`${plate.power.text}/${plate.toughness.text}`} data-tone={plateTone(plate.power.tone, plate.toughness.tone)}>
          <span className={`pt-${plate.power.tone}`} aria-hidden="true">
            {plate.power.text}
          </span>
          <span aria-hidden="true">/</span>
          <span className={`pt-${plate.toughness.tone}`} aria-hidden="true">
            {plate.toughness.text}
          </span>
          <span className="sr-only">{plate.title}</span>
        </span>
      )}
      {stat && (
        <span className={`card-pt card-${stat.kind}`} title={stat.title} data-pt={stat.value.text} data-tone={stat.value.tone}>
          <span className={`pt-${stat.value.tone}`} aria-hidden="true">
            {stat.value.text}
          </span>
          <span className="sr-only">{stat.title}</span>
        </span>
      )}
    </div>
  );
}
