/**
 * Commander lane edh-next, round edh-next-30: the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory and unverified (cloud session, no rules/cr).
 *
 *   CR 205.1b, 611.2a, 611.2c, 613.1d, 613.4b   "<group> become N/N <types> creatures in addition to their other types until end of turn" (Tangletrove Kelp)
 *   CR 608.2d, 205.1b, 613.4b                    "you may have <group> become N/N <types> artifact creatures in addition to their other types ..." (Vihaan, Goldwaker)
 *   CR 205.1b, 613.1f, 611.2a                    "It becomes an Angel in addition to its other types and gains flying." (Archangel Elspeth)
 *   CR 105.3, 205.3m, 613.1d-e, 613.4b           "you may have it become a red Dragon with base power and toughness 4/4 in addition to its other colors and types ..." (Shadow Puppeteers)
 *   CR 603.2, 603.2c, 701.9a                     "Whenever you discard one or more cards for the first time each turn, draw that many cards." (Rielle, the Everwise)
 *   CR 603.2, 603.6a, 510.3a                     "When ~ enters and whenever it deals combat damage to a player, ..." (Ivora, Insatiable Heir)
 *   CR 707.9a-b, 205.1b, 105.3, 111.10           "create a token that's a copy of it, except it's a 3/3 black Zombie creature in addition to its other types" (Anikthea, Hand of Erebos)
 *   CR 604.1, 611.3a, 613.1d, 613.1f, 613.4b     "As long as C, it's a 0/0 creature in addition to its other types and it has annihilator 2." (Idol of False Gods)
 *   CR 701.24a                                   "Target player shuffles." (Lantern of Insight)
 *   CR 701.62a                                   "manifest dread twice" (They Came from the Pipes)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, castAuto, find, findAll, legal, life, pass, passBoth, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onBf = (s: GameState, n: string, owner?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === n && (owner === undefined || s.objects[id]!.controller === owner));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const stats = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const has = (s: GameState, id: ObjectId, kw: string): boolean => hasKeyword(chars(s, id), kw);

/** Answer decisions until the stack is empty or a decision this helper does not know: targets are `targets` (by name), yes/no is `yes`. */
function settle(s0: GameState, o: { targets?: string[]; yes?: boolean } = {}): GameState {
  let s = s0;
  for (let g = 0; g < 120; g++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number } | null;
    if (p === null || p === undefined) break;
    if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      const pend = s.pending as unknown as { objects?: ObjectId[]; players?: PlayerId[]; max?: number };
      const ids = (pend.objects ?? []).filter((id) => (o.targets ?? []).includes(nameOf(s, id))).slice(0, pend.max ?? 1);
      const players = (pend.players ?? []).filter((q) => (o.targets ?? []).includes(q)).slice(0, Math.max(0, (pend.max ?? 1) - ids.length));
      s = answer(s, { kind: 'chooseTargets', targets: [...ids.map((id) => ({ kind: 'object' as const, id })), ...players.map((id) => ({ kind: 'player' as const, id }))] } as never);
    }
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, p.min ?? 1) } as never);
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(s.pending).slice(0, 300)}`);
  }
  return s;
}
const activate = (s: GameState, source: ObjectId, textStart: string): GameState => {
  const a = legal(s, 'p1', 'activate').find((l) => (l as unknown as { action: { source: ObjectId } }).action.source === source && String((l as unknown as { label?: string }).label ?? '').toLowerCase().includes(textStart.toLowerCase()));
  if (!a) throw new Error(`no activation "${textStart}" offered: ${legal(s, 'p1', 'activate').map((l) => JSON.stringify(l).slice(0, 160)).join(' | ')}`);
  return act(s, (a as unknown as { action: never }).action);
};

const ENGINE = (text: string, name = 'Test Engine'): CardDef => card(name, 'Artifact Creature — Construct', text, { pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const OPP_LAND = card('Test Swamp Land', 'Basic Land — Swamp', '');

// ---- Tangletrove Kelp: a group becomes creatures in addition to its other types ------------------------------------------------------------------------------------------------

const TREMOR = ENGINE('{0}: Lands you control become 2/2 Elemental Warrior creatures in addition to their other types until end of turn.');
describe('CR 205.1b, 611.2c, 613.4b: "<group> become 2/2 Elemental Warrior creatures in addition to their other types until end of turn"', () => {
  it('is automated', () => expect(full(TREMOR)).toBe(true));
  it('each land its controller has becomes a 2/2 creature that is still a land; the opponent\'s land is not changed', () => {
    let s = scenario([], { defs: [TREMOR, OPP_LAND], p1: { battlefield: ['Test Engine', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Swamp Land'] } });
    s = settle(activate(s, onBf(s, 'Test Engine')[0]!, 'lands'));
    for (const id of onBf(s, 'Plains', 'p1')) {
      expect(chars(s, id).types).toEqual(expect.arrayContaining(['Land', 'Creature']));
      expect(chars(s, id).subtypes).toEqual(expect.arrayContaining(['Plains', 'Elemental', 'Warrior']));
      expect(stats(s, id)).toBe('2/2');
    }
    expect(chars(s, onBf(s, 'Test Swamp Land')[0]!).types).not.toContain('Creature');
  });
  it('CR 611.2c: a land that enters after the ability resolved is not changed (the affected set is fixed as the ability resolves)', () => {
    let s = scenario([], { defs: [TREMOR], p1: { battlefield: ['Test Engine', 'Plains'] } });
    s = settle(activate(s, onBf(s, 'Test Engine')[0]!, 'lands'));
    const late = put(s, 'p1', 'battlefield', 'Plains');
    expect(onBf(s, 'Plains').length).toBe(2);
    expect(chars(s, late).types).not.toContain('Creature');
    expect(onBf(s, 'Plains').filter((id) => chars(s, id).types.includes('Creature')).length).toBe(1);
  });
});

// ---- Vihaan, Goldwaker: "you may have <group> become ... artifact creatures" -----------------------------------------------------------------------------------------------------------

const FORGE = ENGINE('{0}: You may have Treasures you control become 3/3 Construct Soldier artifact creatures in addition to their other types until end of turn.', 'Test Forge');
const TREASURE = card('Test Treasure', 'Artifact — Treasure', '');
describe('CR 608.2d, 205.1b, 613.4b: "you may have <group> become 3/3 ... artifact creatures in addition to their other types"', () => {
  it('is automated', () => expect(full(FORGE)).toBe(true));
  it('saying yes: every Treasure you control becomes a 3/3 artifact creature (still a Treasure), the Forge itself is not a Treasure and stays 1/1', () => {
    let s = scenario([], { defs: [FORGE, TREASURE], p1: { battlefield: ['Test Forge', 'Test Treasure', 'Test Treasure'] } });
    s = settle(activate(s, onBf(s, 'Test Forge')[0]!, 'treasures'), { yes: true });
    for (const id of onBf(s, 'Test Treasure')) {
      expect(chars(s, id).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
      expect(chars(s, id).subtypes).toEqual(expect.arrayContaining(['Treasure', 'Construct', 'Soldier']));
      expect(stats(s, id)).toBe('3/3');
    }
    expect(stats(s, onBf(s, 'Test Forge')[0]!)).toBe('1/1');
  });
  it('saying no: nothing changes (it is a "may")', () => {
    let s = scenario([], { defs: [FORGE, TREASURE], p1: { battlefield: ['Test Forge', 'Test Treasure'] } });
    s = settle(activate(s, onBf(s, 'Test Forge')[0]!, 'treasures'), { yes: false });
    expect(chars(s, onBf(s, 'Test Treasure')[0]!).types).not.toContain('Creature');
  });
});

// ---- Archangel Elspeth: counters, then "It becomes an Angel in addition to its other types and gains flying" ------------------------------------------------------------------------

const BLESSER = ENGINE('{0}: Put two +1/+1 counters on target creature. It becomes an Angel in addition to its other types and gains flying.', 'Test Blesser');
describe('CR 205.1b, 613.1f, 611.2a: "It becomes an Angel in addition to its other types and gains flying." (no duration)', () => {
  it('is automated', () => expect(full(BLESSER)).toBe(true));
  it('the target keeps its Bear type, becomes an Angel and has flying, with the counters; another creature is not changed', () => {
    let s = scenario([], { defs: [BLESSER, BEAR], p1: { battlefield: ['Test Blesser', 'Test Bear', 'Test Bear'] } });
    const [a, b] = onBf(s, 'Test Bear') as [ObjectId, ObjectId];
    s = settle(activate(s, onBf(s, 'Test Blesser')[0]!, 'two'), { targets: ['Test Bear'] });
    const hit = [a, b].find((id) => s.objects[id]!.counters['+1/+1'] === 2)!;
    const other = [a, b].find((id) => id !== hit)!;
    expect(chars(s, hit).subtypes).toEqual(expect.arrayContaining(['Bear', 'Angel']));
    expect(has(s, hit, 'flying')).toBe(true);
    expect(stats(s, hit)).toBe('4/4');
    expect(chars(s, other).subtypes).not.toContain('Angel');
    expect(has(s, other, 'flying')).toBe(false);
  });
});

// ---- Shadow Puppeteers: a color and a creature type added, base power and toughness set --------------------------------------------------------------------------------------------

const DRAKER = ENGINE('{0}: You may have target creature become a red Dragon with base power and toughness 4/4 in addition to its other colors and types until end of turn.', 'Test Drake Caller');
describe('CR 105.3, 205.3m, 613.1d-e, 613.4b: "become a red Dragon with base power and toughness 4/4 in addition to its other colors and types"', () => {
  it('is automated', () => expect(full(DRAKER)).toBe(true));
  it('a green Bear becomes green and red, a Bear Dragon, 4/4; +1/+1 counters still add on top (layer 7c after 7b)', () => {
    let s = scenario([], { defs: [DRAKER, BEAR], p1: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Drake Caller'] } });
    s = settle(activate(s, onBf(s, 'Test Drake Caller')[0]!, 'you may'), { targets: ['Test Bear'], yes: true });
    const bear = onBf(s, 'Test Bear')[0]!;
    expect(chars(s, bear).colors).toEqual(expect.arrayContaining(['G', 'R']));
    expect(chars(s, bear).subtypes).toEqual(expect.arrayContaining(['Bear', 'Dragon']));
    expect(stats(s, bear)).toBe('5/5');
  });
  it('saying no changes nothing', () => {
    let s = scenario([], { defs: [DRAKER, BEAR], p1: { battlefield: ['Test Bear', 'Test Drake Caller'] } });
    s = settle(activate(s, onBf(s, 'Test Drake Caller')[0]!, 'you may'), { targets: ['Test Bear'], yes: false });
    const bear = onBf(s, 'Test Bear')[0]!;
    expect(chars(s, bear).colors).not.toContain('R');
    expect(stats(s, bear)).toBe('2/2');
  });
});

// ---- Rielle, the Everwise: the first discard of each turn --------------------------------------------------------------------------------------------------------------------------

const SCRIBE = card('Test Scribe', 'Artifact Creature — Construct', 'Whenever you discard one or more cards for the first time each turn, draw that many cards.\n{0}: Discard a card.\n{0}: Discard two cards.', { pt: ['1', '1'] });
const SPARE = card('Test Spare', 'Land', '');
describe('CR 603.2, 603.2c, 701.9a: "Whenever you discard one or more cards for the first time each turn, draw that many cards."', () => {
  it('is automated', () => expect(full(SCRIBE)).toBe(true));
  const setup = (): GameState => scenario([], { defs: [SCRIBE, SPARE], p1: { battlefield: ['Test Scribe'], hand: ['Test Spare', 'Test Spare', 'Test Spare', 'Test Spare'] } });
  const hand = (s: GameState): number => s.zones.hand.p1!.length;
  it('discarding two cards at once draws two cards (that many), one trigger; a second discard the same turn draws nothing', () => {
    const s0 = setup();
    const before = hand(s0);
    let s = settle(activate(s0, onBf(s0, 'Test Scribe')[0]!, 'two'));
    expect(hand(s)).toBe(before); // -2 discarded, +2 drawn
    const mid = hand(s);
    s = settle(activate(s, onBf(s, 'Test Scribe')[0]!, 'a card'));
    expect(hand(s)).toBe(mid - 1); // the second discard of the turn draws nothing
  });
  it('a first discard of one card draws one card', () => {
    const s0 = setup();
    const before = hand(s0);
    const s = settle(activate(s0, onBf(s0, 'Test Scribe')[0]!, 'a card'));
    expect(hand(s)).toBe(before);
  });
});

// ---- Ivora, Insatiable Heir: enters, and combat damage to a player ----------------------------------------------------------------------------------------------------------------

const HEIR = card('Test Heir', 'Creature — Vampire', 'When ~ enters and whenever it deals combat damage to a player, you gain 1 life.', { pt: ['2', '2'] });
describe('CR 603.2, 603.6a, 510.3a: "When ~ enters and whenever it deals combat damage to a player, ..."', () => {
  it('is automated, and the trigger holds exactly two events: its own enters and its own combat damage to a player', () => {
    expect(full(HEIR)).toBe(true);
    const t = (HEIR.faces[0]!.abilities.find((a) => a.kind === 'triggered') as unknown as { trigger: { on: { ev: string; combat?: boolean }[] } }).trigger;
    expect(t.on.map((e) => e.ev)).toEqual(['zoneChange', 'damage']);
    expect(t.on[1]!.combat).toBe(true);
  });
  it('entering gains 1 life', () => {
    const s0 = scenario([], { defs: [HEIR], p1: { hand: ['Test Heir'] } });
    const s = passBoth(castAuto(s0, 'Test Heir'));
    expect(life(settle(s), 'p1')).toBe(21);
  });
  it('dealing combat damage to a player gains 1 life more; a creature that is not Heir dealing damage does not', () => {
    const s0 = scenario(['Grizzly Bears'], { defs: [HEIR], p1: { battlefield: ['Test Heir', 'Grizzly Bears'] } });
    const heir = find(s0, 'Test Heir', 'battlefield');
    let s = s0;
    for (let i = 0; i < 80 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: heir, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else s = pass(s);
    }
    s = settle(s);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(21);
  });
});

// ---- Anikthea, Hand of Erebos: a token copy with a color set and a creature type added -----------------------------------------------------------------------------------------------

const CHANGER = ENGINE('{0}: Create a token that\'s a copy of target enchantment you control, except it\'s a 3/3 black Zombie creature in addition to its other types.', 'Test Changer');
const WARD = card('Test Ward', 'Enchantment', 'Players can\'t gain life.', { colors: ['W'] });
describe('CR 707.9a-b, 205.1b, 105.3, 111.10: "create a token that\'s a copy of ..., except it\'s a 3/3 black Zombie creature in addition to its other types"', () => {
  it('is automated', () => expect(full(CHANGER)).toBe(true));
  it('the token is a copy (same name and ability) that is also a creature Zombie, black only (not white), 3/3; the original is unchanged', () => {
    let s = scenario([], { defs: [CHANGER, WARD], p1: { battlefield: ['Test Changer', 'Test Ward'] } });
    s = settle(activate(s, onBf(s, 'Test Changer')[0]!, 'create'), { targets: ['Test Ward'] });
    const wards = onBf(s, 'Test Ward');
    expect(wards.length).toBe(2);
    const token = wards.find((id) => s.objects[id]!.kind === 'token')!;
    const original = wards.find((id) => s.objects[id]!.kind !== 'token')!;
    expect(chars(s, token).types).toEqual(expect.arrayContaining(['Enchantment', 'Creature']));
    expect(chars(s, token).subtypes).toContain('Zombie');
    expect(chars(s, token).colors).toEqual(['B']);
    expect(stats(s, token)).toBe('3/3');
    expect(chars(s, original).types).not.toContain('Creature');
    expect(chars(s, original).colors).toEqual(['W']);
  });
});

// ---- Idol of False Gods: a conditional static that makes the object a creature with an ability --------------------------------------------------------------------------------------

const IDOL = card('Test Idol', 'Artifact', 'As long as ~ has three or more +1/+1 counters on it, it\'s a 0/0 creature in addition to its other types and it has flying.');
describe('CR 604.1, 611.3a, 613.1d, 613.1f, 613.4b: "As long as C, it\'s a 0/0 creature in addition to its other types and it has flying."', () => {
  it('is automated', () => expect(full(IDOL)).toBe(true));
  it('with two counters it is only an artifact; with three it is an artifact creature 3/3 (0/0 plus counters) with flying', () => {
    let s = scenario([], { defs: [IDOL], p1: { battlefield: [{ name: 'Test Idol', counters: { '+1/+1': 2 } }] } });
    const id = onBf(s, 'Test Idol')[0]!;
    expect(chars(s, id).types).not.toContain('Creature');
    expect(has(s, id, 'flying')).toBe(false);
    s.objects[id]!.counters['+1/+1'] = 3;
    expect(chars(s, id).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(stats(s, id)).toBe('3/3');
    expect(has(s, id, 'flying')).toBe(true);
  });
});

// ---- Lantern of Insight: a target player shuffles ----------------------------------------------------------------------------------------------------------------------------

const LANTERN = card('Test Lantern', 'Artifact', '{0}, {T}: Target player shuffles.');
describe('CR 701.24a: "Target player shuffles."', () => {
  it('is automated and shuffles the chosen player\'s library (a different order for a non-trivial library), not another player\'s', () => {
    expect(full(LANTERN)).toBe(true);
    const s0 = scenario([], { defs: [LANTERN], p1: { battlefield: ['Test Lantern'] } });
    const lib1 = [...s0.zones.library.p1!];
    const lib2 = [...s0.zones.library.p2!];
    const s = settle(activate(s0, onBf(s0, 'Test Lantern')[0]!, 'target player'), { targets: ['p2'] });
    expect(s.zones.library.p2!.length).toBe(lib2.length);
    expect(s.zones.library.p2).not.toEqual(lib2); // the chosen player's library was shuffled (its cards are put in a new order)
    expect(s.zones.library.p1).toEqual(lib1); // the other player's library is untouched
  });
});

// ---- They Came from the Pipes: manifest dread twice ---------------------------------------------------------------------------------------------------------------------------

const PIPE = card('Test Pipe', 'Artifact Creature — Construct', '{0}: Manifest dread twice.', { pt: ['1', '1'] });
describe('CR 701.62a: "Manifest dread twice."', () => {
  it('is automated and puts two face-down 2/2 creatures onto the battlefield (one look at the top two cards each time)', () => {
    expect(full(PIPE)).toBe(true);
    const s0 = scenario([], { defs: [PIPE], p1: { battlefield: ['Test Pipe'] } });
    const before = s0.zones.battlefield.length;
    const s = settle(activate(s0, onBf(s0, 'Test Pipe')[0]!, 'manifest'));
    const down = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown);
    expect(down.length).toBe(2);
    expect(s.zones.battlefield.length).toBe(before + 2);
    expect(stats(s, down[0]!)).toBe('2/2');
  });
});
void findAll;
