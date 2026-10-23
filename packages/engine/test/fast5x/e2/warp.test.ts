/**
 * FAST5X E2: warp (CR 702.185) on the game path, with real fixture cards. "Warp [cost]" means "You may cast this card from your hand by paying [cost] rather
 * than its mana cost" and "If this spell's warp cost was paid, exile the permanent this spell becomes at the beginning of the next end step. Its owner may
 * cast this card after the current turn has ended for as long as it remains exiled" (CR 702.185a; alternative cost, CR 118.9, 601.2b, 601.2f-h). The
 * delayed triggered ability (CR 603.7) is created as the spell resolves and acts on the permanent only while it is the same object (CR 400.7); "a spell was
 * warped this turn" means a spell was cast for its warp cost this turn (CR 702.185c), the history the void ability word reads (CR 207.2c).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type GameState } from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, answer, cast, drive, find, lands, next, onField, resolveTop, scenario, target } from '../../m6/dfc/support';
import { logHas } from '../../m4/helpers';

const MECHAN = 'Red Tiger Mechan'; // {3}{R} 3/3 haste, Warp {1}{R}
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const exile = (s: GameState): string[] => names(s, s.zones.exile);
const field = (s: GameState): string[] => names(s, s.zones.battlefield).filter((n) => !['Mountain', 'Swamp', 'Plains'].includes(n));
const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;

/** p1 casts `name` from their hand for its warp cost (CR 702.185a, 601.2b) and pays automatically. */
const warp = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), method: 'warp' }));
/** The labels of p1's legal cast actions for `name`. */
const castLabels = (s: GameState, name: string): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!] && s.defs[s.objects[a.object!]!.defId]!.name === name).map((a) => a.label);
/** One step forward; two triggers at once are put on the stack in the listed order (CR 603.3b). */
const step = (s: GameState): GameState => {
  if (s.pending?.kind === 'order') return answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
  if (s.pending?.kind === 'manualResolve') return answer(s, { kind: 'manualResolve', ops: [] }); // a manual ability (not under test): its controller does nothing
  if (s.pending?.kind === 'chooseTargets') return answer(s, { kind: 'chooseTargets', targets: [] });
  return next(s);
};
function until(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t); i++) t = step(t);
  if (!done(t)) throw new Error('until: not reached');
  return t;
}
const atEndStep = (s: GameState): GameState => until(s, (t) => t.turn.step === 'end' && t.pending?.kind === 'priority');
const resolveAll = (s: GameState): GameState => until(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority', 40);
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => until(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);

function board(extra: { hand?: string[]; battlefield?: string[]; p2?: { hand?: string[]; battlefield?: string[] } } = {}): GameState {
  return scenario([MECHAN, 'Mountain', 'Swamp', 'Murder', 'Kavaron Skywarden', 'Bygone Colossus', ...(extra.hand ?? []), ...(extra.battlefield ?? [])], {
    p1: { hand: [MECHAN, ...(extra.hand ?? [])], battlefield: [...lands('Mountain', 4), ...(extra.battlefield ?? [])] },
    p2: { hand: extra.p2?.hand ?? [], battlefield: [...lands('Mountain', 4), ...(extra.p2?.battlefield ?? [])] },
  });
}

describe('FAST5X E2: warp is a capability; the warp cards compile full', () => {
  it('keyword:warp and its parts are registered (CR 702.185a, 118.9, 603.7)', () => {
    for (const c of ['keyword:warp', 'feature:alternativeCost.delay', 'feature:permit.cast.laterTurn', 'feature:ev.cast.via']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    for (const name of [MECHAN, 'Bygone Colossus', 'Knight Luminary', 'Germinating Wurm', 'Starwinder', 'Eusocial Engineering', 'Haliya, Guided by Light', 'Sinister Cryologist']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
});

describe('CR 702.185a: casting for the warp cost, the exile at the next end step, the cast from exile on a later turn', () => {
  it('pays the warp cost instead of the mana cost (CR 118.9, 601.2f) and records it (CR 400.7d)', () => {
    let s = board();
    expect(castLabels(s, MECHAN).length).toBeGreaterThanOrEqual(2); // normally and for its warp cost
    s = warp(s, MECHAN);
    expect(tapped(s)).toBe(2); // {1}{R}, not {3}{R}
    s = resolveTop(s);
    const m = onField(s, MECHAN);
    expect(s.objects[m]!.cast?.via).toBe('warp');
    expect(s.delayedTriggers).toHaveLength(1);
    expect(logHas(s, /warp cost was paid, so a delayed triggered ability is created/, 'CR 702.185a')).toBe(true);
    // CR 702.185c: the cast is in the history as a spell cast for its warp cost
    expect(s.history.some((e) => e.ev === 'cast' && e.facts['via'] === 'warp')).toBe(true);
  });

  it('exiles it at the beginning of the next end step; castable from exile only after this turn, for its mana cost, as a sorcery-speed creature (CR 702.185a, 400.7)', () => {
    let s = resolveTop(warp(board(), MECHAN));
    s = atEndStep(s);
    expect(s.zones.stack).toHaveLength(1); // the delayed triggered ability (CR 603.7)
    s = resolveTop(s);
    expect(field(s)).toEqual([]);
    expect(exile(s)).toEqual([MECHAN]);
    const card = s.zones.exile[0]!;
    expect(s.delayedTriggers).toHaveLength(0); // it triggers once (CR 603.7b)
    // still the turn it was exiled: no cast permission yet ("after the current turn has ended")
    expect(castLabels(s, MECHAN)).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card }).error).toBeDefined();
    // p2's turn: the permission is there, but a creature is cast at sorcery speed in its owner's main phase only (CR 307.1, 601.3)
    s = mainOf(s, 'p2');
    expect(s.zones.exile).toContain(card);
    s = mainOf(s, 'p1');
    expect(s.zones.exile).toContain(card);
    expect(castLabels(s, MECHAN)).toEqual([`Cast ${MECHAN} from exile`]);
    // the warp cost works only from the hand (CR 702.185a)
    expect(applyAction(s, { type: 'cast', player: 'p1', card, method: 'warp' }).error?.rules).toContain('CR 118.9');
    const before = tapped(s);
    s = drive(act(s, { type: 'cast', player: 'p1', card }));
    expect(tapped(s) - before).toBe(4); // its mana cost {3}{R}
    s = resolveTop(s);
    const m = onField(s, MECHAN);
    expect(s.objects[m]!.cast?.via).toBeUndefined();
    expect(s.delayedTriggers).toHaveLength(0); // not warped this time: it stays
    s = atEndStep(s);
    expect(s.zones.stack).toHaveLength(0);
    s = mainOf(s, 'p2');
    expect(field(s)).toEqual([MECHAN]);
  });

  it('CR 400.7: a warped permanent that left the battlefield before the end step is not exiled, and its card gets no permission', () => {
    let s = resolveTop(warp(board({ hand: ['Murder'], battlefield: lands('Swamp', 3) }), MECHAN));
    s = resolveTop(cast(s, 'Murder', [target(onField(s, MECHAN))]));
    const card = find(s, MECHAN, 'graveyard', 'p1');
    s = atEndStep(s);
    s = resolveAll(s);
    expect(s.zones.graveyard['p1']).toContain(card); // still in the graveyard: a new object (CR 400.7)
    expect(exile(s)).toEqual([]);
    s = mainOf(s, 'p1');
    expect(castLabels(s, MECHAN)).toEqual([]);
  });

  it('the permission lasts only as long as the card remains exiled: a card that leaves exile is a new object (CR 702.185a, 400.7)', () => {
    let s = resolveTop(warp(board(), MECHAN));
    s = resolveTop(atEndStep(s));
    const card = s.zones.exile[0]!;
    s = mainOf(s, 'p1');
    expect(castLabels(s, MECHAN)).toHaveLength(1);
    // the card is put into its owner's hand by some effect: no longer exiled, so the permission names nothing; from the hand it is cast normally again
    const t = structuredClone(s);
    t.objects[card]!.zone = 'hand';
    t.zones.exile = t.zones.exile.filter((id) => id !== card);
    t.zones.hand['p1']!.push(card);
    expect(castLabels(t, MECHAN).some((l) => /exile/.test(l))).toBe(false);
  });
});

describe('CR 207.2c void / 702.185c: "a spell was warped this turn"', () => {
  it('Kavaron Skywarden gets a counter at your end step after you warped a spell; not after a quiet turn', () => {
    let s = resolveTop(warp(board({ battlefield: ['Kavaron Skywarden'] }), MECHAN));
    s = atEndStep(s);
    expect(s.zones.stack).toHaveLength(2); // the Skywarden's trigger and the warp exile
    s = resolveAll(s);
    const sky = onField(s, 'Kavaron Skywarden');
    expect(s.objects[sky]!.counters['+1/+1']).toBe(1);
    s = mainOf(s, 'p1');
    s = atEndStep(s);
    expect(s.zones.stack).toHaveLength(0); // nothing left the battlefield and no spell was warped this turn: no trigger (CR 603.4)
    expect(s.objects[sky]!.counters['+1/+1']).toBe(1);
  });

  it('any player\'s warped spell counts (CR 702.185c); a spell cast normally does not', () => {
    let s = board({ battlefield: ['Kavaron Skywarden'], p2: { hand: [MECHAN] } });
    s = mainOf(s, 'p2');
    s = resolveTop(warp(s, MECHAN, 'p2'));
    // p2's end step: Kavaron's trigger is "your end step" (p1's), so on p1's turn the history of p2's turn does not count
    s = mainOf(s, 'p1');
    s = resolveTop(cast(s, MECHAN)); // cast normally
    s = atEndStep(s);
    expect(s.zones.stack).toHaveLength(0);
    // a warped spell this turn by the opponent counts: tested on the history directly
    expect(s.history.filter((e) => e.ev === 'cast' && e.facts['via'] === 'warp').map((e) => e.actor)).toEqual(['p2']);
  });
});

describe('"You may cast this card from your graveyard using its warp ability" (CR 702.185a, 601.3, 113.6f; static:castWith)', () => {
  const CULLER = 'Timeline Culler'; // {B}{B} 2/2 haste; Warp--{B}, Pay 2 life.
  const culler = (): GameState => scenario([CULLER, 'Swamp', 'Kavaron Skywarden'], {
    p1: { graveyard: [CULLER], hand: [CULLER], battlefield: [...lands('Swamp', 3), 'Kavaron Skywarden'] },
    p2: { battlefield: lands('Swamp', 2) },
  });

  it('compiles full; from the graveyard it is cast only for its warp cost, which pays {B} and 2 life; the warp exile and the later cast from exile follow', () => {
    expect(compileCard(getCard(CULLER)).automation.level).toBe('full');
    let s = culler();
    const inGy = find(s, CULLER, 'graveyard', 'p1');
    const gyActions = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === inGy);
    expect(gyActions.map((a) => a.label)).toEqual([`Cast ${CULLER} (warp)`]); // never for its mana cost from there (CR 601.3)
    expect(applyAction(s, { type: 'cast', player: 'p1', card: inGy }).error).toBeDefined();
    const life = s.players.find((p) => p.id === 'p1')!.life;
    s = resolveTop(drive(act(s, gyActions[0]!.action)));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life - 2);
    expect(tapped(s)).toBe(1);
    const m = onField(s, CULLER);
    expect(s.objects[m]!.cast?.from).toBe('graveyard');
    expect(s.history.some((e) => e.ev === 'cast' && typeof e.facts['via'] === 'string' && String(e.facts['via']).startsWith('warp'))).toBe(true);
    s = atEndStep(s);
    expect(s.zones.stack).toHaveLength(2); // the warp exile, and the Skywarden's void trigger: a spell was warped this turn (CR 702.185c)
    s = resolveAll(s);
    expect(exile(s)).toEqual([CULLER]);
    expect(s.objects[onField(s, 'Kavaron Skywarden')]!.counters['+1/+1']).toBe(1);
    s = mainOf(s, 'p1');
    expect(castLabels(s, CULLER)).toContain(`Cast ${CULLER} from exile`);
  });

  it('the copy in the hand still has the warp cost from the hand only (CR 702.185a)', () => {
    const s = culler();
    expect(castLabels(s, CULLER)).toEqual(expect.arrayContaining([`Cast ${CULLER}`, `Cast ${CULLER} (warp)`]));
  });
});

describe('"Put target exiled card with warp on the bottom of its owner\'s library" (CR 406.1, 115.1, 702.185b; Blade of the Swarm)', () => {
  it('targets a card in exile that has warp; never one without warp, never a card elsewhere; the card goes to the bottom of its owner\'s library', () => {
    expect(compileCard(getCard('Blade of the Swarm')).automation.level).toBe('full');
    let s = scenario(['Blade of the Swarm', 'Swamp', MECHAN, 'Murder'], {
      p1: { hand: ['Blade of the Swarm'], battlefield: lands('Swamp', 4) },
      p2: { exile: [MECHAN, 'Murder'], graveyard: [MECHAN] },
    });
    const exiled = find(s, MECHAN, 'exile', 'p2');
    s = resolveTop(cast(s, 'Blade of the Swarm')); // the creature resolves; its enters trigger asks for a mode
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    expect(s.pending?.kind).toBe('chooseTargets');
    const legal = JSON.stringify(s.pending);
    expect(legal).toContain(exiled);
    expect(legal).not.toContain(find(s, 'Murder', 'exile', 'p2')); // no warp
    expect(legal).not.toContain(find(s, MECHAN, 'graveyard', 'p2')); // not exiled
    s = drive(s, [target(exiled)]);
    s = resolveAll(s);
    expect(s.zones.exile).not.toContain(exiled);
    const lib = s.zones.library['p2']!;
    expect(names(s, [lib[lib.length - 1]!])).toEqual([MECHAN]);
  });
});

describe('Warp {X}{G} (CR 107.3a, 118.9, 702.185a; Broodguard Elite)', () => {
  it('X is announced for the warp cost and the permanent enters with X counters; it is exiled at the next end step all the same', () => {
    let s = scenario(['Broodguard Elite', 'Forest'], { p1: { hand: ['Broodguard Elite'], battlefield: lands('Forest', 4) } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Broodguard Elite', 'hand', 'p1'), method: 'warp' }), [{ kind: 'chooseNumber', n: 3 }]);
    expect(tapped(s)).toBe(4); // {3}{G}
    s = resolveTop(s);
    const b = onField(s, 'Broodguard Elite');
    expect(s.objects[b]!.counters['+1/+1']).toBe(3);
    expect(s.objects[b]!.cast?.x).toBe(3);
    s = resolveAll(atEndStep(s));
    expect(exile(s)).toEqual(['Broodguard Elite']);
  });
});
