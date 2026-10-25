/**
 * trek-1 (lane trek, Star Trek): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. The Star Trek mechanics are newer than the Comprehensive Rules edition of rules/cr (2026-09-25): their reminder text is the rule
 * source. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   beam me up (CR 702,     "Beam me up [cost] (You may cast this card from your graveyard for [cost] if you also return a creature you control to its owner's
 *   number unverified;      hand. Then exile this spell.)": cast from the graveyard as an alternative cost (CR 118.9, 601.2b) with a creature of yours returned
 *   CR 118.9, 601.2b)       as part of it; the card is exiled as it leaves the stack; no creature of yours, no cast; never from the hand
 *   CR 101.2, 614.17b       "Enchanted creature ... can't be beamed up": that creature can't be returned for a beam me up cost (another one can)
 *   assimilate (CR 701,     "assimilate target creature card from an opponent's graveyard": it enters under your control with a +1/+1 counter, is an artifact
 *   number unverified;      creature (keeping its other card types) and Borg is its only creature type, listed or not
 *   CR 205.1b, 613.1d)
 *   CR 205.1a, 205.3m,      "Until end of turn, target creature you control gets +1/+1 and becomes a Doctor": its creature types are replaced by Doctor (the
 *   613.1d, 611.2a          unlisted Star Trek types too), and come back at the end of the turn; a planeswalker keeps its planeswalker type
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type Action, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, life, scenario } from '../../m5/helpers';
import { drive, pick, resolveTop, target } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** Fully parsed and automated, whatever the status of its templates (an experimental template caps the level at partial, design 6.9). */
const automatedAll = (d: CardDef): boolean => (d.automation.level === 'full' || d.automation.level === 'partial') && d.automation.autoRatio === 1 && !JSON.stringify(d.faces).includes('"op":"manual"')
  && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const castVia = (s: GameState, name: string, method: string): Action | undefined =>
  legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name && (a.action as { method?: string }).method === method)?.action;
const zoneOf = (s: GameState, name: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name).map((o) => o.zone);
const subtypes = (s: GameState, id: string): string[] => [...getChars(s, id)!.subtypes].sort();

const HAIL = card('Test Hailing Signal', 'Sorcery', 'You gain 2 life.\nBeam me up {1}{U} (You may cast this card from your graveyard for {1}{U} if you also return a creature you control to its owner\'s hand. Then exile this spell.)', { cost: '{U}' });
const ENSIGN = card('Test Ensign', 'Creature — Vulcan Officer', '', { pt: ['2', '2'] });
const CADET = card('Test Cadet', 'Creature — Human Soldier', '', { pt: ['1', '1'] });
const YEOMAN = card('Test Yeoman', 'Creature — Andorian Officer', '', { pt: ['1', '2'] });
const STRANDED = card('Test Stranding Field', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature doesn\'t untap during its controller\'s untap step and can\'t be beamed up.', { cost: '{U}' });

describe('beam me up (Star Trek reminder text; CR 702 number unverified, CR 118.9, 601.2b): cast from the graveyard, returning a creature you control, then exiled', () => {
  const board = (p1: { battlefield?: string[]; hand?: string[] } = {}, p2: { battlefield?: string[] } = {}): GameState => scenario(['Island'], {
    p1: { graveyard: ['Test Hailing Signal'], battlefield: ['Island', 'Island', ...(p1.battlefield ?? [])], hand: p1.hand ?? [] },
    p2: { battlefield: p2.battlefield ?? [] },
    defs: [HAIL, ENSIGN, CADET, YEOMAN, STRANDED],
  });

  it('the keyword and its cost part are capabilities; the cards compile fully automated', () => {
    for (const c of ['keyword:beam me up', 'cost:returnToHand.beamUp', 'rule:beBeamedUp']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    expect(full(HAIL)).toBe(true);
    expect(automatedAll(STRANDED)).toBe(true);
  });

  it('paying {1}{U} and returning a creature you control casts it from the graveyard; the creature goes to its owner\'s hand; the card is exiled after it resolves', () => {
    let s = board({ battlefield: ['Test Ensign'] });
    const ensign = find(s, 'Test Ensign', 'battlefield', 'p1');
    const cast = castVia(s, 'Test Hailing Signal', 'beam me up');
    expect(cast).toBeDefined();
    s = drive(act(s, cast!), [pick(ensign)]);
    expect(s.zones.stack.length).toBe(1);
    expect(zoneOf(s, 'Test Ensign')).toEqual(['hand']);
    const before = life(s, 'p1');
    s = resolveTop(s);
    expect(life(s, 'p1')).toBe(before + 2);
    expect(zoneOf(s, 'Test Hailing Signal')).toEqual(['exile']);
  });

  it('with no creature you control it is not offered (an opponent\'s creature can\'t pay it)', () => {
    const s = board({}, { battlefield: ['Test Cadet'] });
    expect(castVia(s, 'Test Hailing Signal', 'beam me up')).toBeUndefined();
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hailing Signal', 'graveyard', 'p1'), method: 'beam me up' } as Action).error).toBeDefined();
  });

  it('cast from the hand, it is an ordinary sorcery: it goes to the graveyard, and only there is beam me up offered', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Hailing Signal'], battlefield: ['Island', 'Island', 'Island', 'Test Ensign'] }, defs: [HAIL, ENSIGN] });
    expect(castVia(s, 'Test Hailing Signal', 'beam me up')).toBeUndefined();
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hailing Signal', 'hand', 'p1') })));
    expect(zoneOf(s, 'Test Hailing Signal')).toEqual(['graveyard']);
    expect(castVia(s, 'Test Hailing Signal', 'beam me up')).toBeDefined();
  });

  it('CR 101.2, 614.17b: a creature that "can\'t be beamed up" can\'t be returned for it: alone it is no way to pay; beside another creature, only the other one is offered', () => {
    let s = board({ battlefield: ['Test Ensign', 'Island'], hand: ['Test Stranding Field'] });
    const ensign = find(s, 'Test Ensign', 'battlefield', 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Stranding Field', 'hand', 'p1') }), [target(ensign)]);
    s = resolveTop(s);
    expect(zoneOf(s, 'Test Stranding Field')).toEqual(['battlefield']);
    expect(castVia(s, 'Test Hailing Signal', 'beam me up')).toBeUndefined();

    let t = board({ battlefield: ['Test Ensign', 'Test Cadet', 'Test Yeoman', 'Island'], hand: ['Test Stranding Field'] });
    const ensign2 = find(t, 'Test Ensign', 'battlefield', 'p1');
    const cadet = find(t, 'Test Cadet', 'battlefield', 'p1');
    const yeoman = find(t, 'Test Yeoman', 'battlefield', 'p1');
    t = resolveTop(drive(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Stranding Field', 'hand', 'p1') }), [target(ensign2)]));
    t = act(t, castVia(t, 'Test Hailing Signal', 'beam me up')!);
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    expect(t.pending?.kind).toBe('chooseObjects');
    expect([...(t.pending as { options: string[] }).options].sort()).toEqual([cadet, yeoman].sort()); // the enchanted Ensign is no candidate
    t = drive(t, [pick(cadet)]);
    expect(zoneOf(t, 'Test Cadet')).toEqual(['hand']);
    expect(zoneOf(t, 'Test Yeoman')).toEqual(['battlefield']);
    expect(zoneOf(t, 'Test Ensign')).toEqual(['battlefield']);
  });
});

describe('assimilate (Star Trek reminder text; CR 701 number unverified, CR 110.2a, 122.6, 205.1b, 613.1d)', () => {
  const QUEEN = card('Test Hive Matriarch', 'Legendary Artifact Creature — Borg Noble', 'When this creature enters, assimilate target creature card from an opponent\'s graveyard. (Put it onto the battlefield under your control with a +1/+1 counter. It\'s a Borg artifact creature and loses all other creature types.)', { pt: ['1', '4'], cost: '{0}' });
  const SPIRIT = card('Test Glade Spirit', 'Enchantment Creature — Elf Vulcan', '', { pt: ['2', '3'] });
  const board = (): GameState => scenario([], { p1: { hand: ['Test Hive Matriarch'], graveyard: ['Test Cadet'] }, p2: { graveyard: ['Test Glade Spirit'] }, defs: [QUEEN, SPIRIT, CADET] });

  it('the card compiles fully automated, with the assimilate action', () => {
    expect(ENGINE_CAPABILITIES.has('action:assimilate')).toBe(true);
    expect(automatedAll(QUEEN)).toBe(true);
  });

  it('the card enters under your control with a +1/+1 counter; it is an artifact creature that keeps its enchantment type; Borg is its only creature type', () => {
    let s = board();
    const spirit = find(s, 'Test Glade Spirit', 'graveyard', 'p2');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hive Matriarch', 'hand', 'p1') }));
    s = resolveTop(s); // the creature spell
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(JSON.stringify(s.pending)).toContain(spirit);
    expect(JSON.stringify(s.pending)).not.toContain(`"${find(s, 'Test Cadet', 'graveyard', 'p1')}"`); // an opponent's graveyard only: your own creature card is no target
    s = drive(s, [target(spirit)]);
    s = resolveTop(s); // the enters trigger
    const id = find(s, 'Test Glade Spirit', 'battlefield');
    expect(s.objects[id]!.controller).toBe('p1');
    expect(s.objects[id]!.owner).toBe('p2');
    expect(s.objects[id]!.counters['+1/+1']).toBe(1);
    const c = getChars(s, id)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature', 'Enchantment']);
    expect(subtypes(s, id)).toEqual(['Borg']); // Elf (listed) and Vulcan (newer than the list) are gone
    expect(`${c.power}/${c.toughness}`).toBe('3/4');
  });

  it('it lasts: the type change has no duration (CR 611.2a), so a later turn still sees a Borg artifact creature', () => {
    let s = board();
    const spirit = find(s, 'Test Glade Spirit', 'graveyard', 'p2');
    s = resolveTop(drive(resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hive Matriarch', 'hand', 'p1') }))), [target(spirit)]));
    s = advanceTo(s, 2, 'main1');
    const id = find(s, 'Test Glade Spirit', 'battlefield');
    expect(subtypes(s, id)).toEqual(['Borg']);
    expect(getChars(s, id)!.types).toContain('Artifact');
  });
});

describe('CR 205.1a, 205.3m, 613.1d: "Until end of turn, target creature you control gets +1/+1 and becomes a Doctor"', () => {
  const RECAST = card('Test Field Commission', 'Instant', 'Until end of turn, target creature you control gets +1/+1 and becomes a Doctor.', { cost: '{0}' });
  const LOSE = card('Test Unmasking', 'Instant', 'Target creature gets +2/-1 and loses all creature types until end of turn.', { cost: '{0}' });
  const WALKER = card('Test Starwalker', 'Legendary Planeswalker Creature — Testwalker Elf', '', { pt: ['2', '2'], loyalty: '3' });

  it('the cards compile fully automated', () => {
    expect(automatedAll(RECAST)).toBe(true);
    expect(full(LOSE)).toBe(true);
  });

  it('a Vulcan Officer (types newer than the list) becomes a 3/3 Doctor and nothing else; at the end of the turn it is a 2/2 Vulcan Officer again', () => {
    let s = scenario([], { p1: { hand: ['Test Field Commission'], battlefield: ['Test Ensign'] }, defs: [RECAST, ENSIGN] });
    const ensign = find(s, 'Test Ensign', 'battlefield', 'p1');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Field Commission', 'hand', 'p1') }), [target(ensign)]));
    expect(subtypes(s, ensign)).toEqual(['Doctor']);
    expect(`${getChars(s, ensign)!.power}/${getChars(s, ensign)!.toughness}`).toBe('3/3');
    s = advanceTo(s, 2, 'main1');
    expect(subtypes(s, ensign)).toEqual(['Officer', 'Vulcan']);
    expect(`${getChars(s, ensign)!.power}/${getChars(s, ensign)!.toughness}`).toBe('2/2');
  });

  it('"loses all creature types" removes the unlisted creature types too (FAST5 T41\'s reading, trek-1 fix)', () => {
    let s = scenario([], { p1: { hand: ['Test Unmasking'], battlefield: ['Test Ensign'] }, defs: [LOSE, ENSIGN] });
    const ensign = find(s, 'Test Ensign', 'battlefield', 'p1');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unmasking', 'hand', 'p1') }), [target(ensign)]));
    expect(subtypes(s, ensign)).toEqual([]);
  });

  it('CR 205.3j: a planeswalker creature keeps its planeswalker type (an unlisted subtype of a planeswalker is no creature type); its Elf is replaced', () => {
    let s = scenario([], { p1: { hand: ['Test Field Commission'], battlefield: [{ name: 'Test Starwalker', counters: { loyalty: 3 } }] }, defs: [RECAST, WALKER] });
    const walker = find(s, 'Test Starwalker', 'battlefield', 'p1');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Field Commission', 'hand', 'p1') }), [target(walker)]));
    expect(subtypes(s, walker)).toEqual(['Doctor', 'Testwalker']);
  });
});
