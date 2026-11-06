/**
 * Commander lane edh-perms, round edh-perms-3: the round's parser readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (the CR text of 2026-09-25 was read for 303.4, 704.5m, 205, 611, 613, 707 and 608.2 (reviewer-checked)).
 *
 *   CR 205.1b, 611.2c, 613.1d      "Each creature you control becomes a Demon in addition to its other types." (the affected set is fixed as the effect resolves)
 *   CR 205.3a, 613.1d, 613.4b      "Until end of turn, each Goblin creature you control has base power and toughness 4/4 and becomes a Demon in addition to its other creature types."
 *   CR 604.2, 113.6, 205.1b        "As long as ~ isn't on the battlefield, it's a 2/2 Spirit creature in addition to its other types." (functions in every zone but the battlefield)
 *   CR 707.9a-b, 613.1f, 614.1c    "You may have ~ enter as a copy of another creature you control, except it has ~'s other abilities."
 *   CR 608.2c-d               "For each player, choose a creature card in that player's graveyard. Put those cards onto the battlefield under your control." (one choice per player)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[]; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

interface Picks { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: TargetChoice[][] }
/** Answer every decision until a player has priority: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options!, s) : p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
/** Cast the card `name` from p1's hand, paying with `mana` put in the pool, and resolve everything. */
function castAndResolve(s0: GameState, name: string, o: Picks = {}, mana: string[] = ['C']): GameState {
  for (const m of mana) s0.players[0]!.manaPool.push({ type: m } as never);
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
}
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && s.objects[id]!.defId === name);

describe('CR 205.1b, 611.2c, 613.1d: "Each creature you control becomes a Demon in addition to its other types."', () => {
  const WAVE = card('Test Dark Wave', 'Sorcery', 'Each creature you control becomes a Demon in addition to its other types.', { cost: '{1}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const LATE = card('Test Late Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [WAVE, BEAR, LATE];
  it('is automated; every creature you control is a Demon and keeps its other types, an opponent\'s creature is not', () => {
    expect(automated(WAVE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear'], hand: ['Test Dark Wave'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const r = castAndResolve(s0, 'Test Dark Wave');
    for (const id of onBf(r, 'Test Bear', 'p1')) {
      expect(chars(r, id).subtypes).toContain('Demon');
      expect(chars(r, id).subtypes).toContain('Bear');
      expect(chars(r, id).types).toContain('Creature');
    }
    expect(onBf(r, 'Test Bear', 'p1')).toHaveLength(2);
    for (const id of onBf(r, 'Test Bear', 'p2')) expect(chars(r, id).subtypes).not.toContain('Demon');
  });
  it('CR 611.2c: the creatures are the ones there when it resolves; a creature that enters afterwards is not a Demon', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Dark Wave'] }, defs });
    const r = castAndResolve(s0, 'Test Dark Wave');
    const late = put(r, 'p1', 'battlefield', 'Test Late Bear');
    expect(chars(r, late).subtypes).not.toContain('Demon');
    expect(chars(r, onBf(r, 'Test Bear', 'p1')[0]!).subtypes).toContain('Demon');
  });
});

describe('CR 205.3a, 613.4b, 611.2a: "{2}{R}: Until end of turn, each Goblin creature you control has base power and toughness 4/4 and becomes a Demon in addition to its other creature types."', () => {
  const CHIEF = card('Test Horde Chief', 'Creature — Goblin', '{2}{R}: Until end of turn, each Goblin creature you control has base power and toughness 4/4 and becomes a Demon in addition to its other creature types.', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
  const GOB = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [CHIEF, GOB, BEAR];
  const activate = (s0: GameState): GameState => {
    s0.players[0]!.manaPool.push({ type: 'R' } as never, { type: 'C' } as never, { type: 'C' } as never);
    const chief = find(s0, 'Test Horde Chief', 'battlefield', 'p1');
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: chief, ability: 'p:0:0' }));
  };
  it('is automated; the Goblins you control are 4/4 Demons until end of turn, a Bear is not, and it ends at the cleanup step', () => {
    expect(automated(CHIEF)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Horde Chief', 'Test Goblin', 'Test Bear'] }, p2: { battlefield: ['Test Goblin'] }, defs });
    const r = activate(s0);
    for (const id of [...onBf(r, 'Test Horde Chief', 'p1'), ...onBf(r, 'Test Goblin', 'p1')]) {
      const c = chars(r, id);
      expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
      expect(c.subtypes).toContain('Demon');
      expect(c.subtypes).toContain('Goblin');
    }
    const bear = chars(r, onBf(r, 'Test Bear', 'p1')[0]!);
    expect([Number(bear.power), Number(bear.toughness)]).toEqual([2, 2]);
    expect(bear.subtypes).not.toContain('Demon');
    const theirs = chars(r, onBf(r, 'Test Goblin', 'p2')[0]!);
    expect([Number(theirs.power), Number(theirs.toughness)]).toEqual([1, 1]);
    const late = put(r, 'p1', 'battlefield', 'Test Goblin');
    expect(chars(r, late).subtypes).not.toContain('Demon'); // CR 611.2c: a Goblin entering after it resolved is not changed
    expect(Number(chars(r, late).power)).toBe(1);
    const end = advanceTo(r, 2, 'upkeep');
    const after = chars(end, onBf(end, 'Test Goblin', 'p1')[0]!);
    expect(after.subtypes).not.toContain('Demon');
    expect(Number(after.power)).toBe(1);
  });
});

describe('CR 604.2, 113.6, 205.1b: "As long as ~ isn\'t on the battlefield, it\'s a 2/2 Spirit creature in addition to its other types."', () => {
  const WALKER = card('Test Hive Walker', 'Legendary Planeswalker — Hive', 'As long as ~ isn\'t on the battlefield, it\'s a 2/2 Spirit creature in addition to its other types.', { cost: '{1}', loyalty: '3' });
  const defs = [WALKER];
  it('is automated; in the hand, the graveyard and the library it is a 2/2 Spirit creature card and a planeswalker card', () => {
    expect(automated(WALKER)).toBe(true);
    for (const zone of ['hand', 'graveyard', 'library'] as const) {
      const s0 = scenario([], { p1: { [zone]: ['Test Hive Walker'] }, defs });
      const c = chars(s0, find(s0, 'Test Hive Walker', zone, 'p1'));
      expect(c.types, zone).toContain('Creature');
      expect(c.types, zone).toContain('Planeswalker');
      expect(c.subtypes, zone).toContain('Spirit');
      expect([Number(c.power), Number(c.toughness)], zone).toEqual([2, 2]);
    }
  });
  it('on the battlefield it is only a planeswalker (no creature type, no power or toughness)', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Hive Walker', counters: { loyalty: 3 } }] }, defs });
    const c = chars(s0, find(s0, 'Test Hive Walker', 'battlefield', 'p1'));
    expect(c.types).toContain('Planeswalker');
    expect(c.types).not.toContain('Creature');
    expect(c.subtypes).not.toContain('Spirit');
  });
  it('on the stack, cast from the hand, it is a creature spell as well', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hive Walker'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hive Walker', 'hand', 'p1') });
    const onStack = s1.zones.stack[0] ?? (s1.pending ? undefined : undefined);
    const id = s1.zones.stack.length > 0 ? onStack! : find(s1, 'Test Hive Walker', 'stack', 'p1');
    expect(chars(s1, id).types).toContain('Creature');
  });
});

describe('CR 707.9a-b, 613.1f, 614.1c: "You may have ~ enter as a copy of another creature you control, except it has ~\'s other abilities."', () => {
  const MIRROR = card('Test Mirror Shaper', 'Legendary Creature — Shapeshifter', 'You may have ~ enter as a copy of another creature you control, except it has ~\'s other abilities.\nThe "legend rule" doesn\'t apply to permanents you control.\nFlying', { pt: ['3', '1'], cost: '{1}' });
  const HERO = card('Test Hero', 'Legendary Creature — Human', '', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [MIRROR, HERO, BEAR];
  const pickByName = (name: string) => (options: ObjectId[], s: GameState): ObjectId[] => [options.find((id) => s.objects[id]!.defId === name) ?? options[0]!];
  it('is automated', () => {
    expect(automated(MIRROR)).toBe(true);
  });
  it('enters as a copy of your Bear that also has the other abilities: flying, and the legend rule exemption', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Mirror Shaper'] }, defs });
    const r = castAndResolve(s0, 'Test Mirror Shaper', { yes: true, pick: pickByName('Test Bear') });
    const copy = onBf(r, 'Test Mirror Shaper', 'p1')[0] ?? s0.zones.battlefield.find(() => false);
    const bears = r.zones.battlefield.filter((id) => s0 !== r && r.objects[id]!.controller === 'p1' && chars(r, id).name === 'Test Bear');
    expect(bears.length).toBe(2); // the original and the copy
    void copy;
    const theCopy = bears.find((id) => r.objects[id]!.defId === 'Test Mirror Shaper')!;
    const c = chars(r, theCopy);
    expect([Number(c.power), Number(c.toughness)]).toEqual([2, 2]);
    expect(c.keywords.map((k) => k.keyword)).toContain('flying');
  });
  it('copying your legendary creature keeps both permanents: the legend rule does not apply to the copy\'s controller', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Hero'], hand: ['Test Mirror Shaper'] }, defs });
    const r = castAndResolve(s0, 'Test Mirror Shaper', { yes: true, pick: pickByName('Test Hero') });
    const heroes = r.zones.battlefield.filter((id) => chars(r, id).name === 'Test Hero');
    expect(heroes.length).toBe(2);
  });
  it('negative: a copy without the other abilities (only "except it has flying") is put into the graveyard by the legend rule when it copies your legendary creature', () => {
    const PLAIN = card('Test Plain Mirror', 'Legendary Creature — Shapeshifter', 'You may have ~ enter as a copy of another creature you control, except it has flying.', { pt: ['3', '1'], cost: '{1}' });
    const s0 = scenario([], { p1: { battlefield: ['Test Hero'], hand: ['Test Plain Mirror'] }, defs: [PLAIN, HERO] });
    expect(automated(PLAIN)).toBe(true);
    const r = castAndResolve(s0, 'Test Plain Mirror', { yes: true, pick: pickByName('Test Hero') });
    expect(r.zones.battlefield.filter((id) => chars(r, id).name === 'Test Hero')).toHaveLength(1);
  });
  it('declining the copy leaves a 3/1 Test Mirror Shaper; an opponent\'s creature is not a choice (another creature YOU control)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mirror Shaper'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const r = castAndResolve(s0, 'Test Mirror Shaper', { yes: true });
    const me = onBf(r, 'Test Mirror Shaper', 'p1')[0]!;
    expect(chars(r, me).name).toBe('Test Mirror Shaper');
    expect([Number(chars(r, me).power), Number(chars(r, me).toughness)]).toEqual([3, 1]);
    const s1 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Mirror Shaper'] }, defs });
    const d = castAndResolve(s1, 'Test Mirror Shaper', { pick: () => [] }); // "may": choose no object
    const me1 = onBf(d, 'Test Mirror Shaper', 'p1')[0]!;
    expect(chars(d, me1).name).toBe('Test Mirror Shaper');
  });
});

describe('CR 608.2c-d: "For each player, choose a creature card in that player\'s graveyard. Put those cards onto the battlefield under your control."', () => {
  const BREACH = card('Test Deep Breach', 'Sorcery', 'Each player mills two cards. For each player, choose a creature card in that player\'s graveyard. Put those cards onto the battlefield under your control. Then each creature you control becomes a Demon in addition to its other types.', { cost: '{1}' });
  const A = card('Test Grave Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const B = card('Test Grave Wolf', 'Creature — Wolf', '', { pt: ['3', '3'] });
  const SPARE = card('Test Spare Bear', 'Creature — Bear', '', { pt: ['1', '1'] });
  const defs = [BREACH, A, B, SPARE];
  it('is automated; one creature card from each graveyard enters under your control and every creature you control is then a Demon', () => {
    expect(automated(BREACH)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Deep Breach'], graveyard: ['Test Grave Bear'] }, p2: { graveyard: ['Test Grave Wolf', 'Test Spare Bear'] }, defs });
    const r = castAndResolve(s0, 'Test Deep Breach', { pick: (options, st) => [options.find((id) => st.objects[id]!.defId !== 'Test Spare Bear') ?? options[0]!] });
    const mine = r.zones.battlefield.filter((id) => r.objects[id]!.controller === 'p1');
    expect(mine.map((id) => r.objects[id]!.defId).sort()).toEqual(['Test Grave Bear', 'Test Grave Wolf']); // one card of each graveyard, the Wolf from the opponent's
    for (const id of mine) expect(chars(r, id).subtypes).toContain('Demon');
    expect(r.zones.battlefield.filter((id) => r.objects[id]!.controller === 'p2')).toHaveLength(0);
    expect(r.zones.graveyard['p2']!.map((id) => r.objects[id]!.defId)).toContain('Test Spare Bear'); // the card not chosen stays
  });
});
void applyAction;
