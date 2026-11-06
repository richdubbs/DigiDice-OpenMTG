/**
 * Commander lane edh-misc, round edh-misc-1, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). The templates this round made stable (copy-token and become-copy exceptions, "N life for each", "as long as" grants, "the next spell has improvise")
 * and the new "a creature dying causes a triggered ability to trigger an additional time" static, each with its negative case. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 603.2d, 603.10a, 700.4   a creature dying makes a triggered ability of a permanent you control trigger an additional time (looking back)
 *   CR 707.2, 707.9a, 707.9b    a token copy keeps the copied values except the stated exceptions; the copy exceptions are part of the copiable values
 *   CR 611.2a, 707.9           "that token gains haste" lasts for good (not copiable); no equipped creature, no token
 *   CR 119.3, 608.2h           "gain 4 life for each ..." counts the creatures as it resolves
 *   CR 604.1, 611.3a, 613.1f   "have equip {0} as long as you control three or more artifacts" (a granted ability while the condition holds)
 *   CR 601.2f, 702.126a        "the next spell you cast this turn has improvise"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string, owner?: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (!owner || s.objects[id]!.controller === owner));
const pt = (s: GameState, id: ObjectId): [string, string] => [chars(s, id).power!, chars(s, id).toughness!];
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => chars(s, id).keywords.some((x) => x.keyword === k);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
/** Move a creature to its owner's graveyard the way destruction does (a real zone change that triggers "dies" abilities). */
function killViaSpell(s: GameState, victim: ObjectId, name: string): GameState {
  return cast(s, name, { targets: [[victim]] });
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const KING = card('Test King', 'Legendary Creature — Human Noble', 'Vigilance', { pt: ['3', '3'] });
const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');

describe('CR 603.2d, 603.10a, 700.4: "if a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time"', () => {
  const DOUBLER = card('Test Doubler', 'Creature — Advisor', 'If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', { pt: ['1', '1'] });
  const SCRIBE = card('Test Scribe', 'Creature — Human', 'Whenever a creature you control dies, you gain 1 life.', { pt: ['1', '1'] });
  const MARTYR = card('Test Martyr', 'Creature — Human', 'When this creature dies, you gain 1 life.', { pt: ['1', '1'] });
  const SCRIBE2 = card('Test Opposing Scribe', 'Creature — Human', 'Whenever a creature you control dies, you gain 1 life.', { pt: ['1', '1'] });
  const defs = [DOUBLER, SCRIBE, MARTYR, SCRIBE2, BEAR, KILL];
  it('is fully automated', () => expect(full(DOUBLER)).toBe(true));
  it('a creature you control dying: your "whenever a creature you control dies" trigger happens twice, and the dying creature\'s own "when this creature dies" too', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Doubler', 'Test Scribe', 'Test Martyr'] } });
    const before = life(s, 'p1');
    s = killViaSpell(s, find(s, 'Test Martyr', 'battlefield', 'p1'), 'Test Smite');
    // Scribe: 2 (doubled) + Martyr's own: 2 (doubled, looking back) = 4
    expect(life(s, 'p1') - before).toBe(4);
  });
  it('the negative case: without the doubler each trigger happens once', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Scribe', 'Test Martyr'] } });
    const before = life(s, 'p1');
    s = killViaSpell(s, find(s, 'Test Martyr', 'battlefield', 'p1'), 'Test Smite');
    expect(life(s, 'p1') - before).toBe(2);
  });
  it('the negative case: a permanent an opponent controls is not doubled ("a permanent you control")', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Doubler'] }, p2: { battlefield: ['Test Opposing Scribe', 'Test Bear'] } });
    const before = life(s, 'p2');
    s = killViaSpell(s, find(s, 'Test Bear', 'battlefield', 'p2'), 'Test Smite');
    expect(life(s, 'p2') - before).toBe(1); // the opponent's own trigger happens once, my Doubler does not touch it
  });
  it('the doubler dying itself still doubles its own death event (last known information, CR 603.10a)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Doubler', 'Test Martyr', 'Test Scribe'] } });
    const before = life(s, 'p1');
    s = killViaSpell(s, find(s, 'Test Doubler', 'battlefield', 'p1'), 'Test Smite');
    // Scribe sees the Doubler die: 1 trigger doubled by the Doubler's own look-back = 2
    expect(life(s, 'p1') - before).toBe(2);
  });
});

describe('CR 707.2, 707.9b, 611.2a: "create a token that\'s a copy of equipped creature, except the token isn\'t legendary. That token gains haste."', () => {
  const HELM = card('Test Helm', 'Legendary Artifact — Equipment', 'At the beginning of combat on your turn, create a token that\'s a copy of equipped creature, except the token isn\'t legendary. That token gains haste.\nEquip {5}');
  const defs = [HELM, KING, BEAR];
  it('is fully automated', () => expect(full(HELM)).toBe(true));
  it('a non-legendary copy of the equipped King with haste appears at the beginning of combat; the King itself stays legendary and hasteless', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Helm', 'Test King'] } });
    const king = find(s, 'Test King', 'battlefield', 'p1');
    s.objects[find(s, 'Test Helm', 'battlefield', 'p1')]!.attachedTo = king;
    s = resolveAll(advanceTo(s, 1, 'beginCombat'));
    const all = onField(s, 'Test King');
    expect(all.length).toBe(2); // not legendary, so the legend rule leaves both
    const token = all.find((id) => id !== king)!;
    expect(s.objects[token]!.kind).toBe('token');
    expect(chars(s, token).supertypes).not.toContain('Legendary');
    expect(hasKeyword(s, token, 'haste')).toBe(true);
    expect(hasKeyword(s, token, 'vigilance')).toBe(true);
    expect(chars(s, king).supertypes).toContain('Legendary');
    expect(hasKeyword(s, king, 'haste')).toBe(false);
  });
  it('the negative case: an unattached Equipment creates no token', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Helm', 'Test King'] } });
    s = resolveAll(advanceTo(s, 1, 'beginCombat'));
    expect(onField(s, 'Test King').length).toBe(1);
  });
  it('the negative case: on the opponent\'s turn it does not trigger ("on your turn")', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Helm', 'Test Bear'] } });
    s.objects[find(s, 'Test Helm', 'battlefield', 'p1')]!.attachedTo = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(advanceTo(s, 1, 'beginCombat'));
    expect(onField(s, 'Test Bear').length).toBe(2); // my turn: one copy
    s = resolveAll(advanceTo(s, 2, 'beginCombat'));
    expect(onField(s, 'Test Bear').length).toBe(2); // the opponent's turn: no second copy
  });
});

describe('CR 707.2, 707.9b, 603.6a: "whenever another nontoken Dragon you control enters, create a token that\'s a copy of it, except the token isn\'t legendary"', () => {
  const WYRM = card('Test Wyrm', 'Legendary Creature — Dragon Spirit', 'Whenever another nontoken Dragon you control enters, create a token that\'s a copy of it, except the token isn\'t legendary.', { pt: ['6', '6'] });
  const ELDER = card('Test Elder Drake', 'Legendary Creature — Dragon', 'Flying', { pt: ['4', '4'] });
  const HATCH = card('Test Hatchling', 'Creature — Dragon', '', { pt: ['1', '1'] });
  const defs = [WYRM, ELDER, HATCH, BEAR];
  it('is fully automated', () => expect(full(WYRM)).toBe(true));
  it('a nonlegendary token copy of the entering Dragon; the copy is a token, so it does not trigger again', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Elder Drake'], battlefield: ['Test Wyrm'] } });
    s = cast(s, 'Test Elder Drake');
    const all = onField(s, 'Test Elder Drake');
    expect(all.length).toBe(2);
    const token = all.find((id) => s.objects[id]!.kind === 'token')!;
    expect(chars(s, token).supertypes).not.toContain('Legendary');
    expect(hasKeyword(s, token, 'flying')).toBe(true);
    expect(pt(s, token)).toEqual(['4', '4']);
    expect(onField(s, 'Test Elder Drake').filter((id) => s.objects[id]!.kind !== 'token').every((id) => chars(s, id).supertypes.includes('Legendary'))).toBe(true);
  });
  it('the negative cases: a non-Dragon, and a Dragon the opponent controls, make no token', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bear'], battlefield: ['Test Wyrm'] }, p2: { battlefield: ['Test Hatchling'] } });
    s = cast(s, 'Test Bear');
    expect(onField(s, 'Test Bear').length).toBe(1);
    expect(onField(s, 'Test Hatchling').length).toBe(1);
  });
  it('the negative case: Test Wyrm itself entering does not copy itself ("another")', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Wyrm'] } });
    s = cast(s, 'Test Wyrm');
    expect(onField(s, 'Test Wyrm').length).toBe(1);
  });
});

describe('CR 707.2, 707.9b: "create a token that\'s a copy of target creature you control, except the token has flying and it isn\'t legendary"', () => {
  const DUP = card('Test Duplication', 'Sorcery', 'Create a token that\'s a copy of target creature you control, except the token has flying and it isn\'t legendary.');
  const defs = [DUP, KING, BEAR];
  it('is fully automated', () => expect(full(DUP)).toBe(true));
  it('the token copy has flying and is not legendary; the King does not gain flying', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Duplication'], battlefield: ['Test King'] } });
    const king = find(s, 'Test King', 'battlefield', 'p1');
    s = cast(s, 'Test Duplication', { targets: [[king]] });
    const all = onField(s, 'Test King');
    expect(all.length).toBe(2);
    const token = all.find((id) => id !== king)!;
    expect(hasKeyword(s, token, 'flying')).toBe(true);
    expect(hasKeyword(s, token, 'vigilance')).toBe(true);
    expect(chars(s, token).supertypes).not.toContain('Legendary');
    expect(hasKeyword(s, king, 'flying')).toBe(false);
    expect(chars(s, king).supertypes).toContain('Legendary');
  });
  it('a non-legendary target gets a flying token copy too (the flying is not tied to legendary, ruling 2022-06-10)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Duplication'], battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Duplication', { targets: [[find(s, 'Test Bear', 'battlefield', 'p1')]] });
    const token = onField(s, 'Test Bear').find((id) => s.objects[id]!.kind === 'token')!;
    expect(hasKeyword(s, token, 'flying')).toBe(true);
  });
});

describe('CR 707.9b, 105.3, 603.10a: "whenever another legendary creature you control dies, create a token that\'s a copy of that creature, except it\'s not legendary and it\'s a 2/2 black Zombie in addition to its other colors and types"', () => {
  const NECRO = card('Test Necromancer', 'Legendary Creature — Zombie Wizard', 'Whenever another legendary creature you control dies, create a token that\'s a copy of that creature, except it\'s not legendary and it\'s a 2/2 black Zombie in addition to its other colors and types.', { pt: ['2', '2'] });
  const GREEN = card('Test Green King', 'Legendary Creature — Elf Noble', 'Vigilance', { pt: ['5', '5'], colors: ['G'] });
  const defs = [NECRO, GREEN, BEAR, KILL];
  it('is fully automated', () => expect(full(NECRO)).toBe(true));
  it('the dying legend returns as a 2/2 nonlegendary token that is green AND black, an Elf Noble Zombie with vigilance', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Smite'], battlefield: ['Test Necromancer', 'Test Green King'] } });
    s = killViaSpell(s, find(s, 'Test Green King', 'battlefield', 'p1'), 'Test Smite');
    const tokens = onField(s, 'Test Green King');
    expect(tokens.length).toBe(1);
    const c = chars(s, tokens[0]!);
    expect(s.objects[tokens[0]!]!.kind).toBe('token');
    expect(c.supertypes).not.toContain('Legendary');
    expect(c.colors.slice().sort()).toEqual(['B', 'G']);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Elf', 'Noble', 'Zombie']));
    expect(pt(s, tokens[0]!)).toEqual(['2', '2']);
    expect(hasKeyword(s, tokens[0]!, 'vigilance')).toBe(true);
  });
  it('the negative cases: a non-legendary creature, and the necromancer itself, make no token', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Necromancer', 'Test Bear'] } });
    s = killViaSpell(s, find(s, 'Test Bear', 'battlefield', 'p1'), 'Test Smite');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
    s = killViaSpell(s, find(s, 'Test Necromancer', 'battlefield', 'p1'), 'Test Smite');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
  });
});

describe('CR 707.2, 707.9b: "at the beginning of your upkeep, create a token that\'s a copy of enchanted creature, except the token is 1/1"', () => {
  const MIRROR = card('Test Mirror Aura', 'Enchantment — Aura', 'Enchant creature you control\nAt the beginning of your upkeep, create a token that\'s a copy of enchanted creature, except the token is 1/1.');
  const BIG = card('Test Big Bear', 'Creature — Bear', 'Trample', { pt: ['5', '5'] });
  const defs = [MIRROR, BIG];
  it('is fully automated', () => expect(full(MIRROR)).toBe(true));
  it('on my next upkeep a 1/1 token copy of the enchanted 5/5 (trample kept); not on the opponent\'s upkeep', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Big Bear'] } });
    const bear = find(s, 'Test Big Bear', 'battlefield', 'p1');
    s.objects[put(s, 'p1', 'battlefield', 'Test Mirror Aura')]!.attachedTo = bear; // put after the scenario's state-based actions ran (an unattached Aura would be put into the graveyard)
    s = resolveAll(advanceTo(s, 2, 'upkeep'));
    expect(onField(s, 'Test Big Bear').length).toBe(1); // the opponent's upkeep: no trigger
    s = resolveAll(advanceTo(s, 3, 'upkeep'));
    const all = onField(s, 'Test Big Bear');
    expect(all.length).toBe(2);
    const token = all.find((id) => id !== bear)!;
    expect(pt(s, token)).toEqual(['1', '1']);
    expect(hasKeyword(s, token, 'trample')).toBe(true);
    expect(pt(s, bear)).toEqual(['5', '5']);
  });
});

describe('CR 707.9a, 707.9b, 611.2a, 613.1a: "target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it\'s an artifact in addition to its other types"', () => {
  const SHIFTER = card('Test Shaper', 'Legendary Planeswalker — Test', '−2: Target artifact you control becomes a copy of another target artifact or creature you control until end of turn, except it\'s an artifact in addition to its other types.');
  const COG = card('Test Cog', 'Artifact', '');
  const WOLF = card('Test Wolf', 'Creature — Wolf', 'Trample', { pt: ['3', '3'], colors: ['G'] });
  const defs = [SHIFTER, COG, WOLF];
  it('is fully automated', () => expect(full(SHIFTER)).toBe(true));
  it('the Cog becomes a green 3/3 Wolf artifact creature with trample; at end of turn it is a Cog again', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Cog', 'Test Wolf'] } });
    const cog = find(s, 'Test Cog', 'battlefield', 'p1');
    const wolf = find(s, 'Test Wolf', 'battlefield', 'p1');
    const pw = put(s, 'p1', 'battlefield', 'Test Shaper');
    s.objects[pw]!.counters = { loyalty: 4 };
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === pw);
    if (!la) throw new Error(`no loyalty activation among: ${legalActions(s, 'p1').map((a) => a.label).join('; ')}`);
    s = resolveAll(act(s, la.action), { targets: [[cog], [wolf]] });
    const c = chars(s, cog);
    expect(c.name).toBe('Test Wolf');
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(pt(s, cog)).toEqual(['3', '3']);
    expect(hasKeyword(s, cog, 'trample')).toBe(true);
    expect(chars(s, wolf).types).not.toContain('Artifact'); // only the target changed
    s = resolveAll(advanceTo(s, 2, 'upkeep'));
    expect(chars(s, cog).name).toBe('Test Cog'); // until end of turn (CR 514.2)
  });
});

describe('CR 707.9a, 707.9b, 613.1a: "~ becomes a copy of up to one other target creature you control, except her name is ~ and she has this ability. Then put a +1/+1 counter on her."', () => {
  const MUTANT = card('Test Mutant', 'Legendary Creature — Human Mutant', 'At the beginning of combat on your turn, Test Mutant becomes a copy of up to one other target creature you control, except her name is Test Mutant and she has this ability. Then put a +1/+1 counter on her.', { pt: ['1', '1'] });
  const WOLF = card('Test Wolf', 'Creature — Wolf', 'Trample', { pt: ['3', '3'], colors: ['G'] });
  const defs = [MUTANT, WOLF];
  it('is fully automated', () => expect(full(MUTANT)).toBe(true));
  it('with a target: a 3/3 Wolf-with-trample named Test Mutant, +1/+1 counter (4/4), and it keeps the ability for the next turn', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Mutant', 'Test Wolf'] } });
    const m = find(s, 'Test Mutant', 'battlefield', 'p1');
    s = resolveAll(advanceTo(s, 1, 'beginCombat'), { targets: [[find(s, 'Test Wolf', 'battlefield', 'p1')]] });
    expect(chars(s, m).name).toBe('Test Mutant');
    expect(hasKeyword(s, m, 'trample')).toBe(true);
    expect(pt(s, m)).toEqual(['4', '4']);
    expect(chars(s, m).subtypes).toContain('Wolf');
    expect(chars(s, m).subtypes).not.toContain('Mutant');
    s = resolveAll(advanceTo(s, 3, 'beginCombat'), { targets: [[]] }); // "up to one": no target this time, another counter, still a Wolf with the ability
    expect(pt(s, m)).toEqual(['5', '5']);
  });
  it('the negative case: with no other creature, up to zero targets: still a Mutant, only the counter', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Mutant'] } });
    const m = find(s, 'Test Mutant', 'battlefield', 'p1');
    s = resolveAll(advanceTo(s, 1, 'beginCombat'));
    expect(chars(s, m).subtypes).toContain('Mutant');
    expect(pt(s, m)).toEqual(['2', '2']);
  });
});

describe('CR 119.3, 608.2h: "draw a card for each creature you control. Ferocious — you gain 4 life for each creature you control with power 4 or greater"', () => {
  const REVEL = card('Test Revelation', 'Sorcery', 'Draw a card for each creature you control.\nFerocious — You gain 4 life for each creature you control with power 4 or greater.');
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['4', '4'] });
  const defs = [REVEL, GIANT, BEAR];
  it('is fully automated', () => expect(full(REVEL)).toBe(true));
  it('two power-4 creatures and a Bear: draw 3, gain 8; an opponent\'s creature counts for nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Revelation'], battlefield: ['Test Giant', 'Test Giant', 'Test Bear'] }, p2: { battlefield: ['Test Giant'] } });
    const hand = s.zones.hand.p1!.length, l = life(s, 'p1');
    s = cast(s, 'Test Revelation');
    expect(s.zones.hand.p1!.length - hand).toBe(3 - 1); // three drawn, the spell left the hand
    expect(life(s, 'p1') - l).toBe(8);
  });
  it('the negative case: no power-4 creature, no life', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Revelation'], battlefield: ['Test Bear'] } });
    const l = life(s, 'p1');
    s = cast(s, 'Test Revelation');
    expect(life(s, 'p1')).toBe(l);
  });
});

describe('CR 604.1, 611.3a, 613.1f, 702.6a: "Equipment you control have equip {0} as long as you control three or more artifacts"', () => {
  const PALADIN = card('Test Smith', 'Creature — Human Knight', 'Equipment you control have equip {0} as long as you control three or more artifacts.', { pt: ['2', '2'] });
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {5}');
  const COG = card('Test Cog', 'Artifact', '');
  const defs = [PALADIN, BLADE, COG, BEAR];
  const equipActions = (s: GameState) => legalActions(s, 'p1').filter((a) => a.kind === 'activate' && !a.isMana && /equip/i.test(a.label));
  it('is fully automated', () => expect(full(PALADIN)).toBe(true));
  it('with three artifacts (the Blade among them) the Blade can be equipped for {0}; the {5} equip stays too', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Smith', 'Test Blade', 'Test Cog', 'Test Cog', 'Test Bear'] } });
    const labels = equipActions(s).map((a) => a.label);
    expect(labels.some((l) => /\{0\}/.test(l)), labels.join(' | ')).toBe(true);
    const la = equipActions(s).find((a) => /\{0\}/.test(a.label))!;
    s = resolveAll(act(s, la.action), { targets: [[find(s, 'Test Bear', 'battlefield', 'p1')]] });
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual(['3', '3']);
  });
  it('the negative case: with only two artifacts there is no {0} equip', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Smith', 'Test Blade', 'Test Cog', 'Test Bear'] } });
    expect(equipActions(s).some((a) => /\{0\}/.test(a.label))).toBe(false);
  });
  it('the negative case: an opponent\'s Equipment does not gain it ("Equipment you control"): one equip ability for theirs, two for mine', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Smith', 'Test Blade', 'Test Cog', 'Test Cog'] }, p2: { battlefield: ['Test Blade'] } });
    const equips = (owner: 'p1' | 'p2') => chars(s, find(s, 'Test Blade', 'battlefield', owner)).abilities.filter((a) => a.def.kind === 'keyword' && a.def.keyword === 'equip').length;
    expect(equips('p1')).toBe(2);
    expect(equips('p2')).toBe(1);
  });
});

describe('CR 118.9, 601.2b, 611.2a: "that player exiles the top two cards of their library. Until end of turn, you may play those cards without paying their mana costs"', () => {
  const SHADE = card('Test Shade', 'Creature — Zombie Ninja', 'Whenever this creature deals combat damage to a player, that player exiles the top two cards of their library. Until end of turn, you may play those cards without paying their mana costs.', { pt: ['2', '2'] });
  const IDEA = card('Test Idea', 'Sorcery', 'You gain 3 life.', { cost: '{2}{G}' });
  const PEBBLE = card('Test Pebble', 'Instant', 'You gain 1 life.', { cost: '{5}' });
  const defs = [SHADE, IDEA, PEBBLE];
  /** p1's Shade hits p2, whose library's top two cards are the given ones; returns the state in the second main phase. */
  function hit(): GameState {
    let s = scenario([], { defs, p1: { battlefield: ['Test Shade'] } });
    s.zones.library.p2 = [];
    for (const n of ['Test Idea', 'Test Pebble', 'Plains', 'Plains']) put(s, 'p2', 'library', n); // the first is the top card of the library
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Shade', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    return resolveAll(toStep(s, 'main2'));
  }
  it('is fully automated', () => expect(full(SHADE)).toBe(true));
  it('the opponent exiles the top two cards of THEIR library; I may cast them for free this turn: the sorcery resolves with no mana spent', () => {
    let s = hit();
    const exiled = s.zones.exile.map((id) => chars(s, id).name).sort();
    expect(exiled).toEqual(['Test Idea', 'Test Pebble']);
    expect(s.zones.library.p2!.length).toBe(2); // only the top two were exiled
    const l = life(s, 'p1');
    const idea = s.zones.exile.find((id) => chars(s, id).name === 'Test Idea')!;
    const la = legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === idea);
    expect(la, legalActions(s, 'p1').map((a) => a.label).join(' | ')).toBeDefined();
    s = resolveAll(act(s, la!.action));
    expect(life(s, 'p1') - l).toBe(3);
  });
  it('the negative cases: the opponent may not play them, and after the turn nobody may', () => {
    let s = hit();
    const pebble = s.zones.exile.find((id) => chars(s, id).name === 'Test Pebble')!;
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === pebble)).toBe(false);
    s = resolveAll(advanceTo(s, 2, 'main1'));
    for (const who of ['p1', 'p2'] as const) expect(legalActions(s, who).some((a) => a.kind === 'cast' && a.object === pebble), who).toBe(false);
    expect(s.zones.exile.includes(pebble)).toBe(true); // cards not played stay exiled
  });
});

describe('CR 118.9, 601.2b, 611.2a: "shuffle your library. Then exile the top card of your library. Until end of turn, you may play that card without paying its mana cost"', () => {
  const DESIRE = card('Test Desire', 'Sorcery', 'Exile the top card of your library. Until end of turn, you may play that card without paying its mana cost.', { cost: '{0}' });
  const IDEA = card('Test Idea', 'Sorcery', 'You gain 3 life.', { cost: '{2}{G}' });
  const defs = [DESIRE, IDEA];
  it('is fully automated', () => expect(full(DESIRE)).toBe(true));
  it('the exiled top card of MY library can be played for free this turn (the top card is known), and not afterwards', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Desire'] } });
    s.zones.library.p1 = [];
    for (const n of ['Test Idea', 'Plains', 'Plains', 'Plains', 'Plains']) put(s, 'p1', 'library', n);
    s = cast(s, 'Test Desire');
    const idea = s.zones.exile.find((id) => chars(s, id).name === 'Test Idea')!;
    const la = legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === idea);
    expect(la).toBeDefined();
    const l = life(s, 'p1');
    s = resolveAll(act(s, la!.action));
    expect(life(s, 'p1') - l).toBe(3);
  });
  it('the negative case: in a later turn the exiled card cannot be cast', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Desire'] } });
    s.zones.library.p1 = [];
    for (const n of ['Test Idea', 'Plains', 'Plains', 'Plains', 'Plains']) put(s, 'p1', 'library', n);
    s = cast(s, 'Test Desire');
    const idea = s.zones.exile.find((id) => chars(s, id).name === 'Test Idea')!;
    s = resolveAll(advanceTo(s, 3, 'main1'));
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === idea)).toBe(false);
  });
});

describe('CR 400.3, 110.2, 303.4f: "put target creature card from a graveyard onto the battlefield under its owner\'s control"', () => {
  const WARDEN = card('Test Warden', 'Legendary Creature — Test', '{4}{B}: Put target creature card from a graveyard onto the battlefield under its owner\'s control.', { pt: ['3', '3'] });
  const defs = [WARDEN, BEAR, KING];
  it('is fully automated', () => expect(full(WARDEN)).toBe(true));
  it('an opponent\'s creature card in THEIR graveyard comes back under THEIR control, not mine (the owner\'s)', () => {
    let s = scenario(['Swamp'], { defs, p1: { battlefield: ['Test Warden', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] }, p2: { graveyard: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'graveyard', 'p2');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === find(s, 'Test Warden', 'battlefield', 'p1'))!;
    s = resolveAll(act(s, la.action), { targets: [[bear]] });
    const back = s.zones.battlefield.find((id) => chars(s, id).name === 'Test Bear')!;
    expect(back).toBeDefined();
    expect(s.objects[back]!.controller).toBe('p2');
  });
  it('the negative case: a noncreature card in a graveyard is not a legal target', () => {
    const s = scenario(['Swamp'], { defs, p1: { battlefield: ['Test Warden', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] }, p2: { graveyard: ['Plains'] } });
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === find(s, 'Test Warden', 'battlefield', 'p1'));
    expect(la === undefined || (() => { const t = act(s, la.action); return t.pending?.kind !== 'chooseTargets' || (t.pending as unknown as { options?: unknown[] }).options?.length === 0; })()).toBe(true);
  });
});
