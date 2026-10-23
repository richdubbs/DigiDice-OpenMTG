/**
 * FAST4 T22: the shapes of parser/templates/zz-fast4/t22.json and the engine additions they needed, played through the engine with synthetic cards compiled by
 * the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 701.10b, 608.2f, 611.2c   "double the power and toughness of each Elf you control until end of turn": +X/+Y per creature, its own values as the
 *                                ability resolves (a later change is not doubled), only until end of turn (CR 514.2)
 *   CR 701.10c                   doubling a negative power makes it more negative
 *   CR 701.10b, 608.2h           "double target creature's power until end of turn": +X/+0, X fixed as it resolves
 *   CR 107.3, 608.2h, 122.1      "put X +1/+1 counters on each creature you control, where X is the number of Elves you control"
 *   CR 301.5, 303.4, 611.3a      "~ gets +2/+1 for each Aura attached to it" counts only the Auras attached to it, as they come and go; Equipment
 *                                likewise; "Enchanted creature gets +1/+1 for each Aura and Equipment attached to it" counts the Aura itself
 *   CR 701.9a, 603.2c            "Whenever you discard one or more cards, put that many +1/+1 counters on ~": the number of cards discarded (one or two)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, legal, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
/** Every ability of the card automated, and the card full (the T22 templates are stable). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Answer the decisions that come up with `answers` (in order), pay costs automatically, choose `targets` when asked; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), [], answers);
const castWith = (s0: GameState, name: string, targets: TargetChoice[] = []): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);
function activate(s: GameState, name: string, targets: TargetChoice[] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}
/** An Aura or Equipment of p1 put onto the battlefield attached to `to`. */
const attachNew = (s: GameState, name: string, to: ObjectId): GameState => tweak(s, (t) => { const id = put(t, 'p1', 'battlefield', name); t.objects[id]!.attachedTo = to; });

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '1']);
const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.');

describe('CR 701.10b, 608.2f, 611.2c: "double the power and toughness of each Elf you control until end of turn"', () => {
  const ROAR = card('Test Roar', 'Sorcery', 'Double the power and toughness of each creature you control until end of turn.');
  const ELFROAR = card('Test Elf Roar', 'Sorcery', 'Double the power and toughness of each Elf you control until end of turn.');
  it('is automated, and each creature gets +X/+Y of its own power and toughness', () => {
    expect(full(ROAR)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Roar'], battlefield: ['Test Elf', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre'] }, defs: [ROAR, ELF, OGRE] });
    const s = resolve(castWith(s0, 'Test Roar'));
    expect(pt(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe('4/4');
    expect(pt(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe('6/2');
    expect(pt(s, find(s, 'Test Ogre', 'battlefield', 'p2'))).toBe('3/1'); // not yours
  });
  it('only the creatures of the filter, with the values as it resolves: a later +1/+1 is not doubled (CR 608.2h)', () => {
    expect(full(ELFROAR)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Pump', 'Test Elf Roar'], battlefield: ['Test Elf', 'Test Ogre'] }, defs: [ELFROAR, PUMP, ELF, OGRE] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    let s = resolve(castWith(s0, 'Test Elf Roar'));
    expect(pt(s, elf)).toBe('4/4');
    expect(pt(s, find(s, 'Test Ogre', 'battlefield', 'p1'))).toBe('3/1');
    s = resolve(castWith(s, 'Test Pump', [obj(elf)]));
    expect(pt(s, elf)).toBe('5/5');
  });
  it('CR 701.10c: a creature with negative power gets -X/-0, and its toughness is doubled as usual', () => {
    const SHRINK = card('Test Shrink', 'Instant', 'Target creature gets -4/-0 until end of turn.');
    const s0 = scenario([], { p1: { hand: ['Test Shrink', 'Test Roar'], battlefield: ['Test Elf'] }, defs: [ROAR, SHRINK, ELF] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    let s = resolve(castWith(s0, 'Test Shrink', [obj(elf)]));
    expect(pt(s, elf)).toBe('-2/2');
    s = resolve(castWith(s, 'Test Roar'));
    expect(pt(s, elf)).toBe('-4/4');
  });
});

describe('CR 701.10b, 608.2h: "double target creature\'s power until end of turn"', () => {
  const BULK = card('Test Bulk', 'Instant', "Double target creature's power until end of turn.");
  it('is automated; the creature gets +X/+0 with X its power as the spell resolves', () => {
    expect(full(BULK)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Pump', 'Test Bulk'], battlefield: ['Test Ogre'] }, defs: [BULK, PUMP, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    let s = resolve(castWith(s0, 'Test Bulk', [obj(ogre)]));
    expect(pt(s, ogre)).toBe('6/1');
    s = resolve(castWith(s, 'Test Pump', [obj(ogre)]));
    expect(pt(s, ogre)).toBe('7/2'); // not doubled again
  });
});

describe('CR 107.3, 608.2h, 122.1: "put X +1/+1 counters on each creature you control, where X is the number of Elves you control"', () => {
  const TEMPLE = card('Test Grove Temple', 'Enchantment', '{0}: Put X +1/+1 counters on each creature you control, where X is the number of Elves you control.');
  it('is automated, and every creature you control gets one counter per Elf you control as it resolves', () => {
    expect(full(TEMPLE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Grove Temple', 'Test Elf', 'Test Elf', 'Test Ogre'] }, p2: { battlefield: ['Test Elf'] }, defs: [TEMPLE, ELF, OGRE] });
    const s = resolve(activate(s0, 'Test Grove Temple'));
    expect(s.objects[find(s, 'Test Ogre', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(2);
    for (const id of s.zones.battlefield.filter((i) => s.objects[i]!.defId === 'Test Elf')) {
      expect(s.objects[id]!.counters['+1/+1'] ?? 0, id).toBe(s.objects[id]!.controller === 'p1' ? 2 : 0);
    }
  });
});

describe('CR 608.2h, 113.7a: "When ~ dies, put X +1/+1 counters on target creature you control, where X is the number of +1/+1 counters on ~"', () => {
  const HEIR = card('Test Scale Heir', 'Creature — Lizard', 'When Test Scale Heir dies, put X +1/+1 counters on target creature you control, where X is the number of +1/+1 counters on Test Scale Heir.', ['0', '1']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('is automated, and X is the counters the creature had as it last existed on the battlefield', () => {
    expect(full(HEIR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Scale Heir', counters: { '+1/+1': 3 } }, 'Test Elf'] }, defs: [HEIR, KILL, ELF] });
    const heir = find(s, 'Test Scale Heir', 'battlefield', 'p1');
    const elf = find(s, 'Test Elf', 'battlefield', 'p1');
    s = settle(pass(pass(castWith(s, 'Test Kill', [obj(heir)]))), [obj(elf)]); // the dies trigger targets the Elf (CR 603.3d)
    expect(find(s, 'Test Scale Heir', 'graveyard', 'p1')).toBeTruthy();
    s = resolve(s);
    expect(s.objects[elf]!.counters['+1/+1']).toBe(3);
  });
});

describe('CR 301.5, 303.4, 611.3a: "~ gets +2/+1 for each Aura attached to it" and "for each Equipment attached to it"', () => {
  const DANCER = card('Test Aura Dancer', 'Creature — Human Spirit', 'Test Aura Dancer gets +2/+1 for each Aura attached to it.', ['0', '2']);
  const ADAPTER = card('Test Gear Adapter', 'Artifact Creature — Construct', 'Test Gear Adapter gets +1/+1 for each Equipment attached to it.', ['1', '1']);
  const AURA = card('Test Ward', 'Enchantment — Aura', 'Enchant creature');
  const GEAR = card('Test Gear', 'Artifact — Equipment', 'Equip {1}');
  it('are automated and count only what is attached to the object itself, as attachments come and go', () => {
    expect(full(DANCER)).toBe(true);
    expect(full(ADAPTER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Aura Dancer', 'Test Gear Adapter', 'Test Elf'] }, defs: [DANCER, ADAPTER, AURA, GEAR, ELF] });
    const dancer = find(s, 'Test Aura Dancer', 'battlefield', 'p1');
    const adapter = find(s, 'Test Gear Adapter', 'battlefield', 'p1');
    const elf = find(s, 'Test Elf', 'battlefield', 'p1');
    expect(pt(s, dancer)).toBe('0/2');
    s = attachNew(s, 'Test Ward', elf); // an Aura on another creature does not count
    s = attachNew(s, 'Test Gear', dancer); // nor does an Equipment
    expect(pt(s, dancer)).toBe('0/2');
    s = attachNew(s, 'Test Ward', dancer);
    s = attachNew(s, 'Test Ward', dancer);
    expect(pt(s, dancer)).toBe('4/4');
    expect(pt(s, adapter)).toBe('1/1');
    s = attachNew(s, 'Test Gear', adapter);
    expect(pt(s, adapter)).toBe('2/2');
    // the Equipment moves away (CR 301.5): the bonus goes with it
    s = tweak(s, (t) => { for (const id of t.zones.battlefield) if (t.objects[id]!.defId === 'Test Gear' && t.objects[id]!.attachedTo === adapter) t.objects[id]!.attachedTo = elf; });
    expect(pt(s, adapter)).toBe('1/1');
  });
  it('CR 303.4: "Enchanted creature gets +1/+1 for each Aura and Equipment attached to it" counts the Aura itself and every Aura and Equipment on that creature', () => {
    const MIGHT = card('Test Great Might', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each Aura and Equipment attached to it.');
    expect(full(MIGHT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Elf', 'Test Ogre'] }, defs: [MIGHT, AURA, GEAR, ELF, OGRE] });
    const elf = find(s, 'Test Elf', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = attachNew(s, 'Test Great Might', elf);
    expect(pt(s, elf)).toBe('3/3');
    s = attachNew(s, 'Test Gear', elf);
    s = attachNew(s, 'Test Ward', elf);
    s = attachNew(s, 'Test Ward', ogre); // on another creature: not counted
    expect(pt(s, elf)).toBe('5/5');
    expect(pt(s, ogre)).toBe('3/1');
  });
});

describe('CR 701.9a, 603.2c: "Whenever you discard one or more cards, put that many +1/+1 counters on ~"', () => {
  const SKY = card('Test Scrap Skyray', 'Creature — Bird', 'Flying\nWhenever you discard one or more cards, put that many +1/+1 counters on Test Scrap Skyray.', ['1', '1']);
  const TWO = card('Test Purge Two', 'Sorcery', 'Discard two cards.');
  const ONE = card('Test Purge One', 'Sorcery', 'Discard a card.');
  const counters = (s: GameState): number => s.objects[find(s, 'Test Scrap Skyray', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  /** Resolve the spell, answer any choice of cards to discard with the first options, then resolve the trigger. */
  function play(s0: GameState, name: string): GameState {
    let s = castWith(s0, name);
    s = settle(pass(pass(s)));
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 5; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else break;
    }
    expect(s.zones.stack.length, 'one trigger for the batch (CR 603.2c)').toBe(1);
    return resolve(s);
  }
  it('is automated; two cards discarded at once are two counters (one trigger), one card is one counter', () => {
    expect(full(SKY)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Purge Two', 'Test Elf', 'Test Ogre', 'Test Purge One', 'Test Elf'], battlefield: ['Test Scrap Skyray'] }, defs: [SKY, TWO, ONE, ELF, OGRE] });
    s = play(s, 'Test Purge Two');
    expect(s.zones.stack).toEqual([]);
    expect(counters(s)).toBe(2);
    s = play(s, 'Test Purge One');
    expect(counters(s)).toBe(3);
  });
});
