/**
 * Commander lane edh-c, round edh-c-85 (EDHREC ranks 15,501-16,000, later pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled
 * by the game's default compiler, in 4-player games. Each group has its negative cases. CR cites are checked against the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 701.8a, 109.5, 118.9  "If a noncreature permanent under your control was destroyed this turn by a spell or ability an opponent controlled, you may pay {0} rather than pay this spell's mana cost."
 *   CR 106.4, 500.5, 614.1   "Tap all lands target player controls and that player loses all unspent mana."
 *   CR 115.1, 601.2c, 608.2b "Target creature an opponent controls deals damage equal to its power to another target creature that player controls."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, mpScenario, pass } from '../../m12/rules/helpers';
import { tweak } from '../../m4/helpers';

const card = (name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);

interface Script { targets?: TargetChoice[][]; yes?: boolean }
/** Answer every decision but priority from the script (targets: one list per targets decision, in order). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = [...(script.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes ?? false });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const toPriority = (s0: GameState, who: string): GameState => { let s = s0; for (let i = 0; i < 8 && s.pending?.player !== who; i++) s = drive(pass(s)); return s; };
const castBy = (s: GameState, name: string, player: string, script?: Script, method?: string): GameState =>
  drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), ...(method ? { method } : {}) } as never), script);
const resolveAll = (s0: GameState): GameState => { let s = s0; for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(pass(s)); return s; };
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const altOk = (s: GameState, name: string, player = 'p1'): boolean => applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player), method: 'alternative' } as never).error === undefined;
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const named = (s: GameState, defId: string, player?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (player === undefined || s.objects[id]!.controller === player));
const full = (d: CardDef): boolean => d.automation.level === 'full';

describe('CR 701.8a, 109.5, 118.9: "If a noncreature permanent under your control was destroyed this turn by a spell or ability an opponent controlled, ..."', () => {
  const TRAP = card('Test Hiss Trap', 'Instant — Trap', "If a noncreature permanent under your control was destroyed this turn by a spell or ability an opponent controlled, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life.", '{4}{G}');
  const SMASH = card('Test Smash', 'Instant', 'Destroy target permanent.');
  const EXILE = card('Test Banish', 'Instant', 'Exile target permanent.');
  const RELIC = card('Test Relic', 'Artifact', '');
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['1', '1']);
  const start = (): GameState => mpScenario({ defs: [TRAP, SMASH, EXILE, RELIC, OX], zones: {
    p1: { hand: ['Test Hiss Trap', 'Test Smash'], battlefield: ['Test Relic', 'Test Ox'] },
    p2: { hand: ['Test Smash', 'Test Banish'], battlefield: ['Test Relic'] },
    p3: { hand: ['Test Smash'] },
  } });
  const by = (s0: GameState, who: string, spell: string, target: ObjectId): GameState => resolveAll(castBy(toPriority(s0, who), spell, who, { targets: [[obj(target)]] }));
  it('is automated', () => expect(full(TRAP)).toBe(true));
  it('an opponent destroys a noncreature permanent you control: the alternative cost is offered, and paying it gains 3 life', () => {
    const s0 = start();
    expect(altOk(s0, 'Test Hiss Trap')).toBe(false);
    const s1 = by(s0, 'p2', 'Test Smash', named(s0, 'Test Relic', 'p1')[0]!);
    expect(named(s1, 'Test Relic', 'p1')).toHaveLength(0);
    const back = toPriority(s1, 'p1');
    expect(altOk(back, 'Test Hiss Trap')).toBe(true);
    const s2 = resolveAll(castBy(back, 'Test Hiss Trap', 'p1', {}, 'alternative'));
    expect(life(s2, 'p1')).toBe(life(back, 'p1') + 3);
  });
  it('another opponent (the third player) counts as well', () => {
    const s0 = start();
    const s1 = by(s0, 'p3', 'Test Smash', named(s0, 'Test Relic', 'p1')[0]!);
    expect(altOk(toPriority(s1, 'p1'), 'Test Hiss Trap')).toBe(true);
  });
  it('negatives: a creature, a permanent of someone else, your own spell, an exile, and nothing destroyed', () => {
    const s0 = start();
    const creature = by(s0, 'p2', 'Test Smash', named(s0, 'Test Ox', 'p1')[0]!);
    expect(altOk(toPriority(creature, 'p1'), 'Test Hiss Trap')).toBe(false); // a creature is not a noncreature permanent
    const theirs = by(s0, 'p3', 'Test Smash', named(s0, 'Test Relic', 'p2')[0]!);
    expect(altOk(toPriority(theirs, 'p1'), 'Test Hiss Trap')).toBe(false); // not under your control
    const own = resolveAll(castBy(s0, 'Test Smash', 'p1', { targets: [[obj(named(s0, 'Test Relic', 'p1')[0]!)]] }));
    expect(named(own, 'Test Relic', 'p1')).toHaveLength(0);
    expect(altOk(own, 'Test Hiss Trap')).toBe(false); // a spell you controlled, not an opponent
    const exiled = by(s0, 'p2', 'Test Banish', named(s0, 'Test Relic', 'p1')[0]!);
    expect(named(exiled, 'Test Relic', 'p1')).toHaveLength(0);
    expect(altOk(toPriority(exiled, 'p1'), 'Test Hiss Trap')).toBe(false); // exile is not destroy (the Scryfall ruling of 2009-10-01)
  });
  it('a destroyed permanent of an earlier turn does not count', () => {
    const s0 = start();
    const s1 = by(s0, 'p2', 'Test Smash', named(s0, 'Test Relic', 'p1')[0]!);
    let s = toPriority(s1, 'p1');
    for (let i = 0; i < 60 && s.turn.number === s1.turn.number; i++) s = drive(pass(s));
    expect(s.turn.number).toBeGreaterThan(s1.turn.number);
    let t = s;
    for (let i = 0; i < 60 && t.turn.activePlayer !== 'p1'; i++) t = drive(pass(t));
    for (let i = 0; i < 60 && t.turn.step !== 'main1'; i++) t = drive(pass(t));
    expect(altOk(toPriority(t, 'p1'), 'Test Hiss Trap')).toBe(false);
  });
});

describe('CR 106.4, 500.5, 614.1: "Tap all lands target player controls and that player loses all unspent mana."', () => {
  const SHORT = card('Test Drain Pulse', 'Instant', 'Tap all lands target player controls and that player loses all unspent mana.', '{0}');
  const pool = (s: GameState, p: string): string => (s.players.find((x) => x.id === p)!.manaPool ?? []).map((u) => u.type).join('');
  const start = (): GameState => tweak(mpScenario({ defs: [SHORT], zones: { p1: { hand: ['Test Drain Pulse'], battlefield: ['Plains'] }, p2: { battlefield: ['Plains', 'Plains'] }, p3: { battlefield: ['Plains'] } } }), (s) => {
    s.players.find((x) => x.id === 'p1')!.manaPool = [{ type: 'W' }];
    s.players.find((x) => x.id === 'p2')!.manaPool = [{ type: 'G' }, { type: 'G' }, { type: 'C' }];
    s.players.find((x) => x.id === 'p3')!.manaPool = [{ type: 'R' }];
  });
  it('is automated', () => expect(full(SHORT)).toBe(true));
  it('the target player\'s lands are tapped and their pool is emptied; nobody else\'s changes', () => {
    const s0 = start();
    const s1 = resolveAll(castBy(s0, 'Test Drain Pulse', 'p1', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(pool(s1, 'p2')).toBe('');
    expect(named(s1, 'Plains', 'p2').every((id) => s1.objects[id]!.tapped)).toBe(true);
    expect(pool(s1, 'p1')).toBe('W');
    expect(pool(s1, 'p3')).toBe('R');
    expect(named(s1, 'Plains', 'p3').every((id) => !s1.objects[id]!.tapped)).toBe(true);
    expect(named(s1, 'Plains', 'p1').every((id) => !s1.objects[id]!.tapped)).toBe(true);
  });
  it('a player with an empty pool loses nothing and the spell still taps their lands', () => {
    const s0 = tweak(start(), (s) => { s.players.find((x) => x.id === 'p3')!.manaPool = []; });
    const s1 = resolveAll(castBy(s0, 'Test Drain Pulse', 'p1', { targets: [[{ kind: 'player', id: 'p3' }]] }));
    expect(pool(s1, 'p3')).toBe('');
    expect(named(s1, 'Plains', 'p3').every((id) => s1.objects[id]!.tapped)).toBe(true);
  });
});

describe('CR 115.1, 601.2c, 608.2b: "Target creature an opponent controls deals damage equal to its power to another target creature that player controls."', () => {
  const COUP = card('Test Coup', 'Sorcery', 'Target creature an opponent controls deals damage equal to its power to another target creature that player controls.', '{0}');
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', '{0}', ['3', '5']);
  const GOAT = card('Test Goat', 'Creature — Goat', '', '{0}', ['0', '5']);
  const KILL = card('Test Slay', 'Instant', 'Destroy target creature.');
  const start = (): GameState => mpScenario({ defs: [COUP, BRUTE, GOAT, KILL], zones: {
    p1: { hand: ['Test Coup'], battlefield: ['Test Brute', 'Test Goat'] },
    p2: { battlefield: ['Test Brute', 'Test Goat'], hand: ['Test Slay'] },
    p3: { battlefield: ['Test Goat'] },
  } });
  const ids = (s: GameState) => ({ brute2: named(s, 'Test Brute', 'p2')[0]!, goat2: named(s, 'Test Goat', 'p2')[0]!, goat3: named(s, 'Test Goat', 'p3')[0]!, brute1: named(s, 'Test Brute', 'p1')[0]! });
  it('is automated', () => expect(full(COUP)).toBe(true));
  it('the first creature deals damage equal to its power to another creature of the same player', () => {
    const s0 = start(); const { brute2, goat2 } = ids(s0);
    const s1 = resolveAll(castBy(s0, 'Test Coup', 'p1', { targets: [[obj(brute2)], [obj(goat2)]] }));
    expect(s1.objects[goat2]!.damage).toBe(3);
    expect(s1.objects[brute2]!.damage).toBe(0);
  });
  it('negatives: the second target of another player, the same creature twice, and a creature of yours first are refused', () => {
    const s0 = start(); const { brute2, goat3, brute1 } = ids(s0);
    const cast = (t: ObjectId[][]): boolean => {
      let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Coup', 'hand', 'p1') } as never);
      try {
        for (const list of t) { if (s.pending?.kind !== 'chooseTargets') return false; s = answer(s, { kind: 'chooseTargets', targets: list.map(obj) }); }
        return s.pending?.kind === 'payCost' || s.pending?.kind === 'priority' || s.zones.stack.length > 0;
      } catch { return false; }
    };
    expect(cast([[brute2], [goat3]])).toBe(false);   // p3's creature is not controlled by p2
    expect(cast([[brute2], [brute2]])).toBe(false);  // "another"
    expect(cast([[brute1], [named(s0, 'Test Goat', 'p1')[0]!]])).toBe(false); // a creature of yours first (p1 has two, so only the first target's filter refuses it)
  });
  it('CR 608.2b (Scryfall ruling 2018-01-19): the damaging creature gone before resolution: no damage is dealt', () => {
    const s0 = start(); const { brute2, goat2 } = ids(s0);
    let s = castBy(s0, 'Test Coup', 'p1', { targets: [[obj(brute2)], [obj(goat2)]] });
    s = castBy(toPriority(s, 'p2'), 'Test Slay', 'p2', { targets: [[obj(brute2)]] });
    s = resolveAll(s);
    expect(s.objects[goat2]?.damage ?? 0).toBe(0);
  });
});
