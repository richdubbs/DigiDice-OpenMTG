/**
 * edh-d-77 (Commander coordinator D, lane exile-links, concept round): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites are checked against
 * the 2026-09-25 text unless the record says otherwise.
 *
 *   CR 607.2a, 110.2   several abilities that exile are linked to "put a creature card exiled with ~ onto the battlefield under your control"
 *   CR 702.66a, 607.2a  the cards a delve payment exiled are "exiled with ~" (the permanent the spell becomes reads them)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual') && !JSON.stringify(f.abilities).includes('"op":"manual"'));
const names = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId).sort();

/** Pass priority / pay automatically until the stack is empty and a priority decision is pending (or `stop` says so). */
function settle(s0: GameState, answers: (s: GameState) => ReturnType<typeof answer> | null = () => null, guard = 80): GameState {
  let s = s0;
  for (let i = 0; i < guard; i++) {
    const d = s.pending;
    if (d === null || s.result) break;
    if (d.kind === 'priority' && s.zones.stack.length === 0) break;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'priority') s = pass(s);
    else { const a = answers(s); if (a === null) break; s = a; }
  }
  return s;
}

let seen: string[] = [];
describe('CR 607.2a, 110.2: two abilities that exile are both linked to "put a creature card exiled with ~ onto the battlefield under your control"', () => {
  const ENGINE = card('Test Rebirth Engine', 'Artifact',
    'When ~ enters, exile all creature cards from your graveyard.\n{T}: Exile the top three cards of your library.\n{4}, {T}: Put a creature card exiled with ~ onto the battlefield under your control. It gains haste until end of turn. Activate only as a sorcery.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  const DRAW = card('Test Study', 'Instant', 'Draw a card.');
  const start = (): GameState => mpScenario({
    defs: [ENGINE, BEAR, OGRE, DRAW],
    zones: {
      p1: { hand: ['Test Rebirth Engine'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Bear', 'Test Study'], library: ['Test Ogre', 'Test Ogre', 'Test Ogre', 'Test Ogre', 'Test Ogre'] },
      p2: { battlefield: ['Plains'] }, p3: { battlefield: ['Plains'] }, p4: { battlefield: ['Plains'] },
    },
  });
  const pickBy = (want: string) => (x: GameState) => (x.pending?.kind === 'chooseObjects' ? answer(x, { kind: 'chooseObjects', ids: x.pending.options.filter((id: ObjectId) => x.objects[id]!.defId === want).slice(0, 1) } as never) : null);
  /** The engine is cast (its enters ability exiles the graveyard's creature card) and its tap ability exiles three cards from the library; then the third ability is activated. */
  const ready = (): GameState => {
    let s = settle(act(start(), { type: 'cast', player: 'p1', card: find(start(), 'Test Rebirth Engine', 'hand', 'p1') }));
    const engine = find(s, 'Test Rebirth Engine', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: engine, ability: 'p:0:1' } as never));
    return tweak(s, (t) => { t.objects[engine]!.tapped = false; }); // untapped again (a later turn)
  };
  it('is automated', () => expect(full(ENGINE), JSON.stringify(ENGINE.automation)).toBe(true));
  it('both the graveyard exile of the enters ability and the library exile of the tap ability are "exiled with ~"; a creature of the first is put onto the battlefield and has haste', () => {
    let s = ready();
    expect(names(s, s.zones.exile)).toEqual(['Test Bear', 'Test Ogre', 'Test Ogre', 'Test Ogre']);
    const engine = find(s, 'Test Rebirth Engine', 'battlefield', 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: engine, ability: 'p:0:2' } as never), pickBy('Test Bear'));
    const bear = findAll(s, 'Test Bear', 'battlefield', 'p1');
    expect(bear).toHaveLength(1);
    expect(names(s, s.zones.exile)).toEqual(['Test Ogre', 'Test Ogre', 'Test Ogre']);
    expect(getChars(s, bear[0]!)!.keywords.map((k: { keyword?: string } | string) => (typeof k === 'string' ? k : k.keyword))).toContain('haste');
  });
  it('negative: the cards offered are the exiled creature cards, and none put onto the battlefield is under the activator\'s control', () => {
    const s0 = ready();
    const engine = find(s0, 'Test Rebirth Engine', 'battlefield', 'p1');
    const s = act(s0, { type: 'activate', player: 'p1', source: engine, ability: 'p:0:2' } as never);
    const d = settle(s, (x) => { seen = x.pending?.kind === 'chooseObjects' ? names(x, x.pending.options) : []; return pickBy('Test Ogre')(x); });
    expect(seen).toEqual(['Test Bear', 'Test Ogre', 'Test Ogre', 'Test Ogre']);
    expect(findAll(d, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
    expect(findAll(d, 'Test Ogre', 'battlefield', 'p1')).toHaveLength(1);
    expect(names(d, d.zones.exile)).toEqual(['Test Bear', 'Test Ogre', 'Test Ogre']);
  });
});

describe('CR 702.66a, 607.2a: the cards a delve payment exiled are "exiled with ~" for the permanent the spell becomes', () => {
  const DELVER = card('Test Delver', 'Creature — Drake', 'Delve\nHaste\nWhenever ~ attacks, you may return an instant or sorcery card exiled with ~ to its owner\'s hand.', { cost: '{3}', pt: ['2', '2'] });
  const BOLT = card('Test Bolt', 'Instant', 'Draw a card.');
  const CLUE = card('Test Relic', 'Artifact', '');
  const start = (): GameState => mpScenario({
    defs: [DELVER, BOLT, CLUE],
    zones: {
      p1: { hand: ['Test Delver'], battlefield: ['Plains', 'Plains'], graveyard: ['Test Bolt', 'Test Relic', 'Test Bolt'] },
      p2: { battlefield: ['Plains'] }, p3: { battlefield: ['Plains'] }, p4: { battlefield: ['Plains'] },
    },
  });
  /** Cast the delver exiling the two named kinds of graveyard cards for delve. */
  const castDelving = (s0: GameState, ...want: string[]): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Delver', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseObjects');
    const pend = s.pending as unknown as { options: ObjectId[] };
    s = answer(s, { kind: 'chooseObjects', ids: want.map((w) => pend.options.find((id) => s0.objects[id]!.defId === w && !want.slice(0, want.indexOf(w)).includes(id as never))!) } as never);
    return settle(s);
  };
  it('is automated', () => expect(full(DELVER), JSON.stringify(DELVER.automation)).toBe(true));
  it('the exiled graveyard cards are linked to the permanent; attacking, its controller may return the instant (not the artifact) to its owner\'s hand', () => {
    let s = castDelving(start(), 'Test Bolt', 'Test Relic');
    const delver = find(s, 'Test Delver', 'battlefield', 'p1');
    expect(names(s, s.zones.exile)).toEqual(['Test Bolt', 'Test Relic']);
    for (let i = 0; i < 12 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: delver, defender: 'p2' }] } as never);
    let offered: string[] = [];
    s = settle(s, (x) => {
      if (x.pending?.kind === 'chooseObjects') { offered = names(x, x.pending.options); return answer(x, { kind: 'chooseObjects', ids: x.pending.options.slice(0, 1) } as never); }
      if (x.pending?.kind === 'yesNo') return answer(x, { kind: 'yesNo', yes: true });
      return null;
    });
    expect(offered).toEqual(['Test Bolt']);
    expect(names(s, s.zones.hand.p1!)).toContain('Test Bolt');
    expect(names(s, s.zones.exile)).toEqual(['Test Relic']);
  });
  it('negative: cards that were not exiled to pay (the other Bolt and the Relic stay in the graveyard) are not offered', () => {
    let s = castDelving(start(), 'Test Bolt');
    const delver = find(s, 'Test Delver', 'battlefield', 'p1');
    for (let i = 0; i < 12 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: delver, defender: 'p2' }] } as never);
    let offered: string[] = [];
    s = settle(s, (x) => {
      if (x.pending?.kind === 'chooseObjects') { offered = names(x, x.pending.options); return answer(x, { kind: 'chooseObjects', ids: [] } as never); }
      if (x.pending?.kind === 'yesNo') return answer(x, { kind: 'yesNo', yes: true });
      return null;
    });
    expect(offered).toEqual(['Test Bolt']); // the Bolt left in the graveyard and the Relic never left it: only the one exiled to pay is offered
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Bolt', 'Test Relic']);
  });
});

describe('CR 607.2a, 614.1c, 122.6: "~ enters with a +1/+1 counter on it for each instant and sorcery card exiled with it" counts the cards the delve payment exiled', () => {
  const REGENT = card('Test Regent', 'Creature — Dragon', 'Delve\nFlying\n~ enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.', { cost: '{4}', pt: ['3', '3'] });
  const BOLT = card('Test Bolt', 'Instant', 'Draw a card.');
  const RITE = card('Test Rite', 'Sorcery', 'Draw a card.');
  const CLUE = card('Test Relic', 'Artifact', '');
  const start = (): GameState => mpScenario({
    defs: [REGENT, BOLT, RITE, CLUE],
    zones: {
      p1: { hand: ['Test Regent'], battlefield: ['Plains'], graveyard: ['Test Bolt', 'Test Rite', 'Test Relic', 'Test Relic', 'Test Relic'] },
      p2: { battlefield: ['Plains'] }, p3: { battlefield: ['Plains'] }, p4: { battlefield: ['Plains'] },
    },
  });
  /** Cast the regent exiling one card of each named kind for delve (three cards pay {3}). */
  const cast = (...want: string[]): GameState => {
    const s0 = start();
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Regent', 'hand', 'p1') });
    const pend = s.pending as unknown as { options: ObjectId[] };
    const used: ObjectId[] = [];
    for (const w of want) used.push(pend.options.find((id) => s0.objects[id]!.defId === w && !used.includes(id))!);
    s = answer(s, { kind: 'chooseObjects', ids: used } as never);
    return settle(s);
  };
  const dbg = (s: GameState): string => JSON.stringify([s.objects[find(s, 'Test Regent', 'battlefield', 'p1')]!.counters, (s.objects[find(s, 'Test Regent', 'battlefield', 'p1')] as unknown as { links?: unknown }).links]);
  const counters = (s: GameState): number => s.objects[find(s, 'Test Regent', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(REGENT), JSON.stringify(REGENT.automation)).toBe(true));
  it('exiling an instant, a sorcery and an artifact with delve: two counters (the artifact is not counted)', () => { const s = cast('Test Bolt', 'Test Rite', 'Test Relic'); expect(counters(s), dbg(s)).toBe(2); });
  it('negative: exiling only artifacts with delve gives no counters; the Regent is a 3/3', () => expect(counters(cast('Test Relic', 'Test Relic', 'Test Relic'))).toBe(0));
});

describe('CR 607.2q, 702.66a: delve on an instant or sorcery links nothing (only the permanent a spell becomes remembers the cards)', () => {
  it('a sorcery with delve that reads "cards exiled with ~" is not automated', () => {
    const d = card('Test Dredge', 'Sorcery', 'Delve\nDraw a card for each card exiled with ~.', { cost: '{3}' });
    expect(full(d)).toBe(false);
  });
});
