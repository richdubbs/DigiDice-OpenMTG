/**
 * C10 (cloud batch 3): casting from the graveyard as a static permission and its riders (parser/templates/zz-cloud/c10.json, statics/play-permits.ts
 * #isGraveyardPermit / #graveyardPermitUses, actions/cast.ts, effects/rule-replacements/permit-enters.ts), played through the engine with synthetic cards
 * compiled by the game's default compiler from invented wordings (design 6.10) and fixture cards. Each test is named after the rule it checks.
 *
 *   CR 601.3, 601.3e   a card in your graveyard that the permission covers is offered and cast from there (as the spell it would be); one it does not
 *                      cover, or one in an opponent's graveyard (CR 404.1), is not; without the permission's source nothing is (CR 113.6, 611.3a)
 *   CR 601.2f, 118.8   "by paying 3 life in addition to paying their other costs": the life is paid with the mana cost; not offered without the life (CR 119.4)
 *   CR 614.1c, 122.1h  "If you cast a spell this way, that artifact enters with a finality counter on it": the permanent enters with it, also after the
 *                      source has left; the same card cast from the hand does not
 *   CR 601.3, 400.7    "Once during each of your turns": one spell per turn per source object, again on your next turn, never on an opponent's turn
 *   CR 305.1, 305.2    "During your turn, you may play cards from your graveyard": a land played from there is the land play of the turn
 *   CR 113.6           "You may cast ~ from your graveyard. If you do, it enters with a finality counter on it": the card's own permission
 *   CR 601.3           several permissions that allow it in different ways: the player chooses (the cast methods `permission:<n>`)
 *   CR 611.2a, 514.2   a resolved "until end of turn, you may cast creature spells from your graveyard" lasts the turn
 */
import { describe, expect, it } from 'vitest';
import { applyAction, ENGINE_CAPABILITIES, legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { PLAY_PERMIT_CAPABILITIES, isGraveyardPermit } from '../../../src/statics/play-permits';
import type { PermissionDef } from '../../../src/types/ability';
import { act, advanceTo, find, scenario } from '../../m5/helpers';
import { activate, drive, resolveAll, resolveTop } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';

const PT = { power: '2', toughness: '2' };
const PRINCE = synthetic('Test Relic Prince', 'Legendary Creature — Human Noble', '{2}{W}', 'You may cast artifact spells from your graveyard by paying 3 life in addition to paying their other costs. If you cast a spell this way, that artifact enters with a finality counter on it.\nSacrifice this creature: You gain 1 life.', PT);
const COLLECTOR = synthetic('Test Junk Collector', 'Creature — Human', '{2}', 'You may cast artifact spells from your graveyard.', PT);
const GOLEM = synthetic('Test Clockwork Golem', 'Artifact Creature — Golem', '{2}', 'Vigilance', PT);
const CHIEF = synthetic('Test Ghost Chief', 'Creature — Spirit', '{3}', 'Once during each of your turns, you may cast a creature spell from your graveyard.', PT);
const LANTERN = synthetic('Test Echo Lantern', 'Artifact', '{2}', 'Once during each of your turns, you may cast an instant spell from your graveyard.');
const SPARK = synthetic('Test Spark of Life', 'Instant', '{W}', 'You gain 2 life.');
const SORCERER = synthetic('Test Sorcerer of Echoes', 'Creature — Avatar', '{4}', 'During your turn, you may play cards from your graveyard.', PT);
const VETERAN = synthetic('Test Undying Veteran', 'Creature — Human Soldier', '{1}{W}', 'You may cast this card from your graveyard. If you do, it enters with a finality counter on it.', PT);
const CALLER = synthetic('Test Bone Caller', 'Creature — Rat Warlock', '{1}{B}', '{T}: Until end of turn, you may cast creature spells from your graveyard.', PT);
const SHATTER = synthetic('Test Shatter', 'Instant', '{W}', 'Destroy target artifact.');
const WILL = synthetic("Test Grave Mandate", 'Sorcery', '{B}', 'Until end of turn, you may play lands and cast spells from your graveyard. If a card would be put into your graveyard from anywhere this turn, exile that card instead.');
const FORAGER = synthetic('Test Marrow Forager', 'Creature — Squirrel Warlock', '{1}{B}', '{T}: Until end of turn, you may cast creature spells from your graveyard by foraging in addition to paying their other costs. If you cast a spell this way, that creature enters with a finality counter on it.', PT);
const DEFS = [PRINCE, COLLECTOR, GOLEM, CHIEF, LANTERN, SPARK, SORCERER, VETERAN, CALLER, SHATTER, WILL, FORAGER];

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const plains = (n: number): string[] => Array(n).fill('Plains') as string[];
const lifeOf = (s: GameState, p: PlayerId = 'p1'): number => s.players.find((x) => x.id === p)!.life;
const onField = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name);
/** p1's cast actions for cards in a graveyard, by label. */
const gyCasts = (s: GameState, player: PlayerId = 'p1'): string[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard').map((a) => a.label).sort();
const board = (p1: { battlefield?: string[]; hand?: string[]; graveyard?: string[] }, extra: { life?: number; p2?: { graveyard?: string[]; battlefield?: string[] } } = {}): GameState =>
  scenario(['Grizzly Bears', 'Forest', 'Swamp'], { p1, ...(extra.p2 ? { p2: extra.p2 } : {}), defs: DEFS, ...(extra.life !== undefined ? { life: extra.life } : {}) });
const castFromGy = (s: GameState, name: string, method?: string): GameState =>
  drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'graveyard', 'p1'), ...(method !== undefined ? { method } : {}) }));

describe('C10: the capabilities and the permission forms (fail closed)', () => {
  it('permit:cast.zone, feature:permit.cast.addCost and feature:permit.cast.entersWith are registered; the other forms are not', () => {
    for (const c of ['permit:cast.zone', 'permit:play.zone', 'feature:permit.cast.addCost', 'feature:permit.cast.entersWith', 'feature:permit.cast.oncePerTurn']) {
      expect(PLAY_PERMIT_CAPABILITIES.includes(c) || c === 'feature:permit.cast.oncePerTurn', c).toBe(true);
      expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    }
    for (const c of ['feature:permit.cast.from', 'feature:permit.play.addCost', 'feature:permit.play.oncePerTurn', 'feature:permit.cast.addCost.other', 'feature:permit.cast.zone.lasting']) {
      expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
    }
    for (const d of DEFS) expect(d.faces[0]!.abilities.filter((a) => a.kind === 'manual'), d.name).toEqual([]);
  });
  it('isGraveyardPermit honors exactly the forms the engine reads', () => {
    const p: PermissionDef = { s: 'permit', who: { ref: 'you' }, action: 'cast', of: { types: ['Artifact'] }, from: 'graveyard' };
    expect(isGraveyardPermit(p)).toBe(true);
    expect(isGraveyardPermit({ ...p, addCost: { other: [{ kind: 'payLife', amount: 3 }] }, entersWith: [{ kind: 'finality', count: 1 }], oncePerTurn: true })).toBe(true);
    expect(isGraveyardPermit({ ...p, from: 'exile' })).toBe(false);
    expect(isGraveyardPermit({ ...p, who: { ref: 'each' } as unknown as PermissionDef['who'] })).toBe(false);
    expect(isGraveyardPermit({ ...p, anyManaType: true })).toBe(false);
    expect(isGraveyardPermit({ ...p, fromTop: true })).toBe(false);
    expect(isGraveyardPermit({ ...p, entersWith: [{ kind: 'finality', count: { q: 'X' } as unknown as number }] })).toBe(false); // a computed number
    expect(isGraveyardPermit({ ...p, of: { is: { ref: 'self' } } })).toBe(false); // named objects: FAST4 T31's form
    expect(isGraveyardPermit({ ...p, action: 'play', of: undefined })).toBe(true); // "play cards"
    expect(isGraveyardPermit({ ...p, action: 'play', of: { types: ['Creature'] } })).toBe(false);
    expect(isGraveyardPermit({ ...p, action: 'play', of: undefined, addCost: { other: [{ kind: 'payLife', amount: 1 }] } })).toBe(false);
  });
});

describe('CR 601.3, 601.3e, 404.1: what the permission covers', () => {
  it('an artifact card in your graveyard is offered; a creature card that is not an artifact and an artifact in the opponent\'s graveyard are not', () => {
    const s = board({ battlefield: ['Test Relic Prince', ...plains(3)], graveyard: ['Test Clockwork Golem', 'Grizzly Bears'] }, { p2: { graveyard: ['Test Clockwork Golem'] } });
    expect(gyCasts(s)).toEqual(['Cast Test Clockwork Golem']);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'graveyard', 'p1') }).error?.rules).toContain('CR 601.3');
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Clockwork Golem', 'graveyard', 'p2') }).error).toBeDefined();
  });
  it('without the permission\'s source nothing is offered and the cast is refused (CR 113.6, 611.3a)', () => {
    let s = board({ battlefield: ['Test Relic Prince', ...plains(3)], graveyard: ['Test Clockwork Golem'] });
    s = resolveAll(activate(s, find(s, 'Test Relic Prince', 'battlefield'), [], /Sacrifice/));
    expect(onField(s, 'Test Relic Prince')).toBeUndefined();
    expect(gyCasts(s)).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Clockwork Golem', 'graveyard', 'p1') }).error?.rules).toContain('CR 601.3');
  });
  it('the timing of the spell is unchanged: not while a spell is on the stack (CR 307.1)', () => {
    let s = board({ battlefield: ['Test Relic Prince', ...plains(4)], hand: ['Test Spark of Life'], graveyard: ['Test Clockwork Golem'] });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark of Life', 'hand', 'p1') }));
    expect(s.zones.stack.length).toBe(1);
    expect(gyCasts(s)).toEqual([]);
  });
});

describe('CR 601.2f, 118.8, 119.4: "by paying 3 life in addition to paying their other costs"', () => {
  it('the spell is cast from the graveyard for its mana cost and 3 life (CR 601.2a, 601.2h)', () => {
    let s = board({ battlefield: ['Test Relic Prince', ...plains(3)], graveyard: ['Test Clockwork Golem'] });
    s = castFromGy(s, 'Test Clockwork Golem');
    expect(s.zones.stack.map((id) => nameOf(s, id))).toEqual(['Test Clockwork Golem']);
    const spell = s.objects[s.zones.stack[0]!]!;
    expect(spell.stack!.castFrom).toBe('graveyard');
    expect(lifeOf(s)).toBe(17);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && s.objects[id]!.tapped).length).toBe(2);
    expect(s.zones.graveyard.p1).toEqual([]);
  });
  it('with less than 3 life the card is not offered and its cast is refused (CR 119.4)', () => {
    const s = board({ battlefield: ['Test Relic Prince', ...plains(3)], graveyard: ['Test Clockwork Golem'] }, { life: 2 });
    expect(gyCasts(s)).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Clockwork Golem', 'graveyard', 'p1') }).error).toBeDefined();
  });
  it('the life is part of the cost, not of the permission to begin: without the mana the card is not offered either (CR 601.2h)', () => {
    const s = board({ battlefield: ['Test Relic Prince', ...plains(1)], graveyard: ['Test Clockwork Golem'] });
    expect(gyCasts(s)).toEqual([]);
  });
});

describe('CR 614.1c, 122.1h: "If you cast a spell this way, that artifact enters with a finality counter on it"', () => {
  it('the permanent enters with a finality counter, and is exiled instead of going to the graveyard when destroyed', () => {
    let s = board({ battlefield: ['Test Relic Prince', ...plains(4)], hand: ['Test Shatter'], graveyard: ['Test Clockwork Golem'] });
    s = resolveTop(castFromGy(s, 'Test Clockwork Golem'));
    const golem = onField(s, 'Test Clockwork Golem')!;
    expect(golem).toBeDefined();
    expect(s.objects[golem]!.counters['finality']).toBe(1);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shatter', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: golem }] }]);
    s = resolveAll(s);
    expect(onField(s, 'Test Clockwork Golem')).toBeUndefined();
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Clockwork Golem');
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).not.toContain('Test Clockwork Golem');
  });
  it('the rider is the spell\'s: the permanent still enters with the counter after the source has left the battlefield', () => {
    let s = board({ battlefield: ['Test Relic Prince', ...plains(3)], graveyard: ['Test Clockwork Golem'] });
    s = castFromGy(s, 'Test Clockwork Golem');
    s = activate(s, find(s, 'Test Relic Prince', 'battlefield'), [], /Sacrifice/);
    s = resolveAll(s);
    expect(onField(s, 'Test Relic Prince')).toBeUndefined();
    expect(s.objects[onField(s, 'Test Clockwork Golem')!]!.counters['finality']).toBe(1);
  });
  it('the same card cast from the hand enters without it', () => {
    let s = board({ battlefield: ['Test Relic Prince', ...plains(2)], hand: ['Test Clockwork Golem'] });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Clockwork Golem', 'hand', 'p1') })));
    expect(s.objects[onField(s, 'Test Clockwork Golem')!]!.counters['finality'] ?? 0).toBe(0);
    expect(lifeOf(s)).toBe(20);
  });
});

describe('CR 601.3, 400.7, 611.3a: "Once during each of your turns, you may cast a creature spell from your graveyard"', () => {
  const forests = (n: number): string[] => Array(n).fill('Forest') as string[];
  it('one creature spell this turn; another again on your next turn', () => {
    let s = board({ battlefield: ['Test Ghost Chief', ...forests(4)], graveyard: ['Grizzly Bears', 'Grizzly Bears'] });
    expect(gyCasts(s)).toEqual(['Cast Grizzly Bears', 'Cast Grizzly Bears']);
    s = resolveTop(castFromGy(s, 'Grizzly Bears'));
    expect(onField(s, 'Grizzly Bears')).toBeDefined();
    expect(gyCasts(s)).toEqual([]);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'graveyard', 'p1') }).error?.rules).toContain('CR 601.3');
    s = advanceTo(s, 3, 'main1');
    expect(gyCasts(s)).toEqual(['Cast Grizzly Bears']);
  });
  it('each object with the ability allows one: two of them, two spells (CR 400.7)', () => {
    let s = board({ battlefield: ['Test Ghost Chief', 'Test Ghost Chief', ...forests(4)], graveyard: ['Grizzly Bears', 'Grizzly Bears'] });
    s = resolveTop(castFromGy(s, 'Grizzly Bears'));
    expect(gyCasts(s)).toEqual(['Cast Grizzly Bears']);
    s = resolveTop(castFromGy(s, 'Grizzly Bears'));
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Grizzly Bears').length).toBe(2);
  });
  it('never during an opponent\'s turn (the ability\'s condition, CR 611.3a), even for an instant', () => {
    let s = board({ battlefield: ['Test Echo Lantern', ...plains(2)], graveyard: ['Test Spark of Life'] });
    expect(gyCasts(s)).toEqual(['Cast Test Spark of Life']);
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.player).toBe('p1');
    expect(gyCasts(s)).toEqual([]);
  });
});

describe('CR 305.1, 305.2, 601.3: "During your turn, you may play cards from your graveyard"', () => {
  it('a land in your graveyard is played as the land of the turn; a nonland card is cast', () => {
    let s = board({ battlefield: ['Test Sorcerer of Echoes', 'Forest', 'Forest'], graveyard: ['Forest', 'Swamp', 'Grizzly Bears'] });
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'playLand').map((a) => a.label).sort()).toEqual(['Play Forest from graveyard', 'Play Swamp from graveyard']);
    expect(gyCasts(s)).toEqual(['Cast Grizzly Bears']);
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') });
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    expect(applyAction(s, { type: 'playLand', player: 'p1', card: find(s, 'Swamp', 'graveyard', 'p1') }).error?.rules).toContain('CR 305.2');
    s = resolveTop(castFromGy(s, 'Grizzly Bears'));
    expect(onField(s, 'Grizzly Bears')).toBeDefined();
  });
});

describe('CR 113.6, 614.1c: "You may cast ~ from your graveyard. If you do, it enters with a finality counter on it."', () => {
  it('from the graveyard, with the counter; from the hand, without it', () => {
    let s = board({ battlefield: plains(4), hand: ['Test Undying Veteran'], graveyard: ['Test Undying Veteran'] });
    expect(gyCasts(s)).toEqual(['Cast Test Undying Veteran']);
    s = resolveTop(castFromGy(s, 'Test Undying Veteran'));
    const fromGy = onField(s, 'Test Undying Veteran')!;
    expect(s.objects[fromGy]!.counters['finality']).toBe(1);
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Undying Veteran', 'hand', 'p1') })));
    const fromHand = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Undying Veteran' && id !== fromGy)!;
    expect(s.objects[fromHand]!.counters['finality'] ?? 0).toBe(0);
  });
  it('another card in the graveyard is not covered by the card\'s own permission', () => {
    const s = board({ battlefield: plains(4), graveyard: ['Test Undying Veteran', 'Grizzly Bears'] });
    expect(gyCasts(s)).toEqual(['Cast Test Undying Veteran']);
  });
});

describe('CR 601.3: several permissions that allow a card in different ways are the player\'s choice', () => {
  it('each way is a cast method named after its source; the plain cast is refused', () => {
    let s = board({ battlefield: ['Test Relic Prince', 'Test Junk Collector', ...plains(3)], graveyard: ['Test Clockwork Golem'] });
    expect(gyCasts(s)).toEqual(['Cast Test Clockwork Golem from your graveyard (Test Junk Collector)', 'Cast Test Clockwork Golem from your graveyard (Test Relic Prince)']);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Clockwork Golem', 'graveyard', 'p1') }).error?.rules).toContain('CR 601.3');
    const free = legalActions(s, 'p1').find((a) => a.label.endsWith('(Test Junk Collector)'))!;
    s = resolveTop(drive(act(s, free.action)));
    expect(lifeOf(s)).toBe(20);
    expect(s.objects[onField(s, 'Test Clockwork Golem')!]!.counters['finality'] ?? 0).toBe(0);
  });
  it('the way with the cost and the rider pays the life and gives the counter', () => {
    let s = board({ battlefield: ['Test Relic Prince', 'Test Junk Collector', ...plains(3)], graveyard: ['Test Clockwork Golem'] });
    const paid = legalActions(s, 'p1').find((a) => a.label.endsWith('(Test Relic Prince)'))!;
    s = resolveTop(drive(act(s, paid.action)));
    expect(lifeOf(s)).toBe(17);
    expect(s.objects[onField(s, 'Test Clockwork Golem')!]!.counters['finality']).toBe(1);
  });
  it('two permissions that allow it the same way are one way: no choice', () => {
    const s = board({ battlefield: ['Test Junk Collector', 'Test Junk Collector', ...plains(3)], graveyard: ['Test Clockwork Golem'] });
    expect(gyCasts(s)).toEqual(['Cast Test Clockwork Golem']);
  });
});

describe('CR 611.2a, 514.2: "Until end of turn, you may cast creature spells from your graveyard" (a resolved effect)', () => {
  it('lasts the turn, then the card is no longer offered', () => {
    let s = board({ battlefield: [{ name: 'Test Bone Caller', since: -1 } as unknown as string, 'Forest', 'Forest', 'Forest', 'Forest'], graveyard: ['Grizzly Bears', 'Grizzly Bears'] });
    expect(gyCasts(s)).toEqual([]);
    s = resolveAll(activate(s, find(s, 'Test Bone Caller', 'battlefield'), [], /Until end of turn/));
    expect(gyCasts(s)).toEqual(['Cast Grizzly Bears', 'Cast Grizzly Bears']);
    s = resolveTop(castFromGy(s, 'Grizzly Bears'));
    expect(gyCasts(s)).toEqual(['Cast Grizzly Bears']); // no once-each-turn limit
    s = advanceTo(s, 3, 'main1');
    expect(gyCasts(s)).toEqual([]);
  });
});

describe('CR 611.2a, 614.1a: "Until end of turn, you may play lands and cast spells from your graveyard. If a card would be put into your graveyard from anywhere this turn, exile that card instead."', () => {
  it('lands are played and spells cast from the graveyard this turn, and every card that would go to your graveyard is exiled instead (the sorcery itself too)', () => {
    let s = board({ battlefield: ['Swamp', 'Forest', 'Forest'], hand: ['Test Grave Mandate'], graveyard: ['Forest', 'Test Spark of Life'] });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Mandate', 'hand', 'p1') })));
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Grave Mandate'); // it resolved, then would have been put into the graveyard (CR 608.2n)
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'playLand').map((a) => a.label)).toEqual(['Play Forest from graveyard']);
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard', 'p1') });
    expect(onField(s, 'Forest')).toBeDefined();
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    expect(gyCasts(s)).toEqual([]); // the white instant needs {W}: no Plains here
  });
  it('an opponent\'s cards still go to their graveyard, and the replacement ends with the turn', () => {
    let s = board({ battlefield: ['Swamp', ...plains(2)], hand: ['Test Grave Mandate', 'Test Spark of Life'] });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Mandate', 'hand', 'p1') })));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark of Life', 'hand', 'p1') })));
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Grave Mandate', 'Test Spark of Life']);
    expect(s.zones.graveyard.p1).toEqual([]);
    s = advanceTo(s, 3, 'main1');
    expect(s.continuousEffects.filter((r) => r.sourceName === 'Test Grave Mandate')).toEqual([]);
  });
});

describe('CR 601.2f, 701.61a, 614.1c: "... by foraging in addition to paying their other costs. If you cast a spell this way, that creature enters with a finality counter on it."', () => {
  it('foraging is paid with the mana (three other cards of your graveyard exiled), and the creature enters with a finality counter', () => {
    let s = board({ battlefield: [{ name: 'Test Marrow Forager', since: -1 } as unknown as string, 'Forest', 'Forest'], graveyard: ['Grizzly Bears', 'Swamp', 'Swamp', 'Swamp'] });
    s = resolveAll(activate(s, find(s, 'Test Marrow Forager', 'battlefield'), [], /Until end of turn/));
    expect(gyCasts(s)).toEqual(['Cast Grizzly Bears']);
    s = castFromGy(s, 'Grizzly Bears');
    while (s.pending && s.pending.kind !== 'priority') {
      const d = s.pending as unknown as { kind: string; options?: unknown[]; min?: number };
      if (d.kind === 'chooseOption') s = act(s, { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: { kind: 'chooseOption', ids: [String((d.options![0] as { id: string }).id)] } });
      else if (d.kind === 'chooseObjects') s = act(s, { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, d.min ?? 3) } });
      else s = drive(s);
    }
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Swamp').length).toBe(3);
    s = resolveAll(s);
    expect(s.objects[onField(s, 'Grizzly Bears')!]!.counters['finality']).toBe(1);
  });
});
