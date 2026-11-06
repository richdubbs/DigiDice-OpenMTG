/**
 * Commander lane edh-perms, round edh-perms-2: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from the Comprehensive Rules of 2026-09-25 (media.wizards.com) unless marked unverified.
 *
 *   CR 702.11b, 702.11d, 613.1f   "You, planeswalkers you control, and other creatures you control have hexproof." (Shalai, Voice of Plenty)
 *   CR 702.16a, 903.4, 903.4f     "Equipped creature gets +3/+3 and has protection from each color that's not in your commander's color identity." (Commander's Plate)
 *   CR 702.6c                     "Equip commander {3}" (the equip cost that only a commander can use)
 *   CR 208.1, 603.4, 608.2c       "Whenever another creature enters, its controller may draw a card if its power is greater than each other creature's power." (Selvala)
 *   CR 107.3, 111.2, 608.2h       "Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."" (Pest Infestation)
 *   CR 301.5, 303.4, 613.4c       "Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}." (Thran Power Suit)
 *   CR 303.4, 608.2h              "... for each Aura you control that's attached to a creature" (Sage's Reverie)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { card as ccard, commanderScenario, forests, legend, tweak } from '../../m11/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const protections = (s: GameState, id: ObjectId): string => getChars(s, id)!.keywords.filter((k) => k.keyword === 'protection').map((k) => k.quality).sort().join(',');
const hexproof = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id)!, 'hexproof');
const objs = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && getChars(s, id)!.name.replace(/ Token$/, '') === name);

/** Answer every decision until a player has priority (targets from the queue, yes/no by `yes`, X by `x`, mana automatically). */
function drive(s0: GameState, o: { yes?: boolean; targets?: TargetChoice[][]; x?: number } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min ?? 0 });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s: GameState, name: string, who: 'p1' | 'p2' = 'p1'): GameState => act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) });

describe('CR 702.11b, 702.11d, 613.1f: "You, planeswalkers you control, and other creatures you control have hexproof."', () => {
  const ANGEL = card('Test Plenty Angel', 'Creature — Angel', 'Flying\nYou, planeswalkers you control, and other creatures you control have hexproof.', { pt: ['3', '4'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to any target.', { cost: '{0}' });
  const defs = [ANGEL, BEAR, ZAP];
  const targetsOf = (s: GameState): { objects: string[]; players: string[] } => s.pending as unknown as { objects: string[]; players: string[] };
  it('is automated', () => expect(automated(ANGEL)).toBe(true));
  it('CR 702.11b: other creatures you control have hexproof, the Angel itself does not, and you can\'t be targeted by an opponent\'s spell', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plenty Angel', 'Test Bear'] }, p2: { hand: ['Test Zap'], battlefield: ['Test Bear'] }, defs });
    const angel = find(s0, 'Test Plenty Angel', 'battlefield', 'p1');
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(hexproof(s0, mine)).toBe(true);
    expect(hexproof(s0, angel)).toBe(false);
    const t = cast(pass(s0), 'Test Zap', 'p2');
    expect(t.pending?.kind).toBe('chooseTargets');
    const { objects, players } = targetsOf(t);
    expect(objects).toContain(angel); // not "other"
    expect(objects).not.toContain(mine);
    expect(objects).toContain(find(s0, 'Test Bear', 'battlefield', 'p2')); // the opponent's own creature has no hexproof
    expect(players).toEqual(['p2']); // not p1
  });
  it('hexproof is against opponents only: you can still target your own creatures and yourself', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plenty Angel', 'Test Bear'], hand: ['Test Zap'] }, defs });
    const t = cast(s0, 'Test Zap');
    const { objects, players } = targetsOf(t);
    expect(objects).toContain(find(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(players).toContain('p1');
  });
  it('without the Angel nothing has hexproof', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { hand: ['Test Zap'] }, defs });
    const t = cast(pass(s0), 'Test Zap', 'p2');
    const { objects, players } = targetsOf(t);
    expect(objects).toContain(find(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(players).toContain('p1');
  });
});

describe('CR 702.16a, 903.4, 903.4f: "Equipped creature ... has protection from each color that\'s not in your commander\'s color identity."', () => {
  const PLATE = card('Test Commander Plate', 'Artifact — Equipment', 'Equipped creature gets +3/+3 and has protection from each color that\'s not in your commander\'s color identity.\nEquip commander {3}\nEquip {5}', { cost: '{3}' });
  const WARD = ccard('Test Warden Plate', '{1}', 'Artifact — Equipment', 'Equipped creature gets +3/+3 and has protection from each color that\'s not in your commander\'s color identity.\nEquip {1}');
  const BEAR = ccard('Test Bear', '{1}{G}', 'Creature — Bear', '', ['2', '2']);
  const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
  const KRAUM = legend('Test Kraum', '{U}{R}', ['4', '4'], ['U', 'R']);
  const COLORLESS = legend('Test Golem', '{5}', ['5', '5'], [], '', 'Legendary Artifact Creature — Golem');
  const UNKNOWN = legend('Test Unknown', '{G}', ['1', '1'], null);
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const equipped = (cmds: CardDef[]): { s: GameState; bear: string } => {
    let s = commanderScenario({ p1Commanders: cmds, p2Commanders: [BOB], defs: [WARD, BEAR], p1: { battlefield: [...forests(2), 'Test Warden Plate', { name: 'Test Bear' }] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const plate = find(s, 'Test Warden Plate', 'battlefield', 'p1');
    s = tweak(s, (t) => { t.objects[plate]!.attachedTo = bear; });
    return { s, bear };
  };
  it('is automated, and Equip commander is understood', () => {
    expect(automated(PLATE)).toBe(true);
    expect(automated(WARD)).toBe(true);
  });
  it('CR 903.4: a green commander: protection from white, blue, black and red, not green; +3/+3', () => {
    const { s, bear } = equipped([TITANIA]);
    expect(protections(s, bear)).toBe('color:B,color:R,color:U,color:W');
    expect(ptOf(s, bear)).toBe('5/5');
  });
  it('CR 702.124c: two commanders (partners) combine their identities: only green, white and black are left', () => {
    const { s, bear } = equipped([KRAUM, TITANIA]);
    expect(protections(s, bear)).toBe('color:B,color:W');
  });
  it('CR 903.4f: a colorless identity is outside no color: protection from all five', () => {
    const { s, bear } = equipped([COLORLESS]);
    expect(protections(s, bear)).toBe('color:B,color:G,color:R,color:U,color:W');
  });
  it('an identity nobody gave (a commander definition without colorIdentity, never guessed) grants no protection (fail closed), but the +3/+3 stays', () => {
    const { s, bear } = equipped([UNKNOWN]);
    expect(protections(s, bear)).toBe('');
    expect(ptOf(s, bear)).toBe('5/5');
  });
  it('outside a Commander game there is no commander: no protection granted', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Warden Plate', 'Test Bear'] }, defs: [WARD, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = tweak(s0, (t) => { t.objects[find(t, 'Test Warden Plate', 'battlefield', 'p1')]!.attachedTo = bear; });
    expect(protections(s, bear)).toBe('');
  });
  it('CR 613.1f, 903.4: whose commander: the Equipment\'s controller\'s, even on a creature the opponent controls', () => {
    const { s, bear } = equipped([TITANIA]);
    const stolen = tweak(s, (t) => { t.objects[bear]!.controller = 'p2'; });
    expect(protections(stolen, bear)).toBe('color:B,color:R,color:U,color:W');
  });
  it('without the Equipment attached the creature has no protection', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WARD, BEAR], p1: { battlefield: ['Test Warden Plate', 'Test Bear'] } });
    expect(protections(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('');
  });
});

describe('CR 208.1, 603.4, 608.2c: "Whenever another creature enters, its controller may draw a card if its power is greater than each other creature\'s power."', () => {
  const SEER = card('Test Wild Seer', 'Legendary Creature — Elf Scout', 'Whenever another creature enters, its controller may draw a card if its power is greater than each other creature\'s power.', { pt: ['2', '3'] });
  const BIG = card('Test Big Bear', 'Creature — Bear', '', { pt: ['4', '4'], cost: '{0}' });
  const SMALL = card('Test Small Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{0}' });
  const TOUGH = card('Test Tough Bear', 'Creature — Bear', '', { pt: ['1', '9'], cost: '{0}' });
  const defs = [SEER, BIG, SMALL, TOUGH];
  const handSize = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => s.zones.hand[p]!.length;
  it('is automated', () => expect(automated(SEER)).toBe(true));
  it('CR 208.1: an entering creature with the greatest power draws its controller a card', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Seer'], hand: ['Test Big Bear'] }, defs });
    const n0 = handSize(s0) - 1;
    const r = resolveAll(cast(s0, 'Test Big Bear'));
    expect(objs(r, 'Test Big Bear', 'p1')).toHaveLength(1);
    expect(handSize(r)).toBe(n0 + 1);
  });
  it('a tie is not greater: a creature of the same power as another creature draws nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Seer'], hand: ['Test Small Bear'] }, defs });
    const n0 = handSize(s0) - 1;
    expect(handSize(resolveAll(cast(s0, 'Test Small Bear')))).toBe(n0);
  });
  it('every other creature counts, the opponent\'s too: a 4/4 does not beat an opponent\'s 4/4', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Seer'], hand: ['Test Big Bear'] }, p2: { battlefield: ['Test Big Bear'] }, defs });
    const n0 = handSize(s0) - 1;
    expect(handSize(resolveAll(cast(s0, 'Test Big Bear')))).toBe(n0);
  });
  it('power, not toughness: a 1/9 draws nothing next to a 2/3', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Seer'], hand: ['Test Tough Bear'] }, defs });
    const n0 = handSize(s0) - 1;
    expect(handSize(resolveAll(cast(s0, 'Test Tough Bear')))).toBe(n0);
  });
  it('"may": declining draws nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Seer'], hand: ['Test Big Bear'] }, defs });
    const n0 = handSize(s0) - 1;
    expect(handSize(resolveAll(cast(s0, 'Test Big Bear'), { yes: false }))).toBe(n0);
  });
  it('CR 608.2h (Selvala ruling 2016-08-23): a creature that left the battlefield before the trigger resolves is compared by its power as it last existed', () => {
    const KILL = card('Test Quick Kill', 'Instant', 'Destroy target creature.', { cost: '{0}' });
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Seer'], hand: ['Test Big Bear', 'Test Quick Kill'] }, defs: [...defs, KILL] });
    const n0 = handSize(s0) - 2;
    // Big Bear enters (a 4/4 beside a 2/3), its trigger is on the stack; the Bear is destroyed in response; the trigger still draws (4 > 2 as it last existed)
    let s = drive(cast(s0, 'Test Big Bear'));
    s = pass(pass(s)); // both pass: the Bear spell resolves and its trigger goes on the stack
    expect(s.zones.stack.length).toBe(1);
    const bear = objs(s, 'Test Big Bear', 'p1')[0]!;
    s = drive(cast(s, 'Test Quick Kill'), { targets: [[{ kind: 'object', id: bear }]] });
    s = resolveAll(s);
    expect(objs(s, 'Test Big Bear', 'p1')).toHaveLength(0);
    expect(handSize(s)).toBe(n0 + 1);
  });
  it('its controller draws: an opponent\'s creature entering draws that opponent, not you', () => {
    const OPPBEAR = card('Test Foe Bear', 'Creature — Bear', 'Flash', { pt: ['5', '5'], cost: '{0}' });
    const s0 = scenario([], { p1: { battlefield: ['Test Wild Seer'] }, p2: { hand: ['Test Foe Bear'] }, defs: [...defs, OPPBEAR] });
    const p1Hand = handSize(s0, 'p1');
    const p2Hand = handSize(s0, 'p2') - 1;
    const s1 = resolveAll(cast(pass(s0), 'Test Foe Bear', 'p2'));
    expect(handSize(s1, 'p2')).toBe(p2Hand + 1);
    expect(handSize(s1, 'p1')).toBe(p1Hand);
  });
});

describe('CR 107.3, 111.2, 608.2h: "Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life.""', () => {
  const PEST = card('Test Pest Bloom', 'Sorcery', 'Destroy up to X target artifacts and/or enchantments. Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."', { cost: '{X}{G}' });
  const ORB = card('Test Orb', 'Artifact', '', { cost: '{0}' });
  const defs = [PEST, ORB];
  const give = (s: GameState, mana: string[]): void => { for (const m of mana) s.players[0]!.manaPool.push({ type: m } as never); };
  it('is automated', () => expect(automated(PEST)).toBe(true));
  it('X = 2 makes four Pests (twice X, not X), each with the lifegain trigger; X = 0 makes none', () => {
    const s0 = scenario([], { p1: { hand: ['Test Pest Bloom'] }, defs });
    give(s0, ['G', 'C', 'C']);
    const r = resolveAll(cast(s0, 'Test Pest Bloom'), { x: 2, targets: [[]] });
    expect(objs(r, 'Pest', 'p1')).toHaveLength(4);
    const t0 = scenario([], { p1: { hand: ['Test Pest Bloom'] }, defs });
    give(t0, ['G']);
    expect(objs(resolveAll(cast(t0, 'Test Pest Bloom'), { x: 0, targets: [[]] }), 'Pest', 'p1')).toHaveLength(0);
  });
  it('X = 1 makes two, and each is a 1/1', () => {
    const s0 = scenario([], { p1: { hand: ['Test Pest Bloom'] }, defs });
    give(s0, ['G', 'C']);
    const r = resolveAll(cast(s0, 'Test Pest Bloom'), { x: 1, targets: [[]] });
    const pests = objs(r, 'Pest', 'p1');
    expect(pests).toHaveLength(2);
    expect(ptOf(r, pests[0]!)).toBe('1/1');
  });
});

describe('CR 301.5, 303.4, 613.4c: "Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}."', () => {
  const SUIT = card('Test Power Suit', 'Artifact — Equipment', 'Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}.\nEquip {1}');
  const BLADE = card('Test Plain Blade', 'Artifact — Equipment', 'Equipped creature gets +0/+0.\nEquip {1}');
  const CHARM = card('Test Plain Charm', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+0.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [SUIT, BLADE, CHARM, BEAR];
  it('is automated', () => expect(automated(SUIT)).toBe(true));
  it('counts itself, other Equipment and Auras attached to the creature: 1, then 3 attachments give +1/+1, then +3/+3; ward {2} is granted', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Power Suit', 'Test Bear', 'Test Plain Blade'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const attach = (name: string) => (t: GameState): void => { t.objects[find(t, name, 'battlefield', 'p1')]!.attachedTo = bear; };
    const one = tweak(s0, attach('Test Power Suit'));
    expect(ptOf(one, bear)).toBe('3/3');
    expect(getChars(one, bear)!.keywords.some((k) => k.keyword === 'ward')).toBe(true);
    const two = tweak(one, attach('Test Plain Blade'));
    expect(ptOf(two, bear)).toBe('4/4');
    const three = tweak(two, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Plain Charm')]!.attachedTo = bear; });
    expect(ptOf(three, bear)).toBe('5/5');
  });
  it('only what is attached to the equipped creature counts: an Equipment on another creature does not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Power Suit', 'Test Bear', 'Test Bear', 'Test Plain Blade'] }, defs });
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bear');
    const s = tweak(s0, (t) => { t.objects[find(t, 'Test Power Suit', 'battlefield', 'p1')]!.attachedTo = b1; t.objects[find(t, 'Test Plain Blade', 'battlefield', 'p1')]!.attachedTo = b2; });
    expect(ptOf(s, b1!)).toBe('3/3');
    expect(ptOf(s, b2!)).toBe('2/2');
  });
});

describe('CR 303.4: "Enchanted creature gets +1/+1 for each Aura you control that\'s attached to a creature." / "draw a card for each Aura you control that\'s attached to a creature"', () => {
  const REVERIE = card('Test Sage Charm', 'Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, draw a card for each Aura you control that\'s attached to a creature.\nEnchanted creature gets +1/+1 for each Aura you control that\'s attached to a creature.', { cost: '{0}' });
  const CHARM = card('Test Plain Charm', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+0.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [REVERIE, CHARM, BEAR];
  it('is automated', () => expect(automated(REVERIE)).toBe(true));
  it('counts the Auras you control attached to a creature, itself included; an opponent\'s Aura does not count, nor an Aura attached to a player', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const aura = (name: string, who: 'p1' | 'p2', host: string) => (t: GameState): ObjectId => { const id = put(t, who, 'battlefield', name); t.objects[id]!.attachedTo = host; return id; };
    let sage = '';
    // the Sage Charm alone: 1 Aura (itself) -> +1/+1
    let s = tweak(s0, (t) => { sage = aura('Test Sage Charm', 'p1', bear)(t); });
    expect(ptOf(s, bear)).toBe('3/3');
    // plus one of my other Auras on the creature: 2 -> +2/+2
    s = tweak(s, (t) => { aura('Test Plain Charm', 'p1', bear)(t); });
    expect(ptOf(s, bear)).toBe('4/4');
    // an Aura of the opponent's on the creature is not one I control: still +2/+2
    s = tweak(s, (t) => { aura('Test Plain Charm', 'p2', bear)(t); });
    expect(ptOf(s, bear)).toBe('4/4');
    // another of my Auras on a creature of the opponent's still counts (attached to a creature): +3/+3
    s = tweak(s, (t) => { const foe = put(t, 'p2', 'battlefield', 'Test Bear'); aura('Test Plain Charm', 'p1', foe)(t); });
    expect(ptOf(s, bear)).toBe('5/5');
    // an Aura attached to a player (not a creature) does not count
    s = tweak(s, (t) => { aura('Test Plain Charm', 'p1', 'p2')(t); });
    expect(ptOf(s, bear)).toBe('5/5');
    expect(s.objects[sage]!.attachedTo).toBe(bear);
  });
  it('CR 603.6a: when the Aura enters it is already attached, so the trigger draws one card per Aura (itself included)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Sage Charm'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const withOne = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Plain Charm')]!.attachedTo = bear; });
    const hand0 = withOne.zones.hand['p1']!.length - 1;
    const r = resolveAll(cast(withOne, 'Test Sage Charm'), { targets: [[{ kind: 'object', id: bear }]] });
    expect(r.zones.hand['p1']!.length).toBe(hand0 + 2);
  });
});
