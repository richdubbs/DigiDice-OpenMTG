/**
 * FAST5 T42 (part 2): distinct names, zone lists, searches and choices, played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10).
 *
 *   CR 201.2, 115.1     "target creature cards with different names", "cards with different names" in a search, "all other cards with the same name"
 *   CR 109.2a, 115.1    one zone said once for several target card phrases; "creature cards with no abilities"
 *   CR 701.23, 608.2d   "reveal it, put it into your hand or graveyard", "put one into your hand and the other into your graveyard"
 *   CR 107.3, 603.10a   "equal to 1 plus the sacrificed artifact's mana value"; "draw a card, then you may put ... mana value less than or equal to the number of lands"
 */
import { describe, expect, it } from 'vitest';
import { act, answer, find, findAll, legal, reject, scenario } from '../../m3/scenario';
import { MOUSE, OGRE, WOLF, card, cast, ids, inZone, noManual, offered, onBattlefield, options, pick, resolve, settle } from './support';

describe('CR 115.1, 201.2: "Return up to three target creature cards with different names from your graveyard to the battlefield."', () => {
  const BEHOLD = card('Test Behold', 'Sorcery', 'Return up to three target creature cards with different names from your graveyard to the battlefield.', { cost: '{0}', colors: ['B'] });
  const ALL = [BEHOLD, MOUSE, WOLF, OGRE];
  it('is automated', () => expect(noManual(BEHOLD)).toEqual([]));
  it('two cards with the same name cannot both be chosen: the answer is rejected and asked again', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Behold'], graveyard: ['Test Mouse', 'Test Mouse', 'Test Wolf'] } });
    const s = cast(s0, 'Test Behold');
    const [m1, m2] = ids(s, 'Test Mouse', 'graveyard');
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: pick(m1!, m2!) });
    expect(err.rules).toContain('CR 201.2');
  });
  it('three cards with three names are chosen and all return; of two same-named cards one is enough', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Behold'], graveyard: ['Test Mouse', 'Test Mouse', 'Test Wolf', 'Test Ogre'] } });
    let s = cast(s0, 'Test Behold');
    s = settle(answer(s, pick(ids(s, 'Test Mouse', 'graveyard')[0]!, find(s, 'Test Wolf', 'graveyard', 'p1'), find(s, 'Test Ogre', 'graveyard', 'p1'))));
    s = resolve(s);
    expect(onBattlefield(s).sort()).toEqual(['Test Mouse', 'Test Ogre', 'Test Wolf']);
    expect(inZone(s, 'graveyard').sort()).toEqual(['Test Behold', 'Test Mouse']);
  });
});

describe('CR 115.1, 109.2a: "Return up to one target creature card, up to one target Mount card, up to one target Vehicle card, and up to one target creature card with no abilities from your graveyard to your hand."', () => {
  const RISE = card('Test Rise', 'Sorcery', 'Return up to one target creature card, up to one target Mount card, up to one target Vehicle card, and up to one target creature card with no abilities from your graveyard to your hand.', { cost: '{0}', colors: ['G'] });
  const BAT = card('Test Bat', 'Creature — Bat', 'Flying', { pt: ['1', '1'], cost: '{1}' });
  const STEED = card('Test Steed', 'Creature — Mount', '', { pt: ['2', '2'], cost: '{1}' });
  const CART = card('Test Cart', 'Artifact — Vehicle', 'Crew 1', { pt: ['3', '3'], cost: '{2}' });
  const ALL = [RISE, BAT, STEED, CART, MOUSE, WOLF];
  it('is automated', () => expect(noManual(RISE)).toEqual([]));
  it('each target is a card of your graveyard (the zone is said once for all four); the last takes only a creature card with no abilities', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Rise'], graveyard: ['Test Bat', 'Test Steed', 'Test Cart', 'Test Mouse'] }, p2: { graveyard: ['Test Wolf'] } });
    let s = cast(s0, 'Test Rise');
    expect(offered(s)).toEqual(['Test Bat', 'Test Mouse', 'Test Steed']); // any creature card of YOUR graveyard (not the opponent's Wolf, not the Vehicle)
    s = answer(s, pick(find(s, 'Test Bat', 'graveyard', 'p1')));
    expect(offered(s)).toEqual(['Test Steed']); // a Mount card
    s = answer(s, pick(find(s, 'Test Steed', 'graveyard', 'p1')));
    expect(offered(s)).toEqual(['Test Cart']); // a Vehicle card
    s = answer(s, pick(find(s, 'Test Cart', 'graveyard', 'p1')));
    expect(offered(s)).toEqual(['Test Mouse', 'Test Steed']); // no abilities: the Bat has flying (a keyword is an ability); the Mouse and the Steed have none
    s = settle(answer(s, pick(find(s, 'Test Mouse', 'graveyard', 'p1'))));
    s = resolve(s);
    expect(inZone(s, 'hand').filter((n) => n.startsWith('Test')).sort()).toEqual(['Test Bat', 'Test Cart', 'Test Mouse', 'Test Steed']);
  });
});

describe('CR 701.23, 201.2: "Search your library for up to two basic land cards and/or Town cards with different names, put them onto the battlefield tapped, then shuffle."', () => {
  const REACH = card('Test Reach', 'Sorcery', 'Search your library for up to two basic land cards and/or Town cards with different names, put them onto the battlefield tapped, then shuffle.', { cost: '{0}', colors: ['G'] });
  const TOWN = card('Test Town', 'Land — Town', '');
  const ALL = [REACH, TOWN];
  it('is automated', () => expect(noManual(REACH)).toEqual([]));
  it('after a Plains is taken only cards of other names are offered; up to two come in tapped, with different names', () => {
    const s0 = scenario(['Island', 'Plains', 'Forest'], { defs: ALL, p1: { hand: ['Test Reach'], library: ['Plains', 'Plains', 'Island', 'Test Town', 'Forest'] } });
    let s = resolve(cast(s0, 'Test Reach'));
    expect([...new Set(options(s))]).toEqual(['Forest', 'Island', 'Plains', 'Test Town']); // (the scenario's library also holds filler Plains)
    s = answer(s, { kind: 'chooseObjects', ids: [ids(s, 'Plains', 'library')[0]!] });
    expect(options(s)).toEqual(['Forest', 'Island', 'Test Town']); // no second Plains
    const island = (s.pending as unknown as { options: string[] }).options.find((id) => s.objects[id]!.defId === 'Island')!;
    s = settle(answer(s, { kind: 'chooseObjects', ids: [island] }));
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1');
    expect(mine.map((id) => s.objects[id]!.defId).sort()).toEqual(['Island', 'Plains']);
    expect(mine.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('taking fewer than two is allowed ("up to two"), and a library of one name offers no second card', () => {
    const s0 = scenario(['Plains'], { defs: ALL, p1: { hand: ['Test Reach'], library: ['Plains', 'Plains'] } });
    let s = resolve(cast(s0, 'Test Reach'));
    s = settle(answer(s, { kind: 'chooseObjects', ids: [ids(s, 'Plains', 'library')[0]!] }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.owner === 'p1')).toHaveLength(1);
  });
  it('the searcher may stop after the first card', () => {
    const s0 = scenario(['Plains', 'Island'], { defs: ALL, p1: { hand: ['Test Reach'], library: ['Plains', 'Island'] } });
    let s = resolve(cast(s0, 'Test Reach'));
    s = answer(s, { kind: 'chooseObjects', ids: [ids(s, 'Plains', 'library')[0]!] });
    s = settle(answer(s, { kind: 'chooseObjects', ids: [] }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1')).toHaveLength(1);
  });
});

describe('CR 701.23, 608.2d: "Search your library for a creature card, reveal it, put it into your hand or graveyard, then shuffle."', () => {
  const GUIDE = card('Test Guide', 'Instant', 'Search your library for a creature card, reveal it, put it into your hand or graveyard, then shuffle.', { cost: '{0}', colors: ['B'] });
  const ALL = [GUIDE, WOLF, MOUSE];
  it('is automated', () => expect(noManual(GUIDE)).toEqual([]));
  it('the player finds the card and chooses the graveyard', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Guide'], library: ['Test Wolf', 'Plains'] } });
    let s = resolve(cast(s0, 'Test Guide'));
    expect(options(s)).toEqual(['Test Wolf']);
    s = answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: string[] }).options });
    const opt = s.pending as unknown as { kind: string; options: { id: string }[] };
    expect(opt.kind).toBe('chooseOption');
    expect(opt.options.map((o) => (o as unknown as { label: string }).label.toLowerCase())).toEqual(['hand', 'graveyard']);
    s = settle(answer(s, { kind: 'chooseOption', ids: [opt.options[1]!.id] }));
    expect(inZone(s, 'graveyard')).toContain('Test Wolf');
    expect(inZone(s, 'hand')).not.toContain('Test Wolf');
  });
  it('or the hand', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Guide'], library: ['Test Wolf', 'Plains'] } });
    let s = resolve(cast(s0, 'Test Guide'));
    s = answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: string[] }).options });
    s = settle(answer(s, { kind: 'chooseOption', ids: [(s.pending as unknown as { options: { id: string }[] }).options[0]!.id] }));
    expect(inZone(s, 'hand')).toContain('Test Wolf');
  });
  it('a library without a creature card: nothing is found and nothing is asked', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Guide'] } });
    const s = resolve(cast(s0, 'Test Guide'));
    expect(s.pending?.kind).toBe('priority');
    expect(inZone(s, 'graveyard')).toEqual(['Test Guide']);
  });
});

describe('CR 107.3, 603.10a: "Search your library for an artifact card with mana value equal to 1 plus the sacrificed artifact\'s mana value, put that card onto the battlefield, then shuffle."', () => {
  const FORGE = card('Test Forge', 'Artifact', '{T}, Sacrifice another artifact: Search your library for an artifact card with mana value equal to 1 plus the sacrificed artifact\'s mana value, put that card onto the battlefield, then shuffle.', { cost: '{0}' });
  const A1 = card('Test Cog', 'Artifact', '', { cost: '{1}' });
  const A2 = card('Test Ring', 'Artifact', '', { cost: '{2}' });
  const A3 = card('Test Orb', 'Artifact', '', { cost: '{3}' });
  const A4 = card('Test Crown', 'Artifact', '', { cost: '{4}' });
  const ALL = [FORGE, A1, A2, A3, A4];
  it('is automated', () => expect(noManual(FORGE)).toEqual([]));
  it('sacrificing the Ring (mana value 2) finds an artifact card of mana value exactly 3', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Forge', 'Test Ring'], library: ['Test Cog', 'Test Ring', 'Test Orb', 'Test Crown'] } });
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === find(s0, 'Test Forge', 'battlefield', 'p1') && !a.isMana);
    expect(la).toBeDefined();
    let s = settle(act(s0, la!.action), (t) => (t.pending!.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: [find(t, 'Test Ring', 'battlefield', 'p1')] } : undefined));
    s = resolve(s);
    expect(options(s)).toEqual(['Test Orb']);
    s = settle(answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: string[] }).options }));
    expect(onBattlefield(s)).toContain('Test Orb');
    expect(onBattlefield(s)).not.toContain('Test Ring');
  });
});

describe('CR 608.2d, 110.5b: "Draw a card, then you may put a permanent card with mana value less than or equal to the number of lands you control from your hand onto the battlefield tapped."', () => {
  const VESTIGE = card('Test Vestige', 'Creature — Eldrazi', 'When this creature leaves the battlefield, draw a card, then you may put a permanent card with mana value less than or equal to the number of lands you control from your hand onto the battlefield tapped.', { pt: ['2', '2'], cost: '{0}' });
  const DUST = card('Test Dust', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  const ALL = [VESTIGE, DUST, MOUSE, WOLF, OGRE];
  it('is automated', () => expect(noManual(VESTIGE)).toEqual([]));
  it('with two lands: the Wolf (2) may be put in, the Ogre (3) may not; it enters tapped', () => {
    const s0 = scenario(['Plains'], { defs: ALL, p1: { hand: ['Test Dust', 'Test Wolf', 'Test Ogre'], battlefield: ['Test Vestige', 'Plains', 'Plains'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dust', 'hand', 'p1') }), (t) => (t.pending!.kind === 'chooseTargets' ? pick(find(t, 'Test Vestige', 'battlefield', 'p1')) : undefined));
    s = resolve(resolve(s)); // the destroy resolves and the Vestige dies; its trigger then resolves and the hand is searched
    expect(options(s).filter((n) => n.startsWith('Test'))).toEqual(['Test Wolf']);
    s = settle(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Wolf', 'hand', 'p1')] }));
    const wolf = find(s, 'Test Wolf', 'battlefield', 'p1');
    expect(s.objects[wolf]!.tapped).toBe(true);
    expect(inZone(s, 'hand')).toContain('Test Ogre');
  });
});

void findAll;
