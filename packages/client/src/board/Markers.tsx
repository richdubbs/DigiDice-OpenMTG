/**
 * The status markers of a card, drawn in a strip outside the card image. Each marker carries its rule in its tooltip. A permanent's power/toughness,
 * loyalty, defense and counters are drawn on the card itself (CardOverlay.tsx).
 */
import type { CardDef, GameObject, GameView } from '@openmtg/engine';
import { faceDownHow, faceDownRule, preparedCopyOf, statusLines } from '../cards/objectStatus';
import { useBoard } from './context';
import { objectName, targetName, type PermanentInfo } from './model';

export interface Marker {
  key: string;
  /** The accessible text (always read by screen readers). */
  text: string;
  /** Visual kind (CSS class `marker-<kind>`). */
  kind: 'damage' | 'attacking' | 'blocking' | 'sick' | 'tapped' | 'facedown' | 'phased' | 'target' | 'automation' | 'pending' | 'layout';
  rule?: string;
  /** A symbol drawn before the text, so colour is never the only signal (design 10.5). */
  icon?: string;
  /** Show only the icon; the text stays for screen readers and in the tooltip. */
  compact?: boolean;
}

const LEVEL_BADGE = {
  full: { icon: '✓', text: 'Fully automated', rule: 'The engine plays all of this card\'s text', compact: true },
  partial: { icon: '◐', text: 'Partly automated', rule: 'Some of this card\'s text is resolved by hand', compact: false },
  // U+270B with the text presentation selector: a plain glyph, not a colour emoji.
  manual: { icon: '✋︎', text: 'Resolve by hand', rule: 'This card\'s text is resolved by hand', compact: false },
} as const;

/**
 * How well the engine understands a card (design 10.5): a badge for every level, for every player (rules knowledge, not hidden information), on cards in
 * hand and on the stack. Never on the battlefield: there the zoom shows the level.
 */
export function automationMarkers(def: CardDef | null): Marker[] {
  if (!def) return [];
  const b = LEVEL_BADGE[def.automation.level];
  return [{ key: 'auto', kind: 'automation', text: b.text, icon: b.icon, rule: b.rule, compact: b.compact }];
}

/** The badge of a spell or ability on the stack: the card's level for a spell, the printed ability's own level for an ability when it is known. */
export function stackAutomationMarkers(view: GameView, o: GameObject): Marker[] {
  const def = view.defs[o.defId];
  // M6-11, CR 708.2a: a face-down spell has no text, so no level applies to it (and another player's has only the pseudo-definition)
  if (!def || o.faceDown) return [];
  if (o.kind !== 'ability') return automationMarkers(def);
  const ref = o.stack?.abilityRef;
  // Granted or inline abilities: no per-ability level is known from the card, so no badge rather than a wrong one.
  if (o.stack?.inline || !ref || (ref.source !== 'printed' && ref.source !== 'keyword')) return [];
  const level = def.automation.faces?.[ref.face]?.abilities[ref.index]?.level;
  return level ? automationMarkers({ ...def, automation: { ...def.automation, level } }) : [];
}

/**
 * The chips under (for the opponents: above) a permanent. Power/toughness, loyalty, defense and counters are drawn ON the card
 * (CardOverlay.tsx), an attachment is drawn tucked under its host (CardSlot.tsx), and no automation badge is drawn on the battlefield (the zoom and the
 * "Triggers to check" list keep the level and the by-hand triggers): what remains here is damage, combat, summoning sickness and the face-down and
 * phased-out states.
 */
export function permanentMarkers(info: PermanentInfo, nameOf: (id: string) => string): Marker[] {
  const o = info.obj;
  const out: Marker[] = [];
  if (o.damage > 0) out.push({ key: 'damage', kind: 'damage', text: `${o.damage} damage`, rule: 'Damage marked on this permanent (CR 120.3e, 120.6)' });
  if (info.combat.attacking) {
    const d = info.combat.attacking.defender;
    // CR 506.4c: the planeswalker or battle it attacked left combat; the creature is still attacking but deals no combat damage to it.
    const where = d === null ? '(its target left combat)' : nameOf(d);
    out.push({ key: 'atk', kind: 'attacking', text: `Attacking ${where}${info.combat.attacking.blocked ? ' (blocked)' : ''}`, rule: 'Attacking creature (CR 508.1, 509.1h, 506.4c)', icon: '⚔︎', compact: true });
  }
  if (info.combat.blocking) {
    out.push({ key: 'blk', kind: 'blocking', text: `Blocking ${info.combat.blocking.map(nameOf).join(', ')}`, rule: 'Blocking creature (CR 509.1)', icon: '🛡︎', compact: true });
  }
  if (o.tapped) out.push({ key: 'tap', kind: 'tapped', text: 'Tapped', rule: 'CR 701.26' });
  if (info.summoningSick) out.push({ key: 'sick', kind: 'sick', text: 'Summoning sick', rule: 'Can\'t attack or use {T} abilities yet (CR 302.6)', icon: 'zZ', compact: true });
  if (o.faceDown) {
    // M6-11: how it came to be face down is public (CR 708.6; a megamorph is announced as a morph to the other players, CR 702.37b-c)
    const how = faceDownHow(o);
    out.push({ key: 'fd', kind: 'facedown', text: how ? `Face down (${how})` : 'Face down', rule: `${faceDownRule(o)}; only its controller may look at it (CR 708.5)` });
  }
  if (o.phasedOut) out.push({ key: 'ph', kind: 'phased', text: 'Phased out', rule: 'Treated as though it does not exist (CR 702.26b)' });
  return out;
}

/**
 * M6-11 (m6 design 3.6, 3.7): the layout and double-faced states of a visible permanent or spell (objectStatus.ts#statusLines): which face is up, what a
 * melded permanent is made of, a Saga's chapter, a Class's or leveler's level, a Case's solved state, prototyped, prepared; and the copy of a prepare spell
 * waiting in exile (CR 722.3c).
 */
export function layoutMarkers(view: GameView, o: GameObject): Marker[] {
  const out: Marker[] = statusLines(view, o).map((l) => ({ key: `l:${l.key}`, kind: 'layout' as const, text: l.text, rule: l.rule }));
  const prepared = preparedCopyOf(view, o);
  if (prepared !== null) out.push({ key: 'l:prepare-copy', kind: 'layout', text: `Prepare spell of ${prepared}`, rule: 'CR 722.3c: castable while that permanent stays prepared' });
  return out;
}

export function MarkerStrip({ markers, id }: { markers: readonly Marker[]; id?: string }) {
  if (markers.length === 0) return null;
  return (
    <ul className="marker-strip" aria-label="Status" id={id}>
      {markers.map((m) => (
        <li key={m.key} className={`marker marker-${m.kind}${m.compact ? ' is-compact' : ''}`} title={m.rule ? `${m.text}: ${m.rule}` : m.text}>
          {m.icon && (
            <span className="marker-icon" aria-hidden="true">
              {m.icon}
            </span>
          )}
          <span className={m.compact ? 'sr-only' : 'marker-text'}>{m.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The current decision's own mark for an object or player (a pending attack or block, a click order), from the prompt; none when it has no mark. */
export function usePromptMark(id: string): Marker[] {
  const { interaction } = useBoard();
  const text = interaction.marks?.[id];
  return text ? [{ key: 'prompt', kind: 'pending', text, rule: 'Your choice in the current decision, not made yet' }] : [];
}

/** "Target of <spell>" markers for an object or player that spells or abilities on the stack target (CR 115.1). */
export function useTargetMarkers(id: string): Marker[] {
  const { view, targeted } = useBoard();
  return (targeted.get(id) ?? []).map((s) => ({ key: `t:${s}`, kind: 'target' as const, text: `Target of ${objectName(view, s)}`, rule: 'CR 115.1, 601.2c' }));
}

export function useNameOf(): (id: string) => string {
  const { view } = useBoard();
  return (id: string) => targetName(view, id);
}
