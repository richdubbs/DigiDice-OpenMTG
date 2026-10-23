/**
 * The lowering support WP23's templates need (each an INTERFACE CHANGE outside the template files, kept as small as the rule it implements):
 *
 *   lower/riders.ts       rider patches may refer to the step they modify: "@previous" / "@previous.<path>", {"@new": X} (set only when absent) and
 *                         "@replace": true (the self-replacement fold of CR 614.15, accepted only after a sentence of ONE step)
 *   lower/conditions.ts   "If you do / don't" after a delayed trigger continues it (CR 603.7); `delay` is not an action for `did`; "When you do" is a
 *                         reflexive trigger (CR 603.12) whose targets move into it (CR 603.12a)
 *   lower/normalize.ts    a delayed trigger captures the bound names its instructions read (CR 603.7c)
 *   lower/mentions.ts     inside a "for each" step its iteration variable is a mention (CR 608.2f)
 *   parse.ts              CR 607.2a: "the exiled card" is linked to the one instruction of the face that exiles
 *   holes/object.ts       "the creature" is an anaphor like "that creature" (design 6.4)
 *   holes/cond.ts         "the player does / doesn't" is "if you do" for a player named just before (CR 118.12)
 *   render/steps-flow.ts  an `if` with an `else` also reads "Y. If C, X instead." (CR 614.15); "for each opponent / player" (CR 608.2f)
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep } from '../../../src/types/ability';
import { applyRider, mergePatch, resolvePrevious } from '../../../src/parser/lower/riders';
import { delayCaptures } from '../../../src/parser/lower/normalize';
import { EXILED_LINK, linkExiled } from '../../../src/parser/parse';
import { renderGate } from '../../../src/render/gate';
import { adaptTokens, runHole } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import { automated, bare, card, face, options } from './support';

const opts = options();
const steps = (a: AbilityDef | undefined): EffectStep[] => (a as { effect: { steps: EffectStep[] } }).effect.steps;
const spell = (text: string): AbilityDef[] => face(card('Test Spell', 'Instant', text), opts).abilities;

describe('riders refer to the step they modify (lower/riders.ts, CR 608.2c)', () => {
  const prev = { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { set: ['Artifact', 'Creature'] } }] }] };

  it('CR 205.1b: "@previous.<path>" moves the types an effect set into an addition, whatever they were (an artifact creature stays an artifact creature)', () => {
    const patch = { effects: [{ mods: [{ types: { add: '@previous.effects.0.mods.0.types.set', set: null } }] }] };
    expect(applyRider(prev, patch, 1)).toMatchObject({ effects: [{ mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] } }] }] });
    expect((applyRider(prev, patch, 1) as { effects: { mods: { types: Record<string, unknown> }[] }[] }).effects[0]!.mods[0]!.types['set']).toBeUndefined();
  });

  it('a reference to something the previous step does not have refuses the rider (never a half merge)', () => {
    expect(() => applyRider({ op: 'draw', who: { ref: 'you' }, count: 1 }, { effects: [{ mods: [{ types: { add: '@previous.effects.0.mods.0.types.set' } }] }] }, 1)).toThrow(/no effects/);
  });

  it('{"@new": X} sets a key only when the previous step does not have it ("Otherwise" twice is refused)', () => {
    const iff = { op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] };
    const once = mergePatch(iff, { else: { '@new': [{ op: 'draw', who: { ref: 'you' }, count: 2 }] } }) as Record<string, unknown>;
    expect(once['else']).toEqual([{ op: 'draw', who: { ref: 'you' }, count: 2 }]);
    expect(() => mergePatch(once, { else: { '@new': [] } })).toThrow(/already has else/);
  });

  it('CR 614.15: "@replace" makes the previous step the else branch of an `if`, only after a sentence of one step', () => {
    const draw = { op: 'draw', who: { ref: 'you' }, count: 1 };
    const patch = { '@replace': true, op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 2 }], else: ['@previous'] };
    expect(applyRider(draw, patch, 1)).toEqual({ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 2 }], else: [draw] });
    expect(() => applyRider(draw, patch, 2)).toThrow(/several instructions/);
    expect(resolvePrevious(['@previous', 'x'], draw)).toEqual([draw, 'x']);
  });

  it('CR 614.15: "X and Y. If C, Z instead." stays manual (which instruction is replaced is not known), and "instead" makes the whole program manual (T2)', () => {
    const defs = spell('Draw a card and target player draws a card. If you control an Elf, draw three cards instead.');
    expect(automated(defs)).toBe(false);
    expect(JSON.stringify(defs)).not.toContain('"op":"if"');
  });

  it('CR 614.15: "Y. If C, X instead." folds into if/else and passes the exact render gate', () => {
    const f = face(card('Test Spell', 'Instant', "Target creature gets +2/+2 until end of turn. If it's your turn, that creature gets +4/+4 until end of turn instead."), opts);
    expect(automated(f.abilities)).toBe(true);
    expect(f.gate[0]!.ok).toBe(true);
    expect(steps(f.abilities[0])[0]).toMatchObject({ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'effect' }], else: [{ op: 'effect' }] });
  });
});

describe('CR 603.7: a delayed trigger keeps its instructions and its objects (lower/conditions.ts, lower/normalize.ts)', () => {
  it('"At the beginning of your next upkeep, pay {2}. If you don\'t, ..." moves the "if you don\'t" into the delayed trigger, folded into the pay (CR 118.12)', () => {
    const s = steps(spell("Draw a card. At the beginning of your next upkeep, pay {2}. If you don't, you lose the game.")[0]);
    expect(s).toEqual([
      { op: 'draw', who: { ref: 'you' }, count: 1 },
      { op: 'delay', when: { at: 'step', step: 'upkeep', whose: 'you', next: true }, do: [{ op: 'pay', who: { ref: 'you' }, cost: { mana: [{ kind: 'generic', amount: 2 }] }, else: [{ op: 'loseGame', who: { ref: 'you' } }] }] },
    ]);
  });

  it('"If you do" after a delayed trigger whose last instruction is not a payment names that instruction inside the trigger', () => {
    // (r3-fx: no target inside the delayed sentence: the delayed ability would choose it when it triggers, CR 603.3d, so such a sentence is manual)
    const s = steps(spell('At the beginning of the next end step, you draw a card. If you do, you gain 2 life.')[0]);
    expect(s).toEqual([{
      op: 'delay', when: { at: 'step', step: 'end', next: true },
      do: [{ op: 'draw', who: { ref: 'you' }, count: 1, as: 'did' }, { op: 'if', cond: { cond: 'did', step: 'did' }, then: [{ op: 'gainLife', who: { ref: 'you' }, amount: 2 }] }],
    }]);
  });

  it('creating a delayed trigger is never what "you do" refers to: the sentence stays manual, never bound to the `delay` step', () => {
    const defs = spell('Draw a card at the beginning of the next end step. You may discard a card. If you do, draw a card.');
    expect(JSON.stringify(defs)).not.toMatch(/"op":"delay"[^\]]*"as":/);
  });

  it('CR 603.7c: the names a delayed trigger reads are captured (Sneak Attack shape), and the lint accepts them', () => {
    const s = steps(face(card('Test Sneak', 'Enchantment', '{R}: You may put a creature card from your hand onto the battlefield. Sacrifice the creature at the beginning of the next end step.'), opts).abilities[0]);
    expect(s[2]).toEqual({ op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [{ op: 'sacrifice', what: { ref: 'bound', name: 'put' } }], capture: ['put'] });
    expect(delayCaptures([{ op: 'move', what: { ref: 'bound', name: 'a' }, as: 'b', to: { zone: 'exile' } }, { op: 'tap', what: { ref: 'bound', name: 'b' } }])).toEqual(['a']);
  });
});

describe('CR 603.12: "When you do" is a reflexive trigger (lower/conditions.ts)', () => {
  it('it waits for the `did` of the instruction right before it, and its targets are its own (chosen when it is put on the stack, CR 603.12a)', () => {
    const p = (spell('You may discard a card. When you do, destroy target artifact.')[0] as { effect: { targets: unknown[]; steps: EffectStep[] } }).effect;
    expect(p.targets).toEqual([]);
    expect(p.steps).toEqual([
      { op: 'may', who: { ref: 'you' }, do: [{ op: 'discard', who: { ref: 'you' }, count: 1 }], as: 'did' },
      { op: 'reflexive', when: { did: 'did' }, targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target artifact', filter: { types: ['Artifact'] } }], do: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] },
    ]);
  });

  it('"when you don\'t" is not a reflexive trigger: manual', () => {
    expect(automated(spell("You may discard a card. When you don't, draw a card."))).toBe(false);
  });

  it('FAST5 T39 (CR 603.7c, 608.2c): a reflexive trigger that only refers to a target of the sentence before it keeps that target, chosen once, and has none of its own', () => {
    const p = (spell('Tap target creature. When you do, destroy that creature.')[0] as { effect: { targets: unknown[]; steps: EffectStep[] } }).effect;
    expect(p.targets).toEqual([{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }]);
    expect(p.steps).toEqual([
      { op: 'tap', what: { ref: 'target', id: 't0' }, as: 'did' },
      { op: 'reflexive', when: { did: 'did' }, targets: [], do: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] },
    ]);
  });
});

describe('CR 608.2f: "for each" names the player or object of the current iteration (lower/mentions.ts, render/steps-flow.ts)', () => {
  it('"For each opponent, that player discards a card" binds "that player" to the iteration', () => {
    expect(steps(spell('For each opponent, that player discards a card.')[0])).toEqual([
      { op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: 'each', do: [{ op: 'discard', who: { ref: 'bound', name: 'each' }, count: 1 }] },
    ]);
  });

  it('the renderer writes the players of the iteration ("for each opponent", "for each player")', () => {
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'forEach', over: { ref: 'each', who: 'player' }, as: 'p', do: [{ op: 'draw', who: { ref: 'bound', name: 'p' }, count: 1 }] }] } };
    expect(renderGate(def, ['For each player, that player draws a card.'], { selfNames: ['Test Spell'] }).ok).toBe(true);
  });
});

describe('CR 607.2a: "the exiled card" reads what the one exiling instruction of the face exiled (parse.ts#linkExiled)', () => {
  const exile = (link?: string): AbilityDef => ({ kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], steps: [{ op: 'move', what: { ref: 'self' }, to: { zone: 'exile' }, ...(link ? { link } : {}) }] } });
  const back: AbilityDef = { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }] }, effect: { targets: [], steps: [{ op: 'move', what: { ref: 'linked', link: EXILED_LINK }, to: { zone: 'battlefield', controller: 'owner' } }] } };

  it('one producer: it gets the link; the input is not changed', () => {
    const input = [exile(), back];
    const r = linkExiled(input);
    expect(r.unlinked).toEqual([]);
    expect(steps(r.producers.get(0))[0]).toMatchObject({ link: EXILED_LINK });
    expect(steps(input[0])[0]).not.toHaveProperty('link');
  });

  it('no producer, or two: the readers are unlinked (they become manual, never a guess)', () => {
    expect(linkExiled([back]).unlinked).toEqual([0]);
    expect(linkExiled([exile(), exile(), back]).unlinked).toEqual([2]);
    expect(linkExiled([exile()]).producers.size).toBe(0);
  });

  it('an ability that exiles and reads "the exiled card" itself is not a linked pair (CR 607.2a links two abilities): unlinked', () => {
    const both: AbilityDef = { ...back, effect: { targets: [], steps: [...steps(exile()), ...steps(back)] } };
    expect(linkExiled([both]).unlinked).toEqual([0]);
    expect(linkExiled([exile(), both]).unlinked).toEqual([1]);
  });

  it('a face whose reader has no producer: the reader is a manual ability and its text is manual in the ledger', () => {
    const f = face(card('Test Warden', 'Creature — Spirit', "When ~ leaves the battlefield, return the exiled card to the battlefield under its owner's control."), opts);
    expect(f.abilities[0]).toMatchObject({ kind: 'manual', shape: 'triggered' });
    expect(f.ledger.some((l) => l.status === 'consumed')).toBe(false);
  });

  it('an activated reader with no producer stays an activated manual ability that keeps its cost and its restriction (CR 602.2, 602.5d)', () => {
    const f = face(card('Test Vault', 'Artifact', "{2}, {T}: Return the exiled card to its owner's hand. Activate only as a sorcery."), opts);
    expect(f.abilities[0]).toMatchObject({ kind: 'manual', shape: 'activated', cost: { mana: [{ kind: 'generic', amount: 2 }], tap: true }, sorcerySpeed: true });
  });
});

describe('hole additions (design 6.4, CR 118.12)', () => {
  const toks = (t: string) => adaptTokens(tokenize(t));
  const env = { lexicon: opts.lexicon, keywords: opts.keywords };

  it('"the creature" is a singular anaphor with its head noun (Obj)', () => {
    const alts = runHole('Obj', toks('the creature'), 0, env).filter((a) => a.end === 2);
    expect(alts.map((a) => a.value)).toEqual([{ ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', head: 'creature', text: 'the creature' } }]);
  });

  it('"the player doesn\'t" is a `did` condition (Cond), "the player does" too', () => {
    expect(runHole('Cond', toks("the player doesn't"), 0, env).map((a) => a.value)).toContainEqual({ cond: 'did', step: '', $step: 'previous', not: true });
    expect(runHole('Cond', toks('the player does'), 0, env).map((a) => a.value)).toContainEqual({ cond: 'did', step: '', $step: 'previous' });
  });

  it('the "instead" reading is offered only with an else branch: "If C, X." still renders one way', () => {
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 2 }] }] } };
    expect(renderGate(def, ["If it's your turn, draw two cards."], { selfNames: ['Test Spell'] }).ok).toBe(true);
    expect(renderGate(def, ["If it's your turn, draw two cards instead."], { selfNames: ['Test Spell'] }).ok).toBe(false);
    expect(bare([def])).toHaveLength(1);
  });
});
