/**
 * edh-d-100 (Commander coordinator D, MUST-FINISH round of the EDHREC band 5,001-10,000, group graveyard-exile-cast): the round's readings played through the engine with synthetic
 * cards compiled by the game's default compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case.
 * CR cites checked against the Comprehensive Rules of 2026-09-25 unless the record lists them as unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { canSee } from '../../../src/core/view';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const castable = (s: GameState, p: PlayerId): ObjectId[] => legal(s, p, 'cast').map((a) => a.object!);
const landable = (s: GameState, p: PlayerId): ObjectId[] => legal(s, p, 'playLand').map((a) => a.object!);

// ---- shared driver ---------------------------------------------------------------------------------------------------------------------------------------------------
interface Script { yes?: boolean[]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; targets?: TargetChoice[][]; numbers?: number[]; options?: string[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const castFrom = (s: GameState, id: ObjectId, player: PlayerId, script: Script = {}): GameState => {
  const offered = legal(s, player, 'cast').filter((a) => a.object === id); // the way the permission offers it (a free one is a granted alternative cost)
  const pick = offered.find((a) => (a.action as { method?: string }).method !== undefined) ?? offered[0];
  return settle(drive(act(s, pick?.action ?? { type: 'cast', player, card: id }), script), script);
};
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const named = (s: GameState, zone: 'exile' | 'battlefield', name: string): ObjectId[] => s.zones[zone].filter((id) => nameOf(s, id) === name);
const libraryOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.library[p] ?? [];

// ---- Share the Spoils ------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 607.2a, 305.1, 601.3, 609.4b, 603.2: "During each player\'s turn, that player may play a land or cast a spell from among cards exiled with ~ ... When they do, exile the top card of their library."', () => {
  const SPOILS = card('Test Spoils', 'Enchantment',
    "When this enchantment enters and whenever an opponent loses the game, exile the top card of each player's library.\nDuring each player's turn, that player may play a land or cast a spell from among cards exiled with this enchantment, and they may spend mana as though it were mana of any color to cast that spell. When they do, exile the top card of their library.", { cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', pt: ['2', '2'] });
  const ELK = card('Test Elk', 'Creature — Elk', '', { cost: '{G}', pt: ['1', '1'] });
  const OAK = card('Test Oak', 'Land', '{T}: Add {G}.');
  const setup = (): GameState => mpScenario({
    defs: [SPOILS, BEAR, ELK, OAK],
    zones: {
      p1: { hand: ['Test Spoils'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Elk', 'Test Bear', 'Test Elk', 'Test Elk', 'Test Elk', 'Test Elk'] }, // the first is drawn in p1's first draw step
      p2: { battlefield: ['Plains'], library: ['Test Oak', 'Test Elk', 'Test Elk', 'Test Elk', 'Test Elk'] },
      p3: { battlefield: ['Plains'], library: ['Test Elk', 'Test Elk', 'Test Elk'] },
      p4: { battlefield: ['Plains'], library: ['Test Oak', 'Test Oak', 'Test Oak'] },
    },
  });
  const entered = (): GameState => settle(drive(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Spoils', 'hand', 'p1') })));
  const linkedOf = (s: GameState): ObjectId[] => {
    const src = named(s, 'battlefield', 'Test Spoils')[0]!;
    const l = (s.objects[src] as unknown as { links?: Record<string, { objects?: { id: ObjectId }[] }> }).links?.['exiled'];
    return (l?.objects ?? []).map((h) => h.id);
  };
  it('is automated', () => expect(full(SPOILS)).toBe(true));
  it('the active player casts a spell they own from among the exiled cards paying with Plains (any color), and "when they do" exiles the top card of THEIR library, linked; then no more that turn', () => {
    const s0 = entered();
    expect(s0.zones.exile.length).toBe(4); // the enters trigger: the top card of each player's library
    const bear = named(s0, 'exile', 'Test Bear')[0]!;
    expect(linkedOf(s0)).toContain(bear);
    expect(castable(s0, 'p1')).toContain(bear); // p1's own card: any player may play any of them on their own turn
    for (const p of ['p2', 'p3', 'p4'] as PlayerId[]) expect(castable(s0, p)).not.toContain(bear); // not the active player
    const s = castFrom(s0, bear, 'p1');
    expect(named(s, 'battlefield', 'Test Bear').length).toBe(1); // {1}{G} paid with three Plains: mana as though it were mana of any color (CR 609.4b)
    // "when they do": p1's next top card (an Elk) is exiled with the enchantment; nobody else's library changed
    expect(s.zones.exile.length).toBe(4);
    const newElk = s.zones.exile.find((id) => s.objects[id]!.owner === 'p1')!;
    expect(nameOf(s, newElk)).toBe('Test Elk');
    expect(linkedOf(s)).toContain(newElk);
    expect(libraryOf(s, 'p2').length).toBe(libraryOf(s0, 'p2').length); // only the caster's library
    // once each turn: p1 may not cast the new Elk (one land OR one spell, the ruling of 2023-07-28), nor play p2's Oak from exile
    expect(castable(s, 'p1')).not.toContain(newElk);
    const oak = named(s, 'exile', 'Test Oak').find((id) => s.objects[id]!.owner === 'p2')!;
    expect(landable(s, 'p1')).not.toContain(oak);
  });
  it('on an opponent\'s turn, that player plays a land they do not own from among them (a land play, CR 305.1), and "when they do" exiles the top card of their own library; the controller of ~ gets nothing that turn', () => {
    let s = entered();
    const oak = named(s, 'exile', 'Test Oak').find((id) => s.objects[id]!.owner === 'p4')!;
    expect(oak).toBeDefined();
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'main 1 of p2');
    expect(landable(s, 'p2')).toContain(oak);
    expect(landable(s, 'p1')).not.toContain(oak); // not p1's turn
    expect(castable(s, 'p1').filter((id) => s.objects[id]!.zone === 'exile')).toEqual([]);
    const p2Library = libraryOf(s, 'p2').length;
    s = act(s, { type: 'playLand', player: 'p2', card: oak });
    expect(s.objects[named(s, 'battlefield', 'Test Oak')[0]!]!.controller).toBe('p2');
    s = settle(s); // the "when they do" trigger resolves (p1 controls it)
    expect(libraryOf(s, 'p2').length).toBe(p2Library - 1);
    const p2Exiled = s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2');
    expect(p2Exiled.length).toBe(2); // the Oak's first copy from the enters trigger was p2's top card; now its next card too
    for (const id of p2Exiled) expect(linkedOf(s)).toContain(id);
    // once each turn: neither another land (they already played one) nor a spell from among them
    expect(castable(s, 'p2').filter((id) => s.objects[id]!.zone === 'exile')).toEqual([]);
  });
  it('cards exiled some other way are not "exiled with" it (CR 607.2a), and with ~ gone the exiled cards stay unplayable (the ruling)', () => {
    const s0 = mpScenario({ defs: [SPOILS, BEAR], zones: { p1: { battlefield: ['Test Spoils', 'Plains', 'Plains'], exile: ['Test Bear'] }, p2: {}, p3: {}, p4: {} } });
    expect(castable(s0, 'p1')).toEqual([]);
  });
});

// ---- Havengul Lich ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.7c, 400.7, 611.2c, 613.1f: "{1}: You may cast target creature card in a graveyard this turn. When you cast it this turn, ~ gains all activated abilities of that card until end of turn."', () => {
  const LICH = card('Test Lich', 'Creature — Zombie Wizard', '{1}: You may cast target creature card in a graveyard this turn. When you cast it this turn, this creature gains all activated abilities of that card until end of turn.', { cost: '{3}{U}{B}', pt: ['4', '4'] });
  const PINGER = card('Test Pinger', 'Creature — Goblin', '{T}: This creature deals 1 damage to any target.', { cost: '{R}', pt: ['1', '1'] });
  const setup = (): GameState => mpScenario({
    defs: [LICH, PINGER],
    cards: ['Mountain'],
    zones: {
      p1: { battlefield: ['Test Lich', 'Mountain', 'Mountain', 'Mountain'], hand: ['Test Pinger'] },
      p2: { graveyard: ['Test Pinger'] }, p3: {}, p4: {},
    },
  });
  const lichAbilities = (s: GameState): string[] => getChars(s, named(s, 'battlefield', 'Test Lich')[0]!).abilities.map((a) => a.def.text ?? '');
  const activateLich = (s: GameState, target: ObjectId): GameState => {
    const lich = named(s, 'battlefield', 'Test Lich')[0]!;
    return settle(drive(act(s, { type: 'activate', player: 'p1', source: lich, ability: 'p:0:0' }), { targets: [[{ kind: 'object', id: target } as TargetChoice]] }));
  };
  it('is automated', () => expect(full(LICH)).toBe(true));
  it('the card in an opponent\'s graveyard is cast; the trigger (above the spell) gives ~ its activated abilities, which ~ keeps after the spell resolves, until end of turn', () => {
    let s = setup();
    const pinger = s.zones.graveyard['p2']!.find((id) => nameOf(s, id) === 'Test Pinger')!;
    s = activateLich(s, pinger);
    expect(castable(s, 'p1')).toContain(pinger);
    const before = lichAbilities(s).length;
    s = drive(act(s, { type: 'cast', player: 'p1', card: pinger }));
    // the delayed trigger is on the stack above the spell (the ruling of 2011-01-22)
    expect(s.zones.stack.length).toBe(2);
    s = settle(s);
    const now = named(s, 'battlefield', 'Test Pinger')[0]!;
    expect(s.objects[now]!.controller).toBe('p1');
    expect(lichAbilities(s).length).toBe(before + 1);
    expect(lichAbilities(s).some((t) => /deals 1 damage to any target/.test(t))).toBe(true);
    // the gained ability is the Lich's own: it deals the damage
    const lich = named(s, 'battlefield', 'Test Lich')[0]!;
    const gained = getChars(s, lich).abilities.find((a) => /deals 1 damage to any target/.test(a.def.text ?? ''))!;
    const life3 = s.players.find((p) => p.id === 'p3')!.life;
    s = settle(drive(act(s, { type: 'activate', player: 'p1', source: lich, ability: gained.key }), { targets: [[{ kind: 'player', id: 'p3' } as TargetChoice]] }));
    expect(s.players.find((p) => p.id === 'p3')!.life).toBe(life3 - 1);
    expect(s.objects[lich]!.tapped).toBe(true); // {T} of the gained ability taps the Lich itself
    // at end of turn the abilities are gone
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main 1 of turn 2');
    expect(lichAbilities(s).length).toBe(before);
  });
  it('another card of the same name cast from the hand is not "it" (CR 400.7): the Lich gains nothing; nor without a cast (the ruling of 2011-01-22)', () => {
    let s = setup();
    const pinger = s.zones.graveyard['p2']!.find((id) => nameOf(s, id) === 'Test Pinger')!;
    s = activateLich(s, pinger);
    const before = lichAbilities(s).length;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pinger', 'hand', 'p1') }));
    expect(s.zones.stack.length).toBe(1); // no trigger
    s = settle(s);
    expect(lichAbilities(s).length).toBe(before);
  });
  it('the card returned to a hand first and cast from there is a new object (CR 400.7, 603.7c): no trigger (review finding)', () => {
    const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to your hand.', { cost: '{0}' });
    let s = mpScenario({ defs: [LICH, PINGER, RAISE], cards: ['Mountain'], zones: { p1: { battlefield: ['Test Lich', 'Mountain', 'Mountain', 'Mountain'], hand: ['Test Raise'], graveyard: ['Test Pinger'] }, p2: {}, p3: {}, p4: {} } });
    const pinger = s.zones.graveyard['p1']!.find((id) => nameOf(s, id) === 'Test Pinger')!;
    s = activateLich(s, pinger);
    const before = lichAbilities(s).length;
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raise', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: pinger } as TargetChoice]] }));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pinger', 'hand', 'p1') }));
    expect(s.zones.stack.length).toBe(1);
    s = settle(s);
    expect(lichAbilities(s).length).toBe(before);
  });
  it('the permission is for this turn only: next turn the card is not castable from the graveyard, and casting it then would not trigger', () => {
    let s = setup();
    const pinger = s.zones.graveyard['p2']!.find((id) => nameOf(s, id) === 'Test Pinger')!;
    s = activateLich(s, pinger);
    s = passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main 1 of p1, turn 5');
    expect(castable(s, 'p1')).not.toContain(pinger);
  });
});

// ---- Knowledge Pool --------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 607.2a, 608.2c, 608.2g, 118.9: "Whenever a player casts a spell from their hand, that player exiles it. If the player does, they may cast a spell from among other cards exiled with ~ without paying its mana cost."', () => {
  const POOL = card('Test Pool', 'Artifact', "Imprint — When this artifact enters, each player exiles the top three cards of their library.\nWhenever a player casts a spell from their hand, that player exiles it. If the player does, they may cast a spell from among other cards exiled with this artifact without paying its mana cost.", { cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{2}', pt: ['2', '2'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { cost: '{5}', pt: ['5', '5'] });
  const OAK = card('Test Oak', 'Land', '{T}: Add {G}.');
  const setup = (): GameState => mpScenario({
    defs: [POOL, BEAR, OGRE, OAK],
    zones: {
      p1: { hand: ['Test Pool', 'Test Bear'], battlefield: ['Plains', 'Plains'], library: ['Test Oak', 'Test Ogre', 'Test Oak', 'Test Oak'] },
      p2: { library: ['Test Oak', 'Test Oak', 'Test Oak'] }, p3: { library: ['Test Oak', 'Test Oak', 'Test Oak'] }, p4: { library: ['Test Oak', 'Test Oak', 'Test Oak'] },
    },
  });
  // p1 draws nothing on turn 1 in this setup? the first card may be drawn: the Pool exiles the next three either way
  const entered = (): GameState => { const s0 = setup(); return settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pool', 'hand', 'p1') }))); };
  it('is automated', () => expect(full(POOL)).toBe(true));
  it('the spell cast from the hand is exiled (it never resolves) and its caster casts another nonland card the artifact exiled, free; the exiled spell joins them', () => {
    let s = entered();
    expect(s.zones.exile.length).toBe(12);
    const ogre = named(s, 'exile', 'Test Ogre')[0]!;
    expect(ogre).toBeDefined();
    const bear = find(s, 'Test Bear', 'hand', 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: bear }));
    // the trigger is above the Bear; resolving it exiles the Bear and offers the nonland cards exiled with the Pool other than the Bear: only the Ogre (lands are not spells)
    let offered: string[] = [];
    s = settle(s, { objects: [(options, at) => { offered = options.map((id) => nameOf(at, id)); return options.filter((id) => nameOf(at, id) === 'Test Ogre'); }] });
    expect(offered).toEqual(['Test Ogre']);
    expect(named(s, 'battlefield', 'Test Ogre').length).toBe(1); // cast without paying its mana cost: p1 had only two Plains
    expect(named(s, 'battlefield', 'Test Bear').length).toBe(0);
    expect(named(s, 'exile', 'Test Bear').length).toBe(1);
  });
  it('a player may decline the free cast: the spell is still exiled (the ruling of 2011-06-01: the original spell is exiled even with nothing cast)', () => {
    let s = entered();
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }));
    s = settle(s, { objects: [[]] });
    expect(named(s, 'exile', 'Test Bear').length).toBe(1);
    expect(named(s, 'battlefield', 'Test Ogre').length).toBe(0);
  });
});

// ---- Lobelia, Defender of Bag End ------------------------------------------------------------------------------------------------------------------------------------
describe('CR 406.3, 406.3a, 607.2a, 305.1, 118.9: "When ~ enters, look at the top card of each opponent\'s library and exile those cards face down." and "Until end of turn, you may play a card exiled with ~ without paying its mana cost."', () => {
  const LOBELIA = card('Test Defender', 'Legendary Creature — Halfling Citizen', "When Test Defender enters, look at the top card of each opponent's library and exile those cards face down.\n{T}, Sacrifice an artifact: Choose one —\n• Until end of turn, you may play a card exiled with Test Defender without paying its mana cost.\n• Each opponent loses 2 life and you gain 2 life.", { cost: '{0}', pt: ['2', '4'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { cost: '{5}', pt: ['5', '5'] });
  const OAK = card('Test Oak', 'Land', '{T}: Add {G}.');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const setup = (): GameState => mpScenario({
    defs: [LOBELIA, OGRE, OAK, TRINKET],
    zones: {
      p1: { hand: ['Test Defender'], battlefield: ['Test Trinket', 'Test Trinket'] },
      p2: { library: ['Test Ogre'] }, p3: { library: ['Test Oak'] }, p4: { library: ['Test Ogre'] },
    },
  });
  const entered = (): GameState => { const s0 = setup(); return settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Defender', 'hand', 'p1') }))); };
  const activateMode = (s: GameState, mode: string): GameState => {
    const me = named(s, 'battlefield', 'Test Defender')[0]!;
    return settle(drive(act(s, { type: 'activate', player: 'p1', source: me, ability: 'p:0:1' }), { options: [[mode]] }));
  };
  it('is automated', () => expect(full(LOBELIA)).toBe(true));
  it('the three opponents\' top cards are exiled face down: you may look at them (CR 406.3), their owners may not', () => {
    const s = entered();
    expect(s.zones.exile.length).toBe(3);
    for (const id of s.zones.exile) {
      expect(s.objects[id]!.faceDown).toBe(true);
      expect(canSee(s, s.objects[id]!, 'p1')).toBe(true);
      expect(canSee(s, s.objects[id]!, s.objects[id]!.owner)).toBe(false);
    }
  });
  it('the first mode lets you play ONE of them this turn without paying its mana cost (a land as your land play, CR 305.1); not a second one; not next turn', () => {
    let s = entered();
    s = passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'main 1 of p1, turn 5');
    expect(castable(s, 'p1').filter((id) => s.objects[id]!.zone === 'exile')).toEqual([]); // not before the mode
    s = activateMode(s, '0');
    const ogres = s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2' || s.objects[id]!.owner === 'p4');
    expect(ogres.every((id) => castable(s, 'p1').includes(id))).toBe(true);
    const oak = s.zones.exile.find((id) => s.objects[id]!.owner === 'p3')!;
    expect(landable(s, 'p1')).toContain(oak);
    s = castFrom(s, ogres[0]!, 'p1');
    expect(named(s, 'battlefield', 'Test Ogre').length).toBe(1); // free: p1 has no mana
    // one card only: the other Ogre and the Oak are no longer offered
    expect(castable(s, 'p1').filter((id) => s.objects[id]!.zone === 'exile')).toEqual([]);
    expect(landable(s, 'p1').filter((id) => s.objects[id]!.zone === 'exile')).toEqual([]);
  });
  it('the second mode drains each opponent for 2 (the modal negative: no permission)', () => {
    let s = entered();
    s = passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'main 1 of p1, turn 5');
    const life = s.players.map((p) => p.life);
    s = activateMode(s, '1');
    expect(s.players.map((p) => p.life)).toEqual([life[0]! + 2, life[1]! - 2, life[2]! - 2, life[3]! - 2]);
    expect(castable(s, 'p1').filter((id) => s.objects[id]!.zone === 'exile')).toEqual([]);
  });
});

// ---- The Capitoline Triad --------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 118.3, 202.3, 107.3b, 114.1: "Exile any number of historic cards from your graveyard with total mana value 30 or greater: You get an emblem with ..."', () => {
  const TRIAD = card('Test Triad', 'Legendary Creature — God Artificer', 'Exile any number of historic cards from your graveyard with total mana value 30 or greater: You get an emblem with "Creatures you control have base power and toughness 9/9."', { cost: '{0}', pt: ['1', '1'] });
  const IDOL = card('Test Idol', 'Artifact', '', { cost: '{10}' });
  const HERO = card('Test Hero', 'Legendary Creature — Human', '', { cost: '{8}', pt: ['1', '1'] });
  const GIANT = card('Test Giant', 'Creature — Giant', '', { cost: '{12}', pt: ['6', '6'] });
  const FIREBALL = card('Test Blaze', 'Artifact', '', { cost: '{X}{X}{R}' });
  const BEAR = card('Test Cub', 'Creature — Bear', '', { cost: '{0}', pt: ['2', '2'] });
  const setup = (graveyard: string[]): GameState => mpScenario({ defs: [TRIAD, IDOL, HERO, GIANT, FIREBALL, BEAR], zones: { p1: { battlefield: ['Test Triad', 'Test Cub'], graveyard }, p2: { battlefield: ['Test Cub'] }, p3: {}, p4: {} } });
  const canActivate = (s: GameState): boolean => { const t = named(s, 'battlefield', 'Test Triad')[0]!; return legal(s, 'p1', 'activate').some((a) => a.object === t && !a.isMana); };
  const activate = (s0: GameState, pick: string[]): GameState => {
    const t = named(s0, 'battlefield', 'Test Triad')[0]!;
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === t && !a.isMana)!;
    const left = [...pick];
    return settle(drive(act(s0, la.action), { objects: [(options, s) => options.filter((id) => { const k = left.indexOf(nameOf(s, id)); if (k < 0) return false; left.splice(k, 1); return true; })] }));
  };
  const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id); return `${c.power}/${c.toughness}`; };
  it('is automated', () => expect(full(TRIAD)).toBe(true));
  it('historic cards (artifact, legendary) with mana values 10 + 10 + 10 are exiled and you get the emblem: your creatures are 9/9, an opponent\'s are not', () => {
    const s = activate(setup(['Test Idol', 'Test Idol', 'Test Hero', 'Test Idol', 'Test Giant']), ['Test Idol', 'Test Idol', 'Test Idol']);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Idol', 'Test Idol', 'Test Idol']);
    expect(s.zones.command.some((id) => s.objects[id]!.kind === 'emblem' && s.objects[id]!.controller === 'p1')).toBe(true);
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id).types.includes('Creature'));
    for (const id of mine) expect(pt(s, id)).toBe('9/9');
    const theirs = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p2')!;
    expect(pt(s, theirs)).toBe('2/2');
  });
  it('the negative cases: 10 + 10 + 8 = 28 is not enough (the payment is refused); a nonhistoric card (the Giant, 12) is never offered and never counts; {X} counts 0 in a graveyard (the ruling of 2024-07-05)', () => {
    expect(() => activate(setup(['Test Idol', 'Test Idol', 'Test Hero', 'Test Giant']), ['Test Idol', 'Test Idol', 'Test Hero'])).toThrow();
    expect(canActivate(setup(['Test Idol', 'Test Idol', 'Test Hero', 'Test Giant', 'Test Giant']))).toBe(false); // 28 historic, the Giants do not count
    const blazes = (n: number): string[] => Array(n).fill('Test Blaze') as string[];
    expect(canActivate(setup(['Test Idol', 'Test Idol', ...blazes(9)]))).toBe(false); // 20 + 9 x 1 (each {X}{X}{R} has mana value 1 there) = 29
    expect(canActivate(setup(['Test Idol', 'Test Idol', ...blazes(10)]))).toBe(true); // 30
  });
});

// ---- Amped Raptor ----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 118.9, 202.3, 107.14, 608.2g: "You may cast that card by paying an amount of {E} equal to its mana value rather than paying its mana cost."', () => {
  const RAPTOR = card('Test Raptor', 'Creature — Dinosaur', "First strike\nWhen this creature enters, you get {E}{E} (two energy counters). Then if you cast it from your hand, exile cards from the top of your library until you exile a nonland card. You may cast that card by paying an amount of {E} equal to its mana value rather than paying its mana cost.", { cost: '{0}', pt: ['2', '1'] });
  const COLT = card('Test Colt', 'Creature — Horse', '', { cost: '{1}{G}', pt: ['2', '2'] });
  const WURM = card('Test Wurm', 'Creature — Wurm', '', { cost: '{2}{G}', pt: ['3', '3'] });
  const OAK = card('Test Oak', 'Land', '{T}: Add {G}.');
  const setup = (library: string[]): GameState => mpScenario({ defs: [RAPTOR, COLT, WURM, OAK], zones: { p1: { hand: ['Test Raptor'], library: ['Test Oak', ...library] }, p2: {}, p3: {}, p4: {} } });
  const energy = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.counters?.['energy'] ?? 0;
  const castRaptor = (s0: GameState, yes: boolean): GameState => settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raptor', 'hand', 'p1') })), { yes: [yes] });
  it('is automated', () => expect(full(RAPTOR)).toBe(true));
  it('cast from the hand: two energy, cards are exiled until a nonland card (the land stays exiled), and that card is cast for two energy (its mana value): no energy left', () => {
    const s = castRaptor(setup(['Test Oak', 'Test Colt']), true);
    expect(named(s, 'battlefield', 'Test Colt').length).toBe(1);
    expect(energy(s)).toBe(0);
    expect(named(s, 'exile', 'Test Oak').length).toBe(1);
  });
  it('the negative cases: declining keeps the card exiled and the energy; a card of mana value 3 can\'t be paid with two energy (it stays exiled, the ruling of 2024-06-07)', () => {
    const declined = castRaptor(setup(['Test Colt']), false);
    expect(named(declined, 'exile', 'Test Colt').length).toBe(1);
    expect(energy(declined)).toBe(2);
    const costly = castRaptor(setup(['Test Wurm']), true);
    expect(named(costly, 'exile', 'Test Wurm').length).toBe(1);
    expect(named(costly, 'battlefield', 'Test Wurm').length).toBe(0);
    expect(energy(costly)).toBe(2);
  });
});

// ---- Urianger Augurelt -----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 607.2a, 406.3, 601.2f, 118.7: "{T}: Look at the top card of your library. You may exile it face down." and "{T}: Until end of turn, you may play cards exiled with ~. Spells you cast this way cost {2} less to cast."', () => {
  const URIANGER = card('Test Augur', 'Legendary Creature — Elf Advisor', "Whenever you play a land from exile or cast a spell from exile, you gain 2 life.\nDraw Arcanum — {T}: Look at the top card of your library. You may exile it face down.\nPlay Arcanum — {T}: Until end of turn, you may play cards exiled with Test Augur. Spells you cast this way cost {2} less to cast.", { cost: '{0}', pt: ['2', '4'] });
  const WURM = card('Test Wurm', 'Creature — Wurm', '', { cost: '{2}{G}', pt: ['3', '3'] });
  const setup = (): GameState => mpScenario({ defs: [URIANGER, WURM], cards: ['Forest'], zones: { p1: { battlefield: ['Test Augur', 'Forest'], hand: ['Test Wurm'], library: ['Test Wurm', 'Test Wurm'] }, p2: {}, p3: {}, p4: {} } });
  const activate = (s: GameState, ability: string, yes: boolean[] = []): GameState => settle(drive(act(s, { type: 'activate', player: 'p1', source: named(s, 'battlefield', 'Test Augur')[0]!, ability }), { yes }), { yes });
  const nextTurn = (s: GameState): GameState => passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'main 1 of p1, turn 5');
  it('is automated', () => expect(full(URIANGER)).toBe(true));
  it('the card exiled face down is "exiled with" it; the play ability lets you cast it for {G} ({2} less) and you gain 2 life; a card in your hand is not reduced', () => {
    let s = activate(setup(), 'p:0:1', [true]);
    const ex = s.zones.exile[0]!;
    expect(s.objects[ex]!.faceDown).toBe(true);
    expect(canSee(s, s.objects[ex]!, 'p1')).toBe(true);
    s = nextTurn(s);
    expect(castable(s, 'p1')).not.toContain(ex); // no permission yet
    s = activate(s, 'p:0:2');
    expect(castable(s, 'p1')).toContain(ex);
    expect(castable(s, 'p1').filter((id) => s.objects[id]!.zone === 'hand')).toEqual([]); // {2}{G} from the hand with one Forest: no
    const life = s.players.find((p) => p.id === 'p1')!.life;
    s = castFrom(s, ex, 'p1');
    expect(named(s, 'battlefield', 'Test Wurm').length).toBe(1);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life + 2);
  });
  it('declining the exile leaves nothing to play (the negative case)', () => {
    let s = activate(setup(), 'p:0:1', [false]);
    expect(s.zones.exile.length).toBe(0);
    s = nextTurn(s);
    s = activate(s, 'p:0:2');
    expect(castable(s, 'p1').filter((id) => s.objects[id]!.zone === 'exile')).toEqual([]);
  });
});

// ---- Astral Drift ----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.29c, 113.6k, 603.2, 603.7: "Whenever you cycle ~ or cycle another card while ~ is on the battlefield, you may exile target creature. If you do, return that card ... at the beginning of the next end step."', () => {
  const DRIFT = card('Test Drift', 'Enchantment', "Whenever you cycle this card or cycle another card while this enchantment is on the battlefield, you may exile target creature. If you do, return that card to the battlefield under its owner's control at the beginning of the next end step.\nCycling {0} ({0}, Discard this card: Draw a card.)", { cost: '{0}' });
  const CYCLER = card('Test Cycler', 'Creature — Bird', 'Cycling {0}', { cost: '{5}', pt: ['1', '1'] });
  const BEAR = card('Test Cub', 'Creature — Bear', '', { cost: '{0}', pt: ['2', '2'] });
  const setup = (p1: { hand?: string[]; battlefield?: string[]; graveyard?: string[] }, p2: { hand?: string[] } = {}): GameState => mpScenario({ defs: [DRIFT, CYCLER, BEAR], zones: { p1, p2: { battlefield: ['Test Cub'], ...p2 }, p3: {}, p4: {} } });
  const cycle = (s0: GameState, name: string, player: PlayerId = 'p1', script: Script = {}): GameState => {
    const id = find(s0, name, 'hand', player);
    const la = legal(s0, player, 'activate').find((a) => a.object === id)!;
    return settle(drive(act(s0, la.action), script), script);
  };
  const cub = (s: GameState): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Cub')!;
  it('is automated', () => expect(full(DRIFT)).toBe(true));
  it('on the battlefield: cycling another card exiles the target creature, which returns at the beginning of the next end step (a new object, CR 400.7)', () => {
    const s0 = setup({ battlefield: ['Test Drift'], hand: ['Test Cycler'] });
    const target = cub(s0);
    let s = cycle(s0, 'Test Cycler', 'p1', { yes: [true], targets: [[{ kind: 'object', id: target } as TargetChoice]] });
    expect(named(s, 'exile', 'Test Cub').length).toBe(1);
    s = passUntil(s, (x) => x.turn.step === 'end' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the end step, trigger resolved');
    expect(named(s, 'battlefield', 'Test Cub').length).toBe(1);
    expect(s.objects[cub(s)]!.controller).toBe('p2');
  });
  it('cycling ~ itself from the hand triggers it from the graveyard', () => {
    const s0 = setup({ hand: ['Test Drift'] });
    const target = cub(s0);
    const s = cycle(s0, 'Test Drift', 'p1', { yes: [true], targets: [[{ kind: 'object', id: target } as TargetChoice]] });
    expect(named(s, 'exile', 'Test Cub').length).toBe(1);
  });
  it('the negative cases: in the graveyard (or the hand) cycling another card does nothing; an opponent\'s cycling does nothing', () => {
    for (const p1 of [{ graveyard: ['Test Drift'], hand: ['Test Cycler'] }, { hand: ['Test Drift', 'Test Cycler'] }]) {
      const s0 = setup(p1);
      const s = drive(act(s0, legal(s0, 'p1', 'activate').find((a) => a.object === find(s0, 'Test Cycler', 'hand', 'p1'))!.action));
      expect(s.zones.stack.length).toBe(1); // the cycling ability only
    }
    let s = setup({ battlefield: ['Test Drift'] }, { hand: ['Test Cycler'] });
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'main 1 of p2');
    s = drive(act(s, legal(s, 'p2', 'activate').find((a) => a.object === find(s, 'Test Cycler', 'hand', 'p2'))!.action));
    expect(s.zones.stack.length).toBe(1);
  });
});

// ---- Nethergoyf ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.138a, 118.3, 205.2a: "Escape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among them."', () => {
  const GOYF = card('Test Goyf', 'Creature — Lhurgoyf', "Test Goyf's power is equal to the number of card types among cards in your graveyard and its toughness is equal to that number plus 1.\nEscape—{2}{B}, Exile any number of other cards from your graveyard with four or more card types among them.", { cost: '{B}', pt: ['*', '1+*'] });
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { cost: '{3}', pt: ['3', '3'] });
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', { cost: '{R}' });
  const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.', { cost: '{W}' });
  const OAK = card('Test Oak', 'Land', '{T}: Add {G}.');
  const CUB = card('Test Cub', 'Creature — Bear', '', { cost: '{0}', pt: ['2', '2'] });
  const setup = (graveyard: string[]): GameState => mpScenario({ defs: [GOYF, GOLEM, BOLT, RITE, OAK, CUB], cards: ['Swamp'], zones: { p1: { battlefield: ['Swamp', 'Swamp', 'Swamp'], graveyard: ['Test Goyf', ...graveyard] }, p2: {}, p3: {}, p4: {} } });
  const goyfIn = (s: GameState): ObjectId => s.zones.graveyard['p1']!.find((id) => nameOf(s, id) === 'Test Goyf')!;
  const escapeWith = (s0: GameState, pick: string[]): GameState => {
    const goyf = goyfIn(s0);
    const la = legal(s0, 'p1', 'cast').find((a) => a.object === goyf)!;
    const left = [...pick];
    return settle(drive(act(s0, la.action), { objects: [(options, s) => options.filter((id) => { const k = left.indexOf(nameOf(s, id)); if (k < 0) return false; left.splice(k, 1); return true; })] }));
  };
  it('is automated', () => expect(full(GOYF)).toBe(true));
  it('an artifact creature card counts two card types: Golem + Bolt + Oak (four types) are exiled and Test Goyf escapes; what is left in the graveyard sizes it', () => {
    const s = escapeWith(setup(['Test Golem', 'Test Bolt', 'Test Oak', 'Test Rite']), ['Test Golem', 'Test Bolt', 'Test Oak']);
    const goyf = named(s, 'battlefield', 'Test Goyf')[0]!;
    expect(goyf).toBeDefined();
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bolt', 'Test Golem', 'Test Oak']);
    const c = getChars(s, goyf);
    expect(`${c.power}/${c.toughness}`).toBe('1/2'); // the Rite (a sorcery) is left
  });
  it('the negative cases: two creature cards and an instant are only two card types (a union, not a sum): no escape; three types in the whole graveyard: not castable', () => {
    expect(() => escapeWith(setup(['Test Cub', 'Test Cub', 'Test Bolt', 'Test Oak', 'Test Rite']), ['Test Cub', 'Test Cub', 'Test Bolt'])).toThrow(/card types among them/);
    const s0 = setup(['Test Cub', 'Test Bolt', 'Test Oak']);
    expect(castable(s0, 'p1')).not.toContain(goyfIn(s0));
  });
});
