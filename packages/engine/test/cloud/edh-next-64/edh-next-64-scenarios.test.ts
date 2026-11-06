/**
 * Round edh-next-64 (Commander lane tokens): the behaviour it added, played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 *
 *   CR 111.3, 202.3, 604.3, 613.4a  "create a Tarmogoyf token": a {1}{G} Lhurgoyf whose power is the card types among cards in all graveyards (Disa the Restless, Tarmogoyf Nest)
 *   CR 303.4f, 303.4g, 111.1         "create a white Aura enchantment token named X attached to target creature. The token has enchant creature and \"...\"" (The Rani, Preston Garvey)
 *   CR 303.4b                        "untap each enchanted permanent you control" (an Aura is attached to each; Preston Garvey)
 *   CR 110.4b, 603.2                 "whenever a Lhurgoyf permanent card is put into your graveyard from anywhere other than the battlefield" (Disa)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const ptOf = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id)!; return [Number(c.power), Number(c.toughness)]; };

type Script = { targets?: (options: string[]) => string };
function settle(s0: GameState, o: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending as unknown as { kind: string; options: { id: string }[] & string[]; min: number; max: number; targets?: { options: { id: string }[] }[]; items: { id: string }[] };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options as unknown as string[]).slice(0, Math.max(p.min, 1)) } as never);
    else if (p.kind === 'chooseTargets') {
      const objs = (p as unknown as { objects: string[] }).objects;
      const pick = o.targets ? o.targets(objs) : objs[0];
      s = answer(s, { kind: 'chooseTargets', targets: pick === undefined ? [] : [{ kind: 'object', id: pick }] } as never);
    } else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, o: Script = {}): GameState => {
  let s = settle(s0, o);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, o);
  return s;
};
const cast = (s: GameState, name: string, o: Script = {}): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);
const tokensOf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]!.name === name);

// ---- the Tarmogoyf token ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 111.3, 202.3, 604.3: "create a Tarmogoyf token"', () => {
  const MAKER = card('Test Goyf Maker', 'Creature — Wizard', 'When this creature enters, create a Tarmogoyf token.', { pt: ['1', '1'] });
  const BOLT = card('Test Zap', 'Instant', 'Draw a card.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(MAKER)).toBe(true));
  it('the token is a green {1}{G} Lhurgoyf creature (mana value 2) whose power is the card types among cards in all graveyards and toughness one more', () => {
    const empty = cast(scenario([], { defs: [MAKER], p1: { hand: ['Test Goyf Maker'] } }), 'Test Goyf Maker');
    const [t0] = tokensOf(empty, 'Tarmogoyf');
    expect(t0).toBeDefined();
    const c = getChars(empty, t0!)!;
    expect(c.colors).toEqual(['G']);
    expect(c.subtypes).toContain('Lhurgoyf');
    expect(c.types).toEqual(['Creature']);
    expect(ptOf(empty, t0!)).toEqual([0, 1]); // no cards in graveyards
    const mv = (empty.defs[empty.objects[t0!]!.defId]!.faces[0]!.manaCost ?? []).reduce((n, x) => n + ((x as { amount?: number }).amount ?? 1), 0);
    expect(mv).toBe(2);
    // creature + instant in the two graveyards: two card types; the second creature adds none (negative: same type twice)
    const s = cast(scenario([], { defs: [MAKER, BOLT, BEAR], p1: { hand: ['Test Goyf Maker'], graveyard: ['Test Bear', 'Test Bear'] }, p2: { graveyard: ['Test Zap'] } }), 'Test Goyf Maker');
    expect(ptOf(s, tokensOf(s, 'Tarmogoyf')[0]!)).toEqual([2, 3]);
  });
});

// ---- Aura tokens -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 303.4f, 111.1: "create a white Aura enchantment token named X attached to target creature an opponent controls. The token has enchant creature and ..."', () => {
  const WARD = card('Test Brander', 'Creature — Bird', 'When this creature enters, create a white Aura enchantment token named Brand attached to target creature an opponent controls. That token has enchant creature and "Enchanted creature gets +2/+2."', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  it('is fully automated', () => expect(full(WARD)).toBe(true));
  it('the Aura token enters attached to the chosen opponent creature (a Aura token the controller owns, enchanting what the opponent controls) and gives it +2/+2', () => {
    const s0 = scenario([], { defs: [WARD, BEAR], p1: { hand: ['Test Brander'] }, p2: { battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Brander');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const [brand] = tokensOf(s, 'Brand');
    expect(brand).toBeDefined();
    expect(s.objects[brand!]!.controller).toBe('p1');
    expect(s.objects[brand!]!.attachedTo).toBe(bear);
    expect(getChars(s, brand!)!.subtypes).toContain('Aura');
    expect(ptOf(s, bear)).toEqual([4, 4]);
  });
  it('negative: with no creature an opponent controls the token is not created (CR 303.4g)', () => {
    const s = cast(scenario([], { defs: [WARD, BEAR], p1: { hand: ['Test Brander'], battlefield: ['Test Bear'] } }), 'Test Brander');
    expect(tokensOf(s, 'Brand')).toHaveLength(0);
  });
  it('when the enchanted creature leaves, the Aura token goes to the graveyard and ceases to exist (CR 704.5m, 111.7)', () => {
    const s0 = scenario([], { defs: [WARD, BEAR, KILL], p1: { hand: ['Test Brander', 'Test Smite'] }, p2: { battlefield: ['Test Bear'] } });
    let s = cast(s0, 'Test Brander');
    expect(tokensOf(s, 'Brand')).toHaveLength(1);
    s = cast(s, 'Test Smite', { targets: (ids) => ids.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')! });
    expect(tokensOf(s, 'Brand')).toHaveLength(0);
  });
});

// ---- each enchanted permanent ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 303.4b: "untap each enchanted permanent you control"', () => {
  const UNTAP = card('Test Rouse', 'Sorcery', 'Untap each enchanted permanent you control.');
  const AURA = card('Test Boon', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(UNTAP)).toBe(true));
  it('untaps a creature with an Aura attached and leaves the unenchanted tapped creature and an opponent\'s enchanted creature tapped', () => {
    const s0 = scenario([], { defs: [UNTAP, AURA, BEAR], p1: { hand: ['Test Rouse'], battlefield: [{ name: 'Test Bear', tapped: true }, { name: 'Test Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }] } });
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1');
    const [c] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    // attach Auras by test setup: an Aura on a (ours) and one on c (the opponent's creature)
    for (const [host, owner] of [[a!, 'p1'], [c!, 'p1']] as [ObjectId, 'p1'][]) {
      const id = `o${s0.counters.object++}`;
      s0.objects[id] = { id, kind: 'card', cardId: `c${s0.counters.card++}`, defId: 'Test Boon', owner, controller: owner, zone: 'battlefield', timestamp: s0.counters.timestamp++, tapped: false, flipped: false, faceDown: false, phasedOut: false, face: 0, controlledSinceTurn: 0, counters: {}, damage: 0, deathtouchDamaged: false, attachedTo: host } as never;
      s0.zones.battlefield.push(id);
    }
    const s = cast(s0, 'Test Rouse');
    expect(s.objects[a!]!.tapped).toBe(false);
    expect(s.objects[b!]!.tapped).toBe(true);
    expect(s.objects[c!]!.tapped).toBe(true); // an Aura you control on a creature you do not control: the creature is not "yours"
  });
});

// ---- permanent card with a subtype in a graveyard trigger ------------------------------------------------------------------------------------------------------
describe('CR 110.4b, 603.2: "whenever a Lhurgoyf permanent card is put into your graveyard from anywhere other than the battlefield, put it onto the battlefield"', () => {
  const REAPER = card('Test Reaper', 'Creature — Wizard', 'Whenever a Goblin permanent card is put into your graveyard from anywhere other than the battlefield, put it onto the battlefield under your control.', { pt: ['1', '1'] });
  const MILL = card('Test Mill', 'Sorcery', 'Mill three cards.');
  const GOB = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(REAPER)).toBe(true));
  it('a milled Goblin card returns to the battlefield; a milled Bear card stays in the graveyard', () => {
    const s = cast(scenario([], { defs: [REAPER, MILL, GOB, BEAR], p1: { hand: ['Test Mill'], battlefield: ['Test Reaper'], library: ['Test Goblin', 'Test Bear', 'Test Bear'] } }), 'Test Mill');
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Goblin')).toHaveLength(1);
    expect(s.zones.graveyard['p1']!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toHaveLength(2);
  });
});
