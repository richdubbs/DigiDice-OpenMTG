/**
 * PUSH1 T1 review fixes: the fail-closed paths of the macro and native keyword actions (design 10), the Army token's name (CR 111.4), and "you may tap it.
 * If you do, ..." when the permanent is already tapped (CR 701.26a, 608.2d, 118.12), and a manual "The token enters tapped and attacking." after the step that
 * created the token (design 6.7 T2). Synthetic wordings only (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, GameState } from '../../../src/index';
import { compileCard } from '../../../src/index';
import { answer, castAuto, find, passBoth, scenario, tweak } from '../helpers';
import { faceOf } from './support';

/** A card compiled from synthetic Oracle text by the game's default pipeline (the T1 templates included). */
function compiled(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{1}', ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as never);
}
/** A card whose abilities are given as JSON (the parser is bypassed). */
function built(name: string, type: string, abilities: AbilityDef[], pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: '(synthetic)', mana_cost: '{1}', ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as never, () => ({ abilities, unsupported: [] }));
}
/** An enchantment with one manual static ability: text the engine does not run. */
const manualStatic = (name: string, text: string): CardDef => built(name, 'Enchantment', [{ kind: 'manual', text, reason: 'not parsed', shape: 'static' } as AbilityDef]);

const lands = ['Forest', 'Forest', 'Forest', 'Forest'];
const CARDS = ['Forest', 'Plains', 'Grizzly Bears', 'Hill Giant'];
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const reasonOf = (s: GameState): string => (s.pending as unknown as { reason?: string }).reason ?? '';

// ---- CR 614.1a, design 10: every macro action another card's manual text replaces is resolved by hand --------------------------------------------------------

/** One spell per entry of manual-text.ts#MACRO_REPLACED, and the manual replacement that names that action. */
const MACROS: { verb: string; spell: string; targets: boolean }[] = [
  { verb: 'investigate', spell: 'Investigate, then you gain 1 life.', targets: false },
  { verb: 'explore', spell: 'You gain 1 life, then target creature you control explores.', targets: true },
  { verb: 'connive', spell: 'Target creature you control connives.', targets: true },
  { verb: 'amass', spell: 'Amass Zombies 2, then you gain 1 life.', targets: false },
  { verb: 'incubate', spell: 'Incubate 2, then you gain 1 life.', targets: false },
  { verb: 'populate', spell: 'Populate, then you gain 1 life.', targets: false },
];

describe('CR 614.1a, design 10: a macro action that manual text replaces ("If ... would <verb>, instead ...") is resolved by hand, for every macro of the table', () => {
  for (const m of MACROS) {
    it(`${m.verb}: with a manual "would ${m.verb}" replacement in play, the players resolve the action by hand`, () => {
      const spell = compiled(`Test ${m.verb} Spell`, 'Sorcery', m.spell);
      const swap = manualStatic('Test Swap', `If you would ${m.verb}, instead you gain 2 life.`);
      const s0 = scenario(CARDS, { defs: [spell, swap], p1: { hand: [spell.name], battlefield: [...lands, 'Test Swap', 'Grizzly Bears'] } });
      const bears = find(s0, 'Grizzly Bears', 'battlefield');
      const answers = m.targets ? [{ kind: 'chooseTargets' as const, targets: [{ kind: 'object' as const, id: bears }] }] : [];
      const s = passBoth(castAuto(s0, spell.name, { answers }));
      expect(s.pending, m.verb).toMatchObject({ kind: 'manualResolve', player: 'p1' });
      expect(reasonOf(s), m.verb).toContain(`${m.verb} is replaced by an ability the engine does not run (CR 614.1a), Test Swap`);
    });
  }
});

// ---- CR 701.39a: bolster fails closed --------------------------------------------------------------------------------------------------------------------------

describe('CR 701.39a, design 10: bolster is resolved by hand whenever "the least toughness among creatures you control" is not plainly known', () => {
  const rally = compiled('Test Rally', 'Sorcery', 'Bolster 3, then you gain 1 life.');

  it('manual text that replaces bolstering ("would bolster") makes the bolster manual', () => {
    const swap = manualStatic('Test Swap', 'If you would bolster, instead bolster that many plus one.');
    const s0 = scenario(CARDS, { defs: [rally, swap], p1: { hand: ['Test Rally'], battlefield: [...lands, 'Test Swap', 'Grizzly Bears'] } });
    const s = passBoth(castAuto(s0, 'Test Rally'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    expect(reasonOf(s)).toMatch(/^bolster is modified by an ability the engine does not run, Test Swap/);
    expect(s.objects[find(s, 'Grizzly Bears', 'battlefield')]!.counters).toEqual({});
  });

  it('another player bolsters ("an opponent bolsters 2"): the creatures they control are no filter the engine has, so it is manual', () => {
    const theirs = built('Test Gift', 'Sorcery', [{ kind: 'spell', effect: { targets: [], steps: [{ op: 'action', action: 'bolster', who: { ref: 'anOpponent' }, n: 2 }] } } as unknown as AbilityDef]);
    const s0 = scenario(CARDS, { defs: [theirs], p1: { hand: ['Test Gift'], battlefield: [...lands, 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const s = passBoth(castAuto(s0, 'Test Gift'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    expect(reasonOf(s)).toMatch(/another player bolsters/);
    expect(s.objects[find(s, 'Hill Giant', 'battlefield')]!.counters).toEqual({});
  });

  it('a creature whose toughness is an unset "*" (CR 208.2) makes the least toughness unknowable: manual', () => {
    const odd = built('Test Shapeless', 'Creature — Test', [], ['*', '*']);
    const s0 = scenario(CARDS, { defs: [rally, odd], p1: { hand: ['Test Rally'], battlefield: [...lands, 'Test Shapeless', 'Hill Giant'] } });
    const s = passBoth(castAuto(s0, 'Test Rally'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    expect(reasonOf(s)).toMatch(/the toughness of Test Shapeless cannot be determined/);
    expect(s.objects[find(s, 'Hill Giant', 'battlefield')]!.counters).toEqual({});
  });
});

// ---- CR 701.47a, 111.4: the Army token's name --------------------------------------------------------------------------------------------------------------

describe('CR 701.47a, 111.4: amass creates a token named after its subtypes plus "Token"', () => {
  it('"Amass Orcs 2" with no Army: an Orc Army Token, 0/0 with two +1/+1 counters', () => {
    const muster = compiled('Test Muster', 'Sorcery', 'Amass Orcs 2, then you gain 1 life.');
    const s0 = scenario(CARDS, { defs: [muster], p1: { hand: ['Test Muster'], battlefield: lands } });
    const s = passBoth(castAuto(s0, 'Test Muster'));
    const army = s.zones.battlefield.filter((id) => s.objects[id]!.counters['+1/+1'] === 2);
    expect(army.map((id) => nameOf(s, id))).toEqual(['Orc Army Token']);
  });
});

// ---- CR 701.26a, 608.2d, 118.12: "you may tap it. If you do, ..." ----------------------------------------------------------------------------------------------

describe('CR 701.26a, 608.2d, 118.12: "you may tap it" is impossible for a tapped permanent, so "if you do" is false', () => {
  const tapper = compiled('Test Tapper', 'Creature — Test', 'When this creature enters, you may tap it. If you do, you gain 3 life.', ['1', '1']);
  const untapper = compiled('Test Untapper', 'Creature — Test', 'When this creature enters, you may untap it. If you do, you gain 3 life.', ['1', '1']);
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

  /** The creature resolves; with its enters trigger on the stack, `setTapped` sets the creature's tapped state; then the trigger resolves. */
  function resolveWith(def: CardDef, setTapped: boolean): GameState {
    const s0 = scenario(CARDS, { defs: [tapper, untapper], p1: { hand: [def.name], battlefield: lands } });
    const s1 = passBoth(castAuto(s0, def.name));
    expect(s1.zones.stack.length, 'the enters trigger is on the stack').toBe(1);
    const id = find(s1, def.name, 'battlefield');
    return passBoth(tweak(s1, (t) => { t.objects[id]!.tapped = setTapped; }));
  }

  it('already tapped: the player is not asked, does not tap it, and gains no life', () => {
    const s = resolveWith(tapper, true);
    expect(s.pending?.kind).toBe('priority');
    expect(life(s, 'p1')).toBe(20);
  });

  it('untapped: the player is asked; yes taps it and the "if you do" part happens', () => {
    const asked = resolveWith(tapper, false);
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    const s = answer(asked, { kind: 'yesNo', yes: true });
    expect(s.objects[find(s, 'Test Tapper', 'battlefield')]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(23);
  });

  it('CR 701.26b: "you may untap it" for an untapped permanent is impossible too', () => {
    const s = resolveWith(untapper, false);
    expect(s.pending?.kind).toBe('priority');
    expect(life(s, 'p1')).toBe(20);
    const asked = resolveWith(untapper, true);
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
  });
});

// ---- design 6.7 T2: "The token enters tapped and attacking." changes how a token created by an earlier step entered ----------------------------------------------

describe('design 6.7 T2, CR 508.4: a manual "the token(s) enter(s) tapped and attacking" after the step that created the token makes the whole program manual', () => {
  const riders: [string, string][] = [
    ['populate', 'Whenever this creature attacks, you gain 1 life, then populate. The token enters tapped and attacking.'],
    ['createToken', 'Whenever this creature attacks, create a 2/2 black Zombie creature token. That token enters tapped and attacking.'],
  ];
  for (const [maker, text] of riders) {
    it(`${maker} then the rider: no automated step creates the token untapped and not attacking`, () => {
      const f = faceOf('Creature — Test', text);
      const trig = f.abilities.find((a) => a.kind === 'triggered') as { effect: { steps: { op: string }[] } } | undefined;
      expect(trig, JSON.stringify(f.abilities)).toBeDefined();
      expect(trig!.effect.steps.map((x) => x.op), JSON.stringify(trig)).toEqual(['manual']);
      expect(f.diagnostics.some((d) => d.code === 'contagion' && d.level === 'manual'), JSON.stringify(f.diagnostics)).toBe(true);
    });
  }
  it('the same sentence with no token made before it stays a manual step of its own (Frost Breath rule): the step before it is still automated', () => {
    const f = faceOf('Creature — Test', 'Whenever this creature attacks, you gain 1 life. The token enters tapped and attacking.');
    const trig = f.abilities.find((a) => a.kind === 'triggered') as { effect: { steps: { op: string }[] } } | undefined;
    expect(trig?.effect.steps.map((x) => x.op)).toEqual(['gainLife', 'manual']);
  });
});
