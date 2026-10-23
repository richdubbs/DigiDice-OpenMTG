/**
 * The scope of a lead-in "if" (parser/chart.ts#leadInIfCutShort, Cloud std-fin; design 6.3 rule 3). Rules cited: CR 608.2c (instructions are followed in the
 * order written; a lead-in "If C," conditions every instruction of its sentence, and Oracle starts a new sentence for an instruction that is not conditional).
 * Guard G5 (two readings with different JSON make the unit manual).
 *
 * "If C, A and B." has two derivations: the lead-in's own {e:Effects} reads "A and B" (`if C then [A, B]`), or a sequence item joins B to a lead-in that ends
 * after A (`[if C then [A]], B`). The second is never built when the joiner is ",", "and" or "then": the left child of that sequence item is itself an Effects
 * node (effects-first, or effects-next after an earlier instruction), and the rule reads its LAST effect template through every nested Effects node. B having
 * a subject of its own ("each opponent loses 2 life and you gain 2 life") changes nothing. The sentence mark (". " and ". then") is not affected.
 */
import { describe, expect, it } from 'vitest';
import type { ChartInput, ChartResult } from '../../../src/parser/chart';
import { chartInputFrom, parseUnit } from '../../../src/parser/chart';
import type { Template, TemplateKind } from '../../../src/parser/types';
import { adaptTokens, faceContexts, preprocessFace, selfExtents, tokenize } from '../../../src/index';
import { defaultParseOptions } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card } from '../templates/support';
import { ENV, toks } from './env';

let seq = 0;
function tpl(kind: TemplateKind, pattern: string, build: unknown, extra: Partial<Template> = {}): Template {
  return { id: extra.id ?? `li${++seq}`, kind, cr: ['CR 608.2c'], pattern, build, examples: [{ text: 'x' }], counterExamples: ['a', 'b'], status: 'stable', since: 1, ...extra };
}

/** The instructions of a reading as a short shape: `if(destroy+draw)+draw`. */
function shape(steps: unknown): string {
  return (steps as { op: string; then?: unknown }[]).map((s) => (s.op === 'if' ? `if(${shape(s.then)})` : s.op)).join('+');
}
/** The shapes of every reading the chart kept: one for `ok`, all of them for `ambiguous`. */
function shapes(r: ChartResult): string[] {
  if (r.status === 'ok') return [shape(r.derivation.value)];
  if (r.status === 'ambiguous') return r.alternatives.map((d) => shape(d.value)).sort();
  throw new Error(`expected ok or ambiguous, got ${JSON.stringify(r).slice(0, 600)}`);
}

describe('a lead-in "if" conditions its whole sentence (synthetic templates; CR 608.2c, design 6.3 rule 3)', () => {
  // the shape of cond.if (parser/templates/condition.json): consumes "if", starts with "if", ends with its instructions
  const LEAD_IN = tpl('effect', 'if {c:Cond} , {e:Effects}', { op: 'if', cond: '$c', then: '$e' }, { id: 'cond.if', consumes: ['if'] });
  const T: Template[] = [
    LEAD_IN,
    tpl('effect', 'destroy {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'eff.destroy' }),
    tpl('effect', '{p:Player} draw[s] {n:Qty} card[s]', { op: 'draw', who: '$p', count: '$n' }, { id: 'eff.draw' }),
  ];
  const run = (text: string): ChartResult => parseUnit({ tokens: toks(text), templates: T, env: ENV, goal: 'effect' } satisfies ChartInput);

  it.each([
    ['and', "if it's your turn, destroy target creature and you draw a card"],
    [',', "if it's your turn, destroy target creature, you draw a card"],
    ['then', "if it's your turn, destroy target creature then you draw a card"],
    [', then', "if it's your turn, destroy target creature, then you draw a card"],
    [', and', "if it's your turn, destroy target creature, and you draw a card"],
  ])('"If C, A %s B" (B with its own subject) is the one reading `if C then [A, B]`: the left child of the cut-short item is an Effects node', (_joiner, text) => {
    const r = run(text);
    expect(r.status).toBe('ok');
    expect(shapes(r)).toEqual(['if(destroy+draw)']);
  });

  it('"If C, A, B, then D" is one `if` over all three: every cut-short item has an Effects left child ending in the lead-in, at any depth', () => {
    expect(shapes(run("if it's your turn, destroy target creature, you draw a card, then target player draws two cards"))).toEqual(['if(destroy+draw+draw)']);
  });

  it('a lead-in after an earlier sentence: the left child of the cut-short item is an effects-next node (the earlier sentence, then the lead-in)', () => {
    expect(shapes(run("you draw a card. if it's your turn, destroy target creature and you draw a card"))).toEqual(['draw+if(destroy+draw)']);
  });

  it.each([
    ['.', "if it's your turn, destroy target creature. you draw a card"],
    ['. then', "if it's your turn, destroy target creature. then you draw a card"],
  ])('the sentence mark "%s" is not affected: the reading with B outside the condition is still built', (_joiner, text) => {
    // Oracle's "If C, A. B." leaves B unconditional; the card pipeline charts each sentence as its own unit, so this only shows the rule leaves "." alone
    expect(shapes(run(text))).toEqual(['if(destroy)+draw', 'if(destroy+draw)']);
  });
});

describe('the default template set: "If C, A and B." with B its own subject (cond.if; CR 608.2c)', () => {
  const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
  /** The chart result of a whole sentence of a sorcery, on the tokens the parser charts (as `npm run cards -- try "<sentence>" --type Sorcery` does). */
  function chart(text: string): ChartResult {
    const pre = preprocessFace(faceContexts(card('Lead-In Test', 'Sorcery', text), OPTS)[0]!, OPTS);
    const tokens = adaptTokens(tokenize(pre.parse, { from: 0, to: pre.parse.length, lexicon: OPTS.lexicon, selfExtents: selfExtents(pre) }));
    return parseUnit(chartInputFrom(OPTS, tokens, 'effects'));
  }

  // the shapes of Soul-Shackled Zombie, Graveyard Trespasser, Warren Weirding, Civilized Scholar and Corpse Appraiser, with conditions this template set reads
  it.each([
    ['If a creature card was exiled this way, each opponent loses 1 life and you gain 1 life.', 'if(loseLife+gainLife)'],
    ['If you control a Zombie, each opponent loses 2 life and you gain 2 life.', 'if(loseLife+gainLife)'],
    ['If you control a Goblin, target player creates two 1/1 black Goblin Rogue creature tokens, and those tokens gain haste until end of turn.', 'if(createToken+effect)'],
    ['If you control a Human, untap ~, then transform it.', 'if(untap+changeFace)'],
    ['If you control a Zombie, look at the top three cards of your library, then put one of those cards into your hand and the rest into your graveyard.', 'if(look+chooseObjects+move+move)'],
  ])('"%s" is the one reading `if C then [...]`', (text, expected) => {
    const r = chart(text);
    expect(r.status).toBe('ok');
    expect(shapes(r)).toEqual([expected]);
  });

  it('"If C, A. B." keeps both readings at the chart (the sentence mark is not affected; the card pipeline charts the two sentences apart)', () => {
    expect(shapes(chart('If you control a Zombie, each opponent loses 2 life. You gain 2 life.'))).toEqual(['if(loseLife)+gainLife', 'if(loseLife+gainLife)']);
  });
});
