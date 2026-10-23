/**
 * Standard round I (slot I of the parallel rounds F-J): the readings of the round, played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 604.3, 613.4a, 305.6   "~'s power is equal to the number of basic land types among lands you control." (domain, power only; read by sta.cda.power with Standard round 6's domain quantity)
 *   CR 701.23a, 201.2         "search your library for up to X basic land cards with different names, reveal them, put them into your hand, then shuffle"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions that come up until priority (payments automatic; targets in order; numbers `x`; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: ObjectId[][]; yes?: boolean; x?: number; pick?: (options: ObjectId[], max: number) => ObjectId[] } = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => (/^p\d+$/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, p.max) : p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id); return `${c.power}/${c.toughness}`; };
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id).power);
const names = (s: GameState, zone: 'hand' | 'library' | 'graveyard', who: 'p1' | 'p2'): string[] => s.zones[zone][who]!.map((id) => s.defs[s.objects[id]!.defId]!.name);

describe('CR 604.3, 613.4a, 305.6: "~\'s power is equal to the number of basic land types among lands you control." (domain, a characteristic-defining ability)', () => {
  const WANDERER = card('Test Wanderer', 'Creature — Scout', 'Domain — Test Wanderer\'s power is equal to the number of basic land types among lands you control.', { pt: ['*', '2'], cost: '{G}' });
  it('is understood', () => expect(noManual(WANDERER)).toBe(true));
  it('three basic land types among your lands: power 3; the toughness is the printed 2; two Plains count once', () => {
    const s = scenario(['Island', 'Forest'], { defs: [WANDERER], p1: { battlefield: ['Test Wanderer', 'Plains', 'Plains', 'Island', 'Forest'] } });
    expect(pt(s, find(s, 'Test Wanderer', 'battlefield'))).toBe('3/2');
  });
  it('an opponent\'s lands are not counted, and the number is read again when the lands change', () => {
    let s = scenario(['Island', 'Forest'], { defs: [WANDERER], p1: { battlefield: ['Test Wanderer', 'Plains'] }, p2: { battlefield: ['Island', 'Forest'] } });
    const w = find(s, 'Test Wanderer', 'battlefield');
    expect(power(s, w)).toBe(1);
    s = scenario(['Island', 'Forest'], { defs: [WANDERER], p1: { battlefield: ['Test Wanderer', 'Plains', 'Island'] }, p2: { battlefield: ['Forest'] } });
    expect(power(s, find(s, 'Test Wanderer', 'battlefield'))).toBe(2);
  });
});

describe('CR 701.23a, 201.2, 107.3m: "search your library for up to X basic land cards with different names, reveal them, put them into your hand, then shuffle"', () => {
  const SEEKER = card('Test Seeker', 'Creature — Scout', 'When this creature enters, search your library for up to X basic land cards with different names, reveal them, put them into your hand, then shuffle.', { pt: ['1', '1'], cost: '{X}' });
  it('is understood', () => expect(noManual(SEEKER)).toBe(true));
  it('X is 2 with two Forests, an Island and a Swamp in the library: at most two cards, never two with the same name', () => {
    const s0 = scenario(['Island', 'Forest', 'Swamp'], { defs: [SEEKER], p1: { hand: ['Test Seeker'], battlefield: ['Plains', 'Plains'], library: ['Forest', 'Forest', 'Island', 'Swamp'] } });
    // pick the first option, then the first option of a different name
    const s = cast(s0, 'Test Seeker', {
      x: 2,
      pick: (options, max) => {
        const seen = new Set<string>();
        const out: ObjectId[] = [];
        for (const id of options) {
          const n = s0.defs[s0.objects[id]!.defId]!.name;
          if (!seen.has(n) && out.length < max) { seen.add(n); out.push(id); }
        }
        return out;
      },
    });
    const hand = names(s, 'hand', 'p1');
    expect(hand.length).toBe(2);
    expect(new Set(hand).size).toBe(2);
    expect(findAll(s, 'Test Seeker', 'battlefield', 'p1').length).toBe(1);
  });
  it('two cards with the same name are not a legal answer (CR 201.2: different names)', () => {
    const s0 = scenario(['Island', 'Forest', 'Swamp'], { defs: [SEEKER], p1: { hand: ['Test Seeker'], battlefield: ['Plains', 'Plains'], library: ['Forest', 'Forest', 'Island', 'Swamp'] } });
    let t = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Seeker', 'hand', 'p1') }), { x: 2 });
    while (t.pending && t.pending.kind === 'priority' && t.zones.stack.length > 0) t = pass(pass(t)); // resolve the spell, then its enters trigger until the search is asked
    expect(t.pending?.kind).toBe('chooseObjects');
    const forests = (t.pending as { options: ObjectId[] }).options.filter((id) => t.defs[t.objects[id]!.defId]!.name === 'Forest');
    expect(forests.length).toBe(2);
    expect(() => answer(t, { kind: 'chooseObjects', ids: forests })).toThrow();
  });
});

describe('CR 603.4, 120.1a, 113.6m: "At the beginning of each upkeep, if an opponent was dealt noncombat damage last turn, return this card from your graveyard to your hand."', () => {
  const RETURN = card('Test Return', 'Sorcery', 'Create a 1/1 colorless Wizard creature token.\nAt the beginning of each upkeep, if an opponent was dealt noncombat damage last turn, return this card from your graveyard to your hand.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 2 damage to target player.');
  const SELF_BOLT = card('Test Burn', 'Instant', 'Test Burn deals 2 damage to you.');
  /** Pass priority until the next turn's upkeep trigger (if any) is on the stack, then resolve everything on the stack. */
  function nextUpkeep(s0: GameState): GameState {
    let s = s0;
    const turn = s.turn.number;
    for (let i = 0; i < 80 && s.turn.number === turn; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    return s;
  }
  it('is understood', () => expect(noManual(RETURN)).toBe(true));
  it('damage to the opponent from a spell last turn: at the next upkeep the card is back in hand', () => {
    const s0 = scenario([], { defs: [RETURN, BOLT], p1: { hand: ['Test Bolt'], graveyard: ['Test Return'] } });
    const s1 = cast(s0, 'Test Bolt', { targets: [['p2']] });
    expect(names(s1, 'graveyard', 'p1')).toContain('Test Return');
    const s2 = nextUpkeep(s1);
    expect(names(s2, 'hand', 'p1')).toContain('Test Return');
    expect(names(s2, 'graveyard', 'p1')).not.toContain('Test Return');
  });
  it('no damage last turn: the card stays in the graveyard; damage to yourself is not damage to an opponent', () => {
    const s0 = scenario([], { defs: [RETURN, SELF_BOLT], p1: { hand: ['Test Burn'], graveyard: ['Test Return'] } });
    const quiet = nextUpkeep(s0);
    expect(names(quiet, 'graveyard', 'p1')).toContain('Test Return');
    const s1 = cast(s0, 'Test Burn');
    const s2 = nextUpkeep(s1);
    expect(names(s2, 'graveyard', 'p1')).toContain('Test Return');
  });
  it('the damage must be last turn\'s: damage two turns ago does not bring it back at a later upkeep', () => {
    const s0 = scenario([], { defs: [RETURN, BOLT], p1: { hand: ['Test Bolt'] } });
    const s1 = cast(s0, 'Test Bolt', { targets: [['p2']] });
    const s2 = nextUpkeep(s1); // turn 2 upkeep: the card is not in the graveyard yet
    put(s2, 'p1', 'graveyard', 'Test Return'); // test setup: it dies after that upkeep
    const s3 = nextUpkeep(s2); // turn 3 upkeep: the damage was dealt two turns ago
    expect(names(s3, 'graveyard', 'p1')).toContain('Test Return');
    expect(names(s3, 'hand', 'p1')).not.toContain('Test Return');
  });
});

describe('CR 120.1, 120.3, 608.2h, 109.2: "When this creature enters, each other Bird you control deals damage equal to its power to target creature an opponent controls."', () => {
  const FLOCK = card('Test Flock', 'Creature — Human Bird', 'When this creature enters, each other Bird you control deals damage equal to its power to target creature an opponent controls.', { pt: ['4', '4'] });
  const WREN = card('Test Wren', 'Creature — Bird', '', { pt: ['2', '2'] });
  const HAWK = card('Test Hawk', 'Creature — Bird', '', { pt: ['3', '3'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
  const TITAN = card('Test Titan', 'Creature — Giant', '', { pt: ['2', '20'] });
  it('is understood', () => expect(noManual(FLOCK)).toBe(true));
  it('every other Bird you control deals its own power (2 + 3); the Bird entering, a non-Bird of yours and an opponent\'s Bird deal none', () => {
    const s0 = scenario([], { defs: [FLOCK, WREN, HAWK, OGRE, TITAN], p1: { hand: ['Test Flock'], battlefield: ['Test Wren', 'Test Hawk', 'Test Ogre'] }, p2: { battlefield: ['Test Titan', 'Test Hawk'] } });
    const titan = find(s0, 'Test Titan', 'battlefield', 'p2');
    const s = cast(s0, 'Test Flock', { targets: [[titan]] });
    expect(s.objects[titan]!.damage).toBe(5);
    expect(findAll(s, 'Test Hawk', 'battlefield', 'p2').every((id) => s.objects[id]!.damage === 0)).toBe(true);
  });
  it('a lone Bird entering: no other Bird of yours, no damage; the target must be a creature an opponent controls', () => {
    const s0 = scenario([], { defs: [FLOCK, OGRE, TITAN], p1: { hand: ['Test Flock'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Titan'] } });
    const titan = find(s0, 'Test Titan', 'battlefield', 'p2');
    const s = cast(s0, 'Test Flock', { targets: [[titan]] });
    expect(s.objects[titan]!.damage).toBe(0);
  });
});

describe('CR 701.17a, 608.2h, 400.7j: "When enchanted creature dies, mill cards equal to its power. Return this card to its owner\'s hand and up to one creature card milled this way to the battlefield under your control."', () => {
  const DESTINY = card('Test Destiny', 'Enchantment — Aura', 'Enchant creature you control\nWhen enchanted creature dies, mill cards equal to its power. Return this card to its owner\'s hand and up to one creature card milled this way to the battlefield under your control.', { cost: '{0}' });
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('is understood', () => expect(noManual(DESTINY)).toBe(true));
  const killed = (library: string[]): GameState => {
    const s0 = scenario([], { defs: [DESTINY, BRUTE, BEAR, KILL], p1: { hand: ['Test Destiny', 'Test Kill'], battlefield: ['Test Brute'], library } });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    let s = cast(s0, 'Test Destiny', { targets: [[brute]] });
    s = cast(s, 'Test Kill', { targets: [[brute]] });
    return s;
  };
  it('the creature had power 2: two cards are milled; the Aura returns to its owner\'s hand and one milled creature card enters the battlefield under your control', () => {
    const s = killed(['Test Bear', 'Test Bear', 'Test Bear']);
    expect(names(s, 'hand', 'p1')).toContain('Test Destiny');
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1); // two milled, one of them put onto the battlefield
    expect(names(s, 'graveyard', 'p1')).toContain('Test Brute');
  });
  it('no creature card among the milled cards: the Aura is returned and nothing enters (up to one)', () => {
    const s = killed([]);
    expect(names(s, 'hand', 'p1')).toContain('Test Destiny');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.controller === 'p1' && s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
  });
});

describe('CR 701.24a, 108.3, 303.4: "{5}: Enchanted creature\'s owner shuffles it into their library." (the enchanted creature is the "it")', () => {
  const GRASP = card('Test Grasp', 'Enchantment — Aura', 'Enchant creature\n{5}: Enchanted creature\'s owner shuffles it into their library.', { cost: '{0}' });
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', { pt: ['3', '3'] });
  it('is understood', () => expect(noManual(GRASP)).toBe(true));
  it('the owner of the enchanted creature (not the Aura\'s controller) gets it back in their library, shuffled; the Aura goes to the graveyard', () => {
    const s0 = scenario([], { defs: [GRASP, BRUTE], p1: { hand: ['Test Grasp'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Brute'] } });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Grasp', { targets: [[brute]] });
    expect(findAll(s1, 'Test Grasp', 'battlefield', 'p1').length).toBe(1);
    const before = { p1: s1.zones.library.p1!.length, p2: s1.zones.library.p2!.length };
    let s2 = act(s1, { type: 'activate', player: 'p1', source: find(s1, 'Test Grasp', 'battlefield', 'p1'), ability: 'p:0:1' });
    s2 = resolveAll(drive(s2));
    expect(findAll(s2, 'Test Brute', 'battlefield').length).toBe(0);
    expect(s2.zones.library.p2!.length).toBe(before.p2 + 1);
    expect(s2.zones.library.p1!.length).toBe(before.p1);
    expect(names(s2, 'graveyard', 'p1')).toContain('Test Grasp');
  });
});

describe('CR 609.4b, 107.4c: "You may spend mana as though it were mana of any color to cast Case spells." (a static permission, spells it names only)', () => {
  const clerk = card('Test Clerk', 'Creature — Human', 'You may spend mana as though it were mana of any color to cast Case spells.', { pt: ['1', '1'] });
  const redCase = card('Test Red Case', 'Enchantment — Case', '', { cost: '{R}' });
  const redCharm = card('Test Red Charm', 'Enchantment', '', { cost: '{R}' });
  const colorlessCase = card('Test Dull Case', 'Enchantment — Case', '', { cost: '{C}' });
  const canCast = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));
  it('is understood', () => expect(noManual(clerk)).toBe(true));
  it('a Case spell with a red cost is castable with a Plains alone; a red spell that is no Case is not (the permission names Case spells)', () => {
    const s = scenario([], { defs: [clerk, redCase, redCharm], p1: { hand: ['Test Red Case', 'Test Red Charm'], battlefield: ['Test Clerk', 'Plains'] } });
    expect(canCast(s, 'Test Red Case')).toBe(true);
    expect(canCast(s, 'Test Red Charm')).toBe(false);
  });
  it('without the permitting permanent the Case spell is not castable with a Plains', () => {
    const s = scenario([], { defs: [clerk, redCase], p1: { hand: ['Test Red Case'], battlefield: ['Plains'] } });
    expect(canCast(s, 'Test Red Case')).toBe(false);
  });
  it('a colorless symbol {C} still needs colorless mana: colored mana can not pay it, as colorless is a type and not a color (CR 107.4c)', () => {
    const s = scenario([], { defs: [clerk, colorlessCase], p1: { hand: ['Test Dull Case'], battlefield: ['Test Clerk', 'Plains'] } });
    expect(canCast(s, 'Test Dull Case')).toBe(false);
  });
  it('the spell is cast and paid with the Plains: the Case enters the battlefield', () => {
    const s0 = scenario([], { defs: [clerk, redCase], p1: { hand: ['Test Red Case'], battlefield: ['Test Clerk', 'Plains'] } });
    const s = cast(s0, 'Test Red Case');
    expect(findAll(s, 'Test Red Case', 'battlefield', 'p1').length).toBe(1);
  });
});
