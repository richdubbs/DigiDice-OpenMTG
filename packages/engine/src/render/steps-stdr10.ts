/**
 * Standard round 10: the clause of `nextSpell` (CR 601.2i, 611.2): "the next spell you cast this turn can't be countered", "the next creature spell you cast this
 * turn can't be countered" (the spell's description from its filter, head noun "spell").
 * std-rx26: rider `keyword`, "the next noncreature spell you cast this turn has affinity for artifacts", "... has convoke" (CR 601.2f, 611.2).
 * std-freecast-1: rider `free`, "the next red or green creature spell you cast this turn can be cast without paying its mana cost" (CR 118.9, 611.2).
 */
import { plain, type Clause } from './clause';
import { K } from './kernel';
import { keywordWords } from './kw';
import type { RenderState } from './state';
import type { StepOf } from './steps-util';
import { NoRenderer } from './text';

export const CLAUSES_STDR10 = {
  nextSpell: (s: StepOf<'nextSpell'>, st: RenderState): Clause => {
    if (s.who.ref !== 'you') throw new NoRenderer('the next spell another player casts');
    if (s.rider !== 'cantBeCountered' && s.rider !== 'keyword' && s.rider !== 'free') throw new NoRenderer(`a next-spell rider ${String(s.rider)}`);
    const spell = s.filter === undefined ? 'spell' : K.np(s.filter, st, { det: 'none', noZone: true, noController: true });
    if (s.rider === 'keyword') {
      if (!s.keyword) throw new NoRenderer('a next-spell keyword rider without its keyword');
      return plain(`the next ${spell} you cast this turn has ${keywordWords(s.keyword, st)}`);
    }
    // std-freecast-1 (CR 118.9, 611.2): rider `free`
    if (s.rider === 'free') return plain(`the next ${spell} you cast this turn can be cast without paying its mana cost`);
    return plain(`the next ${spell} you cast this turn can't be countered`);
  },
};
