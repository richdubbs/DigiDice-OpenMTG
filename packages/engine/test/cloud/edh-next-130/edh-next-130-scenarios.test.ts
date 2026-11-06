/**
 * edh-next-130 (must-finish round, group copies): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative cases and the Scryfall rulings.
 *
 *   CR 120.1, 400.7, 603.10a, 707.2, 707.9b, 205.1a, 205.3d   Shelob, Child of Ungoliant (dealt damage this turn by a Spider you controlled; a Food artifact copy)
 *   CR 607.2a, 707.2, 707.9b, 205.1a, 105.2, 613.4b, 702.19       Dino DNA (a copy of a card exiled with it, except it's a 6/6 green Dinosaur creature with trample)
 *   CR 603.10a, 607.2a, 707.2, 707.9b, 205.1b, 400.7              Hofri Ghostforge (exile it; a Spirit copy linked to the exiled card, which returns when the token leaves)
 *   CR 701.38a, 701.6a, 707.10, 707.10c, 608.2c                   Split Decision (a vote: counter the spell, or copy it on a tie; the two results exclude each other)
 *   CR 614.1c, 614.1e, 708.8, 707.2, 611.2a, 610.3, 702.37e         Vesuvan Shapeshifter (a copy as it enters or is turned face up, until it is turned face down)
 *   CR 707.12, 601.2, 608.2c, 608.2b                              Spelltwine (copy two exiled cards and cast the copies if able, for free)
 *   CR 603.7b, 606.3, 707.10, 510.2                               Jaya's Phoenix (copy the next loyalty ability you activate this turn)
 *   CR 205.3m, 702.73a, 707.10, 707.10f, 601.2i                   Volo, Guide to Monsters (a creature spell that doesn't share a creature type with ... or ...)
 *   CR 101.4, 608.2d, 707.2, 111.1, 608.2c                        Tempt with Reflections (a tempting offer of token copies of the target)
 *   CR 608.2f, 506.2, 508.4, 707.9b, 205.4a, 603.7               Shredder, Shadow Master (for each other opponent, a token copy tapped and attacking that player; sacrificed at end of combat)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

// ---- shared driver ---------------------------------------------------------------------------------------------------------------------------------------------------
interface Script { labels?: string[]; attackers?: ObjectId[]; defender?: PlayerId; yes?: boolean[]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; targets?: TargetChoice[][]; numbers?: number[]; options?: string[][]; seen?: { kind: string; player: PlayerId; options?: ObjectId[] }[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.seen?.push({ kind: p.kind, player: p.player, ...(p.kind === 'chooseObjects' ? { options: [...p.options] } : {}) });
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption' && script.labels !== undefined && script.labels.length > 0) { const want = script.labels.shift()!; const o = p.options.find((x) => x.label === want); if (!o) throw new Error(`no option ${want}: ${p.options.map((x) => x.label).join('/')}`); s = answer(s, { kind: 'chooseOption', ids: [o.id] }); }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'declareAttackers') { const at = script.attackers ?? []; script.attackers = []; s = answer(s, { kind: 'declareAttackers', attacks: at.map((attacker) => ({ attacker, defender: script.defender ?? ('p2' as const) })) }); }
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
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
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id } as TargetChoice);
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const activate = (s: GameState, source: ObjectId, script: Script = {}, player: PlayerId = 'p1'): GameState => {
  const a = legalActions(s, player).find((x) => x.action.type === 'activate' && x.action.source === source);
  if (!a) throw new Error(`no ability to activate on ${source}`);
  return settle(drive(act(s, a.action), script), script);
};
/** Every permanent on the battlefield has been under its controller's control since before the turn (no summoning sickness, CR 302.6). */
const settled = (s: GameState): void => { for (const id of s.zones.battlefield) s.objects[id]!.controlledSinceTurn = -1; };
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token');
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

// ---- Shelob, Child of Ungoliant ---------------------------------------------------------------------------------------------------------------------------------------
const SHELOB = card('Test Brood Mother', 'Legendary Creature — Spider Demon', "Deathtouch, ward {2}\nOther Spiders you control have deathtouch and ward {2}.\nWhenever another creature dealt damage this turn by a Spider you controlled dies, create a token that's a copy of that creature, except it's a Food artifact with \"{2}, {T}, Sacrifice this token: You gain 3 life,\" and it loses all other card types.", { cost: '{4}{B}{G}', pt: ['8', '8'], colors: ['B', 'G'] });
const SPIDER_PINGER = card('Test Web Spitter', 'Creature — Spider', '{T}: This creature deals 1 damage to target creature.', { cost: '{1}{G}', pt: ['1', '2'], colors: ['G'] });
const HUMAN_PINGER = card('Test Slinger', 'Creature — Human Archer', '{T}: This creature deals 1 damage to target creature.', { cost: '{1}{R}', pt: ['1', '1'], colors: ['R'] });
const HERALD = card('Test Herald Ogre', 'Creature — Ogre Warrior', 'When this creature enters, you gain 2 life.', { cost: '{3}{R}', pt: ['4', '4'], colors: ['R'] });
const KILL = card('Test Smite', 'Instant', 'Destroy target creature.', { cost: '{0}' });

describe('CR 120.1, 400.7, 603.10a, 707.9b, 205.1a: Shelob, "another creature dealt damage this turn by a Spider you controlled dies, create a token that\'s a copy of that creature, except it\'s a Food artifact ..."', () => {
  it('is automated', () => expect(full(SHELOB)).toBe(true));
  const setup = (): GameState => mpScenario({
    defs: [SHELOB, SPIDER_PINGER, HUMAN_PINGER, HERALD, KILL],
    zones: { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Brood Mother', 'Test Web Spitter', 'Test Slinger', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Herald Ogre', 'Test Web Spitter'] }, p3: { battlefield: ['Test Herald Ogre'] }, p4: {} },
    setup: settled,
  });
  it('a creature damaged by a Spider you control (a deathtouch one by the static ability: it dies at once) gives a Food artifact copy: no creature type, not a creature, its name and its own abilities kept (enters: the ETB triggers, ruling 2023-06-16), and the Food ability gains 3 life', () => {
    const s0 = setup();
    const spitter = find(s0, 'Test Web Spitter', 'battlefield', 'p1');
    const ogre = find(s0, 'Test Herald Ogre', 'battlefield', 'p2');
    const before = life(s0, 'p1');
    let s = activate(s0, spitter, { targets: [[obj(ogre)]] });
    // deathtouch from the static ability (CR 702.2b): the ogre died to the 1 damage
    expect(s.zones.battlefield.includes(ogre)).toBe(false);
    const toks = tokensOf(s, 'p1');
    expect(toks.length).toBe(1);
    const ch = getChars(s, toks[0]!);
    expect(ch.name).toBe('Test Herald Ogre');
    expect(ch.types).toEqual(['Artifact']);
    expect(ch.subtypes).toEqual(['Food']);
    expect(ch.types.includes('Creature')).toBe(false);
    expect(ch.supertypes).toEqual([]);
    // the enters trigger of the copy resolved (ruling 2023-06-16: enters abilities of the copied creature trigger)
    expect(life(s, 'p1')).toBe(before + 2);
    // the Food ability: {2}, {T}, sacrifice: gain 3 life
    s = activate(s, toks[0]!);
    expect(life(s, 'p1')).toBe(before + 5);
    expect(tokensOf(s, 'p1').length).toBe(0);
  });
  it('the negative cases: damaged only by a non-Spider you control, or by a Spider an OPPONENT controlled, the creature dies with no token', () => {
    const s0 = setup();
    const slinger = find(s0, 'Test Slinger', 'battlefield', 'p1');
    const ogre3 = find(s0, 'Test Herald Ogre', 'battlefield', 'p3');
    let s = activate(s0, slinger, { targets: [[obj(ogre3)]] });
    expect(s.zones.battlefield.includes(ogre3)).toBe(true);
    s = cast(s, 'Test Smite', { targets: [[obj(ogre3)]] });
    expect(s.zones.battlefield.includes(ogre3)).toBe(false);
    expect(tokensOf(s, 'p1').length).toBe(0);
  });
  it('an opponent\'s Spider is not "a Spider you controlled": its damage gives no token to Shelob\'s controller (the source\'s controller as it dealt the damage, CR 120.1, 400.7)', () => {
    const s0 = setup();
    const oppSpider = find(s0, 'Test Web Spitter', 'battlefield', 'p2');
    const ogre3 = find(s0, 'Test Herald Ogre', 'battlefield', 'p3');
    let s = s0;
    // p2 gets priority: pass p1's priority first
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, legalActions(s, 'p2').find((x) => x.action.type === 'activate' && x.action.source === oppSpider)!.action), { targets: [[obj(ogre3)]] });
    s = settle(s);
    expect(s.zones.battlefield.includes(ogre3)).toBe(true); // no deathtouch: Shelob grants it to her controller's Spiders only
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p1') s = act(s, { type: 'pass', player: s.pending.player });
    s = cast(s, 'Test Smite', { targets: [[obj(ogre3)]] });
    expect(s.zones.battlefield.includes(ogre3)).toBe(false);
    expect(tokensOf(s, 'p1').length).toBe(0);
  });
  it('"this turn", and any Spider source: a Kindred Spider spell you cast is a Spider you controlled; its damage on an earlier turn does not count (a damage entry of this turn only)', () => {
    const TOUGH = card('Test Stone Ogre', 'Creature — Ogre', '', { cost: '{3}', pt: ['3', '5'] });
    const SPIT = card('Test Venom Spit', 'Kindred Instant — Spider', 'Test Venom Spit deals 1 damage to target creature.', { cost: '{0}', colors: ['G'] });
    const s0 = mpScenario({ defs: [SHELOB, TOUGH, KILL, SPIT], zones: { p1: { hand: ['Test Smite', 'Test Venom Spit'], battlefield: ['Test Brood Mother'] }, p2: { battlefield: ['Test Stone Ogre'] }, p3: {}, p4: {} }, setup: settled });
    const ogre = find(s0, 'Test Stone Ogre', 'battlefield', 'p2');
    // the spell is no permanent: Shelob gives it no deathtouch, the ogre lives with 1 damage
    const s1 = cast(s0, 'Test Venom Spit', { targets: [[obj(ogre)]] });
    expect(s1.zones.battlefield.includes(ogre)).toBe(true);
    expect(s1.history.some((e) => e.ev === 'damage' && e.subject === ogre)).toBe(true);
    const a = cast(s1, 'Test Smite', { targets: [[obj(ogre)]] });
    expect(tokensOf(a, 'p1').length).toBe(1);
    expect(getChars(a, tokensOf(a, 'p1')[0]!).name).toBe('Test Stone Ogre');
    // the same damage entry moved to an earlier turn: no longer "this turn"
    const s2 = structuredClone(s1);
    for (const e of s2.history) if (e.ev === 'damage') (e as { turn: number }).turn = s2.turn.number - 1;
    const b = cast(s2, 'Test Smite', { targets: [[obj(ogre)]] });
    expect(b.zones.battlefield.includes(ogre)).toBe(false);
    expect(tokensOf(b, 'p1').length).toBe(0);
  });
});

// ---- Shredder, Shadow Master ------------------------------------------------------------------------------------------------------------------------------------------
const SHREDDER = card('Test Shadow Boss', 'Legendary Creature — Human Ninja', "Whenever this creature attacks a player, for each other opponent, create a token that's a copy of this creature tapped and attacking that player, except it isn't legendary. Sacrifice those tokens at end of combat.\nWhenever this creature deals combat damage to a player, that player loses half their life, rounded up.", { cost: '{3}{B}{B}', pt: ['4', '4'], colors: ['B'] });

/** Pass priority (answering what comes up) until `done` holds. */
function until(s0: GameState, done: (s: GameState) => boolean, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 600 && !done(s); guard++) {
    if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    else { const one = { ...script, yes: script.yes ?? [] }; const before = s; s = drive(s, one); if (s === before) break; }
  }
  if (!done(s)) throw new Error('condition never reached');
  return s;
}

describe('CR 608.2f, 506.2, 508.4, 707.9b, 205.4a, 603.7: Shredder, "whenever ~ attacks a player, for each other opponent, create a token that\'s a copy of ~ tapped and attacking that player, except it isn\'t legendary. Sacrifice those tokens at end of combat."', () => {
  it('is automated', () => expect(full(SHREDDER)).toBe(true));
  it('attacking p2 makes one nonlegendary tapped copy attacking EACH OTHER opponent (p3, p4; none for p2, none for you); every one that connects halves that player\'s life rounded up (the copies have the abilities, ruling 2026-01-27); the copies are sacrificed at end of combat', () => {
    const s0 = mpScenario({ defs: [SHREDDER], zones: { p1: { battlefield: ['Test Shadow Boss'] }, p2: {}, p3: {}, p4: {} }, setup: settled });
    const boss = find(s0, 'Test Shadow Boss', 'battlefield', 'p1');
    const p3life = life(s0, 'p3');
    const s1 = until(s0, (s) => tokensOf(s, 'p1').length > 0 && s.zones.stack.length === 0, { attackers: [boss], defender: 'p2' });
    const toks = tokensOf(s1, 'p1');
    expect(toks.length).toBe(2);
    const whom = toks.map((t) => s1.combat?.attackers.find((a) => a.id === t)?.defender);
    expect(new Set(whom)).toEqual(new Set(['p3', 'p4']));
    for (const t of toks) {
      expect(s1.objects[t]!.tapped).toBe(true);
      expect(getChars(s1, t).supertypes.includes('Legendary')).toBe(false);
      expect(getChars(s1, t).name).toBe('Test Shadow Boss');
    }
    // the tokens were never declared as attackers: no second "attacks" trigger (ruling 2026-01-27)
    // through combat damage to the end of combat: each defending player lost half their life, rounded up; then the tokens are gone
    const s2 = until(s1, (s) => s.turn.step === 'main2');
    expect(life(s2, 'p2')).toBe(Math.floor((life(s0, 'p2') - 4) / 2));
    expect(life(s2, 'p3')).toBe(Math.floor((p3life - 4) / 2));
    expect(life(s2, 'p4')).toBe(Math.floor((life(s0, 'p4') - 4) / 2));
    expect(tokensOf(s2, 'p1').length).toBe(0);
    expect(s2.zones.battlefield.includes(boss)).toBe(true);
  });
  it('the negative case: with three players there is ONE other opponent (attacking p3 gives one token, attacking p2), never one for the attacked player', () => {
    const s0 = mpScenario({ players: 3, defs: [SHREDDER], zones: { p1: { battlefield: ['Test Shadow Boss'] }, p2: {}, p3: {} }, setup: settled });
    const boss = find(s0, 'Test Shadow Boss', 'battlefield', 'p1');
    const s1 = until(s0, (s) => tokensOf(s, 'p1').length > 0 && s.zones.stack.length === 0, { attackers: [boss], defender: 'p3' });
    const toks = tokensOf(s1, 'p1');
    expect(toks.length).toBe(1);
    expect(s1.combat?.attackers.find((a) => a.id === toks[0])?.defender).toBe('p2');
    const s2 = until(s1, (s) => s.turn.step === 'main2');
    expect(tokensOf(s2, 'p1').length).toBe(0);
  });
});

// ---- Dino DNA ---------------------------------------------------------------------------------------------------------------------------------------------------------
const DNA = card('Test Gene Vat', 'Artifact', "Imprint — {1}, {T}: Exile target creature card from a graveyard. Activate only as a sorcery.\n{6}: Create a token that's a copy of target creature card exiled with this artifact, except it's a 6/6 green Dinosaur creature with trample. Activate only as a sorcery.", { cost: '{3}' });
const CLOCK = card('Test Clockwork Owl', 'Artifact Creature — Construct Bird', 'Flying\nWhen this creature enters, you gain 2 life.', { cost: '{X}{2}', pt: ['1', '1'] });
const BEAR2 = card('Test Grizzly', 'Creature — Bear', '', { cost: '{1}{G}', pt: ['2', '2'], colors: ['G'] });

describe('CR 607.2a, 707.2, 707.9b, 205.1a, 105.2, 613.4b: Dino DNA, "create a token that\'s a copy of target creature card exiled with this artifact, except it\'s a 6/6 green Dinosaur creature with trample"', () => {
  it('is automated', () => expect(full(DNA)).toBe(true));
  const lands = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  it('the token copies the imprinted card (its name, its abilities: the enters trigger works, ruling 2023-11-10) and is ONLY a 6/6 green Dinosaur creature with trample (artifact and its old subtypes gone, colorless made green); only a card exiled WITH this artifact can be its target (CR 607.2a)', () => {
    const s0 = mpScenario({ defs: [DNA, CLOCK, BEAR2], zones: { p1: { battlefield: ['Test Gene Vat', ...lands] }, p2: { graveyard: ['Test Clockwork Owl'], exile: ['Test Grizzly'] }, p3: {}, p4: {} }, setup: settled });
    const vat = find(s0, 'Test Gene Vat', 'battlefield', 'p1');
    const owl = find(s0, 'Test Clockwork Owl', 'graveyard', 'p2');
    const grizzly = find(s0, 'Test Grizzly', 'exile', 'p2');
    const before = life(s0, 'p1');
    let s = activate(s0, vat, { targets: [[obj(owl)]] });
    const exiledOwl = s.zones.exile.find((id) => s.objects[id]!.defId === CLOCK.id || s.objects[id]!.defId === 'Test Clockwork Owl')!;
    expect(exiledOwl).toBeDefined();
    // the second ability: its only legal target is the imprinted card (not the Grizzly exiled some other way)
    const a = legalActions(s, 'p1').filter((x) => x.action.type === 'activate' && x.action.source === vat);
    expect(a.length).toBe(1);
    let st = act(s, a[0]!.action);
    expect(st.pending?.kind).toBe('chooseTargets');
    expect(() => answer(st, { kind: 'chooseTargets', targets: [obj(grizzly)] })).toThrow();
    st = settle(drive(st, { targets: [[obj(exiledOwl)]] }));
    const toks = tokensOf(st, 'p1');
    expect(toks.length).toBe(1);
    const ch = getChars(st, toks[0]!);
    expect(ch.name).toBe('Test Clockwork Owl');
    expect(ch.types).toEqual(['Creature']);
    expect(ch.subtypes).toEqual(['Dinosaur']);
    expect(ch.colors).toEqual(['G']);
    expect([ch.power, ch.toughness]).toEqual(['6', '6']);
    const kws = JSON.stringify(ch.abilities ?? []).toLowerCase();
    expect(kws.includes('trample')).toBe(true);
    expect(kws.includes('flying')).toBe(true);
    // the copied enters trigger
    expect(life(st, 'p1')).toBe(before + 2);
  });
});

// ---- Hofri Ghostforge -------------------------------------------------------------------------------------------------------------------------------------------------
const HOFRI = card('Test Ghost Smith', 'Legendary Creature — Spirit Cleric', "Spirits you control get +1/+1 and have trample and haste.\nWhenever another nontoken creature you control dies, exile it. If you do, create a token that's a copy of that creature, except it's a Spirit in addition to its other types and it has \"When this token leaves the battlefield, return the exiled card to its owner's graveyard.\"", { cost: '{3}{R}{W}', pt: ['4', '5'], colors: ['R', 'W'] });
const BRUTE = card('Test Hill Brute', 'Creature — Giant', '', { cost: '{4}', pt: ['5', '5'] });

describe('CR 603.10a, 607.2a, 707.2, 707.9b, 205.1b, 400.7: Hofri, "exile it. If you do, create a token that\'s a copy of that creature, except it\'s a Spirit ... and it has "When this token leaves the battlefield, return the exiled card to its owner\'s graveyard.""', () => {
  it('is automated', () => expect(full(HOFRI)).toBe(true));
  const setup = (): GameState => mpScenario({
    defs: [HOFRI, HERALD, BRUTE, KILL],
    zones: { p1: { hand: ['Test Smite', 'Test Smite', 'Test Smite', 'Test Smite'], battlefield: ['Test Ghost Smith', 'Test Herald Ogre', 'Test Hill Brute'] }, p2: { battlefield: ['Test Herald Ogre'] }, p3: {}, p4: {} },
    setup: settled,
  });
  const inZone = (s: GameState, zone: 'exile' | 'graveyard', name: string, owner: PlayerId): ObjectId[] => (zone === 'exile' ? s.zones.exile : s.zones.graveyard[owner]!).filter((id) => s.objects[id]!.defId === name && s.objects[id]!.owner === owner);
  it('your creature dies: it is exiled and a Spirit copy enters (its enters ability triggers; Hofri\'s +1/+1, trample and haste apply); when the TOKEN leaves, THAT card returns to its owner\'s graveyard (ruling 2021-04-16)', () => {
    const s0 = setup();
    const ogre = find(s0, 'Test Herald Ogre', 'battlefield', 'p1');
    const before = life(s0, 'p1');
    let s = cast(s0, 'Test Smite', { targets: [[obj(ogre)]] });
    expect(inZone(s, 'exile', 'Test Herald Ogre', 'p1').length).toBe(1);
    expect(inZone(s, 'graveyard', 'Test Herald Ogre', 'p1').length).toBe(0);
    const toks = tokensOf(s, 'p1');
    expect(toks.length).toBe(1);
    const ch = getChars(s, toks[0]!);
    expect(ch.name).toBe('Test Herald Ogre');
    expect([...ch.subtypes].sort()).toEqual(['Ogre', 'Spirit', 'Warrior']);
    expect([ch.power, ch.toughness]).toEqual(['5', '5']);
    expect(JSON.stringify(ch.abilities).toLowerCase().includes('haste')).toBe(true);
    expect(life(s, 'p1')).toBe(before + 2);
    // the token dies: the card it was made from goes to its owner's graveyard; the token is no nontoken creature, so Hofri does not trigger again
    s = cast(s, 'Test Smite', { targets: [[obj(toks[0]!)]] });
    expect(tokensOf(s, 'p1').length).toBe(0);
    expect(inZone(s, 'exile', 'Test Herald Ogre', 'p1').length).toBe(0);
    expect(inZone(s, 'graveyard', 'Test Herald Ogre', 'p1').length).toBe(1);
  });
  it('each token refers only to the card exiled when IT was made: two creatures die, the first token leaves, only the first card returns (ruling 2021-04-16)', () => {
    const s0 = setup();
    const ogre = find(s0, 'Test Herald Ogre', 'battlefield', 'p1');
    const brute = find(s0, 'Test Hill Brute', 'battlefield', 'p1');
    let s = cast(s0, 'Test Smite', { targets: [[obj(ogre)]] });
    s = cast(s, 'Test Smite', { targets: [[obj(brute)]] });
    const toks = tokensOf(s, 'p1');
    expect(toks.length).toBe(2);
    const ogreTok = toks.find((t) => getChars(s, t).name === 'Test Herald Ogre')!;
    s = cast(s, 'Test Smite', { targets: [[obj(ogreTok)]] });
    expect(inZone(s, 'graveyard', 'Test Herald Ogre', 'p1').length).toBe(1);
    expect(inZone(s, 'exile', 'Test Hill Brute', 'p1').length).toBe(1);
    expect(inZone(s, 'graveyard', 'Test Hill Brute', 'p1').length).toBe(0);
  });
  it('the negative cases: an opponent\'s creature dying is not yours (nothing exiled, no token)', () => {
    const s0 = setup();
    const theirs = find(s0, 'Test Herald Ogre', 'battlefield', 'p2');
    const s = cast(s0, 'Test Smite', { targets: [[obj(theirs)]] });
    expect(tokensOf(s, 'p1').length).toBe(0);
    expect(inZone(s, 'graveyard', 'Test Herald Ogre', 'p2').length).toBe(1);
  });
  it('a creature that was a copy as it died is copied by hand, never as the card it is in the graveyard (ruling 2021-04-16: as it last existed on the battlefield; fail closed)', () => {
    const CLONE = card('Test Mimic', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', { cost: '{0}', pt: ['0', '0'], colors: ['U'] });
    const s0 = mpScenario({ defs: [HOFRI, BRUTE, KILL, CLONE], zones: { p1: { hand: ['Test Mimic', 'Test Smite'], battlefield: ['Test Ghost Smith', 'Test Hill Brute'] }, p2: {}, p3: {}, p4: {} }, setup: settled });
    const brute = find(s0, 'Test Hill Brute', 'battlefield', 'p1');
    let s = cast(s0, 'Test Mimic', { yes: [true], objects: [[brute]] });
    const mimic = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Mimic')!;
    expect(getChars(s, mimic).name).toBe('Test Hill Brute');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') }), { targets: [[obj(mimic)]] }));
    // no token copy of the Mimic CARD was made (that would be a 0/0 asking to copy again): the copy was left to the players
    expect(tokensOf(s, 'p1').filter((t) => getChars(s, t).name === 'Test Mimic').length).toBe(0);
  });
});

// ---- Split Decision ---------------------------------------------------------------------------------------------------------------------------------------------------
const SPLIT = card('Test Council Verdict', 'Instant', 'Will of the council — Choose target instant or sorcery spell. Starting with you, each player votes for denial or duplication. If denial gets more votes, counter the spell. If duplication gets more votes or the vote is tied, copy the spell. You may choose new targets for the copy.', { cost: '{0}', colors: ['U'] });
const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to target player.', { cost: '{0}', colors: ['R'] });

describe('CR 701.38a, 701.6a, 707.10, 707.10c, 608.2c: Split Decision, "each player votes for denial or duplication. If denial gets more votes, counter the spell. If duplication gets more votes or the vote is tied, copy the spell."', () => {
  it('is automated', () => expect(full(SPLIT)).toBe(true));
  const start = (): { s: GameState; bolt: ObjectId } => {
    const s0 = mpScenario({ defs: [SPLIT, BOLT], zones: { p1: { hand: ['Test Spark', 'Test Council Verdict'] }, p2: {}, p3: {}, p4: {} } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p3' } as TargetChoice]] });
    const bolt = s.zones.stack.find((id) => s.objects[id]!.defId === 'Test Spark')!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Council Verdict', 'hand', 'p1') }), { targets: [[obj(bolt)]] });
    return { s, bolt };
  };
  it('denial gets more votes (3 to 1): the spell is countered, no copy; every player votes, starting with you (ruling 2014-05-29)', () => {
    const { s: s1 } = start();
    const seen: NonNullable<Script['seen']> = [];
    const s = settle(s1, { seen, labels: ['denial', 'denial', 'duplication', 'denial'] });
    expect(seen.filter((x) => x.kind === 'chooseOption').map((x) => x.player)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(life(s, 'p3')).toBe(20);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Spark')).toBe(true);
  });
  it('a tie (2 to 2) copies the spell, never counters it (the two results exclude each other: "the spell" is the target, not a countered card); you may choose new targets for the copy', () => {
    const { s: s1 } = start();
    const s = settle(s1, { labels: ['duplication', 'denial', 'duplication', 'denial'], yes: [true], targets: [[{ kind: 'player', id: 'p4' } as TargetChoice]] });
    expect(life(s, 'p3')).toBe(17); // the original
    expect(life(s, 'p4')).toBe(17); // the copy, retargeted
  });
  it('duplication gets more votes and the copy keeps its target when you choose none (3 to 1)', () => {
    const { s: s1 } = start();
    const s = settle(s1, { labels: ['duplication', 'duplication', 'denial', 'duplication'], yes: [false] });
    expect(life(s, 'p3')).toBe(14);
  });
});

// ---- Vesuvan Shapeshifter ---------------------------------------------------------------------------------------------------------------------------------------------
const VESUVAN = card('Test Shifting Mimic', 'Creature — Shapeshifter', 'As this creature enters or is turned face up, you may choose another creature on the battlefield. If you do, until this creature is turned face down, it becomes a copy of that creature, except it has "At the beginning of your upkeep, you may turn this creature face down."\nMorph {1}{U}', { cost: '{0}', pt: ['0', '0'], colors: ['U'] });

describe('CR 614.1c, 614.1e, 708.8, 707.2, 611.2a, 610.3, 702.37e: Vesuvan Shapeshifter, "As this creature enters or is turned face up, you may choose another creature ... until this creature is turned face down, it becomes a copy of that creature, except it has ..."', () => {
  it('is automated', () => expect(full(VESUVAN)).toBe(true));
  const islands = ['Island', 'Island', 'Island'];
  it('it enters as a copy of the chosen creature (its enters ability triggers, ruling 2021-03-19) with the upkeep ability; at your upkeep you may turn it face down (the copy ends); turned face up by morph it copies another chosen creature (no enters ability then)', () => {
    const s0 = mpScenario({ cards: ['Island'], defs: [VESUVAN, HERALD, BRUTE], zones: { p1: { hand: ['Test Shifting Mimic'], battlefield: ['Test Herald Ogre', ...islands] }, p2: { battlefield: ['Test Hill Brute'] }, p3: {}, p4: {} }, setup: settled });
    const ogre = find(s0, 'Test Herald Ogre', 'battlefield', 'p1');
    const brute = find(s0, 'Test Hill Brute', 'battlefield', 'p2');
    const before = life(s0, 'p1');
    let s = cast(s0, 'Test Shifting Mimic', { objects: [[ogre]] });
    const me = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Shifting Mimic')!;
    expect(getChars(s, me).name).toBe('Test Herald Ogre');
    expect(life(s, 'p1')).toBe(before + 2);
    expect(JSON.stringify(getChars(s, me).abilities).includes('turn ~ face down') || JSON.stringify(getChars(s, me).abilities).toLowerCase().includes('face down')).toBe(true);
    // to p1's next upkeep: the granted trigger asks; p1 turns it face down: a 2/2 face-down creature, the copy effect over
    s = until(s, (x) => x.turn.number > 1 && x.turn.activePlayer === 'p1' && x.pending?.kind === 'yesNo', {});
    s = drive(s, { yes: [true] });
    s = settle(s);
    expect(s.objects[me]!.faceDown).toBe(true);
    expect([getChars(s, me).power, getChars(s, me).toughness]).toEqual(['2', '2']);
    // to the main phase, then turn it face up by its morph cost: it becomes a copy of the creature chosen now; no enters ability (no zone change)
    s = until(s, (x) => x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    for (const id of s.zones.battlefield) if (s.objects[id]!.controller === 'p1') s.objects[id]!.tapped = false;
    const mid = life(s, 'p1');
    s = settle(drive(act(s, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: me, via: 'morph' }), { objects: [[brute]] }));
    expect(s.objects[me]!.faceDown).toBe(false);
    expect(getChars(s, me).name).toBe('Test Hill Brute');
    expect(life(s, 'p1')).toBe(mid);
  });
  it('turned face up choosing nothing ("If you do" not met): no copy effect at all, nothing left to apply by hand; the entering copy ended when it was turned face down (it is a 0/0 that dies)', () => {
    const s0 = mpScenario({ cards: ['Island'], defs: [VESUVAN, HERALD], zones: { p1: { hand: ['Test Shifting Mimic'], battlefield: ['Test Herald Ogre', 'Island', 'Island', 'Island'] }, p2: {}, p3: {}, p4: {} }, setup: settled });
    const ogre = find(s0, 'Test Herald Ogre', 'battlefield', 'p1');
    let s = cast(s0, 'Test Shifting Mimic', { objects: [[ogre]] });
    const me = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Shifting Mimic')!;
    s = until(s, (x) => x.turn.number > 1 && x.turn.activePlayer === 'p1' && x.pending?.kind === 'yesNo', {});
    s = settle(drive(s, { yes: [true] }));
    s = until(s, (x) => x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    for (const id of s.zones.battlefield) if (s.objects[id]!.controller === 'p1') s.objects[id]!.tapped = false;
    const logAt = s.log.length;
    const effects = s.continuousEffects.length;
    s = settle(drive(act(s, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: me, via: 'morph' }), { objects: [[]] }));
    expect(s.log.slice(logAt).filter((e) => e.level === 'manual')).toEqual([]);
    expect(s.continuousEffects.length).toBeLessThanOrEqual(effects);
    expect(s.zones.battlefield.includes(me)).toBe(false);
  });
  it('the negative case: choosing nothing, it enters as itself (a 0/0 Shapeshifter that dies, CR 704.5f)', () => {
    const s0 = mpScenario({ defs: [VESUVAN, HERALD], zones: { p1: { hand: ['Test Shifting Mimic'], battlefield: ['Test Herald Ogre'] }, p2: {}, p3: {}, p4: {} }, setup: settled });
    const s = cast(s0, 'Test Shifting Mimic', { objects: [[]] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Shifting Mimic')).toBe(false);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Shifting Mimic')).toBe(true);
  });
});

// ---- Spelltwine -------------------------------------------------------------------------------------------------------------------------------------------------------
const TWINE = card('Test Twin Spell', 'Sorcery', "Exile target instant or sorcery card from your graveyard and target instant or sorcery card from an opponent's graveyard. Copy those cards. Cast the copies if able without paying their mana costs. Exile this card.", { cost: '{0}', colors: ['U'] });
const DIVINE = card('Test Insight', 'Sorcery', 'Draw two cards.', { cost: '{2}{U}', colors: ['U'] });

describe('CR 707.12, 601.2, 608.2c, 608.2b: Spelltwine, "Exile target ... card from your graveyard and target ... card from an opponent\'s graveyard. Copy those cards. Cast the copies if able without paying their mana costs. Exile ~."', () => {
  it('is automated', () => expect(full(TWINE)).toBe(true));
  const setup = (): GameState => mpScenario({ defs: [TWINE, DIVINE, BOLT], zones: { p1: { hand: ['Test Twin Spell'], graveyard: ['Test Insight'] }, p2: { graveyard: ['Test Spark'] }, p3: {}, p4: {} } });
  it('both cards are exiled and stay exiled; both copies are cast for free (the Spark copy\'s target chosen as it is cast) and resolve; Spelltwine is exiled (rulings 2012-07-01)', () => {
    const s0 = setup();
    const insight = find(s0, 'Test Insight', 'graveyard', 'p1');
    const spark = find(s0, 'Test Spark', 'graveyard', 'p2');
    const hand = s0.zones.hand['p1']!.length;
    const s = cast(s0, 'Test Twin Spell', { targets: [[obj(insight)], [obj(spark)], [{ kind: 'player', id: 'p3' } as TargetChoice]] });
    expect(life(s, 'p3')).toBe(17);
    expect(s.zones.hand['p1']!.length).toBe(hand - 1 + 2);
    const exiled = s.zones.exile.map((id) => s.objects[id]!.defId);
    expect(exiled).toEqual(expect.arrayContaining(['Test Insight', 'Test Spark', 'Test Twin Spell']));
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Insight')).toBe(false);
    expect(s.zones.stack.length).toBe(0);
  });
  it('one target gone (illegal) as it resolves: the remaining legal target is still exiled, copied and cast (ruling 2012-07-01)', () => {
    const s0 = setup();
    const insight = find(s0, 'Test Insight', 'graveyard', 'p1');
    const spark = find(s0, 'Test Spark', 'graveyard', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Twin Spell', 'hand', 'p1') }), { targets: [[obj(insight)], [obj(spark)]] });
    // the Spark leaves the graveyard before Spelltwine resolves
    const t = structuredClone(s);
    t.zones.graveyard['p2'] = t.zones.graveyard['p2']!.filter((id) => id !== spark);
    t.zones.exile.push(spark);
    t.objects[spark]!.zone = 'exile';
    const hand = t.zones.hand['p1']!.length;
    s = settle(t);
    expect(s.zones.hand['p1']!.length).toBe(hand + 2);
    expect(life(s, 'p3')).toBe(20);
  });
});

// ---- Jaya's Phoenix ---------------------------------------------------------------------------------------------------------------------------------------------------
const PHOENIX = card('Test Ember Phoenix', 'Creature — Phoenix', 'Flying, haste\nWhenever this creature deals combat damage to a player or planeswalker, copy the next loyalty ability you activate this turn when you activate it. You may choose new targets for the copy.\nWhenever you cast a planeswalker spell, you may return this card from your graveyard to the battlefield.', { cost: '{4}{R}', pt: ['2', '2'], colors: ['R'] });
const WALKER = card('Test Sage Walker', 'Legendary Planeswalker — Jace', '+1: You gain 2 life.', { cost: '{0}', loyalty: '3', colors: ['U'] });
const WALKER2 = card('Test Other Walker', 'Legendary Planeswalker — Chandra', '+1: You gain 1 life.', { cost: '{0}', loyalty: '3', colors: ['R'] });

describe('CR 603.7b, 606.3, 707.10, 510.2: Jaya\'s Phoenix, "copy the next loyalty ability you activate this turn when you activate it"', () => {
  it('is automated', () => expect(full(PHOENIX)).toBe(true));
  const loyaltyOf = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;
  const activateWalker = (s: GameState, id: ObjectId): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.action.type === 'activate' && x.action.source === id);
    if (!a) throw new Error('no loyalty ability to activate');
    return settle(drive(act(s, a.action), { yes: [false] }), { yes: [false] });
  };
  const start = (): GameState => mpScenario({ defs: [PHOENIX, WALKER, WALKER2, SPIDER_PINGER, BEAR2], zones: { p1: { battlefield: ['Test Ember Phoenix', 'Test Sage Walker', 'Test Other Walker', 'Test Web Spitter'] }, p2: { battlefield: ['Test Grizzly'] }, p3: {}, p4: {} }, setup: (x) => { settled(x); for (const id of x.zones.battlefield) if (x.objects[id]!.defId.includes('Walker')) x.objects[id]!.counters['loyalty'] = 3; } });
  it('after its combat damage, the NEXT loyalty ability you activate this turn is copied (the copy resolves too, no loyalty counter for it, ruling 2023-07-28); a tap ability before it does not use it up; a second loyalty ability that turn is not copied (once)', () => {
    const s0 = start();
    const phoenix = find(s0, 'Test Ember Phoenix', 'battlefield', 'p1');
    const sage = find(s0, 'Test Sage Walker', 'battlefield', 'p1');
    const other = find(s0, 'Test Other Walker', 'battlefield', 'p1');
    const spitter = find(s0, 'Test Web Spitter', 'battlefield', 'p1');
    const grizzly = find(s0, 'Test Grizzly', 'battlefield', 'p2');
    let s = until(s0, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.pending.player === 'p1', { attackers: [phoenix], defender: 'p2' });
    expect(life(s, 'p2')).toBe(18);
    s = activate(s, spitter, { targets: [[obj(grizzly)]] });
    const l0 = life(s, 'p1');
    s = activateWalker(s, sage);
    expect(life(s, 'p1')).toBe(l0 + 4);
    expect(loyaltyOf(s, sage)).toBe(4);
    s = activateWalker(s, other);
    expect(life(s, 'p1')).toBe(l0 + 5);
  });
  it('the negative case: with no combat damage dealt, a loyalty ability is not copied', () => {
    const s0 = start();
    const sage = find(s0, 'Test Sage Walker', 'battlefield', 'p1');
    const l0 = life(s0, 'p1');
    const s = activateWalker(s0, sage);
    expect(life(s, 'p1')).toBe(l0 + 2);
  });
});

// ---- Volo, Guide to Monsters ------------------------------------------------------------------------------------------------------------------------------------------
const VOLO = card('Test Monster Scholar', 'Legendary Creature — Human Wizard', "Whenever you cast a creature spell that doesn't share a creature type with a creature you control or a creature card in your graveyard, copy that spell.", { cost: '{2}{G}{U}', pt: ['3', '2'], colors: ['G', 'U'] });
const DRAKE = card('Test Sky Drake', 'Creature — Drake', 'Flying', { cost: '{0}', pt: ['2', '2'], colors: ['U'] });
const CUB2 = card('Test Cub', 'Creature — Bear', '', { cost: '{0}', pt: ['1', '1'], colors: ['G'] });
const ELF = card('Test Elf Scout', 'Creature — Elf Scout', '', { cost: '{0}', pt: ['1', '1'], colors: ['G'] });
const APPRENTICE = card('Test Apprentice', 'Creature — Human', '', { cost: '{0}', pt: ['1', '1'], colors: ['U'] });
const MORPHLING = card('Test Shapeling', 'Creature — Shapeshifter', 'Changeling', { cost: '{0}', pt: ['1', '1'], colors: ['U'] });

describe('CR 205.3m, 702.73a, 707.10, 707.10f, 601.2i: Volo, "Whenever you cast a creature spell that doesn\'t share a creature type with a creature you control or a creature card in your graveyard, copy that spell."', () => {
  it('is automated', () => expect(full(VOLO)).toBe(true));
  const setup = (): GameState => mpScenario({
    defs: [VOLO, DRAKE, CUB2, ELF, APPRENTICE, MORPHLING, BEAR2],
    zones: { p1: { hand: ['Test Sky Drake', 'Test Cub', 'Test Elf Scout', 'Test Apprentice', 'Test Shapeling'], battlefield: ['Test Monster Scholar', 'Test Grizzly'], graveyard: ['Test Elf Scout'] }, p2: { battlefield: ['Test Sky Drake'] }, p3: {}, p4: {} },
    setup: settled,
  });
  const count = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id).name === name).length;
  it('a Drake (no Drake you control, none in your graveyard; an opponent\'s Drake does not count) is copied: two Drakes, one a token (CR 707.10f)', () => {
    const s = cast(setup(), 'Test Sky Drake');
    expect(count(s, 'Test Sky Drake')).toBe(2);
    expect(tokensOf(s, 'p1').length).toBe(1);
  });
  it('the negative cases: a Bear (a Bear you control), an Elf (an Elf card in your graveyard), a Human (Volo himself is a Human you control) and a changeling (every creature type) are not copied', () => {
    let s = setup();
    for (const n of ['Test Cub', 'Test Elf Scout', 'Test Apprentice', 'Test Shapeling']) { s = cast(s, n); expect([n, tokensOf(s, 'p1').length]).toEqual([n, 0]); }
    expect(tokensOf(s, 'p1').length).toBe(0);
    expect(count(s, 'Test Cub') + count(s, 'Test Elf Scout') + count(s, 'Test Apprentice') + count(s, 'Test Shapeling')).toBe(4);
  });
});

// ---- Tempt with Reflections -------------------------------------------------------------------------------------------------------------------------------------------
const TEMPT = card('Test Mirror Offer', 'Sorcery', "Tempting offer — Choose target creature you control. Create a token that's a copy of that creature. Each opponent may create a token that's a copy of that creature. For each opponent who does, create a token that's a copy of that creature.", { cost: '{0}', colors: ['U'] });

describe('CR 101.4, 608.2d, 707.2, 111.1, 608.2c: Tempt with Reflections, a tempting offer of token copies', () => {
  it('is automated', () => expect(full(TEMPT)).toBe(true));
  it('you get one copy; each opponent in turn order may take one (asked p2, p3, p4: ruling 2013-10-17); you get one more for each who did (2 accept: 3 for you); the enters abilities of every copy trigger', () => {
    const s0 = mpScenario({ defs: [TEMPT, HERALD], zones: { p1: { hand: ['Test Mirror Offer'], battlefield: ['Test Herald Ogre'] }, p2: {}, p3: {}, p4: {} } });
    const ogre = find(s0, 'Test Herald Ogre', 'battlefield', 'p1');
    const seen: NonNullable<Script['seen']> = [];
    const s = cast(s0, 'Test Mirror Offer', { seen, targets: [[obj(ogre)]], yes: [true, false, true] });
    expect(seen.filter((x) => x.kind === 'yesNo').map((x) => x.player)).toEqual(['p2', 'p3', 'p4']);
    expect(tokensOf(s, 'p1').length).toBe(3);
    expect(tokensOf(s, 'p2').length).toBe(1);
    expect(tokensOf(s, 'p3').length).toBe(0);
    expect(tokensOf(s, 'p4').length).toBe(1);
    for (const t of [...tokensOf(s, 'p1'), ...tokensOf(s, 'p2')]) expect(getChars(s, t).name).toBe('Test Herald Ogre');
    expect([life(s, 'p1'), life(s, 'p2'), life(s, 'p3'), life(s, 'p4')]).toEqual([life(s0, 'p1') + 6, life(s0, 'p2') + 2, life(s0, 'p3'), life(s0, 'p4') + 2]);
  });
  it('the negative case: nobody accepts, you get exactly one copy', () => {
    const s0 = mpScenario({ defs: [TEMPT, HERALD], zones: { p1: { hand: ['Test Mirror Offer'], battlefield: ['Test Herald Ogre'] }, p2: {}, p3: {}, p4: {} } });
    const ogre = find(s0, 'Test Herald Ogre', 'battlefield', 'p1');
    const s = cast(s0, 'Test Mirror Offer', { targets: [[obj(ogre)]], yes: [false, false, false] });
    expect(tokensOf(s, 'p1').length).toBe(1);
    expect(['p2', 'p3', 'p4'].every((p) => tokensOf(s, p as PlayerId).length === 0)).toBe(true);
  });
});
