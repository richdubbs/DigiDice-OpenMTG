/**
 * Commander lane graveyard, fourth pass, round edh-d-59 (coordinator D): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. p1 is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites are from memory
 * (cloud session without rules/cr), unverified unless the record says otherwise.
 *
 *   CR 608.2c, 109.2, 603.10a  "Whenever a creature you control with a counter on it dies, you may return another target permanent card ... from your graveyard to your hand."
 *   CR 601.2f, 602.2b          "This ability costs {4} less to activate if an opponent controls four or more nonbasic lands." (an ability from the graveyard)
 *   CR 601.2, 608.2c           "you may cast target instant or sorcery card ... from your graveyard. ... If you cast a spell this way, put a +1/+1 counter on ~."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, legal, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
/** Answer every decision with the first sensible option until priority comes back; `pick` chooses targets by name. */
function drive(s0: GameState, pick: (names: string[]) => string[] = (n) => n.slice(0, 1)): GameState {
  let s = s0;
  for (let g = 0; g < 30 && s.pending && s.pending.kind !== 'priority'; g++) {
    const d = s.pending as never as { kind: string; options?: string[]; min?: number; max?: number; targets?: unknown };
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'chooseTargets') break;
    else throw new Error(`unexpected decision ${d.kind}: ${JSON.stringify(d).slice(0, 400)}`);
  }
  return s;
}
const names = (s: GameState, zone: 'hand' | 'graveyard', p: 'p1' | 'p2' = 'p1'): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);

// Puca's Covenant
const COVENANT = card('Test Covenant', 'Enchantment', 'Whenever a creature you control with a counter on it dies, you may return another target permanent card with mana value less than or equal to the number of counters on that creature from your graveyard to your hand. Do this only once each turn.');
const ALTAR = card('Test Altar', 'Artifact', 'Sacrifice a creature: You gain 1 life.');
const MARKED = card('Test Marked', 'Creature — Rat', '', { pt: ['1', '1'] });
const LOW = card('Test Low Relic', 'Artifact', '', { cost: '{2}' });
const HIGH = card('Test High Relic', 'Artifact', '', { cost: '{4}' });

const target = (ids: string[]) => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) }) as never;
const dump = (s: GameState): string => JSON.stringify(s.pending).slice(0, 500);

describe('CR 608.2c, 603.10a: Puca\'s Covenant reading', () => {
  const board = (marked: number): GameState => scenario([], { defs: [COVENANT, ALTAR, MARKED, LOW, HIGH], p1: { battlefield: ['Test Covenant', 'Test Altar', ...Array.from({ length: marked }, () => ({ name: 'Test Marked', counters: { '+1/+1': 2 } }))], graveyard: ['Test Low Relic', 'Test High Relic'] } });
  const sacrifice = (s: GameState): GameState => {
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Altar', 'battlefield'), ability: 'p:0:0' } as never);
    return t.pending?.kind === 'chooseObjects' ? answer(t, { kind: 'chooseObjects', ids: [(t.pending as never as { options: string[] }).options[0]!] } as never) : t;
  };
  it('is automated', () => expect(noManual(COVENANT)).toEqual([]));
  it('offers only a permanent card with mana value 2 or less (two counters) and never the creature that died, which has mana value 0 and is in the graveyard too', () => {
    let s = sacrifice(board(1));
    expect(s.pending?.kind, dump(s)).toBe('chooseTargets');
    const opts = (s.pending as never as { objects: string[] }).objects.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(opts).toEqual(['Test Low Relic']);
    s = answer(s, target([find(s, 'Test Low Relic', 'graveyard')]));
    s = drive(passBoth(s));
    expect(names(s, 'hand')).toContain('Test Low Relic');
    expect(names(s, 'graveyard')).toContain('Test Marked');
  });
  it('once each turn: a second creature with counters dying the same turn does not return another card', () => {
    let s = sacrifice(board(2));
    s = answer(s, target([find(s, 'Test Low Relic', 'graveyard')]));
    s = drive(passBoth(s));
    expect(names(s, 'hand')).toContain('Test Low Relic');
    s = sacrifice(s);
    expect(s.pending?.kind === 'chooseTargets', 'a second return was offered').toBe(false);
  });
  it('a creature with no counter on it dying does not trigger it', () => {
    const s0 = scenario([], { defs: [COVENANT, ALTAR, MARKED, LOW], p1: { battlefield: ['Test Covenant', 'Test Altar', 'Test Marked'], graveyard: ['Test Low Relic'] } });
    expect(sacrifice(s0).pending?.kind === 'chooseTargets').toBe(false);
  });
});

// Helmut Zemo: the cast of a card from the graveyard, then "If you cast a spell this way"
const ZEMO = card('Test Mastermind', 'Creature — Human', '{0}: You may cast target instant or sorcery card with mana value less than or equal to this creature\'s power from your graveyard. If that spell would be put into your graveyard, exile it instead. If you cast a spell this way, put a +1/+1 counter on this creature.', { pt: ['1', '1'] });
const GAIN = card('Test Gain', 'Instant', 'You gain 3 life.');
const BIGGAIN = card('Test Big Gain', 'Instant', 'You gain 5 life.', { cost: '{3}' });

describe('CR 601.2, 608.2c: "If you cast a spell this way, put a +1/+1 counter on ~."', () => {
  const board = (): GameState => scenario([], { defs: [ZEMO, GAIN, BIGGAIN], p1: { battlefield: ['Test Mastermind'], graveyard: ['Test Gain', 'Test Big Gain'] } });
  const start = (s: GameState): GameState => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Mastermind', 'battlefield'), ability: 'p:0:0' } as never);
  it('is automated', () => expect(noManual(ZEMO)).toEqual([]));
  it('offers only the card with mana value at most the power; casting it puts a counter on the creature and the spell is exiled afterwards', () => {
    let s = start(board());
    expect(s.pending?.kind, dump(s)).toBe('chooseTargets');
    expect((s.pending as never as { objects: string[] }).objects.length).toBe(1);
    s = answer(s, target([find(s, 'Test Gain', 'graveyard')]));
    s = passBoth(s);
    s = drive(s);
    s = drive(passBoth(s));
    const zemo = find(s, 'Test Mastermind', 'battlefield');
    expect(s.objects[zemo]!.counters['+1/+1'], dump(s)).toBe(1);
    expect(names(s, 'graveyard')).not.toContain('Test Gain');
  });
  it('declining the cast puts no counter on it', () => {
    let s = start(board());
    s = answer(s, target([find(s, 'Test Gain', 'graveyard')]));
    s = passBoth(s);
    expect(s.pending?.kind, dump(s)).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: false });
    s = drive(s);
    expect(s.objects[find(s, 'Test Mastermind', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(names(s, 'graveyard')).toContain('Test Gain');
  });
});

// Harness the Storm
const HARNESS = card('Test Harness', 'Enchantment', 'Whenever you cast an instant or sorcery spell from your hand, you may cast target card with the same name as that spell from your graveyard.');
describe('CR 201.2, 601.2: "you may cast target card with the same name as that spell from your graveyard"', () => {
  const board = (): GameState => scenario([], { defs: [HARNESS, GAIN, BIGGAIN], p1: { hand: ['Test Gain'], battlefield: ['Test Harness'], graveyard: ['Test Gain', 'Test Big Gain'] } });
  it('is automated', () => expect(noManual(HARNESS)).toEqual([]));
  it('casting a card from the hand offers only the card with its name in the graveyard (not another name) and casting it resolves both', () => {
    let s = act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Gain', 'hand', 'p1') } as never);
    s = drive(s);
    expect(s.pending?.kind, dump(s)).toBe('chooseTargets');
    const opts = (s.pending as never as { objects: string[] }).objects.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(opts).toEqual(['Test Gain']);
    s = answer(s, target([find(s, 'Test Gain', 'graveyard')]));
    s = drive(passBoth(s));
    s = drive(s.pending?.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes: true }) : s);
    expect(s.zones.stack.length, dump(s)).toBeGreaterThanOrEqual(1); // the copy of the name cast from the graveyard is on the stack above the first spell
  });
});

// Razorlash Transmogrant: an ability from the graveyard that costs less under a condition
const RAZOR = card('Test Reaver', 'Artifact Creature — Construct', '{3}: Return this card from your graveyard to the battlefield. This ability costs {3} less to activate if an opponent controls two or more nonbasic lands.', { pt: ['2', '2'] });
const NB = card('Test Nonbasic', 'Land', '');
describe('CR 601.2f, 602.2b: "This ability costs {3} less to activate if an opponent controls two or more nonbasic lands." (from the graveyard)', () => {
  const can = (lands: number, own = false): boolean => {
    const s = scenario([], { defs: [RAZOR, NB], p1: { graveyard: ['Test Reaver'], battlefield: own ? ['Test Nonbasic', 'Test Nonbasic'] : [] }, p2: { battlefield: Array.from({ length: lands }, () => 'Test Nonbasic') } });
    const id = find(s, 'Test Reaver', 'graveyard', 'p1');
    return legal(s, 'p1', 'activate').some((a) => a.object === id);
  };
  it('is automated', () => expect(noManual(RAZOR)).toEqual([]));
  it('two nonbasic lands of an opponent make the {3} ability free (it can be activated with no mana); one does not, and nonbasic lands of your own count for nothing', () => {
    expect(can(2)).toBe(true);
    expect(can(1)).toBe(false);
    expect(can(0, true)).toBe(false);
  });
});

// Reconstruct History: five "up to one target" card phrases
const REBUILD = card('Test Rebuild', 'Sorcery', 'Return up to one target artifact card, up to one target enchantment card, up to one target instant card, up to one target sorcery card, and up to one target planeswalker card from your graveyard to your hand. Exile ~.');
const ENCH = card('Test Charm Aura', 'Enchantment', '');
describe('CR 115.1, 601.2c: five "up to one target <kind> card" phrases from the graveyard', () => {
  it('is automated with five targets', () => {
    expect(noManual(REBUILD)).toEqual([]);
    const sp = REBUILD.faces[0]!.abilities.find((a) => a.kind === 'spell') as unknown as { effect: { targets: unknown[] } };
    expect(sp.effect.targets.length).toBe(5);
  });
  it('returns an artifact and an enchantment and leaves a second artifact (one target per kind), then exiles itself', () => {
    const s0 = scenario([], { defs: [REBUILD, LOW, HIGH, ENCH], p1: { hand: ['Test Rebuild'], graveyard: ['Test Low Relic', 'Test High Relic', 'Test Charm Aura'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rebuild', 'hand', 'p1') } as never);
    for (let g = 0; g < 8 && s.pending?.kind === 'chooseTargets'; g++) {
      const objs = (s.pending as never as { objects: string[] }).objects;
      const text = (s.pending as never as { targetText: string }).targetText;
      s = answer(s, target(/artifact/.test(text) && objs.length > 0 ? [objs[0]!] : /enchantment/.test(text) && objs.length > 0 ? [objs[0]!] : []));
    }
    s = drive(s);
    s = drive(passBoth(s));
    expect(names(s, 'hand')).toContain('Test Charm Aura');
    expect(names(s, 'hand').filter((n) => /Relic/.test(n)).length).toBe(1);
    expect(names(s, 'graveyard').filter((n) => /Relic/.test(n)).length).toBe(1);
  });
});

// Aphetto Dredging: a creature type in common
const APHETTO = card('Test Dredging', 'Sorcery', 'Return up to three target creature cards of the creature type of your choice from your graveyard to your hand.');
const RAT1 = card('Test Rat One', 'Creature — Rat Rogue', '', { pt: ['1', '1'] });
const RAT2 = card('Test Rat Two', 'Creature — Rat', '', { pt: ['1', '1'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
describe('CR 205.3m, 115.1: "target creature cards of the creature type of your choice"', () => {
  const start = (): GameState => {
    const s0 = scenario([], { defs: [APHETTO, RAT1, RAT2, ELF], p1: { hand: ['Test Dredging'], graveyard: ['Test Rat One', 'Test Rat Two', 'Test Elf'] } });
    return act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dredging', 'hand', 'p1') } as never);
  };
  it('is automated with a creature type in common and up to three targets', () => {
    expect(noManual(APHETTO)).toEqual([]);
    const sp = APHETTO.faces[0]!.abilities.find((a) => a.kind === 'spell') as unknown as { effect: { targets: { sharedCreatureType?: boolean; max: number }[] } };
    expect(sp.effect.targets[0]!.sharedCreatureType).toBe(true);
    expect(sp.effect.targets[0]!.max).toBe(3);
  });
  it('two Rats can be chosen together and are returned; a Rat and an Elf can not', () => {
    const s = start();
    expect(s.pending?.kind, dump(s)).toBe('chooseTargets');
    const rats = [find(s, 'Test Rat One', 'graveyard'), find(s, 'Test Rat Two', 'graveyard')];
    expect(() => answer(s, target([rats[0]!, find(s, 'Test Elf', 'graveyard')]))).toThrow();
    let t = answer(s, target(rats));
    t = drive(passBoth(drive(t)));
    expect(names(t, 'hand').sort()).toEqual(['Test Rat One', 'Test Rat Two']);
    expect(names(t, 'graveyard')).toContain('Test Elf');
  });
});

// Call of the Death-Dweller
const CALL = card('Test Call', 'Sorcery', 'Return up to two target creature cards with total mana value 3 or less from your graveyard to the battlefield. Put a deathtouch counter on either of them. Then put a menace counter on either of them.');
const C1 = card('Test One Drop', 'Creature — Rat', '', { pt: ['1', '1'], cost: '{1}' });
const C2 = card('Test Two Drop', 'Creature — Rat', '', { pt: ['2', '2'], cost: '{2}' });
describe('CR 608.2c-d, 122.1: "Put a deathtouch counter on either of them."', () => {
  it('is automated', () => expect(noManual(CALL)).toEqual([]));
  it('returns both creatures (total mana value 3) and puts one deathtouch and one menace counter on creatures among them; total 4 is not allowed', () => {
    const s0 = scenario([], { defs: [CALL, C1, C2], p1: { hand: ['Test Call'], graveyard: ['Test One Drop', 'Test Two Drop', 'Test Two Drop'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Call', 'hand', 'p1') } as never);
    const two = findAll(s, 'Test Two Drop', 'graveyard', 'p1');
    expect(() => answer(s, target(two))).toThrow(); // 2 + 2 = 4 is over 3
    s = answer(s, target([find(s, 'Test One Drop', 'graveyard'), two[0]!]));
    s = drive(s);
    s = passBoth(s);
    for (let g = 0; g < 6 && s.pending?.kind === 'chooseObjects'; g++) s = answer(s, { kind: 'chooseObjects', ids: [(s.pending as never as { options: string[] }).options[0]!] } as never);
    s = drive(s);
    const bf = s.zones.battlefield.filter((id) => /Drop/.test(s.defs[s.objects[id]!.defId]!.name));
    expect(bf.length, dump(s)).toBe(2);
    expect(bf.map((id) => s.objects[id]!.counters['deathtouch'] ?? 0).reduce((a, b) => a + b, 0)).toBe(1);
    expect(bf.map((id) => s.objects[id]!.counters['menace'] ?? 0).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

// Loamcrafter Faun
const FAUN = card('Test Faun', 'Creature — Elemental', 'When this creature enters, you may discard one or more land cards. When you do, return up to that many target nonland permanent cards from your graveyard to your hand.', { pt: ['2', '2'] });
const LAND = card('Test Plain Land', 'Land', '');
describe('CR 701.9a, 603.12: "you may discard one or more land cards. When you do, return up to that many target nonland permanent cards ..."', () => {
  const start = (): GameState => {
    const s0 = scenario([], { defs: [FAUN, LAND, LOW, HIGH], p1: { hand: ['Test Faun', 'Test Plain Land', 'Test Plain Land'], graveyard: ['Test Low Relic', 'Test High Relic'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Faun', 'hand', 'p1') } as never);
    return passBoth(passBoth(drive(s)));
  };
  it('is automated', () => expect(noManual(FAUN)).toEqual([]));
  it('discarding two lands lets two cards be chosen to return, and no more; the lands are in the graveyard', () => {
    let s = answer(start(), { kind: 'yesNo', yes: true });
    expect(s.pending?.kind, dump(s)).toBe('chooseObjects');
    const lands = (s.pending as never as { options: string[] }).options;
    s = answer(s, { kind: 'chooseObjects', ids: lands.slice(0, 2) } as never);
    s = drive(s);
    expect(s.pending?.kind, dump(s)).toBe('chooseTargets');
    expect((s.pending as never as { max: number }).max).toBe(2);
    s = answer(s, target([find(s, 'Test Low Relic', 'graveyard'), find(s, 'Test High Relic', 'graveyard')]));
    s = drive(passBoth(s));
    expect(names(s, 'hand')).toEqual(expect.arrayContaining(['Test Low Relic', 'Test High Relic']));
    expect(names(s, 'graveyard').filter((n) => n === 'Test Plain Land').length).toBe(2);
  });
  it('discarding one land allows one target only; declining the discard returns nothing', () => {
    let s = answer(start(), { kind: 'yesNo', yes: true });
    s = answer(s, { kind: 'chooseObjects', ids: [(s.pending as never as { options: string[] }).options[0]!] } as never);
    s = drive(s);
    expect((s.pending as never as { max: number }).max).toBe(1);
    const no = answer(start(), { kind: 'yesNo', yes: false });
    expect(no.pending?.kind === 'chooseTargets').toBe(false);
    expect(names(no, 'hand')).not.toContain('Test Low Relic');
  });
});
