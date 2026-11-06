/**
 * edh-next-122 (must-finish round, group copies): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative cases and the Scryfall rulings.
 *
 *   CR 601.2i, 603.2, 113.6k, 707.2, 707.9b, 613.4b, 105.2c, 205.1a   Benthic Anomaly's cast trigger (per-opponent choice, token copy with total power and toughness)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

// ---- shared driver ---------------------------------------------------------------------------------------------------------------------------------------------------
interface Script { yes?: boolean[]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; targets?: TargetChoice[][]; numbers?: number[]; options?: string[][]; seen?: { kind: string; player: PlayerId; options?: ObjectId[] }[] }
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
/** Pass priority once around (every player), driving decisions: the top object of the stack resolves. */
function resolveTop(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  const n = s.zones.stack.length;
  for (let guard = 0; s.zones.stack.length >= n && n > 0 && s.pending?.kind === 'priority' && guard < 8; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token');

// ---- Benthic Anomaly -------------------------------------------------------------------------------------------------------------------------------------------------
const ANOMALY = card('Test Deep Oddity', 'Creature — Eldrazi Serpent', "Devoid\nWhen you cast this spell, for each opponent, choose a creature that player controls. Create a token that's a copy of one of those creatures, except its power is equal to the total power of those creatures, its toughness is equal to the total toughness of those creatures, and it's a colorless Eldrazi creature.", { cost: '{0}', pt: ['5', '6'], colors: ['U'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', pt: ['2', '2'], colors: ['G'] });
const KNIGHT = card('Test Snow Knight', 'Legendary Snow Creature — Human Knight', 'First strike', { cost: '{W}{W}', pt: ['3', '1'], colors: ['W'] });
const ELK = card('Test Elk', 'Creature — Elk', '', { cost: '{3}{G}', pt: ['4', '5'], colors: ['G'] });
const ANTHEM = card('Test Banner', 'Enchantment', 'Creatures you control get +1/+1.');

describe('CR 601.2i, 603.2, 113.6k, 707.2, 707.9b, 613.4b, 105.2c: Benthic Anomaly, "for each opponent, choose a creature that player controls. Create a token that\'s a copy of one of those creatures, except ..."', () => {
  const setup = (): GameState => mpScenario({
    defs: [ANOMALY, BEAR, KNIGHT, ELK, ANTHEM],
    zones: { p1: { hand: ['Test Deep Oddity'], battlefield: ['Test Elk'] }, p2: { battlefield: ['Test Bear', 'Test Elk'] }, p3: { battlefield: ['Test Snow Knight'] }, p4: { battlefield: ['Test Bear', 'Test Banner'] } },
  });
  it('is automated', () => expect(full(ANOMALY)).toBe(true));
  it('the caster chooses one creature of EACH opponent (never their own), then which one to copy; the token is the copy with the total power and toughness (current values: the +1/+1 counts), colorless, an Eldrazi creature only, legendary and snow kept (ruling 2024-06-07)', () => {
    const s0 = setup();
    const p2Elk = find(s0, 'Test Elk', 'battlefield', 'p2');
    const knight = find(s0, 'Test Snow Knight', 'battlefield', 'p3');
    const p4Bear = find(s0, 'Test Bear', 'battlefield', 'p4');
    const myElk = find(s0, 'Test Elk', 'battlefield', 'p1');
    const seen: NonNullable<Script['seen']> = [];
    const s = cast(s0, 'Test Deep Oddity', { seen, objects: [[p2Elk], [knight], [p4Bear], (opts) => { expect(new Set(opts)).toEqual(new Set([p2Elk, knight, p4Bear])); return [knight]; }] });
    const choices = seen.filter((x) => x.kind === 'chooseObjects');
    expect(choices.every((c) => c.player === 'p1')).toBe(true);
    expect(choices.some((c) => (c.options ?? []).includes(myElk))).toBe(false);
    const toks = tokensOf(s, 'p1');
    expect(toks.length).toBe(1);
    const ch = getChars(s, toks[0]!);
    expect(ch.name).toBe('Test Snow Knight');
    // 4 (Elk) + 3 (Knight) + 3 (Bear with the Banner's +1/+1) = 10; 5 + 1 + 3 = 9
    expect(ch.power).toBe('10');
    expect(ch.toughness).toBe('9');
    expect(ch.colors).toEqual([]);
    expect(ch.types).toEqual(['Creature']);
    expect(ch.subtypes).toEqual(['Eldrazi']);
    expect([...ch.supertypes].sort()).toEqual(['Legendary', 'Snow']);
    expect(JSON.stringify(ch.abilities ?? []).toLowerCase().includes('first strike')).toBe(true);
    // the Anomaly itself resolved too (the trigger resolved first, ruling 2024-06-07)
    expect(onBf(s, 'Test Deep Oddity').length).toBe(1);
  });
  it('an opponent with no creature adds nothing; with every opponent creatureless no token is made (the negative case)', () => {
    const s0 = mpScenario({ defs: [ANOMALY, BEAR], zones: { p1: { hand: ['Test Deep Oddity'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: {}, p4: {} } });
    const s = cast(s0, 'Test Deep Oddity');
    const toks = tokensOf(s, 'p1');
    expect(toks.length).toBe(1);
    expect(getChars(s, toks[0]!).power).toBe('2');
    expect(getChars(s, toks[0]!).toughness).toBe('2');
    const none = cast(mpScenario({ defs: [ANOMALY, BEAR], zones: { p1: { hand: ['Test Deep Oddity'], battlefield: ['Test Bear'] }, p2: {}, p3: {}, p4: {} } }), 'Test Deep Oddity');
    expect(tokensOf(none, 'p1').length).toBe(0);
  });
  it('the trigger still resolves when the spell is countered in response (ruling 2024-06-07): it functions on the stack and does not name the spell', () => {
    const COUNTER = card('Test Denial', 'Instant', 'Counter target spell.', { cost: '{0}' });
    const s0 = mpScenario({ defs: [ANOMALY, BEAR, COUNTER], zones: { p1: { hand: ['Test Deep Oddity', 'Test Denial'] }, p2: { battlefield: ['Test Bear'] }, p3: {}, p4: {} } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Deep Oddity', 'hand', 'p1') }));
    const spell = s.zones.stack.find((id) => s.objects[id]?.defId === 'Test Deep Oddity');
    expect(spell).toBeDefined();
    expect(s.zones.stack.length).toBe(2); // the spell and its cast trigger above it
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Denial', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: spell! } as TargetChoice]] });
    s = settle(s);
    expect(onBf(s, 'Test Deep Oddity').length).toBe(0);
    expect(tokensOf(s, 'p1').length).toBe(1);
  });
});

// ---- Mystic Reflection ------------------------------------------------------------------------------------------------------------------------------------------------
const REFLECT = card('Test Mirror Trick', 'Instant', 'Choose target nonlegendary creature. The next time one or more creatures or planeswalkers enter this turn, they enter as copies of the chosen creature.', { cost: '{0}' });
const TWINS = card('Test Twin Call', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.', { cost: '{0}' });
const KILL = card('Test Smite', 'Instant', 'Destroy target creature.', { cost: '{0}' });
const TRINKET = card('Test Trinket', 'Artifact', '{T}: You gain 1 life.', { cost: '{0}' });
const CUB = card('Test Cub', 'Creature — Bear', '', { cost: '{0}', pt: ['1', '1'], colors: ['G'] });
const ELK0 = card('Test Big Elk', 'Creature — Elk', 'Trample', { cost: '{0}', pt: ['4', '5'], colors: ['G'] });
const LEGEND = card('Test Lone Hero', 'Legendary Creature — Human', '', { cost: '{0}', pt: ['2', '2'] });
const tgt = (id: ObjectId): TargetChoice[][] => [[{ kind: 'object', id } as TargetChoice]];
const namesOn = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => getChars(s, id).name ?? '').sort();

describe('CR 614.1c, 616.1, 707.2, 608.2h, 611.2a: Mystic Reflection, "The next time one or more creatures or planeswalkers enter this turn, they enter as copies of the chosen creature."', () => {
  const setup = (extra: Partial<Record<PlayerId, { hand?: string[]; battlefield?: string[] }>> = {}): GameState => mpScenario({
    defs: [REFLECT, TWINS, KILL, TRINKET, CUB, ELK0, LEGEND],
    zones: { p1: { hand: ['Test Mirror Trick', 'Test Cub', 'Test Cub', 'Test Twin Call', 'Test Smite', 'Test Trinket', ...(extra.p1?.hand ?? [])] }, p2: { battlefield: ['Test Big Elk', 'Test Lone Hero'], hand: ['Test Cub'] }, p3: {}, p4: {} },
  });
  it('is automated', () => expect(full(REFLECT)).toBe(true));
  it('targets a nonlegendary creature only (a legendary one is no legal target)', () => {
    const s0 = setup();
    const hero = find(s0, 'Test Lone Hero', 'battlefield', 'p2');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mirror Trick', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    const legalIds = JSON.stringify(s.pending);
    expect(legalIds).toContain(find(s0, 'Test Big Elk', 'battlefield', 'p2'));
    expect(legalIds).not.toContain(hero);
    s = s; // nothing else
  });
  it('the next creature to enter (any player\'s) enters as a copy of the chosen creature; the one after enters as itself; a noncreature entering first does not use it up', () => {
    const s0 = setup();
    const elk = find(s0, 'Test Big Elk', 'battlefield', 'p2');
    let s = cast(s0, 'Test Mirror Trick', { targets: tgt(elk) });
    s = cast(s, 'Test Trinket');
    expect(namesOn(s, 'p1')).toEqual(['Test Trinket']);
    s = cast(s, 'Test Cub');
    expect(namesOn(s, 'p1')).toEqual(['Test Big Elk', 'Test Trinket']);
    const copy = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.defId === 'Test Cub')!;
    expect(getChars(s, copy).power).toBe('4');
    s = cast(s, 'Test Cub');
    expect(namesOn(s, 'p1')).toEqual(['Test Big Elk', 'Test Cub', 'Test Trinket']);
  });
  it('one or more entering TOGETHER all enter as copies (two tokens of one instruction), and only that once (ruling: the next time)', () => {
    const s0 = setup();
    const elk = find(s0, 'Test Big Elk', 'battlefield', 'p2');
    let s = cast(s0, 'Test Mirror Trick', { targets: tgt(elk) });
    s = cast(s, 'Test Twin Call');
    expect(namesOn(s, 'p1')).toEqual(['Test Big Elk', 'Test Big Elk']);
    s = cast(s, 'Test Cub');
    expect(namesOn(s, 'p1')).toEqual(['Test Big Elk', 'Test Big Elk', 'Test Cub']);
    expect(s.continuousEffects.some((r) => r.effect.s === 'replace' && (r.effect as { shield?: { batch?: true } }).shield?.batch === true)).toBe(false);
  });
  it('review: creatures entering during one resolution from separate events all enter as copies ("each player creates", two kinds of tokens), and the shield ends with that resolution', () => {
    const EACH = card('Test Muster All', 'Sorcery', 'Each player creates a 1/1 white Soldier creature token.', { cost: '{0}' });
    const PAIR = card('Test Odd Pair', 'Sorcery', 'Create a 1/1 white Soldier creature token and a 2/2 black Zombie creature token.', { cost: '{0}' });
    const s0 = mpScenario({ defs: [REFLECT, EACH, PAIR, CUB, ELK0], zones: { p1: { hand: ['Test Mirror Trick', 'Test Muster All', 'Test Odd Pair', 'Test Cub'] }, p2: { battlefield: ['Test Big Elk'] }, p3: {}, p4: {} } });
    const elk = find(s0, 'Test Big Elk', 'battlefield', 'p2');
    let s = cast(s0, 'Test Mirror Trick', { targets: tgt(elk) });
    s = cast(s, 'Test Muster All');
    for (const p of ['p1', 'p3', 'p4'] as PlayerId[]) expect(namesOn(s, p)).toEqual(['Test Big Elk']);
    expect(namesOn(s, 'p2')).toEqual(['Test Big Elk', 'Test Big Elk']);
    s = cast(s, 'Test Odd Pair');
    expect(namesOn(s, 'p1').filter((n) => n !== 'Test Big Elk').sort()).toEqual(['Soldier Token', 'Zombie Token']);
    const u0 = mpScenario({ defs: [REFLECT, PAIR, ELK0], zones: { p1: { hand: ['Test Mirror Trick', 'Test Odd Pair'] }, p2: { battlefield: ['Test Big Elk'] }, p3: {}, p4: {} } });
    const t0 = cast(u0, 'Test Mirror Trick', { targets: tgt(find(u0, 'Test Big Elk', 'battlefield', 'p2')) });
    const t = cast(t0, 'Test Odd Pair');
    expect(namesOn(t, 'p1')).toEqual(['Test Big Elk', 'Test Big Elk']);
  });
  it('review (CR 608.2c): instructions done one after the other in one resolution are not "the next time" twice: only the first group becomes copies', () => {
    const SEQ1 = card('Test Raise Then', 'Sorcery', 'Create a 1/1 white Soldier creature token. Then return target creature card from your graveyard to the battlefield.', { cost: '{0}' });
    const SEQ2 = card('Test Make Then', 'Sorcery', 'Create a 1/1 white Soldier creature token, then create a 2/2 black Zombie creature token.', { cost: '{0}' });
    const SEQ3 = card('Test Return First', 'Sorcery', 'Return target creature card from your graveyard to the battlefield. Create a 1/1 white Soldier creature token.', { cost: '{0}' });
    const run = (spell: CardDef, script: (s: GameState) => Script): string[] => {
      const s0 = mpScenario({ defs: [REFLECT, spell, CUB, ELK0], zones: { p1: { hand: ['Test Mirror Trick', spell.name], graveyard: ['Test Cub'] }, p2: { battlefield: ['Test Big Elk'] }, p3: {}, p4: {} } });
      const s1 = cast(s0, 'Test Mirror Trick', { targets: tgt(find(s0, 'Test Big Elk', 'battlefield', 'p2')) });
      return namesOn(cast(s1, spell.name, script(s1)), 'p1');
    };
    const cubTarget = (s: GameState): Script => ({ targets: tgt(find(s, 'Test Cub', 'graveyard', 'p1')) });
    expect(run(SEQ1, cubTarget)).toEqual(['Test Big Elk', 'Test Cub']);
    void SEQ2; // "create a token, then create another token": lowered as "create A and B" is (two createToken steps), read as one instruction: a known limit (one card in the index)
    expect(run(SEQ3, cubTarget)).toEqual(['Soldier Token', 'Test Big Elk']);
  });
  it('the chosen creature left the battlefield: the entering creature copies it as it last existed (ruling 2021-02-05)', () => {
    const s0 = setup();
    const elk = find(s0, 'Test Big Elk', 'battlefield', 'p2');
    let s = cast(s0, 'Test Mirror Trick', { targets: tgt(elk) });
    s = cast(s, 'Test Smite', { targets: tgt(elk) });
    expect(s.zones.battlefield).not.toContain(elk);
    s = cast(s, 'Test Cub');
    expect(namesOn(s, 'p1')).toEqual(['Test Big Elk']);
  });
  it('the chosen creature left the battlefield and two tokens enter together: both copy it as it last existed', () => {
    const s0 = setup();
    const elk = find(s0, 'Test Big Elk', 'battlefield', 'p2');
    let s = cast(s0, 'Test Mirror Trick', { targets: tgt(elk) });
    s = cast(s, 'Test Smite', { targets: tgt(elk) });
    s = cast(s, 'Test Twin Call');
    expect(namesOn(s, 'p1')).toEqual(['Test Big Elk', 'Test Big Elk']);
    expect(tokensOf(s, 'p1').every((id) => getChars(s, id).power === '4')).toBe(true);
  });
  it('the effect lasts this turn only: a creature entering next turn is itself (the negative case)', () => {
    const s0 = setup();
    const elk = find(s0, 'Test Big Elk', 'battlefield', 'p2');
    let s = cast(s0, 'Test Mirror Trick', { targets: tgt(elk) });
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'main 1 of p2');
    s = cast(s, 'Test Cub', {}, 'p2');
    expect(namesOn(s, 'p2')).toEqual(['Test Big Elk', 'Test Cub', 'Test Lone Hero']);
  });
});

// ---- Vizier of Many Faces ---------------------------------------------------------------------------------------------------------------------------------------------
const VIZIER = card('Test Face Vizier', 'Creature — Shapeshifter Cleric', "You may have this creature enter as a copy of any creature on the battlefield, except if this creature was embalmed, the token has no mana cost, it's white, and it's a Zombie in addition to its other types.\nEmbalm {1}", { cost: '{0}', pt: ['1', '1'], colors: ['U'] }); // 1/1 (the card is 0/0) so that the uncopied token survives to be looked at
const STAG = card('Test Green Stag', 'Creature — Elk', 'Vigilance', { cost: '{2}{G}', pt: ['3', '3'], colors: ['G'] });
const MIMIC = card('Test Mimic', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', { cost: '{0}', pt: ['0', '0'], colors: ['U'] });

describe('CR 707.5, 707.9b, 702.128a-b, 614.1c: Vizier of Many Faces, "... except if this creature was embalmed, the token has no mana cost, it\'s white, and it\'s a Zombie in addition to its other types."', () => {
  const setup = (zones: { hand?: string[]; graveyard?: string[] }): GameState => mpScenario({
    defs: [VIZIER, STAG, MIMIC],
    zones: { p1: { ...zones, battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Green Stag'] }, p3: {}, p4: {} },
  });
  const embalm = (s0: GameState, script: Script): GameState => {
    const card0 = s0.zones.graveyard.p1!.find((id) => s0.objects[id]!.defId === 'Test Face Vizier')!;
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object === card0);
    expect(a).toBeDefined();
    return settle(drive(act(s0, a!.action), script), script);
  };
  const p1Creatures = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id).types.includes('Creature'));
  it('is automated', () => expect(full(VIZIER)).toBe(true));
  it('cast from the hand: it copies the chosen creature exactly (its mana cost, its color, no Zombie): it was not embalmed (the negative case)', () => {
    const s0 = setup({ hand: ['Test Face Vizier'] });
    const stag = find(s0, 'Test Green Stag', 'battlefield', 'p2');
    const s = cast(s0, 'Test Face Vizier', { objects: [[stag]] });
    const [v] = p1Creatures(s);
    const ch = getChars(s, v!);
    expect(ch.name).toBe('Test Green Stag');
    expect(ch.colors).toEqual(['G']);
    expect(ch.subtypes).toEqual(['Elk']);
    expect(ch.manaValue).toBe(3);
    expect(s.objects[v!]!.kind).toBe('card');
  });
  it('embalmed: the token copies the chosen creature with no mana cost, white, and a Zombie in addition (ruling 2017-04-18: the copy\'s values are those exceptions)', () => {
    const s0 = setup({ graveyard: ['Test Face Vizier'] });
    const stag = find(s0, 'Test Green Stag', 'battlefield', 'p2');
    const s = embalm(s0, { objects: [[stag]] });
    const [v] = p1Creatures(s);
    expect(v).toBeDefined();
    expect(s.objects[v!]!.kind).toBe('token');
    expect(s.objects[v!]!.embalmed).toBe(true);
    const ch = getChars(s, v!);
    expect(ch.name).toBe('Test Green Stag');
    expect(ch.colors).toEqual(['W']);
    expect([...ch.subtypes].sort()).toEqual(['Elk', 'Zombie']);
    expect(ch.manaCost ?? null).toBe(null);
    expect(ch.manaValue).toBe(0);
    expect(ch.power).toBe('3');
  });
  it('embalmed and copying nothing: the token is the embalm copy of the card itself (white Zombie, no mana cost)', () => {
    const s0 = setup({ graveyard: ['Test Face Vizier'] });
    const s = embalm(s0, { objects: [[]] });
    const v = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token');
    expect(v).toBeDefined();
    const ch = getChars(s, v!);
    expect(ch.name).toBe('Test Face Vizier');
    expect(ch.colors).toEqual(['W']);
    expect(ch.subtypes).toContain('Zombie');
    expect(ch.manaValue).toBe(0);
  });
  it('the exceptions are copiable values: a clone of the embalmed copy is a white Zombie with no mana cost too (ruling 2017-04-18), and not a token', () => {
    const s0 = mpScenario({ defs: [VIZIER, STAG, MIMIC], zones: { p1: { graveyard: ['Test Face Vizier'], hand: ['Test Mimic'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Green Stag'] }, p3: {}, p4: {} } });
    const stag = find(s0, 'Test Green Stag', 'battlefield', 'p2');
    let s = embalm(s0, { objects: [[stag]] });
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token')!;
    s = cast(s, 'Test Mimic', { objects: [[tok]] });
    const m = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'card' && s.objects[id]!.defId === 'Test Mimic')!;
    const ch = getChars(s, m);
    expect(ch.name).toBe('Test Green Stag');
    expect(ch.colors).toEqual(['W']);
    expect([...ch.subtypes].sort()).toEqual(['Elk', 'Zombie']);
    expect(ch.manaValue).toBe(0);
  });
});

// ---- The Master, Multiplied ------------------------------------------------------------------------------------------------------------------------------------------
const MASTER = card('Test Many Masters', 'Legendary Creature — Time Lord Rogue', 'Myriad\nThe "legend rule" doesn\'t apply to creature tokens you control.\nTriggered abilities you control can\'t cause you to sacrifice or exile creature tokens you control.', { cost: '{0}', pt: ['4', '3'], colors: ['B'] });
const PLAIN_MYRIAD = card('Test Echo Raider', 'Creature — Human', 'Myriad', { cost: '{0}', pt: ['2', '2'] });
const TOLL = card('Test Toll Altar', 'Enchantment', 'Whenever you cast a spell, sacrifice a creature.', { cost: '{0}' });
const BANISH = card('Test Banish', 'Instant', 'Exile target creature.', { cost: '{0}' });
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', { cost: '{0}' });
const GOBLINS = card('Test Goblin Call', 'Sorcery', 'Create a 1/1 red Goblin creature token.', { cost: '{0}' });

describe('CR 701.21a, 406.1, 603.1, 702.116a, 101.2: The Master, Multiplied, "Triggered abilities you control can\'t cause you to sacrifice or exile creature tokens you control."', () => {
  const toCombat = (s0: GameState, attacker: ObjectId): GameState => {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers', 'the declaration of attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' }] });
    return drive(s, { yes: [true, true, true, true] });
  };
  const endOfTurn = (s0: GameState): GameState => {
    let s = s0;
    for (let g = 0; g < 200 && !(s.turn.step === 'end' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); g++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s, { yes: [true, true] });
    return s;
  };
  it('is automated', () => expect(full(MASTER)).toBe(true));
  it('myriad\'s tokens (legendary copies, the legend rule waived) are not exiled at end of combat: myriad\'s exile is a triggered ability you control (ruling 2023-10-13)', () => {
    const s0 = mpScenario({ defs: [MASTER], zones: { p1: { battlefield: ['Test Many Masters'] }, p2: {}, p3: {}, p4: {} } });
    const master = find(s0, 'Test Many Masters', 'battlefield', 'p1');
    let s = toCombat(s0, master);
    s = settle(s, { yes: [true, true, true, true] });
    expect(tokensOf(s, 'p1').length).toBe(2);
    expect(tokensOf(s, 'p1').every((id) => getChars(s, id).name === 'Test Many Masters')).toBe(true);
    s = endOfTurn(s);
    expect(tokensOf(s, 'p1').length).toBe(2); // still there after the end of combat
    expect(onBf(s, 'Test Many Masters').length).toBe(1); // the card itself (legend rule: the tokens are exempt, the card stays)
  });
  it('without the Master, the same myriad tokens are exiled at end of combat (the negative case)', () => {
    const s0 = mpScenario({ defs: [PLAIN_MYRIAD], zones: { p1: { battlefield: ['Test Echo Raider'] }, p2: {}, p3: {}, p4: {} } });
    let s = toCombat(s0, find(s0, 'Test Echo Raider', 'battlefield', 'p1'));
    s = settle(s, { yes: [true, true, true, true] });
    expect(tokensOf(s, 'p1').length).toBe(2);
    s = endOfTurn(s);
    expect(tokensOf(s, 'p1').length).toBe(0);
  });
  it('your own triggered ability can\'t make you sacrifice a creature token (only the nontoken creature is offered); a spell you control still exiles one; an opponent\'s triggered ability still makes you sacrifice one', () => {
    const OPP_TOLL = card('Test Grim Toll', 'Enchantment', 'Whenever you cast a spell, each opponent sacrifices a creature.', { cost: '{0}' });
    const setup = (): GameState => mpScenario({ defs: [MASTER, TOLL, OPP_TOLL, BANISH, SPARK, GOBLINS], zones: { p1: { battlefield: ['Test Many Masters'], hand: ['Test Goblin Call', 'Test Spark', 'Test Banish'] }, p2: { battlefield: ['Test Grim Toll'], hand: ['Test Spark'] }, p3: {}, p4: {} } });
    const master = (s: GameState): ObjectId => find(s, 'Test Many Masters', 'battlefield', 'p1');
    // (a) your own trigger ("Whenever you cast a spell, sacrifice a creature"): the Goblin token is not offered (it can't be sacrificed), the nontoken Master is
    const sa = mpScenario({ defs: [MASTER, TOLL, SPARK, GOBLINS, CUB], zones: { p1: { battlefield: ['Test Many Masters', 'Test Toll Altar', 'Test Cub'], hand: ['Test Goblin Call', 'Test Spark'] }, p2: {}, p3: {}, p4: {} } });
    let a = cast(sa, 'Test Goblin Call', { objects: [[find(sa, 'Test Cub', 'battlefield', 'p1')]] });
    const tok = tokensOf(a, 'p1')[0]!;
    expect(tok).toBeDefined();
    let offered: ObjectId[] = [];
    a = cast(a, 'Test Spark', { objects: [(opts) => { offered = [...opts]; return opts.includes(tok) ? [tok] : [opts[0]!]; }] });
    expect(offered).not.toContain(tok);
    expect(tokensOf(a, 'p1')).toEqual([tok]);
    expect(onBf(a, 'Test Many Masters').length).toBe(0);
    // (b) a spell you control exiles your token
    let c = cast(setup(), 'Test Goblin Call');
    const goblin = tokensOf(c, 'p1')[0]!;
    c = cast(c, 'Test Banish', { targets: tgt(goblin) });
    expect(tokensOf(c, 'p1')).toEqual([]);
    // (c) an opponent's triggered ability: p2 casts a spell, p1 sacrifices the Goblin token
    let d = cast(setup(), 'Test Goblin Call');
    const g2 = tokensOf(d, 'p1')[0]!;
    d = passUntil(d, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2', 'main 1 of p2');
    d = cast(d, 'Test Spark', { objects: [[g2]] }, 'p2');
    expect(tokensOf(d, 'p1')).toEqual([]);
    expect(d.zones.battlefield).toContain(master(d));
  });
  it('review (Tajuru Preserver ruling 2010-06-15 on the like wording): a creature token sacrificed to pay a mana ability\'s cost while your own trigger resolves is not caused by the trigger', () => {
    const SPAWNER = card('Test Spawn Maker', 'Sorcery', 'Create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this token: Add {C}."', { cost: '{0}' });
    const PAYER = card('Test Pay Rune', 'Enchantment', 'Whenever you cast a spell, you may pay {1}. If you do, draw a card.', { cost: '{0}' });
    const s1 = mpScenario({ defs: [MASTER, SPAWNER, PAYER, SPARK], zones: { p1: { battlefield: ['Test Many Masters'], hand: ['Test Spawn Maker', 'Test Spark', 'Test Pay Rune'] }, p2: {}, p3: {}, p4: {} } });
    let u = cast(s1, 'Test Spawn Maker');
    u = cast(u, 'Test Pay Rune');
    const handBefore = u.zones.hand.p1!.length;
    u = cast(u, 'Test Spark', { yes: [true] });
    expect(tokensOf(u, 'p1')).toEqual([]); // the Spawn paid the {1}
    expect(u.zones.hand.p1!.length).toBe(handBefore); // Spark left the hand, one card drawn
  });
});
