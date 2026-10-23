/**
 * Merge wave 8, line e3xp (PR #75): the merger's review tests.
 *
 *   CR 608.3a, 110.2, 701.12a-b  Perplexing Chimera's exchange with a PERMANENT spell: the spell is the exchanger's on the stack, so the permanent it becomes
 *              enters under that player's control; the Chimera stays with the opponent
 *   CR 608.2b, 701.12a  the exchanged instant resolves under its new controller (its damage hits the new target)
 *   CR 614.1a, 614.5    one build, two wordings: r4-repl's passive "those tokens plus a Clue token are created instead" (Case of the Pilfered Proof) and
 *              E3XP's active "instead create those tokens plus an additional Food token" (Tippy-Toe) parse to the same replacement and both pass the render
 *              gate (wave 8 fold: before it, E3XP's renderer change took r4-repl's cards and Case of the Pilfered Proof went manual)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { lifeOf } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

interface Script { yes?: boolean[]; targets?: TargetChoice[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
const resolveTop = (s: GameState, script?: Script): GameState => drive(passBoth(s), script);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });

const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', 'Flash', '{0}', ['3', '3']); // flash: p2 casts it on p1's turn
const CHIMERA = card('Test Chimera', 'Creature — Chimera', 'Whenever an opponent casts a spell, you may exchange control of Test Chimera and that spell. If you do, you may choose new targets for the spell.', '{0}', ['2', '2']);
const DEFS = [SHOCK, BEAR, OGRE, CHIMERA];

describe('Perplexing Chimera: exchange of control with a spell (CR 701.12a-b, 108.4)', () => {
  it('CR 608.3a, 110.2: an exchanged creature spell enters under the exchanger; the Chimera stays with the opponent', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Chimera'] }, p2: { hand: ['Test Ogre'] } });
    const chimera = find(s, 'Test Chimera', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Ogre', {}, 'p2');
    const ogre = s.zones.stack.find((id) => s.objects[id]!.kind === 'card')!;
    s = resolveTop(s, { yes: [true] }); // the Chimera's trigger: exchange (the Ogre spell has no targets, so nothing more is asked)
    expect(s.objects[ogre]!.controller).toBe('p1');
    expect(s.objects[chimera]!.controller).toBe('p2');
    s = resolveTop(s); // the Ogre spell resolves
    expect(s.zones.stack).toEqual([]);
    const ogreOnBf = find(s, 'Test Ogre', 'battlefield');
    expect(s.objects[ogreOnBf]!.controller).toBe('p1');
    expect(s.objects[ogreOnBf]!.owner).toBe('p2');
    expect(s.objects[chimera]!.controller).toBe('p2'); // the exchange has no duration (CR 611.2a)
  });

  it('CR 608.2b, 701.12a: the exchanged instant resolves under its new controller and hits the new target', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Chimera', 'Test Bear'] }, p2: { hand: ['Test Shock'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Shock', { targets: [[obj(bear)]] }, 'p2');
    s = resolveTop(s, { yes: [true, true], targets: [[player('p2')]] });
    const life = lifeOf(s, 'p2');
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(life - 2);
    expect(s.zones.battlefield).toContain(bear);
    expect(s.objects[bear]!.damage ?? 0).toBe(0);
  });
});

describe('CR 614.1a, 614.5: "those tokens plus an additional <token>" in both wordings (wave 8 fold of E3XP into r4-repl)', () => {
  const active = card('Test Pantry', 'Creature — Squirrel', 'If you would create one or more tokens, instead create those tokens plus an additional Food token.', '{0}', ['1', '1']);
  const passive = card('Test Case', 'Enchantment', 'If one or more tokens would be created under your control, those tokens plus a Clue token are created instead.');
  const passiveFrog = card('Test Pond', 'Enchantment', 'If one or more tokens would be created under your control, those tokens plus a 1/1 green Frog creature token are created instead.');
  it('the flash Ogre is full (the test needs it)', () => expect(OGRE.automation.level).toBe('full'));
  it('each is full', () => {
    for (const d of [active, passive, passiveFrog]) expect(d.automation.level, d.name).toBe('full');
  });
  it('the two wordings are one replacement (same JSON but the token)', () => {
    const json = (d: CardDef): string => JSON.stringify(d.faces[0]!.abilities[0]).replace(/"(food|clue)"/gi, '"T"').replace(/"text":"[^"]*"/g, '');
    const a = JSON.parse(JSON.stringify(active.faces[0]!.abilities[0]));
    const p = JSON.parse(JSON.stringify(passive.faces[0]!.abilities[0]));
    expect(a.kind).toBe(p.kind);
    expect(json(active)).toBe(json(passive));
  });
});
