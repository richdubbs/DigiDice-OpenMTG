/**
 * Commander lane edh-next, round edh-next-13: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 205.4a, 613.1d, 704.5j  "Enchanted permanent is legendary." / "All nonland permanents are legendary." (In Bolas's Clutches, Leyline of Singularity)
 *   CR 106.6, 702.33d          "Spend this mana only to cast kicked spells." (Elfhame Druid), "... an instant or sorcery spell or a kicked spell." (Volshe Tideturner)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
const resolveAll = (s0: GameState): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 30 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = settle(pass(s));
  return s;
};
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const pickT = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });
void pickT; void stat; void resolveAll; void legal; void noManual;

const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const count = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => nameOf(s, id) === name).length;
const cast = (s: GameState, name: string, targets?: ObjectId[]): GameState => {
  let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never));
  if (t.pending?.kind === 'chooseTargets' && targets) t = settle(answer(t, pickT(...targets)));
  return resolveAll(t);
};

const LEYLINE = card('Test Singularity', 'Enchantment', 'All nonland permanents are legendary.');
const AURA = card('Test Clutches', 'Enchantment — Aura', 'Enchant permanent\nEnchanted permanent is legendary.', { cost: '{0}' });
const TWIN = card('Test Twin', 'Artifact Creature — Construct', '', { pt: ['1', '1'] });
const PLAIN = card('Test Plain', 'Creature — Elf', '', { pt: ['2', '2'] });

describe('CR 205.4a, 613.1d, 704.5j: "All nonland permanents are legendary."', () => {
  it('is automated', () => { expect(noManual(LEYLINE)).toEqual([]); expect(noManual(AURA)).toEqual([]); });
  it('makes every nonland permanent legendary, so two of the same name trigger the legend rule; with no Leyline they both stay', () => {
    const base = (): GameState => scenario([], { defs: [LEYLINE, TWIN, PLAIN], p1: { hand: ['Test Singularity'], battlefield: ['Test Twin', 'Test Twin', 'Test Plain'] } });
    const without = settle(base());
    expect(count(without, 'Test Twin')).toBe(2);
    expect(getChars(without, find(without, 'Test Plain', 'battlefield', 'p1'))!.supertypes).not.toContain('Legendary');
    let s = cast(base(), 'Test Singularity');
    expect(getChars(s, find(s, 'Test Plain', 'battlefield', 'p1'))!.supertypes).toContain('Legendary');
    for (let g = 0; s.pending && s.pending.kind !== 'priority' && g < 5; g++) {
      const d = s.pending as unknown as { options: ObjectId[] };
      s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, 1) });
    }
    expect(count(s, 'Test Twin')).toBe(1);
  });
  it('"Enchanted permanent is legendary" affects only the enchanted permanent', () => {
    let s = scenario([], { defs: [AURA, PLAIN, TWIN], p1: { hand: ['Test Clutches'], battlefield: ['Test Plain', 'Test Twin'] } });
    s = cast(s, 'Test Clutches', [find(s, 'Test Plain', 'battlefield', 'p1')]);
    expect(getChars(s, find(s, 'Test Plain', 'battlefield', 'p1'))!.supertypes).toContain('Legendary');
    expect(getChars(s, find(s, 'Test Twin', 'battlefield', 'p1'))!.supertypes).not.toContain('Legendary');
  });
});

describe('CR 106.6, 702.33d: "Spend this mana only to cast kicked spells." / "... an instant or sorcery spell or a kicked spell."', () => {
  const DRUID = card('Test Druid', 'Creature — Elf Druid', '{T}: Add {G}{G}. Spend this mana only to cast kicked spells.', { pt: ['1', '1'] });
  const TIDE = card('Test Tide', 'Creature — Merfolk', '{T}: Add {U}. Spend this mana only to cast an instant or sorcery spell or a kicked spell.', { pt: ['1', '1'] });
  const KICKER = card('Test Kicker', 'Sorcery', 'Kicker {G}\nYou gain 1 life.', { cost: '{G}' });
  const PLAIN_SPELL = card('Test Plain Spell', 'Sorcery', 'You gain 1 life.', { cost: '{G}' });
  const KICK_CREATURE = card('Test Kick Creature', 'Creature — Elf', 'Kicker {U}', { pt: ['1', '1'], cost: '{U}' });
  const PLAIN_CREATURE = card('Test Plain Creature', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{U}' });
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('are automated', () => { expect(noManual(DRUID)).toEqual([]); expect(noManual(TIDE)).toEqual([]); expect(noManual(KICKER)).toEqual([]); });
  it('the mana pays for a kicked spell (kicker and cost); it can\'t pay for the same spell cast without kicker', () => {
    const s0 = scenario([], { defs: [DRUID, KICKER, PLAIN_SPELL], p1: { hand: ['Test Kicker', 'Test Plain Spell'], battlefield: ['Test Druid'] } });
    expect(legal(s0, 'p1', 'cast').some((a) => a.object === find(s0, 'Test Plain Spell', 'hand', 'p1'))).toBe(false);
    const offered = legal(s0, 'p1', 'cast').some((a) => a.object === find(s0, 'Test Kicker', 'hand', 'p1'));
    expect(offered).toBe(true);
  });
  const castAnswering = (s0: GameState, name: string, kick: boolean): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never);
    for (let k = 0; k < 10 && s.pending && s.pending.kind !== 'priority'; k++) {
      const d = s.pending as unknown as { kind: string; options?: { id: string }[] };
      if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: kick });
      else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: kick ? [d.options![0]!.id] : [] });
      else s = settle(s);
    }
    return resolveAll(s);
  };
  it('casting the kicked spell is paid with the Druid\'s GG (the Druid taps) and resolves', () => {
    const s0 = scenario([], { defs: [DRUID, KICKER], p1: { hand: ['Test Kicker'], battlefield: ['Test Druid'] } });
    const s = castAnswering(s0, 'Test Kicker', true);
    expect(life(s)).toBe(life(s0) + 1);
    expect(s.objects[find(s, 'Test Druid', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(s.zones.stack.length).toBe(0);
  });
  it('"an instant or sorcery spell or a kicked spell": a plain sorcery and a kicked creature spell are payable, a plain creature spell is not', () => {
    const TIDE2 = card('Test Tide Two', 'Creature — Merfolk', '{T}: Add {U}. Spend this mana only to cast an instant or sorcery spell or a kicked spell.', { pt: ['1', '1'] });
    const s1 = scenario([], { defs: [TIDE, TIDE2, PLAIN_CREATURE, KICK_CREATURE], p1: { hand: ['Test Plain Creature', 'Test Kick Creature'], battlefield: ['Test Tide', 'Test Tide Two'] } });
    const offered = (n: string): boolean => legal(s1, 'p1', 'cast').some((a) => a.object === find(s1, n, 'hand', 'p1'));
    expect(offered('Test Plain Creature')).toBe(false);
    expect(offered('Test Kick Creature')).toBe(true);
    const U_SPELL = card('Test Blue Spell', 'Sorcery', 'You gain 1 life.', { cost: '{U}' });
    const s2 = scenario([], { defs: [TIDE, U_SPELL], p1: { hand: ['Test Blue Spell'], battlefield: ['Test Tide'] } });
    expect(legal(s2, 'p1', 'cast').some((x) => x.object === find(s2, 'Test Blue Spell', 'hand', 'p1'))).toBe(true);
  });
});

describe('CR 115.1, 101.2: "This creature can\'t be the target of black or red spells your opponents control."', () => {
  const PALADIN = card('Test Paladin', 'Creature — Human Knight', 'This creature can\'t be the target of black or red spells your opponents control.', { pt: ['2', '2'] });
  const bolt = (name: string, color: 'B' | 'R' | 'G' | 'W'): CardDef => card(name, 'Instant', `${name} deals 1 damage to target creature.`, { cost: '{0}', colors: [color] });
  const BLACK = bolt('Test Black Bolt', 'B');
  const RED = bolt('Test Red Bolt', 'R');
  const GREEN = bolt('Test Green Bolt', 'G');
  const POKER = card('Test Poker', 'Artifact', '{T}: Test Poker deals 1 damage to target creature.', { cost: '{0}', colors: ['B'] });
  const board = (): GameState => scenario([], { defs: [PALADIN, BLACK, RED, GREEN, POKER], p1: { hand: ['Test Black Bolt', 'Test Red Bolt', 'Test Green Bolt'], battlefield: ['Test Poker'] }, p2: { battlefield: ['Test Paladin'] } });
  const offered = (s: GameState, n: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, n, 'hand', 'p1'));
  it('is automated', () => expect(noManual(PALADIN)).toEqual([]));
  it('a black or red spell an opponent controls can\'t target it; a green one can', () => {
    const s = board();
    expect(offered(s, 'Test Black Bolt')).toBe(false);
    expect(offered(s, 'Test Red Bolt')).toBe(false);
    expect(offered(s, 'Test Green Bolt')).toBe(true);
  });
  it('an ability of a black permanent an opponent controls can still target it (the text says spells)', () => {
    const s = board();
    expect(legal(s, 'p1', 'activate').some((a) => a.object === find(s, 'Test Poker', 'battlefield', 'p1'))).toBe(true);
  });
});
