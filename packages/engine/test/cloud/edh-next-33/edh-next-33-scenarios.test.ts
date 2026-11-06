/**
 * Commander lane edh-next, round edh-next-33: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites listed as unverified in the
 * round's record where the Comprehensive Rules text could not be fetched.
 *
 *   CR 701.50a, 603.2          "Whenever a creature you control connives, put a +1/+1 counter on each Villain you control." (Iron Monger)
 *   CR 702.140d, 730.2         "... where X is the number of times this creature has mutated." (Insatiable Hemophage)
 *   CR 113.6k, 400.7, 608.2c   "you may exile ~ from your graveyard. If you do, ~ deals 5 damage to each creature." (Kozilek's Return)
 *   CR 120.3, 608.2h           "Each creature you control that's a Wolf or a Werewolf deals damage equal to its power to that creature." (Moonlight Hunt)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mutate as mutateCast, resolveTop, table as mutateTable, ELVES } from '../../m6/mutate/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const namesOn = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name);
const idOn = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
interface Opts { targets?: Targets }
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min === 0 ? p.max : p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Opts = {}): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];


const countersOn = (s: GameState, id: ObjectId): number => s.objects[id]?.counters?.['+1/+1'] ?? 0;

describe('CR 701.50a, 603.2: "Whenever a creature you control connives, put a +1/+1 counter on each Villain you control."', () => {
  const MONGER = card('Test Tycoon', 'Creature — Human Villain', 'Whenever a creature you control connives, put a +1/+1 counter on each Villain you control.', { pt: ['2', '2'] });
  const VILLAIN = card('Test Villain', 'Creature — Villain', '', { pt: ['1', '1'] });
  const CONNIVE = card('Test Scheme', 'Sorcery', 'Target creature connives.');
  const defs = [MONGER, VILLAIN, BEAR, CONNIVE];
  const run = (target: string, owner: PlayerId): GameState => {
    const s0 = scenario(['Plains', 'Island'], { defs, p1: { battlefield: ['Test Tycoon', 'Test Villain'], hand: ['Test Scheme'], library: ['Plains', 'Island'] }, p2: { battlefield: ['Test Bear'], library: ['Plains', 'Island'] } });
    const id = s0.zones.battlefield.find((x) => s0.defs[s0.objects[x]!.defId]!.name === target && s0.objects[x]!.controller === owner)!;
    return cast(s0, 'Test Scheme', { targets: [[obj(id)]] });
  };
  it('is understood', () => { expect(noManual(MONGER)).toBe(true); });
  it('a creature you control connives: every Villain you control gets a +1/+1 counter, the Tycoon and the Villain alike', () => {
    const s = run('Test Villain', 'p1');
    expect(countersOn(s, idOn(s, 'Test Tycoon'))).toBe(1);
    expect(countersOn(s, idOn(s, 'Test Villain'))).toBe(1 + 0); // the Villain is a Villain; the connive itself adds a counter only for a nonland discard
  });
  it('a computed connive X with X = 0 is a connive 0 and reports nothing (CR 701.50e, review finding)', () => {
    const VAULT = card('Test Vault', 'Artifact', '{T}: Target creature you control connives X, where X is the number of creatures that died this turn.');
    const s0 = scenario(['Plains', 'Island'], { defs: [...defs, VAULT], p1: { battlefield: ['Test Tycoon', 'Test Vault'], library: ['Plains', 'Island'] }, p2: {} });
    const s = drive(act(s0, { type: 'activate', player: 'p1', source: idOn(s0, 'Test Vault'), ability: 'p:0:0' } as never), { targets: [[obj(idOn(s0, 'Test Tycoon'))]] });
    expect(countersOn(resolveAll(s), idOn(s0, 'Test Tycoon'))).toBe(0);
  });
  it('a creature an opponent controls connives: no counter (negative)', () => {
    const s = run('Test Bear', 'p2');
    expect(countersOn(s, idOn(s, 'Test Tycoon'))).toBe(0);
    expect(countersOn(s, idOn(s, 'Test Villain'))).toBe(0);
  });
});

describe('CR 120.3, 608.2h: "Each creature you control that\'s a Wolf or a Werewolf deals damage equal to its power to that creature."', () => {
  const HUNT = card('Test Hunt', 'Instant', "Choose target creature you don't control. Each creature you control that's a Wolf or a Werewolf deals damage equal to its power to that creature.");
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
  const WEREWOLF = card('Test Werewolf', 'Creature — Human Werewolf', '', { pt: ['3', '3'] });
  const DRAGON = card('Test Dragon', 'Creature — Dragon', '', { pt: ['9', '9'] });
  const BIG = card('Test Giant', 'Creature — Giant', '', { pt: ['4', '9'] });
  const defs = [HUNT, WOLF, WEREWOLF, DRAGON, BIG];
  const dmg = (mine: string[]): number => {
    const s0 = scenario([], { defs, p1: { battlefield: mine, hand: ['Test Hunt'] }, p2: { battlefield: ['Test Giant'] } });
    const victim = s0.zones.battlefield.find((x) => s0.defs[s0.objects[x]!.defId]!.name === 'Test Giant')!;
    const s = cast(s0, 'Test Hunt', { targets: [[obj(victim)]] });
    return s.objects[victim]?.damage ?? 0;
  };
  it('is understood', () => { expect(noManual(HUNT)).toBe(true); });
  it('each Wolf and each Werewolf deals its own power: 2 + 3 = 5 damage', () => { expect(dmg(['Test Wolf', 'Test Werewolf'])).toBe(5); });
  it('a creature that is neither deals nothing, the Dragon\'s power 9 is not used (negative)', () => { expect(dmg(['Test Wolf', 'Test Dragon'])).toBe(2); });
});

describe("CR 113.6k, 400.7, 608.2c: \"you may exile ~ from your graveyard. If you do, ~ deals 5 damage to each creature.\"", () => {
  const SWEEP = card('Test Sweeper', 'Instant', 'Test Sweeper deals 2 damage to each creature.\nWhenever you cast an Eldrazi creature spell with mana value 7 or greater, you may exile Test Sweeper from your graveyard. If you do, Test Sweeper deals 5 damage to each creature.', { cost: '{2}{R}' });
  const TITAN = card('Test Titan', 'Creature — Eldrazi', '', { pt: ['1', '1'], cost: '{7}' });
  const SMALL = card('Test Spawnling', 'Creature — Eldrazi', '', { pt: ['1', '1'], cost: '{6}' });
  const defs = [SWEEP, TITAN, SMALL, BEAR];
  const run = (spell: string): GameState => {
    const lands = Array(7).fill('Plains') as string[];
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: lands, hand: [spell], graveyard: ['Test Sweeper'] }, p2: { battlefield: ['Test Bear'] } });
    return cast(s0, spell);
  };
  it('is understood', () => { expect(noManual(SWEEP)).toBe(true); });
  it('casting a mana value 7 Eldrazi creature spell: the card leaves the graveyard for exile and the Bear takes 5 damage and dies', () => {
    const s = run('Test Titan');
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Sweeper')).toBe(true);
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Sweeper')).toBe(false);
    expect(namesOn(s, 'p2')).not.toContain('Test Bear');
  });
  it('a mana value 6 Eldrazi creature spell does nothing (negative)', () => {
    const s = run('Test Spawnling');
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Sweeper')).toBe(true);
    expect(namesOn(s, 'p2')).toContain('Test Bear');
  });
});

describe('CR 702.140d, 730.2: "where X is the number of times this creature has mutated"', () => {
  const MUTANT = card('Test Mutant', 'Creature — Beast', 'Mutate {0}\nWhenever this creature mutates, you gain X life, where X is the number of times this creature has mutated.', { pt: ['2', '2'], cost: '{G}' });
  it('is understood', () => { expect(noManual(MUTANT)).toBe(true); });
  it('one mutate: the trigger gains 1 life (one merge)', () => {
    const s0 = mutateTable([ELVES], { hand: ['Test Mutant'], defs: [MUTANT] });
    const before = life(s0, 'p1');
    const s = resolveTop(resolveTop(mutateCast(s0, find(s0, ELVES, 'battlefield'), 'Test Mutant'), [{ kind: 'chooseOption', ids: ['over'] }]));
    expect(life(s, 'p1')).toBe(before + 1);
  });
  it('cast as an ordinary creature spell it never mutates: no life gained (negative)', () => {
    const s0 = scenario(['Forest'], { defs: [MUTANT], p1: { battlefield: ['Forest', 'Forest'], hand: ['Test Mutant'] } });
    const s = cast(s0, 'Test Mutant');
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});
