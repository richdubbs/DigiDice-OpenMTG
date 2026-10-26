/**
 * Lane pc-tokens, round pc-tokens-2 (Commander precon decks: tokens and copies), played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified.
 *
 *   CR 614.12, 707.2, 611.2     "As ~ enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste."
 *   CR 111.4, 201.2             "Create a 0/1 red Kobold creature token named Kobolds of <this card's name>."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], who: PlayerId) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: (p as { options: { id: string }[] }).options[0]!.id });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, p.player) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

const BEAR = card('Test Bear', 'Creature — Bear', 'Trample', { pt: ['2', '2'] });

describe('CR 614.12, 707.2, 611.2: "As ~ enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste."', () => {
  const MIRROR = card('Test Mirror', 'Artifact', 'As this artifact enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste.');
  const defs = [MIRROR, BEAR];
  it('is fully automated', () => expect(full(MIRROR)).toBe(true));
  it('accepted: it is a 2/2 Bear creature with trample and haste (not an artifact) this turn, and the artifact again after the turn ends', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mirror'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Mirror', { yes: true });
    const id = find(s, 'Test Mirror', 'battlefield', 'p1');
    const c = chars(s, id);
    expect(c.types).toContain('Creature');
    expect(c.types).not.toContain('Artifact');
    expect(c.subtypes).toContain('Bear');
    expect(c.power).toBe('2');
    expect(c.keywords.some((k) => k.keyword === 'haste')).toBe(true);
    expect(c.keywords.some((k) => k.keyword === 'trample')).toBe(true);
    s = advanceTo(s, 2, 'upkeep');
    const after = chars(s, id);
    expect(after.types).toContain('Artifact');
    expect(after.types).not.toContain('Creature');
    expect(after.keywords.some((k) => k.keyword === 'haste')).toBe(false);
  });
  it('declined: it stays the artifact', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mirror'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Mirror', { pick: () => [] }); // the choice of what to copy is optional: none chosen
    const c = chars(s, find(s, 'Test Mirror', 'battlefield', 'p1'));
    expect(c.types).toContain('Artifact');
    expect(c.types).not.toContain('Creature');
  });
  it('with no creature to copy it just enters as the artifact', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Mirror'] } });
    s = cast(s, 'Test Mirror', { yes: true });
    expect(chars(s, find(s, 'Test Mirror', 'battlefield', 'p1')).types).toContain('Artifact');
  });
});

describe('CR 111.4, 201.2: a token named after the card ("Kobolds of Kher Keep")', () => {
  const KEEP = card('Test Keep', 'Land', '{T}: Add {C}.\n{1}{R}, {T}: Create a 0/1 red Kobold creature token named Kobolds of Test Keep.');
  it('is fully automated', () => expect(full(KEEP)).toBe(true));
  it('activating it creates a 0/1 Kobold named Kobolds of Test Keep', () => {
    let s = scenario(['Mountain'], { defs: [KEEP], p1: { battlefield: ['Test Keep', 'Mountain', 'Mountain'] } });
    const keep = find(s, 'Test Keep', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: keep, ability: 'p:0:1' });
    s = resolveAll(s);
    const tok = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tok.length).toBe(1);
    expect(s.objects[tok[0]!]!.defId).toContain('Kobolds of Test Keep');
    expect(chars(s, tok[0]!).power).toBe('0');
    expect(chars(s, tok[0]!).toughness).toBe('1');
    void findAll;
  });
});

describe('CR 614.1a, 614.5, 111.10: "If you would create a Clue, Food, or Treasure token, instead create one of each."', () => {
  const MANUFACTOR = card('Test Manufactor', 'Creature — Gnome', 'If you would create a Clue, Food, or Treasure token, instead create one of each.', { pt: ['3', '3'] });
  const GOLD = card('Test Gold', 'Sorcery', 'Create a Treasure token.');
  const GOLD2 = card('Test Gold Two', 'Sorcery', 'Create two Treasure tokens.');
  const SOLDIER = card('Test Raise', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
  const BOTH = card('Test Both', 'Sorcery', 'Create a Clue token. Create a Treasure token.');
  const defs = [MANUFACTOR, GOLD, GOLD2, SOLDIER, BOTH];
  const kinds = (s: GameState, who: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === who).map((id) => chars(s, id).subtypes[0] ?? chars(s, id).name).sort();
  it('is fully automated', () => expect(full(MANUFACTOR)).toBe(true));
  it('one Treasure becomes a Clue, a Food and a Treasure (once: the new tokens are not replaced again)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Gold'], battlefield: ['Test Manufactor'] } });
    s = cast(s, 'Test Gold');
    expect(kinds(s, 'p1')).toEqual(['Clue', 'Food', 'Treasure']);
  });
  it('two Treasures at once make two of each', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Gold Two'], battlefield: ['Test Manufactor'] } });
    s = cast(s, 'Test Gold Two');
    expect(kinds(s, 'p1')).toEqual(['Clue', 'Clue', 'Food', 'Food', 'Treasure', 'Treasure']);
  });
  it('a Clue and then a Treasure are two events, each replaced: two of each', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Both'], battlefield: ['Test Manufactor'] } });
    s = cast(s, 'Test Both');
    expect(kinds(s, 'p1')).toEqual(['Clue', 'Clue', 'Food', 'Food', 'Treasure', 'Treasure']);
  });
  it('other tokens are not replaced, and without the Manufactor a Treasure is just a Treasure', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Raise'], battlefield: ['Test Manufactor'] } });
    s = cast(s, 'Test Raise');
    expect(kinds(s, 'p1')).toEqual(['Soldier']);
    let z = scenario([], { defs, p1: { hand: ['Test Gold'] } });
    z = cast(z, 'Test Gold');
    expect(kinds(z, 'p1')).toEqual(['Treasure']);
  });
  it('only tokens YOU would create: with the Manufactor on the other side, your Treasure stays a Treasure', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Gold'] }, p2: { battlefield: ['Test Manufactor'] } });
    s = cast(s, 'Test Gold');
    expect(kinds(s, 'p1')).toEqual(['Treasure']);
  });
});

describe('CR 603.6a, 614.1c: "Whenever a land you control enters tapped" is how it ENTERED, not how it is when the trigger is collected (review fix)', () => {
  const WATCH = card('Test Watch', 'Enchantment', 'Whenever a land you control enters tapped, you gain 1 life.');
  const TAPLAND = card('Test Tapland', 'Land', 'This land enters tapped.');
  const GROVE = card('Test Grove', 'Land — Forest', '');
  const FETCH = card('Test Fetch', 'Sorcery', 'Return target land card from your graveyard to the battlefield, then tap it.');
  const defs = [WATCH, TAPLAND, GROVE, FETCH];
  it('is fully automated', () => { expect(full(WATCH)).toBe(true); expect(full(FETCH)).toBe(true); });
  it('a land that enters tapped triggers it', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Fetch'], graveyard: ['Test Tapland'], battlefield: ['Test Watch'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Fetch', { targets: [[find(s, 'Test Tapland', 'graveyard', 'p1')]] });
    expect(life(s, 'p1')).toBe(before + 1);
  });
  it('a land that entered UNTAPPED and was tapped afterwards by the same effect does not', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Fetch'], graveyard: ['Test Grove'], battlefield: ['Test Watch'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Fetch', { targets: [[find(s, 'Test Grove', 'graveyard', 'p1')]] });
    expect(s.objects[find(s, 'Test Grove', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(before);
  });
});

describe('CR 614.5, 616.1 (review fix): two replacements that each add one of each kind are not run in one pass', () => {
  const MANUFACTOR = card('Test Manufactor', 'Creature — Gnome', 'If you would create a Clue, Food, or Treasure token, instead create one of each.', { pt: ['3', '3'] });
  const GOLD = card('Test Gold', 'Sorcery', 'Create a Treasure token.');
  it('with two Manufactors only the Treasure itself is made (the players make the rest by hand), never a wrong mix', () => {
    let s = scenario([], { defs: [MANUFACTOR, GOLD], p1: { hand: ['Test Gold'], battlefield: ['Test Manufactor', 'Test Manufactor'] } });
    s = cast(s, 'Test Gold');
    const kinds = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => chars(s, id).subtypes[0]);
    expect(kinds).toEqual(['Treasure']);
  });
});
