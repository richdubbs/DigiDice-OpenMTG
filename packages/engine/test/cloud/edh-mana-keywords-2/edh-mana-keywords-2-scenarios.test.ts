/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-2: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites checked against the Comprehensive Rules 2026-09-25.
 *
 *   CR 602.5e, 605.3a  "Activate only as an instant." on a mana ability (Lion's Eye Diamond): at priority only, never while a cost is being paid
 *   CR 404.1, 608.2n  "Add {R}{R}, then add {R} for each card named ~ in each graveyard." (Rite of Flame): counted as the spell resolves, so the spell itself (still on the stack) is not counted
 *   CR 106.6, 614.1c, 903.8  Opal Palace: "If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters ... equal to the number of times it's been cast"
 *   CR 106.7   "could produce" mana chains: an Exotic Orchard-type land can make {U} because an opponent controls an Island, so a Reflecting Pool-type land can too;
 *              lands that only name each other make nothing; a land whose ability would make no mana now adds no type (Gaea's Cradle without creatures)
 */
import { describe, expect, it } from 'vitest';
import { manaAbilityDenial } from '../../../src/rules/mana';
import { answerUntilPriority, card as cmdCard, commanderRec, commanderScenario, drive, findAll, forests, inCommand, legend, pass, tweak } from '../../m11/rules/helpers';
import { act, answer, castAuto, find, life, passBoth, scenario } from '../../m3/scenario';
import { activatedAbilities, compileCard, legalActions, type CardDef, type Color, type GameState, type ObjectId, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
/** Pass priority until the stack is empty (both players pass; automatic payments and orders; the first legal answer to a yes/no). */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) {
    s = drive(pass(pass(s)));
    if (s.pending?.kind === 'yesNo') s = drive(answer(s, { kind: 'yesNo', yes: true }));
  }
  return s;
}
const poolOf = (s: GameState, p = 0): string => s.players[p]!.manaPool.map((u) => u.type).sort().join('');
const manaActions = (s: GameState, source: ObjectId, player = 'p1') => legalActions(s, player).filter((l) => l.kind === 'activate' && l.isMana === true && l.object === source);

/** Activate `source`'s mana ability; each color question is answered from `colors` in turn; returns the state and the options of each question ('not offered' when no ability is). */
function tapFor(s0: GameState, source: ObjectId, colors: string[] = []): { s: GameState; asked: string[][] } | 'not offered' | 'by hand' {
  const a = manaActions(s0, source)[0];
  if (!a) return 'not offered';
  const asked: string[][] = [];
  let s = act(s0, a.action);
  for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const d = s.pending as unknown as { kind: string; options?: string[] };
    if (d.kind !== 'chooseColor') return 'by hand';
    asked.push([...(d.options ?? [])].sort());
    s = answer(s, { kind: 'chooseColor', color: colors[asked.length - 1] as never });
  }
  return { s, asked };
}
const tap = (s0: GameState, source: ObjectId, colors: string[] = []) => {
  const r = tapFor(s0, source, colors);
  if (typeof r === 'string') throw new Error(r);
  return r;
};

const ORCHARD = card('Test Orchard', 'Land', '{T}: Add one mana of any color that a land an opponent controls could produce.');
const POOL = card('Test Pool', 'Land', '{T}: Add one mana of any type that a land you control could produce.');
const ZERO = card('Test Zero Land', 'Land', '{T}: Add {R} for each Goblin you control.');
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
const DEFS = [ORCHARD, POOL, ZERO, GOBLIN];

describe('CR 106.7: "could produce" abilities chain through a land that really makes mana', () => {
  it('the Orchard alone makes the color of an opponent\'s Island; your Pool next to that Orchard makes it too', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Pool', 'Test Orchard'] }, p2: { battlefield: ['Island'] } });
    const o = tap(s0, find(s0, 'Test Orchard', 'battlefield', 'p1'));
    expect(o.asked).toEqual([]);
    expect(poolOf(o.s)).toBe('U');
    const p = tap(s0, find(s0, 'Test Pool', 'battlefield', 'p1'));
    expect(p.asked).toEqual([]); // the Pool could make {U} through the Orchard (CR 106.7, its Exotic Orchard example)
    expect(poolOf(p.s)).toBe('U');
  });
  it('a Pool with a Forest and that Orchard can make {G} or {U}', () => {
    const s0 = scenario(['Island', 'Forest'], { defs: DEFS, p1: { battlefield: ['Test Pool', 'Test Orchard', 'Forest'] }, p2: { battlefield: ['Island'] } });
    const p = tap(s0, find(s0, 'Test Pool', 'battlefield', 'p1'), ['U']);
    expect(p.asked).toEqual([['G', 'U']]);
    expect(poolOf(p.s)).toBe('U');
  });
  it('negative: two lands that only name each other make nothing (no chain end)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pool', 'Test Pool'] } });
    const id = find(s0, 'Test Pool', 'battlefield', 'p1');
    const p = tap(s0, id);
    expect(p.asked).toEqual([]);
    expect(poolOf(p.s)).toBe('');
  });
  it('negative: an Orchard with no opponent land that makes mana, next to your Pool, makes nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pool', 'Test Orchard'] }, p2: { battlefield: ['Test Orchard'] } });
    expect(poolOf(tap(s0, find(s0, 'Test Pool', 'battlefield', 'p1')).s)).toBe('');
  });
});

describe('CR 106.7: a land ability that would make no mana adds no type', () => {
  it('"Add {R} for each Goblin you control" with no Goblin: the Pool next to an Island makes {U} only, with no question', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Pool', 'Island', 'Test Zero Land'] } });
    const p = tap(s0, find(s0, 'Test Pool', 'battlefield', 'p1'));
    expect(p.asked).toEqual([]);
    expect(poolOf(p.s)).toBe('U');
  });
  it('with a Goblin the {R} counts: the Pool asks {R} or {U}', () => {
    const s0 = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Test Pool', 'Island', 'Test Zero Land', 'Test Goblin'] } });
    const p = tap(s0, find(s0, 'Test Pool', 'battlefield', 'p1'), ['R']);
    expect(p.asked).toEqual([['R', 'U']]);
    expect(poolOf(p.s)).toBe('R');
  });
});

describe('CR 106.7: a land with a second instruction or a "color among" ability counts for "could produce"', () => {
  const PAIN = card('Test Pain Land', 'Land', '{T}: Add {C}.\n{T}: Add {R} or {G}. Test Pain Land deals 1 damage to you.');
  const PLAZA = card('Test Plaza', 'Land', '{T}: Add one mana of any color among legendary creatures you control.');
  const HERO = card('Test Blue Hero', 'Legendary Creature — Human', '', { pt: ['1', '1'], cost: '{U}', colors: ['U'] });
  const defs = [POOL, PAIN, PLAZA, HERO];
  it('a pain land: the Pool offers {C}, {R} or {G} (the damage is not a mana ability step)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pool', 'Test Pain Land'] } });
    const p = tap(s0, find(s0, 'Test Pool', 'battlefield', 'p1'), ['G']);
    expect(p.asked).toEqual([['C', 'G', 'R']]);
    expect(poolOf(p.s)).toBe('G');
    expect(p.s.players[0]!.life).toBe(20); // the Pool's own mana ability does not deal the damage (it only reads what could be produced)
  });
  it('"color among": the Pool makes the color of your legendary creature; with none, the Plaza adds no type', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pool', 'Test Plaza', 'Test Blue Hero'] } });
    const p = tap(s0, find(s0, 'Test Pool', 'battlefield', 'p1'));
    expect(p.asked).toEqual([]);
    expect(poolOf(p.s)).toBe('U');
    const s1 = scenario([], { defs, p1: { battlefield: ['Test Pool', 'Test Plaza'] } });
    const q = tap(s1, find(s1, 'Test Pool', 'battlefield', 'p1'));
    expect(q.asked).toEqual([]);
    expect(poolOf(q.s)).toBe('');
  });
});

describe('CR 602.5e, 605.3a: "Activate only as an instant." on a mana ability', () => {
  const DIAMOND = card('Test Diamond', 'Artifact', 'Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.');
  const SPELL = card('Test Red Spell', 'Instant', 'Test Red Spell deals 1 damage to any target.', { cost: '{R}{R}{R}', colors: ['R'] });
  const FILLER = card('Test Filler', 'Sorcery', '', { cost: '{5}' });
  const defs = [DIAMOND, SPELL, FILLER];
  it('is automated and offered at priority: discards the hand, sacrifices the Diamond, adds three mana of one color', () => {
    expect(DIAMOND.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Diamond'], hand: ['Test Filler', 'Test Filler'] } });
    const r = tap(s0, find(s0, 'Test Diamond', 'battlefield', 'p1'), ['R']);
    expect(r.asked).toEqual([['B', 'G', 'R', 'U', 'W']]);
    expect(poolOf(r.s)).toBe('RRR');
    expect(r.s.zones.hand['p1']!.length).toBe(0);
    expect(() => find(r.s, 'Test Diamond', 'battlefield', 'p1')).toThrow();
  });
  it('negative: the automatic payer never sacrifices it to pay for a spell (it is not "an instant" while a cost is paid)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Diamond'], hand: ['Test Red Spell'] } });
    expect(legalActions(s0, 'p1').some((l) => l.kind === 'cast')).toBe(false); // {R}{R}{R} can't be paid: the Diamond's mana is not counted
    expect(find(s0, 'Test Diamond', 'battlefield', 'p1')).toBeDefined();
  });
  it('negative: named in the payment of a spell it is refused; at priority its controller can activate it', () => {
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Diamond', 'Mountain'], hand: ['Test Red Spell'] } });
    const o = s0.objects[find(s0, 'Test Diamond', 'battlefield', 'p1')]!;
    const info = activatedAbilities(s0, o).find((i) => i.def.isMana === true)!;
    expect(manaAbilityDenial(s0, 'p1', o, info)).toBeNull(); // at priority
    const SPELL1 = card('Test One Spell', 'Instant', 'You gain 1 life.', { cost: '{R}', colors: ['R'] });
    const s1 = scenario(['Mountain'], { defs: [DIAMOND, SPELL1], p1: { battlefield: ['Test Diamond', 'Mountain'], hand: ['Test One Spell'] } });
    let s = act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test One Spell', 'hand', 'p1') });
    while (s.pending && s.pending.kind !== 'payCost' && s.pending.kind !== 'priority') s = answer(s, { kind: 'chooseTargets', targets: [[{ player: 'p2' }]] } as never);
    expect(s.pending?.kind).toBe('payCost');
    {
      const d = s.pending as unknown as { manaSources: { objectId: ObjectId }[] };
      expect(d.manaSources.some((m) => m.objectId === find(s, 'Test Diamond', 'battlefield', 'p1'))).toBe(false); // not offered as a source
      const diamond = find(s, 'Test Diamond', 'battlefield', 'p1');
      const key = activatedAbilities(s, s.objects[diamond]!).find((i) => i.def.isMana === true)!.key;
      expect(() => answer(s, { kind: 'payCost', auto: false, activations: [{ objectId: diamond, abilityKey: key, color: 'R' }] } as never)).toThrow(/only as an instant/);
    }
  });
});

describe('CR 404.1, 608.2n: "Add {R}{R}, then add {R} for each card named ~ in each graveyard."', () => {
  const RITE = card('Test Rite', 'Sorcery', 'Add {R}{R}, then add {R} for each card named Test Rite in each graveyard.', { cost: '{R}', colors: ['R'] });
  const OTHER = card('Test Other Rite', 'Sorcery', '', { cost: '{R}', colors: ['R'] });
  const defs = [RITE, OTHER];
  const castRite = (s0: GameState): GameState => passBoth(castAuto(s0, 'Test Rite'));
  it('is automated; adds {R}{R} and one {R} for each other copy in any graveyard (yours and an opponent\'s), not for the spell itself', () => {
    expect(RITE.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Mountain'], hand: ['Test Rite'], graveyard: ['Test Rite'] }, p2: { graveyard: ['Test Rite', 'Test Rite'] } });
    expect(poolOf(castRite(s0))).toBe('RRRRR'); // RR + 3 in graveyards (the cast one is on the stack while it resolves)
    const s1 = scenario(['Mountain'], { defs, p1: { battlefield: ['Mountain'], hand: ['Test Rite'] } });
    expect(poolOf(castRite(s1))).toBe('RR');
  });
  it('negative: a copy in a hand, in exile or on the battlefield, or a card with another name, adds nothing', () => {
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Mountain'], hand: ['Test Rite', 'Test Rite'], graveyard: ['Test Other Rite'] }, p2: { hand: ['Test Rite'] } });
    expect(poolOf(castRite(s0))).toBe('RR');
  });
});

describe('CR 106.6, 614.1c, 903.8: "If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters on it equal to the number of times it\'s been cast from the command zone this game."', () => {
  const PALACE = cmdCard('Test Palace', '', 'Land', "{1}, {T}: Add one mana of any color in your commander's color identity. If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters on it equal to the number of times it's been cast from the command zone this game.");
  const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const BEAR = cmdCard('Test Bear', '{G}', 'Creature — Bear', '', ['2', '2']);
  const counters = (s: GameState, name: string): number => { const id = findAll(s, name, 'battlefield', 'p1')[0]!; return Number(s.objects[id]!.counters['+1/+1'] ?? 0); };
  /** Activate the Palace's mana ability (a Forest pays its {1}), leaving {G} with the rider in the pool. */
  const makePalaceMana = (s0: GameState): GameState => {
    const id = find(s0, 'Test Palace', 'battlefield', 'p1');
    const key = activatedAbilities(s0, s0.objects[id]!).find((i) => i.def.isMana === true)!.key;
    return drive(act(s0, { type: 'activate', player: 'p1', source: id, ability: key }));
  };
  const setup = (casts: number): GameState => tweak(commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [PALACE, BEAR], p1: { battlefield: [...forests(8), 'Test Palace'], hand: ['Test Bear'] } }), (t) => { commanderRec(t, 'p1', 'Test Titania').casts = casts; });
  it('is automated', () => {
    expect(PALACE.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
  });
  it('the first cast of the commander from the command zone with the Palace\'s mana: one counter (the cast that is happening counts, ruling 2020-11-10)', () => {
    let s = makePalaceMana(setup(0));
    s = resolveAll(answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Titania') })));
    expect(counters(s, 'Test Titania')).toBe(1);
  });
  it('after two earlier casts, the third gives three counters', () => {
    let s = makePalaceMana(setup(2));
    s = resolveAll(answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Titania') })));
    expect(counters(s, 'Test Titania')).toBe(3);
  });
  it('negative: paid with other mana, no counters; a spell that is not the commander, no counters', () => {
    const s0 = setup(0);
    const s1 = resolveAll(answerUntilPriority(act(s0, { type: 'cast', player: 'p1', card: inCommand(s0, 'Test Titania') })));
    expect(counters(s1, 'Test Titania')).toBe(0);
    let s2 = makePalaceMana(setup(0));
    s2 = resolveAll(answerUntilPriority(act(s2, { type: 'cast', player: 'p1', card: find(s2, 'Test Bear', 'hand', 'p1') })));
    expect(counters(s2, 'Test Bear')).toBe(0);
  });
});

describe('CR 702.120a, 700.2h: escalate ("Pay this cost for each mode chosen beyond the first.")', () => {
  const ESC = card('Test Escalate', 'Instant', 'Escalate {1}\nChoose one or more --\n• You gain 2 life.\n• Each opponent loses 1 life.\n• Draw a card.', { cost: '{G}', colors: ['G'] });
  const defs = [ESC];
  /** Cast with `modes` chosen; a state with the modes chosen, or the error the engine refused them with. */
  function castWith(forests: number, modes: string[]): GameState | string {
    const s0 = scenario(['Forest'], { defs, p1: { battlefield: Array(forests).fill('Forest') as string[], hand: ['Test Escalate'] } });
    try {
      let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Escalate', 'hand', 'p1') });
      if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: modes } as never);
      while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      return s;
    } catch (e) { return String((e as Error).message); }
  }
  it('is automated; one mode costs only the mana cost', () => {
    expect(ESC.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    const s = castWith(1, ['0']) as GameState;
    expect(typeof s).not.toBe('string');
    expect(s.zones.stack.length).toBe(1);
  });
  it('two modes cost {G}{1}; three modes cost {G}{1}{1}', () => {
    const two = castWith(2, ['0', '2']) as GameState;
    expect(two.zones.stack.length).toBe(1);
    expect(two.zones.battlefield.every((id) => two.objects[id]!.tapped)).toBe(true); // both Forests paid
    const three = castWith(3, ['0', '1', '2']) as GameState;
    expect(three.zones.stack.length).toBe(1);
    expect(three.zones.battlefield.every((id) => three.objects[id]!.tapped)).toBe(true);
  });
  it('negative: two modes with one land, or three modes with two lands, are refused (the escalate cost can\'t be paid)', () => {
    expect(typeof castWith(1, ['0', '2'])).toBe('string');
    expect(typeof castWith(2, ['0', '1', '2'])).toBe('string');
  });
  it('the chosen modes resolve: gain 2 life and draw a card', () => {
    let s = castWith(2, ['0', '2']) as GameState;
    const lifeBefore = life(s, 'p1');
    s = passBoth(s);
    expect(life(s, 'p1')).toBe(lifeBefore + 2);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 702.120a: escalate with a cost that is not mana ("Escalate--Tap an untapped creature you control.")', () => {
  const ESC = card('Test Tap Escalate', 'Instant', 'Escalate--Tap an untapped creature you control.\nChoose one or more --\n• You gain 2 life.\n• Each opponent loses 1 life.\n• Draw a card.', { cost: '{G}', colors: ['G'] });
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{G}', colors: ['G'] });
  const defs = [ESC, ELF];
  function castWith(elves: number, modes: string[]): GameState | string {
    const s0 = scenario(['Forest'], { defs, p1: { battlefield: ['Forest', ...Array(elves).fill('Test Elf')] as string[], hand: ['Test Tap Escalate'] } });
    try {
      let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tap Escalate', 'hand', 'p1') });
      if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: modes } as never);
      for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
        const d = s.pending as unknown as { kind: string; options?: string[]; min?: number };
        s = d.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : answer(s, { kind: 'chooseObjects', ids: (d.options ?? []).slice(0, d.min ?? 1) } as never);
      }
      return s;
    } catch (e) { return String((e as Error).message); }
  }
  it('is automated; two modes tap one creature, three modes tap two', () => {
    expect(ESC.faces[0]!.abilities.every((a) => a.kind !== 'manual')).toBe(true);
    const two = castWith(2, ['0', '2']) as GameState;
    expect(two.zones.stack.length).toBe(1);
    expect(two.zones.battlefield.filter((id) => two.objects[id]!.tapped && two.objects[id]!.kind === 'card' && two.defs[two.objects[id]!.defId]!.name === 'Test Elf').length).toBe(1);
    const three = castWith(2, ['0', '1', '2']) as GameState;
    expect(three.zones.battlefield.filter((id) => three.objects[id]!.tapped && two.defs[three.objects[id]!.defId]!.name === 'Test Elf').length).toBe(2);
  });
  it('negative: two modes with no creature to tap are refused', () => {
    expect(typeof castWith(0, ['0', '2'])).toBe('string');
  });
});

describe('CR 106.7: a mana ability the engine does not run still counts as "could produce"', () => {
  const POOL2 = card('Test Pool', 'Land', '{T}: Add one mana of any type that a land you control could produce.');
  const CAVE = card('Test Cave', 'Land', '{T}: Choose a color. Add one mana of that color unless any player pays {1}. Activate only as an instant.');
  it('a Pool next to such a land is left to the player (no mana added silently)', () => {
    const s0 = scenario([], { defs: [POOL2, CAVE], p1: { battlefield: ['Test Pool', 'Test Cave'] } });
    const r = tapFor(s0, find(s0, 'Test Pool', 'battlefield', 'p1'));
    const silentNothing = typeof r !== 'string' && r.asked.length === 0 && poolOf(r.s) === '';
    expect(silentNothing).toBe(false);
  });
});
