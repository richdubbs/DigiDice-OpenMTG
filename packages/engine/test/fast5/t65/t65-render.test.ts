/**
 * FAST5 T65: the exact render gate (design 6.8, G6) for the readings the package added, and the parser readings (events, quantities, the superscript X) that
 * come with them. Nothing here is loosened for one sentence: a wording the JSON does not say is rejected.
 *
 *   joiner                 the last of three or more steps is also joined with the serial comma (", and")
 *   leaves without dying   CR 700.4, 603.6c: a zone change from the battlefield to every zone but a graveyard
 *   dies, shared wording   CR 700.4: several singular subjects that die share "is put into a graveyard from the battlefield"
 *   comparisons            comparisons of the statistics of one object are a parallel list ("its power ... or its toughness ...")
 *   entered this turn      CR 603.6a: "for each land that entered the battlefield under your control this turn"
 *   colors among           CR 105.1: "draw a card for each color among permanents you control"
 *   explore                CR 701.44a: "it explores X times", "explores twice"
 *   sacrifice any number   CR 701.21a: "sacrifice any number of A, B, and/or tokens, then draw that many cards"
 *   2 to the power X       CR 107.3: "target player draws 2ˣ cards" (the doubling steps)
 *   each player may        CR 608.2d, 608.2f: "each player may shuffle their hand and graveyard into their library, then each player who does draws N cards"
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern, Quantity } from '../../../src/types/ability';
import { WITHOUT_DYING } from '../../../src/types/ability';
import { tokenize } from '../../../src/parser/tokenize';
import { accepts, bound, draw, objTarget, playerTarget, rejects, self, spell, t, trig, you } from '../../m5/render/build';

const gain = (n: number): EffectStep => ({ op: 'gainLife', who: you, amount: n });
const scry = (n: number): EffectStep => ({ op: 'scry', who: you, count: n });
const counters = (on: unknown, kind: string, count: Quantity): EffectStep => ({ op: 'putCounters', on, kind, count }) as EffectStep;
const creature = { selfNames: ['Test Card'], selfTypes: ['Creature'] };

describe('the joiner: the last of three or more steps is also joined with the serial comma', () => {
  const three = spell([draw(), gain(1), scry(1)]);
  it('accepts "A, B, and C" and the older wordings of the same three steps', () => {
    accepts(three, 'Draw a card, gain 1 life, and scry 1.');
    accepts(three, 'Draw a card. Gain 1 life. Scry 1.');
    accepts(three, 'Draw a card, gain 1 life, then scry 1.');
  });
  it('rejects a different list: "or", a missing step, another order', () => {
    rejects(three, 'Draw a card, gain 1 life, or scry 1.');
    rejects(three, 'Draw a card and gain 1 life.');
    rejects(three, 'Draw a card, scry 1, and gain 1 life.');
  });
  it('two steps keep their own wording (no comma before the "and")', () => {
    const two = spell([draw(), gain(1)]);
    accepts(two, 'Draw a card and gain 1 life.');
    rejects(two, 'Draw a card, and gain 1 life.');
  });
});

describe('CR 700.4, 603.6c: "leaves the battlefield without dying"', () => {
  const left = (subject: Record<string, unknown>): EventPattern => ({ ev: 'zoneChange', subject, from: 'battlefield', to: [...WITHOUT_DYING] }) as EventPattern;
  it('is every zone but a graveyard: hand, library, exile and the command zone', () => {
    expect([...WITHOUT_DYING].sort()).toEqual(['command', 'exile', 'hand', 'library']);
  });
  it('accepts the wording for one subject, a batch and "~ or another"', () => {
    const one = trig([left({ types: ['Creature'], controller: 'you', other: true })], [draw()]);
    accepts(one, 'Whenever another creature you control leaves the battlefield without dying, draw a card.', creature);
    const batch = trig([left({ types: ['Creature'], controller: 'you', other: true })], [draw()], { batch: true });
    accepts(batch, 'Whenever one or more other creatures you control leave the battlefield without dying, draw a card.', creature);
    const two = trig([left({ self: true }), left({ types: ['Creature'], controller: 'you', other: true })], [draw()]);
    accepts(two, 'Whenever ~ or another creature you control leaves the battlefield without dying, draw a card.', creature);
  });
  it('rejects the wording for other zone sets, and the plain "leaves the battlefield" for this one', () => {
    const exileOnly = trig([{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: ['exile', 'hand'] } as EventPattern], [draw()]);
    rejects(exileOnly, 'Whenever a creature leaves the battlefield without dying, draw a card.', creature);
    const any = trig([{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield' } as EventPattern], [draw()]);
    rejects(any, 'Whenever a creature leaves the battlefield without dying, draw a card.', creature);
    accepts(any, 'Whenever a creature leaves the battlefield, draw a card.', creature);
    const dies = trig([{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' } as EventPattern], [draw()]);
    rejects(dies, 'Whenever a creature leaves the battlefield without dying, draw a card.', creature);
  });
});

describe('CR 700.4: several singular subjects that die share one wording', () => {
  const dies = (subject: Record<string, unknown>): EventPattern => ({ ev: 'zoneChange', subject, from: 'battlefield', to: 'graveyard' }) as EventPattern;
  const def = trig([dies({ types: ['Creature'], controller: 'you', other: true }), dies({ types: ['Land'], controller: 'you' })], [draw()]);
  it('accepts "A or B is put into a graveyard from the battlefield" and the two events apart', () => {
    accepts(def, 'Whenever another creature you control or a land you control is put into a graveyard from the battlefield, draw a card.', creature);
    accepts(def, 'Whenever another creature you control dies or a land you control is put into a graveyard from the battlefield, draw a card.', creature);
  });
  it('rejects "dies" for the land, a graveyard of another owner and "and"', () => {
    rejects(def, 'Whenever another creature you control or a land you control dies, draw a card.', creature);
    rejects(def, 'Whenever another creature you control and a land you control is put into a graveyard from the battlefield, draw a card.', creature);
    rejects(def, 'Whenever another creature you control or a land you control is put into your graveyard from the battlefield, draw a card.', creature);
  });
});

describe('comparisons of the statistics of one object are a parallel list', () => {
  const stat = (s: 'power' | 'toughness', of: unknown): Quantity => ({ q: 'stat', stat: s, of }) as Quantity;
  const subject = { ref: 'event', role: 'subject' };
  const bigger = (s: 'power' | 'toughness') => ({ cond: 'compare', left: stat(s, subject), op: '>', right: stat(s, self) });
  const def = trig([{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' } as EventPattern], [counters(self, '+1/+1', 1)],
    { interveningIf: { cond: 'any', of: [bigger('power'), bigger('toughness')] } });
  it('accepts "its power is greater than ~\'s power or its toughness is greater than ~\'s toughness"', () => {
    accepts(def, "Whenever a creature you control enters, if its power is greater than ~'s power or its toughness is greater than ~'s toughness, put a +1/+1 counter on ~.", creature);
  });
  it('rejects a list that names ~ for the second one, or "and"', () => {
    rejects(def, "Whenever a creature you control enters, if its power is greater than ~'s power and its toughness is greater than ~'s toughness, put a +1/+1 counter on ~.", creature);
    rejects(def, "Whenever a creature you control enters, if its power is greater than ~'s power or ~'s toughness is greater than its toughness, put a +1/+1 counter on ~.", creature);
  });
});

describe('CR 603.6a: "for each land that entered the battlefield under your control this turn"', () => {
  const entered = (types: string[]): Quantity => ({ q: 'happenedCount', event: { ev: 'zoneChange', subject: { types, controller: 'you' }, to: 'battlefield' }, scope: 'turn' }) as Quantity;
  const each = (count: Quantity): AbilityDef => ({
    kind: 'static', text: '',
    effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count }] } }],
  } as unknown as AbilityDef);
  it('accepts the wording for the lands you put onto the battlefield this turn', () => {
    accepts(each(entered(['Land'])), 'Each creature you control enters with an additional +1/+1 counter on it for each land that entered the battlefield under your control this turn.');
  });
  it('rejects another kind, a count of every player\'s lands and "a +1/+1 counter" without "additional"', () => {
    rejects(each(entered(['Land'])), 'Each creature you control enters with an additional +1/+1 counter on it for each creature that entered the battlefield under your control this turn.');
    rejects(each(entered(['Land'])), 'Each creature you control enters with an additional +1/+1 counter on it for each land that entered the battlefield this turn.');
    rejects(each(entered(['Land'])), 'Each creature you control enters with an additional +1/+1 counter on it for each land you control.');
  });
});

describe('CR 105.1: "draw a card for each color among ..."', () => {
  const colors = (filter: Record<string, unknown>): EffectStep => ({ op: 'draw', who: you, count: { q: 'distinct', what: 'colors', among: { ref: 'each', filter } } }) as EffectStep;
  it('is the number of colors among a set, in either wording', () => {
    accepts(spell([colors({ controller: 'you' })]), 'Draw a card for each color among permanents you control.');
    accepts(spell([colors({ controller: 'you' })]), 'Draw cards equal to the number of colors among permanents you control.');
    accepts(spell([colors({ controller: 'you', types: ['Artifact'] })]), 'Draw a card for each color among artifacts you control.');
  });
  it('rejects another noun and another kind of count', () => {
    rejects(spell([colors({ controller: 'you' })]), 'Draw a card for each creature type among permanents you control.');
    rejects(spell([colors({ controller: 'you' })]), 'Draw two cards for each color among permanents you control.');
  });
});

describe('CR 701.44a: "it explores X times", "explores twice"', () => {
  const explores = (n: Quantity): AbilityDef => trig([{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' } as EventPattern], [{ op: 'action', action: 'explore', who: { ref: 'controllerOf', object: self }, subject: self, n } as EffectStep]);
  it('says the number of times after the verb', () => {
    accepts(explores({ q: 'X' }), 'When ~ enters, it explores X times.', creature);
    accepts(explores(2), 'When ~ enters, it explores twice.', creature);
    accepts(explores(3), 'When ~ enters, it explores three times.', creature);
  });
  it('rejects the number as a bare word and a different count', () => {
    rejects(explores({ q: 'X' }), 'When ~ enters, it explores X.', creature);
    rejects(explores(2), 'When ~ enters, it explores three times.', creature);
  });
});

describe('CR 701.21a, 121.1, 608.2c: "sacrifice any number of A, B, and/or tokens, then draw that many cards"', () => {
  const steps = (kinds: Record<string, unknown>[]): EffectStep[] => [
    { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { controller: 'you', anyOf: kinds } }, min: 0, max: 'any', as: 'a' } as EffectStep,
    { op: 'sacrifice', what: bound('a'), as: 'b' } as EffectStep,
    { op: 'draw', who: you, count: { q: 'resultCount', step: 'b' } } as EffectStep,
  ];
  const three = [{ types: ['Artifact'] }, { types: ['Enchantment'] }, { token: true }];
  it('accepts the wording of three kinds the player controls', () => {
    accepts(spell(steps(three)), 'Sacrifice any number of artifacts, enchantments, and/or tokens, then draw that many cards.');
  });
  it('rejects "or", the opponent\'s permanents, another number of cards and a missing "then draw"', () => {
    rejects(spell(steps(three)), 'Sacrifice any number of artifacts, enchantments, or tokens, then draw that many cards.');
    rejects(spell(steps(three)), 'Sacrifice any number of artifacts, enchantments, and/or tokens you control, then draw that many cards.');
    rejects(spell(steps(three)), 'Sacrifice any number of artifacts, enchantments, and/or tokens, then draw two cards.');
    // r4-fxz: the choice and sacrifice alone now read as that sentence (render/fold.ts#sacrificeAnyList); the draw must still not go missing
    rejects(spell(steps(three)), 'Sacrifice any number of artifacts, enchantments, and/or tokens.');
  });
});

describe('CR 107.3, 608.2h: "target player draws 2ˣ cards"', () => {
  const pow = (times: Quantity = { q: 'X' }, base = 2): EffectStep[] => [
    { op: 'let', name: 'n', value: 1 } as EffectStep,
    { op: 'repeat', times, do: [{ op: 'let', name: 'n', value: { q: 'math', op: '*', args: [{ q: 'var', name: 'n' }, base] } }] } as EffectStep,
    { op: 'draw', who: t('p'), count: { q: 'var', name: 'n' } } as EffectStep,
  ];
  it('is 1 doubled X times', () => {
    accepts(spell(pow(), [playerTarget('p')]), 'Target player draws 2ˣ cards.');
  });
  it('rejects another base, a number of times that is not X and a different player', () => {
    rejects(spell(pow({ q: 'X' }, 3), [playerTarget('p')]), 'Target player draws 2ˣ cards.');
    rejects(spell(pow(3), [playerTarget('p')]), 'Target player draws 2ˣ cards.');
    accepts(spell(pow(), [playerTarget('p')]), 'Target player draws 2ˣ cards.');
    rejects(spell(pow(), [playerTarget('p')]), 'You draw 2ˣ cards.');
  });
  it('the tokenizer reads "2ˣ" as the number 2 and the word ˣ; a number glued to other letters is still not a number', () => {
    const toks = tokenize('draws 2ˣ cards');
    expect(toks.map((x) => `${x.kind}:${x.norm}`)).toEqual(['WORD:draws', 'NUM:2', 'WORD:ˣ', 'WORD:cards']);
    expect(tokenize('draws 2x cards').some((x) => x.kind === 'NUM')).toBe(false);
  });
});

describe('CR 608.2d, 608.2f, 701.24a: "each player may shuffle their hand and graveyard into their library, then each player who does draws N cards"', () => {
  const it0 = { ref: 'iterating' } as const;
  const group = (n: number, who: unknown = { ref: 'each', who: 'player' }): AbilityDef => spell([{
    op: 'may', who,
    do: [
      { op: 'move', what: { ref: 'each', filter: { zone: 'hand', owner: it0 } }, to: { zone: 'library', owner: it0 } },
      { op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', owner: it0 } }, to: { zone: 'library', owner: it0 } },
      { op: 'shuffle', who: it0 },
      { op: 'draw', who: it0, count: n },
    ],
  } as unknown as EffectStep]);
  it('accepts the wording for every player', () => {
    accepts(group(7), 'Each player may shuffle their hand and graveyard into their library, then each player who does draws seven cards.');
  });
  it('rejects another count, "an opponent", a missing "may" and a hand only', () => {
    rejects(group(7), 'Each player may shuffle their hand and graveyard into their library, then each player who does draws three cards.');
    rejects(group(7, { ref: 'each', who: 'opponent' }), 'Each player may shuffle their hand and graveyard into their library, then each player who does draws seven cards.');
    rejects(group(7), 'Each player shuffles their hand and graveyard into their library, then draws seven cards.');
    rejects(group(7), 'Each player may shuffle their hand into their library, then each player who does draws seven cards.');
  });
});

describe('CR 701.10e: "double the number of +1/+1 counters on each of those creatures" after a division', () => {
  const targets = [{ ...objTarget('c', { types: ['Creature'] }), min: 1, max: 3, divide: { what: 'counters', total: 3 } } as never];
  const def = spell([counters(t('c'), '+1/+1', 3), { op: 'action', action: 'doubleCounters', subject: t('c'), who: you, arg: '+1/+1' } as EffectStep], targets);
  it('accepts both wordings for the set named before', () => {
    accepts(def, 'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures.');
    accepts(def, 'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on those creatures.');
  });
  it('rejects a single target\'s "each of those" and another kind of counter', () => {
    rejects(def, 'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of -1/-1 counters on each of those creatures.');
    const one = spell([counters(t('c'), '+1/+1', 1), { op: 'action', action: 'doubleCounters', subject: t('c'), who: you, arg: '+1/+1' } as EffectStep], [objTarget('c')]);
    rejects(one, 'Put a +1/+1 counter on target creature, then double the number of +1/+1 counters on each of those creatures.');
    accepts(one, 'Put a +1/+1 counter on target creature, then double the number of +1/+1 counters on it.');
  });
});
