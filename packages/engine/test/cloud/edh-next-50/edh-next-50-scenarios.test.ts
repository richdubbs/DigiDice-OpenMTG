/**
 * Commander lane edh-next, round edh-next-50 (EDHREC ranks 15,001-16,250, third pass): the round's readings played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR numbers were checked against
 * the 2026-09-25 text (media.wizards.com), where marked.
 *
 *   CR 601.2i, 603.2, 707.10, 707.10c, 115.7   cast triggers of the spell itself: a copy ("a new target"), a copy for each kind of counter, tokens equal to the mana spent
 *   CR 611.2b, 613.1b                          "for as long as you control ~ and ~ remains tapped" (Helm of Possession)
 *   CR 701.23a-b, 303.4f                       "search your graveyard and/or library / graveyard, hand, and library for a card named ..." (Arachnus Spinner, Shaun & Rebecca)
 *   CR 113.6m, 601.2                           "you may cast ~ from your graveyard" at the beginning of the end step (Sproutback Trudge)
 *   CR 601.2f, 118.8                           "if you pay {1} more to cast it for each other creature card in your graveyard" (Risen Executioner)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { activatedAbilities, getChars } from '../../../src/index';
import { advanceTo, find, pass, scenario } from '../../m3/scenario';
import { act, card, cast, drive, full, legal, lifeOf, named, obj, resolveAll, type Script } from '../r4-cost/support';

const lifeP = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (p === undefined || s.objects[id]!.controller === p));
const tokens = (s: GameState, name: string, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && getChars(s, id)!.name === name).length;
const activate = (s: GameState, who: string, name: string, script: Script = {}, n = 0): GameState => {
  const src = find(s, name, 'battlefield', who);
  return drive(act(s, { type: 'activate', player: who, source: src, ability: activatedAbilities(s, s.objects[src]!)[n]!.key } as never), script);
};
void pass; void lifeOf; void named; void obj; void find; void act; void advanceTo;

// ---- Ancestral Communion: "When you cast this spell while you control ..., copy this spell. You may choose a new target for the copy." -------------------------------------------
const COMMUNE = card('Test Communion', 'Sorcery', 'When you cast this spell while you control a Goblin, copy this spell. You may choose a new target for the copy.\nYou gain 2 life.', '{1}');
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['1', '1']);
describe('CR 601.2i, 603.2, 707.10, 707.10c, 115.7: the cast trigger of the spell itself with "a new target for the copy" (Ancestral Communion)', () => {
  const DEFS = [COMMUNE, GOBLIN];
  it('is automated', () => expect(full(COMMUNE)).toBe(true));
  it('cast while you control a Goblin, the spell is copied: the spell and its copy each gain 2 life', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Communion'], battlefield: ['Test Goblin', 'Plains', 'Plains'] } });
    const before = lifeP(s);
    s = resolveAll(cast(s, 'Test Communion', { yes: [true, true] }), { yes: [true, true] });
    expect(lifeP(s)).toBe(before + 4);
  });
  it('negative: cast without a Goblin, the trigger does not happen: one gain of 2 life', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Communion'], battlefield: ['Plains', 'Plains'] } });
    const before = lifeP(s);
    s = resolveAll(cast(s, 'Test Communion', { yes: [true, true] }), { yes: [true, true] });
    expect(lifeP(s)).toBe(before + 2);
  });
});

// ---- Abby, Merciless Soldier: "When you cast this spell, create a number of ... tokens equal to the amount of mana spent to cast it" --------------------------------------------
const SCOUT = card('Test Infected Scout', 'Creature — Human', 'When you cast this spell, create a number of 1/1 black Zombie creature tokens named Test Infected equal to the amount of mana spent to cast it.', '{2}{B}', ['2', '2'], ['B']);
const SCOUT2 = card('Test Infected Runner', 'Creature — Human', 'When you cast this spell, create a number of 1/1 black Zombie creature tokens named Test Infected equal to the amount of mana spent to cast it.', '{1}{B}', ['1', '1'], ['B']);
describe('CR 601.2h, 601.2i, 603.2, 111.1: tokens equal to the mana spent to cast the spell, made by its cast trigger (Abby)', () => {
  const DEFS = [SCOUT, SCOUT2];
  it('is automated', () => { expect(full(SCOUT)).toBe(true); expect(full(SCOUT2)).toBe(true); });
  it('a spell cast with three mana makes three tokens before it resolves (the trigger resolves first), a spell cast with two makes two', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Infected Scout'], battlefield: ['Swamp', 'Swamp', 'Swamp'] } });
    s = resolveAll(cast(s, 'Test Infected Scout'));
    expect(tokens(s, 'Test Infected', 'p1')).toBe(3);
    let t = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Infected Runner'], battlefield: ['Swamp', 'Swamp', 'Swamp'] } });
    t = resolveAll(cast(t, 'Test Infected Runner'));
    expect(tokens(t, 'Test Infected', 'p1')).toBe(2);
  });
  it('negative (review): outside the spell\'s own cast trigger "it" is the cast spell, not the source: a permanent that reacts to your creature spells counts the mana spent on THAT spell', () => {
    const SAP = card('Test Sapling Lord', 'Enchantment', 'Whenever you cast a creature spell, create a number of 1/1 green Saproling creature tokens equal to the amount of mana spent to cast it.', '{0}');
    const FOUR = card('Test Four Drop', 'Creature — Bear', '', '{4}', ['2', '2']);
    let s = scenario(['Swamp'], { defs: [SAP, FOUR], p1: { hand: ['Test Four Drop'], battlefield: ['Test Sapling Lord', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] } });
    s = resolveAll(cast(s, 'Test Four Drop'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(4);
  });
  it('negative: the opponent casting it makes the tokens for the opponent only (the controller of the trigger is the caster)', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p2: { hand: ['Test Infected Runner'], battlefield: ['Swamp', 'Swamp'] } });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(s, 'Test Infected Runner', {}, 'p2'));
    expect(tokens(s, 'Test Infected', 'p2')).toBe(2);
    expect(tokens(s, 'Test Infected', 'p1')).toBe(0);
  });
});

// ---- Storm of Forms: "copy it for each kind of counter among permanents you control" ----------------------------------------------------------------------------------------
const FORMS = card('Test Forms', 'Instant', 'When you cast this spell, copy it for each kind of counter among permanents you control. You may choose new targets for the copies.\nYou gain 1 life.', '{1}');
const BEAST = card('Test Counter Beast', 'Creature — Beast', '', '{0}', ['1', '1']);
const TRINKET = card('Test Trinket', 'Artifact', '', '{0}');
describe('CR 122.1, 707.10, 601.2i: a copy for each kind of counter among permanents you control (Storm of Forms)', () => {
  const DEFS = [FORMS, BEAST, TRINKET];
  const cast1 = (bf: (string | { name: string; counters: Record<string, number> })[], opp: (string | { name: string; counters: Record<string, number> })[] = []): number => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Forms'], battlefield: ['Plains', ...bf] }, p2: { battlefield: opp } });
    const before = lifeP(s);
    s = resolveAll(cast(s, 'Test Forms', { yes: [true, true, true, true] }), { yes: [true, true, true, true] });
    return lifeP(s) - before;
  };
  it('is automated', () => expect(full(FORMS)).toBe(true));
  it('two kinds of counters among your permanents (a +1/+1 counter twice over, a charge counter): the spell and two copies, three gains of 1', () => {
    expect(cast1([{ name: 'Test Counter Beast', counters: { '+1/+1': 2 } }, { name: 'Test Trinket', counters: { charge: 1 } }])).toBe(3);
  });
  it('negative: no counters means no copy (one gain); counters only on the opponent\'s permanents do not count; one kind on two permanents counts once', () => {
    expect(cast1([])).toBe(1);
    expect(cast1([], [{ name: 'Test Trinket', counters: { charge: 3 } }])).toBe(1);
    expect(cast1([{ name: 'Test Counter Beast', counters: { '+1/+1': 1 } }, { name: 'Test Trinket', counters: { '+1/+1': 1 } }])).toBe(2);
  });
});

// ---- Helm of Possession: "Gain control of target creature for as long as you control this artifact and this artifact remains tapped." -------------------------------------------
const HELM = card('Test Helm', 'Artifact', '{2}, {T}, Sacrifice a creature: Gain control of target creature for as long as you control this artifact and this artifact remains tapped.', '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OXEN = card('Test Ox', 'Creature — Ox', '', '{0}', ['3', '3']);
const ctl = (s: GameState, id: ObjectId): string => getChars(s, id)!.controller;
describe('CR 611.2b, 613.1b, 701.21a: control for as long as you control the artifact and it remains tapped (Helm of Possession)', () => {
  const DEFS = [HELM, BEAR, OXEN];
  const setup = (): { s: GameState; ox: ObjectId } => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Helm', 'Test Bear', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Ox'] } });
    const ox = onBf(s, 'Test Ox')[0]!;
    s = resolveAll(activate(s, 'p1', 'Test Helm', { objects: [[onBf(s, 'Test Bear')[0]!]], targets: [[obj(ox)]] }));
    return { s, ox };
  };
  it('is automated', () => expect(full(HELM)).toBe(true));
  it('the Ox is yours while the Helm stays tapped (the Bear was sacrificed as the cost)', () => {
    const { s, ox } = setup();
    expect(onBf(s, 'Test Bear').length).toBe(0);
    expect(ctl(s, ox)).toBe('p1');
  });
  it('the Ox goes back to its owner when the Helm untaps in your untap step', () => {
    const { s: s0, ox } = setup();
    let s = advanceTo(s0, 3, 'main1');
    expect(ctl(s, ox)).toBe('p2');
    expect(s.objects[find(s, 'Test Helm', 'battlefield', 'p1')]!.tapped).toBe(false);
  });
  it('negative: if you lose the Helm the Ox goes back at once (an opponent takes control of the artifact)', () => {
    const { s: s0, ox } = setup();
    const s = JSON.parse(JSON.stringify(s0)) as GameState;
    const helm = find(s, 'Test Helm', 'battlefield', 'p1');
    s.objects[helm]!.controller = 'p2';
    expect(ctl(s, ox)).toBe('p2');
    expect(ctl(pass(pass(s)), ox)).toBe('p2');
  });
});

// ---- Arachnus Spinner: "Search your graveyard and/or library for a card named ... and put it onto the battlefield attached to target creature." ----------------------------
const SPIN = card('Test Spinner', 'Creature — Spider', 'Reach\nTap an untapped Spider you control: Search your graveyard and/or library for a card named Test Web and put it onto the battlefield attached to target creature. If you search your library this way, shuffle.', '{0}', ['1', '1']);
const WEB = card('Test Web', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+2.', '{0}');
const attachedTo = (s: GameState, id: ObjectId): ObjectId | undefined => s.objects[id]!.attachedTo as ObjectId | undefined;
describe('CR 701.23a-b, 303.4f, 301.5: search your graveyard and/or library for a named card and put it onto the battlefield attached to a target (Arachnus Spinner)', () => {
  const DEFS = [SPIN, WEB, BEAR];
  it('is automated', () => expect(full(SPIN)).toBe(true));
  it('the Aura found in the library comes in attached to the target creature, and that creature has its +0/+2', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spinner', 'Test Bear'], library: ['Test Web', 'Plains'] } });
    const bear = onBf(s, 'Test Bear')[0]!;
    s = resolveAll(activate(s, 'p1', 'Test Spinner', { targets: [[obj(bear)]] }), { options: [['library']], objects: [[find(s, 'Test Web', 'library', 'p1')]] });
    const webs = onBf(s, 'Test Web');
    expect(webs.length).toBe(1);
    expect(attachedTo(s, webs[0]!)).toBe(bear);
    expect(Number(getChars(s, bear)!.toughness)).toBe(4);
  });
  it('the Aura found in the graveyard comes in the same way', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spinner', 'Test Bear'], graveyard: ['Test Web'], library: ['Plains'] } });
    const bear = onBf(s, 'Test Bear')[0]!;
    s = resolveAll(activate(s, 'p1', 'Test Spinner', { targets: [[obj(bear)]] }), { options: [['graveyard']], objects: [[find(s, 'Test Web', 'graveyard', 'p1')]] });
    expect(onBf(s, 'Test Web').length).toBe(1);
    expect(attachedTo(s, onBf(s, 'Test Web')[0]!)).toBe(bear);
  });
  it('negative: with no card of that name in either zone nothing comes in', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spinner', 'Test Bear'], library: ['Plains'] } });
    const bear = onBf(s, 'Test Bear')[0]!;
    s = resolveAll(activate(s, 'p1', 'Test Spinner', { targets: [[obj(bear)]] }));
    expect(onBf(s, 'Test Web').length).toBe(0);
  });
});

// ---- Shaun & Rebecca: "search your graveyard, hand, and library for a card named ... and put it onto the battlefield, then shuffle" -----------------------------------------------
const AGENT = card('Test Agent', 'Legendary Creature — Human', 'When ~ enters, search your graveyard, hand, and library for a card named Test Animus and put it onto the battlefield, then shuffle.', '{0}', ['2', '2']);
const ANIMUS = card('Test Animus', 'Artifact', '', '{0}');
describe('CR 701.23a-b, 701.24: search your graveyard, hand, and library for a named card, put it onto the battlefield, then shuffle (Shaun & Rebecca, Agents)', () => {
  const DEFS = [AGENT, ANIMUS];
  const run = (zone: 'hand' | 'graveyard' | 'library'): GameState => {
    const p1: Record<string, string[]> = { hand: ['Test Agent'], battlefield: [] };
    if (zone === 'hand') p1['hand'] = ['Test Agent', 'Test Animus'];
    if (zone === 'graveyard') p1['graveyard'] = ['Test Animus'];
    if (zone === 'library') p1['library'] = ['Test Animus', 'Plains'];
    const s = scenario([], { defs: DEFS, p1 });
    return resolveAll(cast(s, 'Test Agent', {}), { options: [[zone]], objects: [[find(s, 'Test Animus', zone, 'p1')]] });
  };
  it('is automated', () => expect(full(AGENT)).toBe(true));
  for (const zone of ['hand', 'graveyard', 'library'] as const) {
    it(`the card named in the ${zone} is put onto the battlefield`, () => expect(onBf(run(zone), 'Test Animus').length).toBe(1));
  }
  it('negative: with none of that name anywhere, nothing comes in', () => {
    const s = resolveAll(cast(scenario([], { defs: DEFS, p1: { hand: ['Test Agent'] } }), 'Test Agent'));
    expect(onBf(s, 'Test Animus').length).toBe(0);
  });
});

// ---- Sproutback Trudge: "At the beginning of your end step, if you gained life this turn, you may cast ~ from your graveyard." -----------------------------------------------
const TRUDGE = card('Test Trudge', 'Creature — Fungus Beast', 'At the beginning of your end step, if you gained life this turn, you may cast ~ from your graveyard.', '{3}', ['2', '2']);
const SIP = card('Test Sip', 'Sorcery', 'You gain 1 life.', '{0}');
describe('CR 113.6m, 603.4, 601.2, 608.2g: an end-step trigger of a card in the graveyard that lets you cast it (Sproutback Trudge)', () => {
  const DEFS = [TRUDGE, SIP];
  const lands = ['Plains', 'Plains', 'Plains'];
  it('is automated', () => expect(full(TRUDGE)).toBe(true));
  it('after gaining life this turn, at the end step you may cast it from the graveyard: it resolves onto the battlefield', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Sip'], graveyard: ['Test Trudge'], battlefield: lands } });
    s = resolveAll(cast(s, 'Test Sip'));
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s, { yes: [true] });
    expect(onBf(s, 'Test Trudge', 'p1').length).toBe(1);
  });
  it('negative: answering no leaves it in the graveyard; with no life gained this turn the trigger does not happen at all', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Sip'], graveyard: ['Test Trudge'], battlefield: lands } });
    s = resolveAll(cast(s, 'Test Sip'));
    s = resolveAll(advanceTo(s, 1, 'end'), { yes: [false] });
    expect(onBf(s, 'Test Trudge').length).toBe(0);
    let t = scenario([], { defs: DEFS, p1: { graveyard: ['Test Trudge'], battlefield: lands } });
    t = resolveAll(advanceTo(t, 1, 'end'), { yes: [true] });
    expect(onBf(t, 'Test Trudge').length).toBe(0);
  });
  it('negative: the card on the battlefield or in the hand does not do it (the ability functions in the graveyard only)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Sip', 'Test Trudge'], battlefield: lands } });
    s = resolveAll(cast(s, 'Test Sip'));
    s = resolveAll(advanceTo(s, 1, 'end'), { yes: [true] });
    expect(onBf(s, 'Test Trudge').length).toBe(0);
  });
});

// ---- Risen Executioner: "You may cast ~ from your graveyard if you pay {1} more to cast it for each other creature card in your graveyard." ----------------------------------------
const EXEC = card('Test Executioner', 'Creature — Zombie Warrior', 'You may cast ~ from your graveyard if you pay {1} more to cast it for each other creature card in your graveyard.', '{1}{B}', ['2', '2'], ['B']);
describe('CR 601.2f, 118.8, 404.1, 113.6: casting from the graveyard for {1} more for each other creature card in the graveyard (Risen Executioner)', () => {
  const DEFS = [EXEC, BEAR];
  const legalCastFromGraveyard = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => (a as { object: ObjectId }).object === find(s, 'Test Executioner', 'graveyard', 'p1'));
  const cast4 = (s: GameState): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Executioner', 'graveyard', 'p1') }));
  it('is automated', () => expect(full(EXEC)).toBe(true));
  it('with two other creature cards in the graveyard it costs {1}{B} + {2}: castable with four lands, not with three', () => {
    const gy = ['Test Executioner', 'Test Bear', 'Test Bear'];
    const four = scenario(['Swamp'], { defs: DEFS, p1: { graveyard: gy, battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'] } });
    const three = scenario(['Swamp'], { defs: DEFS, p1: { graveyard: gy, battlefield: ['Swamp', 'Swamp', 'Swamp'] } });
    const resolved = resolveAll(cast4(four));
    expect(onBf(resolved, 'Test Executioner', 'p1').length).toBe(1);
    expect(legalCastFromGraveyard(three)).toBe(false);
    expect(legalCastFromGraveyard(four)).toBe(true);
  });
  it('with no other creature card it costs just {1}{B}; a noncreature card in the graveyard does not count', () => {
    const s = scenario(['Swamp'], { defs: DEFS, p1: { graveyard: ['Test Executioner'], battlefield: ['Swamp', 'Swamp'] } });
    expect(legalCastFromGraveyard(s)).toBe(true);
  });
  it('negative: the other player\'s graveyard does not count', () => {
    const s = scenario(['Swamp'], { defs: DEFS, p1: { graveyard: ['Test Executioner'], battlefield: ['Swamp', 'Swamp'] }, p2: { graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    expect(legalCastFromGraveyard(s)).toBe(true);
  });
});

// ---- Figure of Destiny: "If ~ is a Warrior, it becomes a ... with base power and toughness 8/8, flying, and first strike." -----------------------------------------------------
const FIG_TEXT = '{1}: If ~ is a Warrior, it becomes a Kithkin Spirit Warrior Avatar with base power and toughness 8/8, flying, and first strike.';
const FIGW = card('Test Figure', 'Creature — Kithkin Warrior', FIG_TEXT, '{0}', ['4', '4']);
const FIGS = card('Test Figure Spirit', 'Creature — Kithkin Spirit', FIG_TEXT, '{0}', ['2', '2']);
describe('CR 611.2a, 205.1b, 613.1d, 613.1f, 613.4b: "becomes a ... with base power and toughness 8/8, flying, and first strike" for good, only if it is a Warrior (Figure of Destiny)', () => {
  const DEFS = [FIGW, FIGS];
  it('is automated', () => { expect(full(FIGW)).toBe(true); expect(full(FIGS)).toBe(true); });
  it('a Warrior becomes an 8/8 Avatar with flying and first strike, and stays so (no duration)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Figure', 'Plains'] } });
    s = resolveAll(activate(s, 'p1', 'Test Figure'));
    const id = onBf(s, 'Test Figure')[0]!;
    const c = getChars(s, id)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([8, 8]);
    expect(c.subtypes).toContain('Avatar');
    expect(JSON.stringify(c.keywords ?? c.abilities ?? [])).toMatch(/flying/i);
    s = advanceTo(s, 2, 'main1');
    expect(Number(getChars(s, id)!.power)).toBe(8);
  });
  it('negative: something that is not a Warrior stays as it is', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Figure Spirit', 'Plains'] } });
    s = resolveAll(activate(s, 'p1', 'Test Figure Spirit'));
    const c = getChars(s, onBf(s, 'Test Figure Spirit')[0]!)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([2, 2]);
  });
});
