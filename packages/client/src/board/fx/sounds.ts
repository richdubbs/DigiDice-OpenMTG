/**
 * What a change sounds like on the table (docs/design/sound.md): the sound of each moment, the events the animator never shows, and the short summary of a
 * change shown without animation. Pure, like plan.ts, so the choices are tested without a browser or Web Audio.
 *
 * - The animator (Animator.ts) plays most sounds itself, at the visual beats of its choreography: the helpers here only name them (`hitSound`,
 *   `arrivalSound`, `exitCue` ...).
 * - `eventCues`: what happened without a visual of its own (taps, untaps, shuffles, coin flips, a lock-on by the opponent ...), for every change, animated
 *   or not. Quiet by design: at most a few cues, each sound once.
 * - `unanimatedCues`: a change shown at once (animations off, reduced motion, a catch-up, no board on screen) still sounds, condensed: its most important
 *   moments, a few at most, a beat apart, then its event cues.
 *
 * Every id comes from events already redacted for the viewer (connection/redactEvents.ts), so a sound never tells more than the screen may show (CR 400.2).
 */
import type { GameEvent, GameView, ObjectId, PlayerId, Step } from '@openmtg/engine';
import type { SoundId } from '../../audio/catalog';
import type { SoundCue } from '../../game/sound';
import { charsOf, isHidden } from '../model';
import { planBatch, planIsEmpty, spellStyle, type Hit, type Move, type Plan, type SpellStyle } from './plan';

/** Left-right placement: (x - the table's centre) / its half width, scaled to 0.7 so nothing sits hard in one ear. */
export function panFor(x: number, arena: { left: number; width: number }): number {
  if (!Number.isFinite(x) || !(arena.width > 0)) return 0;
  const p = ((x - (arena.left + arena.width / 2)) / (arena.width / 2)) * 0.7;
  return Math.max(-0.7, Math.min(0.7, p));
}

/** A blow's sound by its damage: 1-2 light, 3-5 medium, 6+ heavy on a card; a player's disc has its own (CR 120.3a: damage to a player is life lost). */
export function hitSound(amount: number, onPlayer: boolean): SoundId {
  if (onPlayer) return 'hit.player';
  return amount >= 6 ? 'hit.heavy' : amount >= 3 ? 'hit.medium' : 'hit.light';
}

/** Louder for more damage: 0.6 at 0, full at 6 or more. */
export function damageGain(amount: number): number {
  return 0.6 + 0.4 * Math.min(1, Math.max(0, amount) / 6);
}

/**
 * Lines a sound's accent (catalog `accent`, seconds into the sound) up with its animation's beat (`beat`, seconds at normal speed) when the animation
 * runs at `k` times its normal length: the sound starts `offset` seconds in when the beat comes sooner than the accent, or `delay` seconds later.
 */
export function alignAccent(accent: number, beat: number, k: number): { offset: number; delay: number } {
  const target = beat * k;
  return target < accent ? { offset: Math.round((accent - target) * 1000) / 1000, delay: 0 } : { offset: 0, delay: target - accent };
}

export function castSound(style: SpellStyle): SoundId {
  return `cast.${style}`;
}

export function impactSound(style: SpellStyle): SoundId {
  return `impact.${style}`;
}

const MANA_SOUNDS: Record<string, SoundId> = { W: 'mana.W', U: 'mana.U', B: 'mana.B', R: 'mana.R', G: 'mana.G', C: 'mana.C' };

/** The mana orb's sound by the mana's type (colourless for anything else). */
export function manaSound(type: string | undefined): SoundId {
  return MANA_SOUNDS[type ?? 'C'] ?? 'mana.C';
}

/** The sound of a card leaving: shattered, consumed, banished, recalled, filed away. `finishedSpell`: a resolved spell's card going to its pile, softer. */
export function exitCue(m: Move, finishedSpell = false): SoundCue {
  // A token outside the battlefield ceases to exist (CR 111.7, 704.5d): it vanishes, quietly.
  if (m.token && m.kind !== 'die' && m.kind !== 'sacrifice' && m.kind !== 'exile') return { id: 'card.exile', gain: 0.4 };
  const soft = finishedSpell ? 0.6 : undefined;
  switch (m.kind) {
    case 'die':
      return { id: 'card.destroy' };
    case 'sacrifice':
      return { id: 'card.sacrifice' };
    case 'exile':
      return { id: 'card.exile', ...(soft ? { gain: soft } : {}) };
    case 'bounce':
    case 'toHand':
      return { id: 'card.bounce' };
    case 'toLibrary':
      return { id: 'card.toLibrary', ...(soft ? { gain: soft } : {}) };
    case 'toGraveyard':
      return { id: 'card.toGraveyard', ...(soft ? { gain: soft } : {}) };
    default:
      return { id: 'card.exile', gain: 0.4 };
  }
}

function objectOf(view: GameView, id: ObjectId) {
  return view.objects[id] ?? view.lki[id]?.object;
}

function isLand(view: GameView, id: ObjectId): boolean {
  const o = view.objects[id];
  if (!o || isHidden(o)) return false;
  const chars = charsOf(view, o);
  if (chars) return chars.types.includes('Land');
  return /\bLand\b/.test(view.defs[o.defId]?.faces[o.face ?? 0]?.typeLine ?? '');
}

/** A permanent's power on `view` (0 when it has none or it cannot be told). */
export function powerOf(view: GameView, id: ObjectId): number {
  const o = view.objects[id];
  if (!o || isHidden(o)) return 0;
  const p = Number(charsOf(view, o)?.power ?? view.defs[o.defId]?.faces[o.face ?? 0]?.power ?? 0);
  return Number.isFinite(p) ? p : 0;
}

/** The lands played in this change (CR 305.1), by their new ids. */
export function landsPlayed(events: readonly GameEvent[]): Set<ObjectId> {
  return new Set(events.flatMap((e) => (e.type === 'landPlayed' ? [e.objectId] : [])));
}

/** A permanent landing on the table: a land locks in, a big creature (power 4 or more) shakes the table, a token compiles out of light. */
export function enterSound(to: GameView, id: ObjectId, lands: ReadonlySet<ObjectId>): SoundId {
  if (to.objects[id]?.kind === 'token') return 'card.token';
  if (lands.has(id) || isLand(to, id)) return 'card.land';
  return powerOf(to, id) >= 4 ? 'card.enterHeavy' : 'card.enter';
}

/** The sound of a card arriving where the animator flies it: cast to the stack, drawn or returned to a hand, landing on the table. */
export function arrivalSound(m: Move, to: GameView, lands: ReadonlySet<ObjectId>): SoundId | null {
  if (m.newId === null) return null;
  if (m.to === 'stack') return castSound(spellStyle([to], m.newId));
  if (m.to === 'hand') return m.from === 'library' ? 'card.draw' : 'card.bounce';
  if (m.to === 'battlefield') return enterSound(to, m.newId, lands);
  return null;
}

/** The banner's sound for a new turn, or none when the game's start just played (they would collide: the start already says "here we go"). */
export function bannerSound(turn: { number: number; player: PlayerId }, viewer: PlayerId | null, startedMsAgo: number): SoundId | null {
  if (turn.number <= 1 && startedMsAgo < GAME_START_QUIET_MS) return null;
  return turn.player === viewer ? 'turn.mine' : 'turn.theirs';
}

/** How long after `game.start` the first turn's banner stays quiet. */
export const GAME_START_QUIET_MS = 3000;

// ---- events without a visual ------------------------------------------------------------------------------------------------------------------

/** At most this many event cues per change. */
export const EVENT_CUE_CAP = 6;
/** At most this many taps per change (a board of taps is one gesture). */
const TAP_CAP = 3;
/** Steps whose start is never ticked: nobody gets priority in the untap step (CR 502.4), and normally not in the cleanup step (CR 514.3). */
const SILENT_STEPS: ReadonlySet<Step> = new Set<Step>(['untap', 'cleanup']);

function controllerOf(from: GameView, to: GameView, id: string): PlayerId | undefined {
  return (objectOf(to, id) ?? objectOf(from, id))?.controller;
}

/**
 * The sounds of what the animator never shows, in order, each sound once (taps up to three), at most EVENT_CUE_CAP. A tap is not heard for a creature
 * declared as an attacker in the same change (the attack is heard, CR 508.1f) or for a source that made mana in it (its mana is heard, CR 106.4).
 * `card.targeted` only for the other player's spell or ability aimed at the viewer or the viewer's permanent (CR 115.1). A new step only ticks when the
 * change has nothing louder.
 */
export function eventCues(events: readonly GameEvent[], from: GameView, to: GameView, viewer: PlayerId | null, plan?: Plan): SoundCue[] {
  const out: SoundCue[] = [];
  const once = new Set<SoundId>();
  const add = (id: SoundId, gain?: number) => {
    if (once.has(id)) return;
    once.add(id);
    out.push(gain === undefined ? { id } : { id, gain });
  };
  const attackers = new Set(events.flatMap((e) => (e.type === 'attackersDeclared' ? e.attackers.map((a) => a.attacker) : [])));
  const manaSources = new Set(events.flatMap((e) => (e.type === 'manaAdded' && e.sourceId ? [e.sourceId] : [])));
  let taps = 0;
  let untaps = 0;
  let untapMine = false;
  let step: Step | null = null;
  for (const e of events) {
    switch (e.type) {
      case 'tapped':
        if (attackers.has(e.objectId) || manaSources.has(e.objectId) || taps >= TAP_CAP) break;
        taps++;
        out.push({ id: 'card.tap' });
        break;
      case 'untapped':
        untaps++;
        if (viewer !== null && controllerOf(from, to, e.objectId) === viewer) untapMine = true;
        break;
      case 'shuffled':
        add('game.shuffle');
        break;
      case 'mulligan':
        add('game.mulligan');
        break;
      case 'coinFlipped':
        add('game.coin');
        break;
      case 'dieRolled':
        add('game.dice');
        break;
      case 'dayNight':
        add(e.to === 'day' ? 'world.day' : 'world.night');
        break;
      case 'designationChanged':
        // CR 724 (the monarch), 725 (the initiative); day and night (CR 731) also come as dayNight: one sound.
        if (e.what === 'monarch' || e.what === 'initiative') add('world.crown');
        else add(e.what === 'day' ? 'world.day' : 'world.night');
        break;
      case 'controlChanged':
        add('card.control');
        break;
      case 'attached':
        if (e.to !== null) add('card.attach');
        break;
      case 'phasedOut':
        add('card.phase');
        break;
      case 'spellCopied':
        add('spell.copied');
        break;
      case 'turnedFaceDown':
      case 'flipped':
      case 'melded':
      case 'mutated':
        add('card.flip');
        break;
      case 'actionPerformed':
        if (e.verb === 'search') add('card.search');
        else if (e.verb === 'reveal' || e.verb === 'scry' || e.verb === 'surveil') add('card.reveal');
        break;
      case 'becameTarget':
        if (viewer !== null && e.byController !== viewer && (e.objectId === viewer || controllerOf(from, to, e.objectId) === viewer)) add('card.targeted');
        break;
      case 'damagePrevented':
        add('damage.prevented');
        break;
      case 'zoneChanged':
        // Milled (CR 701.17): the library and the graveyard are piles, nothing flies between them.
        if (e.from === 'library' && e.to === 'graveyard') add('card.toGraveyard', 0.7);
        break;
      case 'stepBegan':
        step = e.step;
        break;
      default:
        break;
    }
  }
  // Untapping is one sweep for the whole board (CR 502.3), softer for the other player's.
  if (untaps > 0) add('card.untap', untapMine || viewer === null ? undefined : 0.6);
  if (step !== null && !SILENT_STEPS.has(step) && out.length === 0 && planIsEmpty(plan ?? planBatch(events, from, to))) add('turn.step');
  // A mulligan's hand goes back and is shuffled (CR 103.5): the shuffle follows the mulligan's own "again", not over it.
  const m = out.findIndex((c) => c.id === 'game.mulligan');
  const sh = out.findIndex((c) => c.id === 'game.shuffle');
  if (m >= 0 && sh >= 0 && sh < m) out.splice(m, 0, ...out.splice(sh, 1));
  return spaced(out.slice(0, EVENT_CUE_CAP), 0);
}

/**
 * Delays for cues played one after another: taps 30 ms apart, a shuffle 0.7 s after a mulligan, anything else 70 ms. The lock-on warning waits at least
 * 0.12 s, so the spell's own cast (a fire roar) does not cover its first pips.
 */
function spaced(cues: SoundCue[], start: number): SoundCue[] {
  let t = start;
  return cues.map((c, i) => {
    const prev = cues[i - 1]?.id;
    if (i > 0) t += c.id === 'card.tap' && prev === 'card.tap' ? 0.03 : c.id === 'game.shuffle' && prev === 'game.mulligan' ? 0.7 : 0.07;
    if (c.id === 'card.targeted') t = Math.max(t, start + 0.12);
    return t > 0 ? { ...c, delay: Math.round(t * 1000) / 1000 } : c;
  });
}

// ---- a change shown without animation ---------------------------------------------------------------------------------------------------------

/** A change shown at once makes at most this many sounds of its own moments, this far apart. */
export const CONDENSED_CAP = 4;
export const CONDENSED_GAP_S = 0.08;
/** ... and at most this many sounds in all, with its event cues. */
export const UNANIMATED_CAP = 6;

interface Candidate {
  cue: SoundCue;
  /** Importance: lower is kept first. */
  rank: number;
  /** When it would happen in the animation: the kept cues play in this order. */
  beat: number;
}

/** The heaviest blow of the change (spell effects, combat, other damage), with how it would sound. */
function heaviestHit(plan: Plan): { hit: Hit; style: SpellStyle | 'physical' } | null {
  let best: { hit: Hit; style: SpellStyle | 'physical' } | null = null;
  for (const s of plan.a) {
    if (s.kind !== 'resolve' && s.kind !== 'combat' && s.kind !== 'damage') continue;
    const style = s.kind === 'combat' ? 'physical' : s.style;
    for (const h of s.hits) if (!best || h.amount > best.hit.amount) best = { hit: h, style };
  }
  return best;
}

/**
 * The most important moments of a change, as the animator would have sounded them, at most CONDENSED_CAP, CONDENSED_GAP_S apart in the order they would
 * have happened: the end of the game, a new turn, destructions, the heaviest blow, life, a counter, a cast, a draw, a card landing, attacks and blocks,
 * abilities, counters, a transformation.
 */
export function condensedCues(plan: Plan, events: readonly GameEvent[], to: GameView, viewer: PlayerId | null, startedMsAgo = Infinity): SoundCue[] {
  const list: Candidate[] = [];
  const add = (cue: SoundCue, rank: number, beat: number) => {
    if (!list.some((c) => c.cue.id === cue.id)) list.push({ cue, rank, beat });
  };
  const b = plan.b;
  if (b.gameOver) add({ id: 'game.finalBlow' }, 0, 12);
  else if (b.turn) {
    const id = bannerSound(b.turn, viewer, startedMsAgo);
    if (id) add({ id }, 1, 11);
  }
  for (const m of b.moves) if (m.kind === 'die' || m.kind === 'sacrifice' || (m.kind === 'exile' && m.from === 'battlefield')) add(exitCue(m), 2, 6);
  const heavy = heaviestHit(plan);
  if (heavy) {
    const onPlayer = to.players.some((p) => p.id === heavy.hit.target);
    const gain = damageGain(heavy.hit.amount);
    add({ id: heavy.style === 'physical' || onPlayer ? hitSound(heavy.hit.amount, onPlayer) : impactSound(heavy.style), gain }, 3, 3);
  }
  for (const s of plan.a) {
    const life = s.kind === 'resolve' || s.kind === 'combat' || s.kind === 'damage' || s.kind === 'life' ? s.life : [];
    for (const l of life) {
      if (l.delta > 0) add({ id: 'life.gain' }, 4, 4);
      else if (l.delta < 0 && !l.byDamage) add({ id: 'life.loss' }, 4, 4);
    }
    if (s.kind === 'countered') add({ id: 'spell.countered' }, 4, 2);
  }
  const cast = plan.a.find((s) => s.kind === 'cast');
  if (cast?.kind === 'cast') add({ id: castSound(cast.style) }, 5, 0);
  const lands = landsPlayed(events);
  for (const m of b.moves) {
    if (m.newId === null) continue;
    if (m.to === 'stack') add({ id: castSound(spellStyle([to], m.newId)) }, 5, 0);
    else if (m.to === 'hand' && m.from === 'library') add({ id: 'card.draw', ...(m.owner === viewer || viewer === null ? {} : { gain: 0.6 }) }, 6, 8);
    else if (m.to === 'battlefield') add({ id: enterSound(to, m.newId, lands) }, 6, 7);
  }
  if (b.tokens.length > 0) add({ id: 'card.token' }, 6, 7);
  if (b.attackers.length > 0) add({ id: 'combat.attack' }, 5, 9);
  if (b.blocks.length > 0) add({ id: 'combat.block' }, 5, 9);
  for (const s of plan.a) {
    if (s.kind === 'ability') add({ id: s.triggered ? 'ability.triggered' : 'ability.activated' }, 7, 1);
    if (s.kind === 'resolve' && s.spell && !b.moves.some((m) => m.oldId === s.stackId && m.to === 'battlefield')) add({ id: 'spell.resolve' }, 7, 2);
    const counters = s.kind === 'resolve' || s.kind === 'counters' ? s.counters : [];
    for (const c of counters) add({ id: counterGood(c.counter, c.delta) ? 'counter.up' : 'counter.down' }, 8, 5);
  }
  if (events.some((e) => e.type === 'transformed' || e.type === 'turnedFaceUp')) add({ id: 'card.flip' }, 8, 10);
  const kept = list
    .map((c, i) => ({ ...c, i }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .slice(0, CONDENSED_CAP)
    .sort((x, y) => x.beat - y.beat || x.i - y.i);
  return kept.map((c, i) => (i === 0 ? c.cue : { ...c.cue, delay: Math.round(i * CONDENSED_GAP_S * 1000) / 1000 }));
}

/** A counter change is good for its permanent: +1/+1, loyalty, charge added, or a -1/-1 removed (the animator's motes use the same rule). */
export function counterGood(counter: string, delta: number): boolean {
  return delta > 0 ? !/^-/.test(counter) : /^-/.test(counter);
}

/** Everything a change shown without animation sounds like: its condensed moments, then its event cues, each sound once, at most UNANIMATED_CAP. */
export function unanimatedCues(events: readonly GameEvent[], from: GameView, to: GameView, startedMsAgo = Infinity): SoundCue[] {
  const plan = planBatch(events, from, to);
  const viewer = to.viewer;
  const main = condensedCues(plan, events, to, viewer, startedMsAgo);
  const ids = new Set(main.map((c) => c.id));
  const start = main.length * CONDENSED_GAP_S;
  const extra = eventCues(events, from, to, viewer, plan)
    .filter((c) => !ids.has(c.id))
    .map((c) => ({ ...c, delay: Math.round((start + (c.delay ?? 0)) * 1000) / 1000 }));
  return [...main, ...extra].slice(0, UNANIMATED_CAP);
}
