/**
 * Commander lane edh-perms, round edh-perms-20: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 701.21a, 608.2c, 608.2h  "... You gain life equal to the greatest power among creatures sacrificed this way." (the creatures as they last existed)
 *   CR 701.17a, 603.2c          "Whenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of nonland cards milled this way."
 *   CR 603.10a, 608.2h, 303.4   "Whenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, life, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: string): TargetChoice => ({ kind: 'object', id });

const FIEND = card('Test Fiend', 'Creature — Demon', 'When this creature enters, each opponent sacrifices a creature with the greatest power among creatures they control. You gain life equal to the greatest power among creatures sacrificed this way.', { pt: ['4', '4'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
const TROLL = card('Test Troll', 'Creature — Troll', '', { pt: ['5', '3'] });
const SAGE = card('Test Sage', 'Legendary Creature — Insect', 'Flying\nWhenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of nonland cards milled this way.', { pt: ['2', '2'] });
const GRINDER = card('Test Grinder', 'Sorcery', 'Mill three cards.');
const MUTUAL_GRINDER = card('Test Mutual Grinder', 'Sorcery', 'Each player mills two cards.');
const SPELLBOOK = card('Test Spellbook', 'Sorcery', 'Draw a card.');
const AURA = card('Test Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
const EIDOLON = card('Test Eidolon', 'Enchantment Creature — Spirit', 'Lifelink\nWhenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it.', { pt: ['2', '2'] });
const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
const HOST = card('Test Host', 'Creature — Human', '', { pt: ['2', '2'] });
const BETRAYAL = card('Test Betrayal', 'Enchantment', 'Whenever a creature you don\'t control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. That creature is a black Zombie in addition to its other colors and types.');
const BREWER = card('Test Brewer', 'Enchantment', 'When this enchantment enters, any number of target opponents each draw a card. Put a brew counter on this enchantment, then put a brew counter on it for each card drawn this way.\nWhenever you cast a creature spell, that creature enters with X additional +1/+1 counters on it, where X is the number of brew counters on this enchantment.');
const SPAWN = card('Test Spawn', 'Sorcery', 'Create a 4/4 green Beast creature token.');
const DEVOUR = card('Test Devour', 'Sorcery', 'Target player sacrifices a creature. You gain life equal to the greatest power among creatures sacrificed this way.');
const REBOUND = card('Test Rebound', 'Enchantment — Aura', "Enchant creature\nWhen this Aura is put into a graveyard from the battlefield, return this Aura to its owner's hand.");
const SCOUT = card('Test Scout', 'Creature — Scout', '', { pt: ['1', '1'] });

const DEFS = [REBOUND, SPAWN, DEVOUR, BETRAYAL, BREWER, SCOUT, FIEND, BEAR, OGRE, TROLL, SAGE, GRINDER, MUTUAL_GRINDER, SPELLBOOK, AURA, EIDOLON, SMITE, HOST];

interface Drive { targets?: TargetChoice[]; pick?: (options: ObjectId[]) => ObjectId[] }
/** Answer every decision until the stack is empty and nobody has a decision but priority; passes priority only while something is on the stack. */
function settle(s0: GameState, d: Drive = {}): GameState {
  let s = s0;
  for (let g = 0; g < 60; g++) {
    const p = s.pending;
    if (p === undefined || p === null) break;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: d.targets ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.pick ?? ((o) => o.slice(0, p.min)))(p.options) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    // (simultaneous triggers: the Eidolon's goes on the stack first, so the Aura's own return resolves before it does)
    else if (p.kind === 'order') { const items = (p as unknown as { items: { id: string; label: string }[] }).items; s = answer(s, { kind: 'order', ids: [...items].sort((a, b) => Number(/Eidolon/.test(b.label)) - Number(/Eidolon/.test(a.label))).map((i) => i.id) }); }
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const castSpell = (s: GameState, name: string, d: Drive = {}): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), d);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const defOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const inYard = (s: GameState, owner: string): string[] => s.zones.graveyard[owner]!.map((id) => defOf(s, id));

describe('design 6.9: the round\'s test cards compile fully', () => {
  it('every card with a rules text is fully automated', () => {
    for (const d of [REBOUND, SPAWN, DEVOUR, FIEND, SAGE, GRINDER, MUTUAL_GRINDER, AURA, EIDOLON, SMITE, BETRAYAL, BREWER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.21a, 608.2h: "You gain life equal to the greatest power among creatures sacrificed this way."', () => {
  it('the opponent sacrifices their greatest-power creature and you gain life equal to its power', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fiend'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    const s = castSpell(s0, 'Test Fiend');
    expect(inYard(s, 'p2')).toEqual(['Test Ogre']);
    expect(life(s, 'p1')).toBe(20 + 5);
  });
  it('the power is the one the creature had as it was sacrificed (counters count, CR 608.2h)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fiend'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 3 } }, 'Test Troll'] }, defs: DEFS });
    const s = castSpell(s0, 'Test Fiend');
    // the 5/3 Troll and the 2/2 Bear with three counters (5/5) tie for the greatest power: the opponent chooses; either way 5 life
    expect(inYard(s, 'p2')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(25);
  });
  it('a creature pumped by counters is read as it was: the single 2/2 with three counters gives 5', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fiend'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 3 } }] }, defs: DEFS });
    expect(life(castSpell(s0, 'Test Fiend'), 'p1')).toBe(25);
  });
  it('an opponent without creatures sacrifices nothing and you gain nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fiend'] }, defs: DEFS });
    const s = castSpell(s0, 'Test Fiend');
    expect(life(s, 'p1')).toBe(20);
  });
  it('only the creature with the greatest power is sacrificed: the smaller one stays and does not add to the life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fiend'] }, p2: { battlefield: ['Test Bear', 'Test Troll'] }, defs: DEFS });
    const s = castSpell(s0, 'Test Fiend');
    expect(inYard(s, 'p2')).toEqual(['Test Troll']);
    expect(s.zones.battlefield.map((id) => defOf(s, id))).toContain('Test Bear');
    expect(life(s, 'p1')).toBe(25);
  });
  it('a token sacrificed is read as it last existed too: the 4/4 token that ceased to exist still counts 4', () => {
    const s0 = scenario([], { p1: { hand: ['Test Spawn', 'Test Devour'] }, defs: DEFS });
    const s1 = castSpell(s0, 'Test Spawn');
    const s2 = castSpell(s1, 'Test Devour', { targets: [{ kind: 'player', id: 'p1' } as TargetChoice] });
    expect(s2.zones.battlefield.map((id) => s2.objects[id]!.kind)).not.toContain('token');
    expect(life(s2, 'p1')).toBe(24);
  });
  it('a sacrificed group is read only after a sacrifice: "creatures destroyed this way" for the same stat stays manual', () => {
    expect(full(card('Test Wrath', 'Sorcery', 'Destroy target creature. You gain life equal to the greatest power among creatures sacrificed this way.'))).toBe(false);
    expect(full(card('Test Mixed', 'Sorcery', 'Each opponent sacrifices a creature. You gain life equal to the greatest power among creatures sacrificed this way and artifacts you control.'))).toBe(false);
  });
});

describe('CR 701.17a, 603.2c: "Whenever one or more nonland cards are milled, ... up to X target creatures, where X is the number of nonland cards milled this way."', () => {
  const setup = (library: string[]): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Grinder', 'Test Mutual Grinder'], battlefield: ['Test Sage', 'Test Bear', 'Test Ogre'], library }, p2: { battlefield: ['Test Troll'] }, defs: DEFS });
    return s0;
  };
  it('milling three cards with two nonland cards among them: up to two targets get a +1/+1 counter', () => {
    const s0 = setup(['Test Spellbook', 'Plains', 'Test Spellbook']);
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const s = castSpell(s0, 'Test Grinder', { targets: [obj(bear), obj(ogre)] });
    expect(counters(s, bear)).toBe(1);
    expect(counters(s, ogre)).toBe(1);
  });
  it('lands are not counted: three lands milled do not trigger it at all', () => {
    const s0 = setup(['Plains', 'Plains', 'Plains']);
    const s = castSpell(s0, 'Test Grinder', { targets: [] });
    expect(s.zones.stack).toHaveLength(0);
    expect(counters(s, find(s0, 'Test Bear', 'battlefield'))).toBe(0);
  });
  it('X is the count of nonland cards: one nonland card among three allows one target, not two', () => {
    const s0 = setup(['Plains', 'Test Spellbook', 'Plains']);
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    expect(() => castSpell(s0, 'Test Grinder', { targets: [obj(bear), obj(ogre)] })).toThrow(/between 0 and 1 targets/);
    const s = castSpell(s0, 'Test Grinder', { targets: [obj(bear)] });
    expect(counters(s, bear)).toBe(1);
    expect(counters(s, ogre)).toBe(0);
  });
  it('two players milling at once is ONE trigger for the whole batch (the 2024-03-08 ruling): X counts both players\' nonland cards', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mutual Grinder'], battlefield: ['Test Sage', 'Test Bear', 'Test Ogre'], library: ['Test Spellbook', 'Plains'] }, p2: { battlefield: ['Test Troll'], library: ['Test Spellbook', 'Plains'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const troll = find(s0, 'Test Troll', 'battlefield', 'p2');
    // X = 2 (one nonland card from each library): three targets are refused ("Choose between 0 and 2 targets"), and one trigger is not two
    expect(() => castSpell(s0, 'Test Mutual Grinder', { targets: [obj(bear), obj(ogre), obj(troll)] })).toThrow(/between 0 and 2 targets/);
    const s = castSpell(s0, 'Test Mutual Grinder', { targets: [obj(bear), obj(troll)] });
    expect(counters(s, bear) + counters(s, ogre) + counters(s, troll)).toBe(2);
    expect(counters(s, ogre)).toBe(0);
  });
  it('near miss: a count of a different description than the trigger\'s ("creature cards milled this way") stays manual', () => {
    expect(full(card('Test Sage Two', 'Creature — Insect', 'Whenever one or more nonland cards are milled, put a +1/+1 counter on each of up to X target creatures, where X is the number of creature cards milled this way.', { pt: ['1', '1'] }))).toBe(false);
  });
});

describe('CR 603.10a, 608.2h, 303.4: "Whenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it."', () => {
  const setup = (): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Eidolon', 'Test Host'] }, p2: { battlefield: [] }, defs: DEFS });
    return s0;
  };
  const attach = (s: GameState, owner: 'p1' | 'p2', host: ObjectId): void => { s.objects[put(s, owner, 'battlefield', 'Test Aura')]!.attachedTo = host; };
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;
  it('two of your Auras on the creature that dies: you draw two cards', () => {
    const s0 = setup();
    const host = find(s0, 'Test Host', 'battlefield');
    attach(s0, 'p1', host);
    attach(s0, 'p1', host);
    const before = hand(s0) - 1; // Test Smite leaves the hand
    const s = castSpell(s0, 'Test Smite', { targets: [obj(host)] });
    expect(hand(s)).toBe(before + 2);
  });
  it('an Aura you own but an opponent controlled when the creature died is not counted: the controller is the one it last had (CR 608.2h)', () => {
    const s0 = setup();
    const host = find(s0, 'Test Host', 'battlefield');
    attach(s0, 'p1', host);
    const stolen = put(s0, 'p1', 'battlefield', 'Test Aura');
    s0.objects[stolen]!.attachedTo = host;
    s0.objects[stolen]!.controller = 'p2';
    const before = hand(s0) - 1;
    const s = castSpell(s0, 'Test Smite', { targets: [obj(host)] });
    expect(hand(s)).toBe(before + 1);
  });
  it('an Aura an opponent controlled that was attached to it is not counted (you controlled)', () => {
    const s0 = setup();
    const host = find(s0, 'Test Host', 'battlefield');
    attach(s0, 'p1', host);
    attach(s0, 'p2', host);
    const before = hand(s0) - 1;
    const s = castSpell(s0, 'Test Smite', { targets: [obj(host)] });
    expect(hand(s)).toBe(before + 1);
  });
  it('an Aura attached to another creature is not counted', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Eidolon', 'Test Host', 'Test Bear'] }, defs: DEFS });
    attach(s0, 'p1', find(s0, 'Test Host', 'battlefield'));
    attach(s0, 'p1', find(s0, 'Test Bear', 'battlefield'));
    const before = hand(s0) - 1;
    const s = castSpell(s0, 'Test Smite', { targets: [obj(find(s0, 'Test Host', 'battlefield'))] });
    expect(hand(s)).toBe(before + 1);
  });
  it('an Aura that left the graveyard before the trigger resolved (returned to its owner\'s hand) still counts: it is read as it last existed (ruling 2020-01-24, CR 608.2h)', () => {
    const s0 = setup();
    const host = find(s0, 'Test Host', 'battlefield');
    attach(s0, 'p1', host);
    s0.objects[put(s0, 'p1', 'battlefield', 'Test Rebound')]!.attachedTo = host;
    const before = hand(s0) - 1;
    const s = castSpell(s0, 'Test Smite', { targets: [obj(host)] });
    expect(s.zones.hand['p1']!.map((id) => defOf(s, id))).toContain('Test Rebound');
    expect(hand(s)).toBe(before + 2 + 1 - 0); // two cards drawn, plus the Aura that came back to the hand
  });
  it('a creature with no Aura does not trigger it', () => {
    const s0 = setup();
    const host = find(s0, 'Test Host', 'battlefield');
    const before = hand(s0) - 1;
    const s = castSpell(s0, 'Test Smite', { targets: [obj(host)] });
    expect(hand(s)).toBe(before);
  });
});

describe('CR 603.7, 400.7, 122.6: "Return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step. That creature is a black Zombie ..."', () => {
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Betrayal'] }, p2: { battlefield: ['Test Bear', 'Test Eidolon'] }, defs: DEFS });
  it('the creature is back at the next end step under your control, with one +1/+1 counter, black and a Zombie in addition to what it was', () => {
    const s0 = setup();
    const s1 = castSpell(s0, 'Test Smite', { targets: [obj(find(s0, 'Test Bear', 'battlefield', 'p2'))] });
    expect(s1.zones.battlefield.map((id) => defOf(s1, id))).not.toContain('Test Bear'); // still in the graveyard until the end step
    expect(inYard(s1, 'p2')).toContain('Test Bear');
    const s2 = settle(advanceTo(s1, 1, 'end'));
    const back = s2.zones.battlefield.find((id) => defOf(s2, id) === 'Test Bear')!;
    expect(back).toBeDefined();
    expect(s2.objects[back]!.controller).toBe('p1');
    expect(counters(s2, back)).toBe(1);
    const c = getChars(s2, back)!;
    expect(c.subtypes).toContain('Zombie');
    expect(c.subtypes).toContain('Bear');
    expect(c.colors).toContain('B');
    expect(Number(c.power)).toBe(3);
  });
  it('a creature you control that dies is not returned (you don\'t control it)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Betrayal', 'Test Bear'] }, defs: DEFS });
    const s1 = castSpell(s0, 'Test Smite', { targets: [obj(find(s0, 'Test Bear', 'battlefield', 'p1'))] });
    const s2 = settle(advanceTo(s1, 1, 'end'));
    expect(s2.zones.battlefield.map((id) => defOf(s2, id))).not.toContain('Test Bear');
  });
  it('a card that left the graveyard before the end step does not return', () => {
    const s0 = setup();
    const s1 = castSpell(s0, 'Test Smite', { targets: [obj(find(s0, 'Test Bear', 'battlefield', 'p2'))] });
    const card1 = s1.zones.graveyard['p2']!.find((id) => defOf(s1, id) === 'Test Bear')!;
    const s1b = JSON.parse(JSON.stringify(s1)) as GameState;
    s1b.zones.graveyard['p2'] = s1b.zones.graveyard['p2']!.filter((id) => id !== card1);
    s1b.zones.exile.push(card1);
    s1b.objects[card1]!.zone = 'exile';
    const s2 = settle(advanceTo(s1b, 1, 'end'));
    expect(s2.zones.battlefield.map((id) => defOf(s2, id))).not.toContain('Test Bear');
  });
});

describe('CR 121.2, 608.2c: "Put a brew counter on ~, then put a brew counter on it for each card drawn this way." and "X additional +1/+1 counters ... where X is the number of brew counters"', () => {
  it('one opponent draws: the enchantment gets one counter and one more for the card drawn (two); a creature spell then enters with two extra counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Brewer', 'Test Scout'] }, defs: DEFS });
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Brewer', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' } as TargetChoice] });
    const brewer = find(s1, 'Test Brewer', 'battlefield');
    expect(counters(s1, brewer, 'brew')).toBe(2);
    expect(s1.zones.hand['p2']!.length).toBe(1);
    const s2 = settle(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Scout', 'hand', 'p1') }));
    const scout = find(s2, 'Test Scout', 'battlefield');
    expect(counters(s2, scout)).toBe(2);
  });
  it('with no opponent chosen only the first counter is put and nobody draws', () => {
    const s0 = scenario([], { p1: { hand: ['Test Brewer'] }, defs: DEFS });
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Brewer', 'hand', 'p1') }), { targets: [] });
    expect(counters(s1, find(s1, 'Test Brewer', 'battlefield'), 'brew')).toBe(1);
    expect(s1.zones.hand['p2']!.length).toBe(0);
  });
});
