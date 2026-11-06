/**
 * Commander lane edh-c, round edh-c-72 (EDHREC ranks 26,501-27,000, second pass): the round's readings played through the engine with synthetic cards (invented names), compiled by the
 * game's default compiler. Alice (p1) casts and attacks. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 702.122a, 508.1c, 509.1b   "Enchanted creature can't attack, block, or crew Vehicles."
 *   CR 115.1, 303.4, 101.2        "Enchanted creature can't be the target of spells and can't be enchanted by other Auras."
 *   CR 509.1, 603.2, 119.1        "Whenever enchanted creature blocks or becomes blocked, it gets +0/+3 until end of turn and you gain 1 life."
 *   CR 106.12, 614.1a, 106.1b     "If a land is tapped for mana, it produces colorless mana instead of any other type."
 *   CR 122.1, 701.13a             "Exile any number of target creatures that have -1/-1 counters on them."
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, applyAction, compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, pool, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';
import { counters, full, named, pt, resolveAll, settle, type Picks } from '../cmd3/helpers';

function card(name: string, type: string, text: string, ptv?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(ptv ? { power: ptv[0], toughness: ptv[1] } : {}) } as OracleCard);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const cast = (s: GameState, name: string, p: Picks = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);
const reply = (s: GameState, a: Parameters<typeof answer>[1]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BIG = card('Test Big Bear', 'Creature — Bear', '', ['3', '5']);
const SCOUT = card('Test Scout', 'Creature — Elf', '', ['1', '1']);
const WAGON = card('Test Wagon', 'Artifact — Vehicle', 'Crew 1', ['3', '3']);
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to target creature.');
const AURA_B = card('Test Plain Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');

/** An Aura named `aura` on the battlefield of p1 attached to p1's creature `target`. */
function enchanted(defs: CardDef[], aura: string, target: string, others: { p1?: string[]; p2?: string[]; hand?: string[] } = {}): { s: GameState; id: ObjectId } {
  const s0 = scenario([], { defs, p1: { battlefield: [target, ...(others.p1 ?? [])], hand: others.hand ?? [] }, p2: { battlefield: others.p2 ?? [] } });
  const id = find(s0, target, 'battlefield', 'p1');
  const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', aura)]!.attachedTo = id; });
  return { s, id };
}
const attackError = (s0: GameState, id: ObjectId): string | undefined => {
  const s = toDeclareAttackers(s0);
  return applyAction(s, reply(s, { kind: 'declareAttackers', attacks: [{ attacker: id, defender: 'p2' }] })).error?.message;
};

describe('CR 702.122a, 508.1c, 509.1b: "Enchanted creature can\'t attack, block, or crew Vehicles."', () => {
  const REVOKE = card('Test Revoke', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can\'t attack, block, or crew Vehicles.');
  const DEFS = [REVOKE, BEAR, SCOUT, WAGON];
  const crewActions = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => /crew/i.test(a.label)).length;
  it('is automated', () => expect(full(REVOKE)).toBe(true));
  it('the enchanted creature cannot attack; an unenchanted creature can', () => {
    const { s, id } = enchanted(DEFS, 'Test Revoke', 'Test Bear', { p1: ['Test Scout'] });
    expect(attackError(s, id)).toBeDefined();
    expect(attackError(s, find(s, 'Test Scout', 'battlefield', 'p1'))).toBeUndefined();
  });
  it('the enchanted creature cannot block; an unenchanted creature can', () => {
    const blockError = (enchantBear: boolean): string | undefined => {
      const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Scout'] }, p2: { battlefield: ['Test Bear'] } });
      const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
      const s1 = enchantBear ? tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Revoke')]!.attachedTo = bear; }) : s0;
      let s = declareAttackers(toDeclareAttackers(s1), [[find(s0, 'Test Scout', 'battlefield', 'p1'), 'p2']]);
      for (let i = 0; i < 30 && s.pending?.kind === 'priority' && s.turn.step !== 'declareBlockers'; i++) s = pass(s);
      if (s.pending?.kind !== 'declareBlockers') return 'no blockers decision';
      return applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [{ blocker: bear, attacker: find(s0, 'Test Scout', 'battlefield', 'p1') }] })).error?.message;
    };
    const withAura = blockError(true);
    expect(withAura).toBeDefined(); // refused, or no decision at all: the Bear can't block
    expect(blockError(false)).toBeUndefined();
  });
  it('CR 702.122a: the enchanted creature cannot be tapped to crew a Vehicle; a creature without the Aura can', () => {
    const { s } = enchanted(DEFS, 'Test Revoke', 'Test Bear', { p1: ['Test Wagon'] });
    expect(crewActions(s)).toBe(0); // the enchanted creature is the only creature that could crew
    const { s: s2 } = enchanted(DEFS, 'Test Revoke', 'Test Bear', { p1: ['Test Wagon', 'Test Scout'] });
    expect(crewActions(s2)).toBe(1); // another creature can
  });
  it('negative: without the Aura the same creature crews', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear', 'Test Wagon'] } });
    expect(crewActions(s)).toBe(1);
  });
});

/** The objects a spell or ability could target when it is put on the stack (the decision's options), or null when no target decision comes up. */
const targetOptions = (s0: GameState, action: Parameters<typeof act>[1]): ObjectId[] | null => {
  const t = act(s0, action);
  if (t.pending?.kind !== 'chooseTargets') return null;
  return [...(t.pending as unknown as { objects: ObjectId[] }).objects];
};
const castOptions = (s: GameState, name: string): ObjectId[] | null => targetOptions(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never);

describe('CR 115.1, 303.4, 101.2: "Enchanted creature can\'t be the target of spells and can\'t be enchanted by other Auras."', () => {
  const ANTI = card('Test Ward Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can\'t be the target of spells and can\'t be enchanted by other Auras.');
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{T}: Test Pinger deals 1 damage to target creature.', ['1', '1']);
  const DEFS = [ANTI, BEAR, SCOUT, ZAP, AURA_B, PINGER];
  it('is automated', () => expect(full(ANTI)).toBe(true));
  it('a spell cannot target the enchanted creature, but can target another creature', () => {
    const { s, id } = enchanted(DEFS, 'Test Ward Aura', 'Test Bear', { p1: ['Test Scout'], hand: ['Test Zap'] });
    const options = castOptions(s, 'Test Zap');
    expect(options).not.toContain(id);
    expect(options).toContain(find(s, 'Test Scout', 'battlefield', 'p1'));
  });
  it('CR 303.4: another Aura spell cannot enchant it (it targets, and the creature is no legal target)', () => {
    const { s, id } = enchanted(DEFS, 'Test Ward Aura', 'Test Bear', { p1: ['Test Scout'], hand: ['Test Plain Aura'] });
    const options = castOptions(s, 'Test Plain Aura');
    expect(options).not.toContain(id);
    expect(options).toContain(find(s, 'Test Scout', 'battlefield', 'p1'));
  });
  it('negative: an ability can still target it', () => {
    const { s, id } = enchanted(DEFS, 'Test Ward Aura', 'Test Bear', { p1: ['Test Pinger'] });
    const pinger = find(s, 'Test Pinger', 'battlefield', 'p1');
    const options = targetOptions(s, { type: 'activate', player: 'p1', source: pinger, ability: activatedAbilities(s, s.objects[pinger]!)[0]!.key } as never);
    expect(options).toContain(id);
  });
  it('negative: without the Aura the same creature is a legal target of the spell', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'], hand: ['Test Zap'] } });
    expect(castOptions(s, 'Test Zap')).toContain(find(s, 'Test Bear', 'battlefield', 'p1'));
  });
});

describe('CR 509.1, 603.2, 119.1: "Whenever enchanted creature blocks or becomes blocked, it gets +0/+3 until end of turn and you gain 1 life."', () => {
  const GIFT = card('Test Gift Aura', 'Enchantment — Aura', 'Enchant creature\nWhenever enchanted creature blocks or becomes blocked, it gets +0/+3 until end of turn and you gain 1 life.');
  const DEFS = [GIFT, BEAR, SCOUT];
  it('is automated', () => expect(full(GIFT)).toBe(true));
  it('it becomes blocked: the enchanted attacker gets +0/+3 and its Aura\'s controller gains 1 life', () => {
    const { s: s0, id } = enchanted(DEFS, 'Test Gift Aura', 'Test Bear', { p2: ['Test Scout'] });
    let s = declareAttackers(toDeclareAttackers(s0), [[id, 'p2']]);
    for (let i = 0; i < 30 && s.pending?.kind === 'priority' && s.turn.step !== 'declareBlockers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Scout', 'battlefield', 'p2'), attacker: id }] } as DecisionAnswer);
    s = resolveAll(s);
    expect(pt(s, id)).toBe('2/5');
    expect(life(s, 'p1')).toBe(21);
  });
  it('it blocks: the enchanted blocker gets +0/+3 and the gain happens too (the creature, not the attacker)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Scout'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const scout = find(s0, 'Test Scout', 'battlefield', 'p1');
    const s1 = tweak(s0, (t) => { t.objects[put(t, 'p2', 'battlefield', 'Test Gift Aura')]!.attachedTo = bear; });
    let s = declareAttackers(toDeclareAttackers(s1), [[scout, 'p2']]);
    for (let i = 0; i < 30 && s.pending?.kind === 'priority' && s.turn.step !== 'declareBlockers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: bear, attacker: scout }] } as DecisionAnswer);
    s = resolveAll(s);
    expect(pt(s, bear)).toBe('2/5');
    expect(pt(s, scout)).toBe('1/1');
    expect(life(s, 'p2')).toBe(21);
  });
  it('negative: an unenchanted creature that becomes blocked gets nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Scout'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear, 'p2']]);
    for (let i = 0; i < 30 && s.pending?.kind === 'priority' && s.turn.step !== 'declareBlockers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Scout', 'battlefield', 'p2'), attacker: bear }] } as DecisionAnswer);
    s = resolveAll(s);
    expect(pt(s, bear)).toBe('2/2');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 106.12, 614.1a, 106.1b: "If a land is tapped for mana, it produces colorless mana instead of any other type."', () => {
  const RITUAL = card('Test Dull Ritual', 'Enchantment', 'If a land is tapped for mana, it produces colorless mana instead of any other type.');
  const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
  const TWIN = card('Test Twin Land', 'Land', '{T}: Add {W}{W}.');
  const GREEN_SPELL = card('Test Green Spell', 'Sorcery', 'You gain 1 life.', undefined, '{G}', ['G']);
  const GENERIC_SPELL = card('Test Plain Spell', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
  const DEFS = [RITUAL, FOREST, TWIN, GREEN_SPELL, GENERIC_SPELL];
  const tap = (s: GameState, name: string, who = 'p1'): GameState => {
    const src = find(s, name, 'battlefield', who);
    return settle(act(s, { type: 'activate', player: who, source: src, ability: activatedAbilities(s, s.objects[src]!)[0]!.key } as never));
  };
  const castable = (s: GameState, who = 'p1'): string[] => legal(s, who, 'cast').map((a) => s.objects[(a as { object: ObjectId }).object]!.defId);
  it('is automated', () => expect(full(RITUAL)).toBe(true));
  it('a Forest tapped for {G} produces {C}; a land that would add {W}{W} adds {C}{C} (the amount is unchanged)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Dull Ritual', 'Test Forest', 'Test Twin Land'] } });
    expect(pool(tap(s0, 'Test Forest'), 'p1')).toBe('C');
    expect(pool(tap(s0, 'Test Twin Land'), 'p1')).toBe('CC');
  });
  it('the payment planner agrees: {G} cannot be paid with the Forest, {1} can; every player\'s lands are affected', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Green Spell', 'Test Plain Spell'], battlefield: ['Test Dull Ritual', 'Test Forest'] } });
    expect(castable(s0)).toContain('Test Plain Spell');
    expect(castable(s0)).not.toContain('Test Green Spell');
    const s1 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Forest'] }, p2: { battlefield: ['Test Dull Ritual'] } }); // an opponent's Ritual affects your land
    expect(pool(tap(s1, 'Test Forest'), 'p1')).toBe('C');
  });
  it('a filter land ({1}, {T}: Add {G}{G}) is planned as {C}{C} too: a {G}{G} spell is not castable, a {2} spell is', () => {
    const FILTER = card('Test Filter Land', 'Land', '{1}, {T}: Add {G}{G}.');
    const GG = card('Test Double Green', 'Sorcery', 'You gain 1 life.', undefined, '{G}{G}', ['G']);
    const TWO = card('Test Two Spell', 'Sorcery', 'You gain 1 life.', undefined, '{2}');
    const s0 = scenario([], { defs: [...DEFS, FILTER, GG, TWO], p1: { hand: ['Test Double Green', 'Test Two Spell'], battlefield: ['Test Dull Ritual', 'Test Forest', 'Test Filter Land'] } });
    expect(castable(s0)).toContain('Test Two Spell');
    expect(castable(s0)).not.toContain('Test Double Green');
    const s1 = scenario([], { defs: [...DEFS, FILTER, GG, TWO], p1: { hand: ['Test Double Green'], battlefield: ['Test Forest', 'Test Filter Land'] } });
    expect(castable(s1)).toContain('Test Double Green'); // without Ritual the filter land turns the Forest's {G} into {G}{G}
  });
  it('negative: without it the Forest adds {G} and {G} can be paid', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Green Spell'], battlefield: ['Test Forest', 'Test Twin Land'] } });
    expect(pool(tap(s0, 'Test Forest'), 'p1')).toBe('G');
    expect(pool(tap(s0, 'Test Twin Land'), 'p1')).toBe('WW');
    expect(castable(s0)).toContain('Test Green Spell');
  });
});

describe('CR 122.1, 114.1: "Exile any number of target creatures that have -1/-1 counters on them."', () => {
  const DUST = card('Test Grave Dust', 'Sorcery', 'Exile any number of target creatures that have -1/-1 counters on them.');
  const DEFS = [DUST, BEAR, BIG];
  it('is automated', () => expect(full(DUST)).toBe(true));
  it('only creatures with a -1/-1 counter are legal targets, and they are exiled', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Grave Dust'], battlefield: ['Test Big Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const shrunk = find(s0, 'Test Big Bear', 'battlefield', 'p1');
    const plain = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = tweak(s0, (t) => { t.objects[shrunk]!.counters['-1/-1'] = 1; });
    const options = castOptions(s1, 'Test Grave Dust');
    expect(options).toContain(shrunk);
    expect(options).not.toContain(plain);
    const s2 = resolveAll(cast(s1, 'Test Grave Dust', { targets: [obj(shrunk)] }));
    expect(s2.zones.battlefield.includes(shrunk)).toBe(false);
    expect(s2.zones.exile.some((id) => s2.objects[id]!.defId === 'Test Big Bear')).toBe(true);
    expect(s2.zones.battlefield.includes(plain)).toBe(true);
  });
});

describe('fail closed (CR 509.1): "that creature" after "blocks or becomes blocked by a creature" is the OTHER combatant, never the enchanted one', () => {
  it('a trigger that names the other combatant and then says "that creature" is not automated (it would hit the enchanted creature itself)', () => {
    const BLADE = card('Test Cursed Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nWhenever equipped creature blocks or becomes blocked by a creature, that creature loses all abilities until end of turn.\nEquip {1}');
    // edh-d-25 (Barrow-Blade, Wooden Stake; Scryfall: "that creature" is the creature blocked by or blocking the equipped one): the attached creature is never "that creature" (Mention.otherPartyThat), so these are now automated
    expect(full(BLADE)).toBe(true);
    const STAKE = card('Test Oak Stake', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nWhenever equipped creature blocks or becomes blocked by a Vampire, destroy that creature. It can\'t be regenerated.\nEquip {1}');
    expect(full(STAKE)).toBe(true);
  });
});
