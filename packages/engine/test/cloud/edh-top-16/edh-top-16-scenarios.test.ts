/**
 * Commander lane edh-top, round edh-top-16: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 706.1, 706.2, 508.1b-c, 608.2c "At the beginning of combat on your turn, each player rolls a d20. If one or more opponents had the highest result, ~ can't attack those players or planeswalkers they control this combat." (Chaos Dragon)
 *   CR 702.76a, 604.1, 613.1f, 601.2b  "Dinosaur spells you cast have prowl {2}{R}." (Hunting Velociraptor)
 *   CR 706.2, 603.12, 115.1, 601.2c  "Whenever ~ deals combat damage to a player, roll a d20. When you do, put any number of target creature cards with total mana value X or less from graveyards onto the battlefield under your control, where X is the result." (Ancient Brass Dragon)
 *   CR 706.1, 706.2, 107.3m, 608.2h  "When this Vehicle enters, roll X six-sided dice. For each odd result, create a 1/1 ... token. For each even result, put a +1/+1 counter on ~." (Clown Car)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, life, pass, reject, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { attackUnblocked, declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toStep } from '../../m4/helpers';
import { card as card3, resolveAll as resolveAll3, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
function drive(s0: GameState, o: { x?: number } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: { x?: number } = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const counters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

describe('CR 706.1, 706.2, 107.3m: "When this Vehicle enters, roll X six-sided dice. For each odd result, create ... For each even result, put a +1/+1 counter on ~."', () => {
  const CAR = card('Test Car', 'Artifact — Vehicle', 'When ~ enters, roll X six-sided dice. For each odd result, create a 1/1 white Clown Robot artifact creature token. For each even result, put a +1/+1 counter on ~.\nCrew 2', { cost: '{X}' });
  const play = (seed: string, x: number): { s: GameState; tokens: number; counters: number } => {
    const s0 = scenario(['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], { defs: [CAR], seed, p1: { hand: ['Test Car'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Car', 'hand', 'p1') }), { x }), { x });
    const car = findAll(s, 'Test Car', 'battlefield', 'p1')[0]!;
    return { s, tokens: findAll(s, 'Clown Robot Token', 'battlefield', 'p1').length, counters: counters(s, car) };
  };
  it('is automated', () => {
    expect(CAR.automation.level).toBe('full');
  });
  it('X dice: every die is one token (odd) or one counter (even), so the two add up to X (several seeds)', () => {
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const r = play(seed, 5);
      expect(r.tokens + r.counters, seed).toBe(5);
      seen.add(`${r.tokens}/${r.counters}`);
    }
    expect(seen.size).toBeGreaterThan(1); // the dice are really rolled: not the same split for every seed
  });
  it('X = 0 rolls no dice: no token and no counter (negative)', () => {
    const r = play('z', 0);
    expect(r.tokens + r.counters).toBe(0);
  });
});

describe('CR 706.2, 508.1b, 508.1c, 608.2c: "At the beginning of combat on your turn, each player rolls a d20. If one or more opponents had the highest result, ~ can\'t attack those players or planeswalkers they control this combat."', () => {
  const DRAGON = card('Test Dragon', 'Creature — Dragon', "Flying\nAt the beginning of combat on your turn, each player rolls a d20. If one or more opponents had the highest result, ~ can't attack those players or planeswalkers they control this combat.", { pt: ['4', '4'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Planeswalker — Test', oracle_text: '', colors: [], loyalty: '4' } as OracleCard);
  const rolls = (s: GameState): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const l of s.log) {
      const m = /^(\w+) rolls a d20: (\d+)\./.exec(l.text);
      if (m) out[s.players.find((p) => p.name === m[1])!.id] = Number(m[2]);
    }
    return out;
  };
  const r2 = (r: Record<string, number>): number[] => Object.values(r);
  const start = (seed: string): GameState => toDeclareAttackers(mpScenario({ players: 3, seed, defs: [DRAGON, BEAR, WALKER], zones: { p1: { battlefield: ['Test Dragon', 'Test Bear'] }, p2: { battlefield: ['Test Walker'] } },
    setup: (st) => { const w = Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Walker')!; w.counters['loyalty'] = 4; } }));
  it('is automated', () => {
    expect(DRAGON.automation.level).toBe('full');
  });
  it('an opponent who rolled the highest result can be attacked by the Dragon neither as a player nor through their planeswalker; the other opponent, the Bear and a lower roll are free (several seeds)', () => {
    let banned = 0;
    let free = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p']) {
      const s = start(seed);
      const r = rolls(s);
      expect(Object.keys(r).sort(), seed).toEqual(['p1', 'p2', 'p3']);
      const top = Math.max(...r2(r));
      const dragon = find(s, 'Test Dragon', 'battlefield');
      const bear = find(s, 'Test Bear', 'battlefield');
      const walker = find(s, 'Test Walker', 'battlefield', 'p2');
      const d = s.pending;
      if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
      const tryAttack = (attacker: ObjectId, defender: string): boolean => applyAction(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker, defender }] } } as never).error === undefined;
      for (const opp of ['p2', 'p3']) {
        const ban = r[opp] === top;
        expect(tryAttack(dragon, opp), `${seed}: Dragon attacks ${opp} (rolls ${JSON.stringify(r)})`).toBe(!ban);
        expect(tryAttack(bear, opp), `${seed}: Bear attacks ${opp}`).toBe(true);
        if (ban) banned++; else free++;
      }
      expect(tryAttack(dragon, walker), `${seed}: Dragon attacks p2's planeswalker (rolls ${JSON.stringify(r)})`).toBe(r['p2'] !== top);
    }
    expect(banned).toBeGreaterThan(0); // the seeds include both outcomes
    expect(free).toBeGreaterThan(0);
  });
  it('the controller having the highest roll alone bans nothing (negative); a tie between the controller and an opponent bans that opponent', () => {
    let alone = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']) {
      const s = start(seed);
      const r = rolls(s);
      const top = Math.max(...r2(r));
      if (!(r['p1'] === top && r['p2'] !== top && r['p3'] !== top)) continue;
      alone++;
      const d = s.pending;
      if (d?.kind !== 'declareAttackers') throw new Error('no declareAttackers');
      const dragon = find(s, 'Test Dragon', 'battlefield');
      for (const opp of ['p2', 'p3']) expect(applyAction(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: dragon, defender: opp }] } } as never).error, `${seed}: ${opp}`).toBeUndefined();
    }
    expect(alone).toBeGreaterThan(0);
  });
});

describe('CR 702.76a, 613.1f, 601.2b: "Dinosaur spells you cast have prowl {1}."', () => {
  const RAPTOR = card3('Test Raptor', 'Creature — Dinosaur', 'Dinosaur spells you cast have prowl {1}.', ['2', '2']);
  const BITER = card3('Test Biter', 'Creature — Dinosaur', '', ['2', '2']);
  const GOBLIN = card3('Test Goblin', 'Creature — Goblin', '', ['2', '2']);
  const FEAST = card3('Test Feast', 'Kindred Sorcery — Dinosaur', 'You gain 1 life. If ~\'s prowl cost was paid, you gain 4 life.', undefined, '{5}');
  const SNACK = card3('Test Snack', 'Sorcery', 'You gain 1 life.', undefined, '{5}');
  const DEFS = [RAPTOR, BITER, GOBLIN, FEAST, SNACK];
  const setup = (bf: string[]): GameState => scenario(['Plains'], { p1: { battlefield: ['Plains', ...bf], hand: ['Test Feast', 'Test Snack'] }, defs: DEFS });
  const hit = (s: GameState, name: string): GameState => toStep(attackUnblocked(s, [find(s, name, 'battlefield', 'p1')]), 'main2');
  it('is automated', () => {
    expect(RAPTOR.automation.level).toBe('full');
  });
  it('with the Dinosaur on the battlefield, after a Dinosaur dealt combat damage to a player, a Dinosaur spell is cast for its prowl cost: the extra life shows the prowl cost was paid', () => {
    let s = hit(setup(['Test Raptor', 'Test Biter']), 'Test Biter');
    const l0 = life(s, 'p1');
    s = resolveAll3(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Feast', 'hand', 'p1'), method: 'prowl' })));
    expect(life(s, 'p1')).toBe(l0 + 5);
  });
  it('negative: without the Dinosaur that grants it the Feast has no prowl cost', () => {
    const s = hit(setup(['Test Biter']), 'Test Biter');
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Feast', 'hand', 'p1'), method: 'prowl' });
  });
  it('negative: a spell that is not a Dinosaur does not get it', () => {
    const s = hit(setup(['Test Raptor', 'Test Biter']), 'Test Biter');
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Snack', 'hand', 'p1'), method: 'prowl' });
  });
  it('negative: no combat damage by a creature that shares a type with the spell (a Goblin dealt it): the prowl cost is not offered', () => {
    const s = hit(setup(['Test Raptor', 'Test Goblin']), 'Test Goblin');
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Feast', 'hand', 'p1'), method: 'prowl' });
  });
});

describe('CR 706.2, 603.12, 115.1: "Whenever ~ deals combat damage to a player, roll a d20. When you do, put any number of target creature cards with total mana value X or less from graveyards onto the battlefield under your control, where X is the result."', () => {
  const BRASS = card3('Test Brass', 'Creature — Dragon', 'Flying\nWhenever ~ deals combat damage to a player, roll a d20. When you do, put any number of target creature cards with total mana value X or less from graveyards onto the battlefield under your control, where X is the result.', ['4', '4']);
  const BIG = card3('Test Big Ogre', 'Creature — Ogre', '', ['5', '5'], '{5}{5}');
  const OLD = card3('Test Old Ogre', 'Creature — Ogre', '', ['5', '5'], '{10}');
  const DEFS = [BRASS, BIG, OLD];
  const TEN = card3('Test Ten', 'Creature — Ogre', '', ['5', '5'], '{10}');
  // the reflexive trigger's targets are asked once the d20 has been rolled
  const toTargets = (seed: string): { s: GameState; roll: number } => {
    const s0 = scenario([], { seed, defs: [BRASS, TEN], p1: { battlefield: ['Test Brass'], graveyard: ['Test Ten'] }, p2: { graveyard: ['Test Ten'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Brass', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.pending?.kind === 'chooseTargets', 'blockers or the targets of the reflexive trigger', 20);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    s = passUntil(s, (x) => x.pending?.kind === 'chooseTargets' || (x.zones.stack.length === 0 && x.turn.step === 'endCombat'), 'the targets of the reflexive trigger', 20);
    const roll = Number(/rolls a d20: (\d+)/.exec([...s.log].reverse().find((l) => /rolls a d20/.test(l.text))!.text)![1]);
    return { s, roll };
  };
  void DEFS; void BIG; void OLD;
  it('is automated', () => {
    expect(BRASS.automation.level).toBe('full');
  });
  it('the cards chosen together may total the d20 result or less: one Ten from any graveyard needs a 10 or more, both need a 20 (several seeds)', () => {
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't']) {
      const { s, roll } = toTargets(seed);
      seen.add(roll >= 10 ? 'high' : 'low');
      if (s.pending?.kind !== 'chooseTargets') { expect(roll, `${seed}: no target choice is asked only when no card can be chosen`).toBeLessThan(10); continue; }
      const ids = Object.values(s.objects).filter((o) => o.zone === 'graveyard' && s.defs[o.defId]?.name === 'Test Ten').map((o) => o.id);
      const d = s.pending;
      const tryTargets = (picked: string[]): boolean => applyAction(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'chooseTargets', targets: picked.map((id) => ({ kind: 'object', id })) } } as never).error === undefined;
      expect(tryTargets([ids[0]!]), `${seed}: one Ten with roll ${roll}`).toBe(roll >= 10);
      expect(tryTargets(ids), `${seed}: two Tens (one from each graveyard) with roll ${roll}`).toBe(roll >= 20);
    }
    expect(seen.size).toBe(2);
  });
  it('a legal choice is put onto the battlefield under the controller\'s control, from the graveyard of any player', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { s, roll } = toTargets(seed);
      if (s.pending?.kind !== 'chooseTargets' || roll < 10) continue;
      const mine = Object.values(s.objects).find((o) => o.zone === 'graveyard' && o.owner === 'p2' && s.defs[o.defId]?.name === 'Test Ten')!;
      let t = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: mine.id }] });
      for (let i = 0; i < 6 && t.zones.stack.length > 0; i++) t = pass(pass(t));
      const now = Object.values(t.objects).find((o) => o.zone === 'battlefield' && t.defs[o.defId]?.name === 'Test Ten')!;
      expect(now, seed).toBeDefined();
      expect(now.controller, seed).toBe('p1');
      expect(now.owner, seed).toBe('p2');
      return;
    }
    throw new Error('no seed rolled 10 or more');
  });
});
