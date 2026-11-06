/**
 * Commander lane graveyard, round edh-next-59 (code edhn59): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory (cloud session), unverified unless noted.
 *
 *   CR 601.3, 601.3e, 400.7, 701.17a   "Once during each of your turns, you may cast a spell from among cards in your graveyard that were milled this turn." (Raul, Trouble Shooter)
 *   CR 601.3, 400.7                    "... that were put there from anywhere other than the battlefield this turn" (Banon, the Returners' Leader)
 *   CR 601.3, 202.3                    "... from your graveyard with mana value less than or equal to the number of quest counters on ~" (Arcade Gannon)
 *   CR 702.141a, 702.97a, 118.9        "Each ... card in your graveyard has encore {X}, where X is its mana value" / "has scavenge. The scavenge cost is equal to its mana cost."
 *   CR 702.34a                         "During your turn, each instant and sorcery card in your graveyard has flashback. Its flashback cost is equal to its mana cost." (Return the Past)
 *   CR 113.6m, 400.7, 508.4            "... pay {R}{R}. If you do, return ~ from your graveyard to the battlefield tapped and attacking with a +1/+1 counter on it." (Phoenix Chick)
 *   CR 113.6m, 301.5c                  "Whenever a 1/1 creature you control enters, you may return ~ from your graveyard to the battlefield, then attach it to that creature." (Sword of the Meek)
 *   CR 113.6m, 603.4                   "At the beginning of each end step, if an enchantment was put into your graveyard from the battlefield this turn, you may return ~ ..." (Kami of Transience)
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, advanceTo, find, scenario } from '../../m5/helpers';
import { answer } from '../../m3/scenario';
import { activate, drive, resolveAll } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';

const PT = { power: '2', toughness: '2' };
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const gyCasts = (s: GameState, player: PlayerId = 'p1'): string[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard').map((a) => nameOf(s, a.object!)).sort();
const onField = (s: GameState, name: string, p?: PlayerId): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));
const inYard = (s: GameState, name: string, p: PlayerId = 'p1'): ObjectId | undefined => s.zones.graveyard[p]!.find((id) => nameOf(s, id) === name);
const cast = (s: GameState, name: string, zone: 'hand' | 'graveyard' = 'hand'): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, zone, 'p1') }));
const pt = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id)!; return [Number(c.power), Number(c.toughness)]; };
const lands = (n: number): string[] => Array(n).fill('Plains') as string[];

// ---- Raul / Banon / Arcade Gannon ---------------------------------------------------------------------------------------------------------------------------------
const GRINDER = synthetic('Test Grinder', 'Creature — Human', '{2}', 'Once during each of your turns, you may cast a spell from among cards in your graveyard that were milled this turn.', PT);
const RETURNER = synthetic('Test Returner', 'Creature — Human', '{2}', 'Once during each of your turns, you may cast a creature spell from among cards in your graveyard that were put there from anywhere other than the battlefield this turn.', PT);
const QUESTER = synthetic('Test Quester', 'Creature — Human', '{2}', 'Once during each of your turns, you may cast an artifact or Human spell from your graveyard with mana value less than or equal to the number of quest counters on this creature.', PT);
const MILL = synthetic('Test Grind', 'Sorcery', '{0}', 'Mill two cards.');
const DISCARD = synthetic('Test Cull', 'Sorcery', '{0}', 'Discard a card.');
const SMITE = synthetic('Test Smite', 'Instant', '{0}', 'Destroy target creature.');
const GOLEM = synthetic('Test Golem', 'Artifact Creature — Golem', '{3}', 'Vigilance', PT);
const WIZARD = synthetic('Test Wizard', 'Creature — Human Wizard', '{1}', '', { power: '1', toughness: '1' });
const BEAR = synthetic('Test Bear', 'Creature — Bear', '{1}', '', PT);
const XBOT = synthetic('Test Xbot', 'Artifact Creature — Construct', '{X}{X}', 'Vigilance', PT);
const DEFS = [XBOT, GRINDER, RETURNER, QUESTER, MILL, DISCARD, SMITE, GOLEM, WIZARD, BEAR];

describe('edh-next-59: the readings are automated', () => {
  it('every synthetic card compiles without a manual ability', () => {
    for (const d of DEFS) expect(d.faces[0]!.abilities.filter((a) => a.kind === 'manual'), d.name).toEqual([]);
  });
});

describe('CR 601.3, 400.7, 701.17a: "cast a spell from among cards in your graveyard that were milled this turn"', () => {
  const start = (hand: string[] = ['Test Grind']): GameState => scenario(['Forest'], { p1: { library: ['Test Bear', 'Test Golem', 'Test Wizard', 'Test Bear'], battlefield: ['Test Grinder', ...lands(4)], hand, graveyard: ['Test Wizard'] }, defs: DEFS });
  it('offers a card milled this turn (once), not a card that was already there, and not a second one after the first was cast', () => {
    let s = start();
    expect(gyCasts(s)).toEqual([]); // the Wizard has been in the graveyard since before the turn
    s = resolveAll(cast(s, 'Test Grind'));
    const milled = s.zones.graveyard.p1!.map((id) => nameOf(s, id)).filter((n) => n !== 'Test Wizard' && n !== 'Test Grind');
    expect(milled.length).toBe(2);
    expect(gyCasts(s).sort()).toEqual(milled.slice().sort()); // both milled cards (and not the old Wizard) are offered
    s = resolveAll(cast(s, milled[0]!, 'graveyard'));
    expect(gyCasts(s)).toEqual([]); // once during each of your turns
  });
  it('negative: a card discarded (not milled) is not offered', () => {
    let s = start(['Test Cull', 'Test Bear']);
    s = resolveAll(cast(s, 'Test Cull'));
    expect(gyCasts(s)).toEqual([]);
  });
});

describe('CR 601.3, 400.7: "that were put there from anywhere other than the battlefield this turn"', () => {
  const start = (hand: string[]): GameState => scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Returner', 'Test Bear', ...lands(4)], hand, graveyard: [] }, defs: DEFS });
  it('offers a creature card discarded this turn; not one that died on the battlefield', () => {
    let s = start(['Test Cull', 'Test Wizard']);
    s = resolveAll(cast(s, 'Test Cull'));
    expect(inYard(s, 'Test Wizard')).toBeDefined();
    expect(gyCasts(s)).toEqual(['Test Wizard']); // a creature card put there from the hand is offered
  });
  it('negative: a creature that died on the battlefield this turn is not offered', () => {
    let s = start(['Test Smite']);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Bear', 'battlefield', 'p1') }] }]));
    expect(inYard(s, 'Test Bear')).toBeDefined();
    expect(gyCasts(s)).not.toContain('Test Bear');
  });
});

describe('CR 601.3, 202.3: "from your graveyard with mana value less than or equal to the number of quest counters on ~"', () => {
  const start = (quest: number): GameState => {
    const s = scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Quester', ...lands(4)], graveyard: ['Test Golem', 'Test Wizard', 'Test Bear'] }, defs: DEFS });
    const q = onField(s, 'Test Quester')!;
    s.objects[q]!.counters = { quest };
    return s;
  };
  it('offers an artifact or Human card whose mana value is at most the quest counters, and no other card', () => {
    expect(gyCasts(start(0))).toEqual([]);
    expect(gyCasts(start(1))).toEqual(['Test Wizard']); // MV 1, Human; the Bear (not artifact or Human) never
    expect(gyCasts(start(3))).toEqual(['Test Golem', 'Test Wizard']);
  });
});

describe('CR 202.3e, 107.3: the mana value limit of a graveyard permission counts the X announced (review)', () => {
  it('with 1 quest counter an {X}{X} artifact cannot be cast with X = 3 (mana value 6)', () => {
    const s = scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Quester', ...lands(8)], graveyard: ['Test Xbot'] }, defs: DEFS });
    s.objects[onField(s, 'Test Quester')!]!.counters = { quest: 1 };
    const t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Xbot', 'graveyard', 'p1') }), [{ kind: 'chooseX', x: 3 } as never]);
    expect(t.zones.stack.length === 0 || t.objects[t.zones.stack[0]!]!.stack!.x !== 3).toBe(true);
  });
});

// ---- graveyard keywords ---------------------------------------------------------------------------------------------------------------------------------------------
const GRAVEMOTHER = synthetic('Test Gravemother', 'Legendary Creature — Sliver', '{3}{W}', 'Each Sliver creature card in your graveyard has encore {X}, where X is its mana value.', { power: '3', toughness: '3' });
const SLIVER = synthetic('Test Sliver', 'Creature — Sliver', '{1}{W}', 'Flying', PT);
const WOLF = synthetic('Test Wolf', 'Creature — Wolf', '{2}{G}', '', PT);
const CLAWS = synthetic('Test Claws', 'Creature — Mutant', '{2}{G}', 'Each creature card in your graveyard has scavenge. The scavenge cost is equal to its mana cost.', PT);
const PAST = synthetic('Test Past', 'Enchantment', '{1}{U}', 'During your turn, each instant and sorcery card in your graveyard has flashback. Its flashback cost is equal to its mana cost.');
const BOLT = synthetic('Test Bolt', 'Instant', '{R}', 'Test Bolt deals 2 damage to any target.');
const KDEFS = [GRAVEMOTHER, SLIVER, WOLF, CLAWS, PAST, BOLT, BEAR];
const gyActivations = (s: GameState, player: PlayerId = 'p1'): string[] =>
  legalActions(s, player).filter((a) => a.kind === 'activate' && !a.isMana && s.objects[a.object!]?.zone === 'graveyard').map((a) => `${nameOf(s, a.object!)}:${a.label}`);

describe('CR 702.141a, 118.9: "Each Sliver creature card in your graveyard has encore {X}, where X is its mana value."', () => {
  const start = (mana = 2): GameState => scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Gravemother', ...lands(mana)], graveyard: ['Test Sliver', 'Test Wolf'] }, defs: KDEFS });
  it('is automated, grants encore to Sliver cards only, for generic mana equal to their mana value', () => {
    expect(KDEFS.every((d) => d.faces[0]!.abilities.every((a) => a.kind !== 'manual'))).toBe(true);
    const s = start(2);
    const acts = gyActivations(s);
    expect(acts.some((a) => a.startsWith('Test Sliver:'))).toBe(true);
    expect(acts.some((a) => a.startsWith('Test Wolf:'))).toBe(false);
    const t = activate(s, inYard(s, 'Test Sliver')!);
    expect(inYard(t, 'Test Sliver')).toBeUndefined(); // exiled as part of the cost
    expect(t.zones.battlefield.filter((id) => nameOf(t, id) === 'Test Sliver' && t.objects[id]!.kind === 'token').length).toBe(0); // the token comes on resolution
    const r = resolveAll(t);
    expect(r.zones.battlefield.some((id) => nameOf(r, id) === 'Test Sliver' && r.objects[id]!.kind === 'token')).toBe(true);
  });
  it('negative: with less mana than its mana value (2) the encore is not offered', () => {
    const s = start(1);
    expect(gyActivations(s).some((a) => a.startsWith('Test Sliver:'))).toBe(false);
  });
});

describe('CR 702.97a, 118.9: "Each creature card in your graveyard has scavenge. The scavenge cost is equal to its mana cost."', () => {
  it('offers scavenge for the card\'s mana cost: with {2}{G} available, a Wolf card puts +1/+1 counters equal to its power on a creature', () => {
    const s = (scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Claws', 'Test Bear', 'Forest', 'Plains', 'Plains'], graveyard: ['Test Wolf'] }, defs: KDEFS }));
    expect(gyActivations(s).some((a) => a.startsWith('Test Wolf:'))).toBe(true);
  });
  it('negative: without the colored mana of its mana cost it is not offered', () => {
    const s = (scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Claws', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Wolf'] }, defs: KDEFS }));
    expect(gyActivations(s).some((a) => a.startsWith('Test Wolf:'))).toBe(false);
  });
});

describe('CR 702.34a, 118.9: "During your turn, each instant and sorcery card in your graveyard has flashback. Its flashback cost is equal to its mana cost."', () => {
  const mk = (lands_: string[]): GameState => scenario(['Forest', 'Mountain'], { p1: { battlefield: ['Test Past', ...lands_], graveyard: ['Test Bolt'] }, defs: KDEFS });
  it('is automated and lets you cast the instant from your graveyard on your turn for its mana cost {R}', () => {
    expect(PAST.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    const s = mk(['Mountain']);
    expect(gyCasts(s)).toEqual(['Test Bolt']);
  });
  it('negative: without {R} it is not offered', () => {
    expect(gyCasts(mk(['Plains']))).toEqual([]);
    expect(gyCasts(scenario(['Mountain'], { p1: { battlefield: ['Mountain'], graveyard: ['Test Bolt'] }, defs: KDEFS }))).toEqual([]); // without the enchantment
  });
});

// ---- graveyard triggers ----------------------------------------------------------------------------------------------------------------------------------------------
const CHICK = synthetic('Test Chick', 'Creature — Phoenix', '{2}{R}', 'Flying\nWhenever you attack with three or more creatures, you may pay {R}{R}. If you do, return this card from your graveyard to the battlefield tapped and attacking with a +1/+1 counter on it.', PT);
const BLADE = synthetic('Test Meek Blade', 'Artifact — Equipment', '{1}', 'Equipped creature gets +1/+2.\nEquip {2}\nWhenever a 1/1 creature you control enters, you may return this card from your graveyard to the battlefield, then attach it to that creature.');
const SPIRIT = synthetic('Test Spirit', 'Creature — Spirit', '{2}{W}', 'Trample\nAt the beginning of each end step, if an enchantment was put into your graveyard from the battlefield this turn, you may return this card from your graveyard to your hand.', PT);
const SHRINE = synthetic('Test Shrine', 'Enchantment', '{1}', '');
const BREAK = synthetic('Test Break', 'Instant', '{0}', 'Destroy target enchantment.');
const TDEFS = [CHICK, BLADE, SPIRIT, SHRINE, BREAK, BEAR, WIZARD, SMITE];

describe('CR 113.6m, 400.7, 508.4: a graveyard trigger returns the card tapped and attacking with a counter', () => {
  it('is automated; attacking with three creatures and paying {R}{R} puts it onto the battlefield tapped and attacking with a +1/+1 counter', () => {
    expect(CHICK.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Mountain', 'Mountain'], graveyard: ['Test Chick'] }, defs: TDEFS });
    const bears = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Bear');
    s = advanceTo(s, 1, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: bears.map((attacker) => ({ attacker, defender: 'p2' })) });
    s = resolveAll(s, [{ kind: 'yesNo', yes: true } as never]);
    const chick = onField(s, 'Test Chick');
    expect(chick).toBeDefined();
    expect(s.objects[chick!]!.tapped).toBe(true);
    expect(s.objects[chick!]!.counters['+1/+1']).toBe(1);
    expect(inYard(s, 'Test Chick')).toBeUndefined();
  });
  it('negative: with fewer than three attackers it stays in the graveyard', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Bear', 'Test Bear', 'Mountain', 'Mountain'], graveyard: ['Test Chick'] }, defs: TDEFS });
    const bears = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Bear');
    s = advanceTo(s, 1, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: bears.map((attacker) => ({ attacker, defender: 'p2' })) });
    s = resolveAll(s);
    expect(onField(s, 'Test Chick')).toBeUndefined();
    expect(inYard(s, 'Test Chick')).toBeDefined();
  });
});

describe('CR 113.6m, 301.5c: "return this card from your graveyard to the battlefield, then attach it to that creature"', () => {
  it('a 1/1 creature entering brings the Equipment back from the graveyard attached to THAT creature (not the other way round)', () => {
    expect(BLADE.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    let s = scenario(['Mountain'], { p1: { hand: ['Test Wizard'], battlefield: ['Plains'], graveyard: ['Test Meek Blade'] }, defs: TDEFS });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wizard', 'hand', 'p1') }));
    s = resolveAll(s, [{ kind: 'yesNo', yes: true } as never]);
    const blade = onField(s, 'Test Meek Blade');
    const wiz = onField(s, 'Test Wizard');
    expect(blade).toBeDefined();
    expect(s.objects[blade!]!.attachedTo).toBe(wiz);
    expect(pt(s, wiz!)).toEqual([2, 3]);
  });
  it('negative: a 2/2 creature entering does not trigger it', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Bear'], battlefield: ['Plains', 'Plains'], graveyard: ['Test Meek Blade'] }, defs: TDEFS });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') })));
    expect(onField(s, 'Test Meek Blade')).toBeUndefined();
  });
});

describe('CR 113.6m, 603.4: "if an enchantment was put into your graveyard from the battlefield this turn, you may return ~ from your graveyard to your hand"', () => {
  const start = (): GameState => scenario(['Mountain'], { p1: { battlefield: ['Test Shrine'], hand: ['Test Break'], graveyard: ['Test Spirit'] }, defs: TDEFS });
  it('returns the card to your hand at the end step when your enchantment went to your graveyard this turn', () => {
    let s = start();
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Break', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: onField(s, 'Test Shrine')! }] }]));
    expect(inYard(s, 'Test Shrine')).toBeDefined();
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s, [{ kind: 'yesNo', yes: true } as never]);
    expect(s.zones.hand.p1!.some((id) => nameOf(s, id) === 'Test Spirit')).toBe(true);
    expect(inYard(s, 'Test Spirit')).toBeUndefined();
  });
  it('negative: with no enchantment put into your graveyard from the battlefield this turn, it stays', () => {
    let s = advanceTo(start(), 1, 'end');
    s = resolveAll(s);
    expect(inYard(s, 'Test Spirit')).toBeDefined();
  });
});
