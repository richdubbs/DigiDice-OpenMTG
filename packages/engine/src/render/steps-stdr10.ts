/**
 * Standard round 10: the clause of `nextSpell` (CR 601.2i, 611.2): "the next spell you cast this turn can't be countered", "the next creature spell you cast this
 * turn can't be countered" (the spell's description from its filter, head noun "spell").
 * std-rx26: rider `keyword`, "the next noncreature spell you cast this turn has affinity for artifacts", "... has convoke" (CR 601.2f, 611.2).
 * std-freecast-1: rider `free`, "the next red or green creature spell you cast this turn can be cast without paying its mana cost" (CR 118.9, 611.2).
 */
import { plain, type Clause } from './clause';
import { K } from './kernel';
import { countParts } from './qty';
import { cloneState } from './state';
import { keywordWords } from './kw';
import type { RenderState } from './state';
import type { StepOf } from './steps-util';
import { alt, article, NoRenderer } from './text';

export const CLAUSES_STDR10 = {
  nextSpell: (s: StepOf<'nextSpell'>, st: RenderState): Clause => {
    // edh-d-98 (CR 601.2a, 611.2c, 608.2c; Bigger on the Inside): "Target player adds ... The next spell they cast this turn has cascade.": the keyword rider for a player
    // named earlier in the ability (a target player), said with "they"; only that player, only the keyword rider, no cast-from zone
    if (s.who.ref !== 'you') {
      const subj = s.rider === 'keyword' && s.keyword !== undefined && s.lasting !== true && s.who.ref === 'target' ? K.player(s.who, st, 'subject') : null;
      if (subj === null || subj.they !== true || subj.plural) throw new NoRenderer('the next spell another player casts');
      const f = (s.filter ?? {}) as NonNullable<typeof s.filter> & { castFrom?: string };
      if (f.castFrom !== undefined) throw new NoRenderer('a next-spell filter with a cast-from zone for another player');
      const spellO = s.filter === undefined || Object.keys(f).length === 0 ? 'spell' : K.np(f, st, { det: 'none', noZone: true, noController: true });
      const kwO = keywordWords(s.keyword!, st);
      return plain(`the next ${spellO} they cast this turn has ${kwO}`);
    }
    if (s.rider !== 'cantBeCountered' && s.rider !== 'keyword' && s.rider !== 'free' && s.rider !== 'life' && s.rider !== 'reduce' && s.rider !== 'flash') throw new NoRenderer(`a next-spell rider ${String(s.rider)}`);
    // edh-d-50 (CR 601.2a): "from your hand" is the one cast-origin the filter may carry (the keyword rider only); it is said after the description, the rest of the filter as before
    const { castFrom: fromZone, ...plainFilter } = (s.filter ?? {}) as NonNullable<typeof s.filter> & { castFrom?: string };
    if (fromZone !== undefined && fromZone !== 'hand') throw new NoRenderer('a next-spell filter with a cast-from zone other than the hand');
    const spell0 = s.filter === undefined || Object.keys(plainFilter).length === 0 ? 'spell' : K.np(plainFilter, st, { det: 'none', noZone: true, noController: true });
    const spell = fromZone === 'hand' ? `${spell0} from your hand` : spell0;
    if (s.rider === 'keyword') {
      if (!s.keyword) throw new NoRenderer('a next-spell keyword rider without its keyword');
      const kw = keywordWords(s.keyword, st);
      // edh-d-50 (CR 601.2i, 611.2; Yidris, Maelstrom Wielder): "as you cast spells from your hand this turn, they gain cascade": every such spell this turn, no filter beyond the cast-from zone
      if (s.lasting === true) {
        if (fromZone !== 'hand' || Object.keys(plainFilter).length !== 0 && Object.keys(plainFilter).some((k) => k !== 'stackKind' && k !== 'zone')) throw new NoRenderer('a lasting next-spell rider with a filter other than the hand');
        return plain(`as you cast spells from your hand this turn, they gain ${kw}`);
      }
      // edh-mana-keywords-12 (CR 601.2i, 611.2; Solar Array; family next-spell-gains): "When you next cast an artifact spell this turn, that spell gains sunburst." is the same waiting effect
      return plain(alt(`the next ${spell} you cast this turn has ${kw}`, `when you next cast ${article(spell)} ${spell} this turn, that spell gains ${kw}`, `when you next cast ${article(spell)} ${spell} this turn, it gains ${kw}`));
    }
    // edh-c-53 (CR 601.2f, 118.7; Hardened Berserker): rider `reduce`
    if (s.rider === 'reduce' && s.amount !== undefined) {
      // edh-next-38 (CR 601.2f, 107.3; Kaza, Elminster): "costs {X} less to cast, where X is <quantity>"; a count of objects is read "as this ability resolves" (Oracle's words)
      if (s.mana !== undefined) throw new NoRenderer('a next-spell reduction with both mana and an amount');
      // edh-next-140 (CR 601.2f, 608.2h; Mutated Cultist; family next-spell-reduce-for-each): a count is also "costs {1} less to cast for each <thing counted>" ("for each counter removed this way")
      const per = typeof s.amount === 'object' && s.amount.q === 'countersRemoved' ? countParts(s.amount, cloneState(st)) : null;
      const q = K.qty(s.amount, st);
      const whereX = `the next ${spell} you cast this turn costs {X} less to cast, where X is ${q}${typeof s.amount === 'object' && s.amount.q === 'eventAmount' ? '' : ' as this ability resolves'}`;
      return plain(per === null ? whereX : alt(whereX, `the next ${spell} you cast this turn costs {1} less to cast for each ${per.singular}`));
    }
    if (s.rider === 'reduce') {
      if (!s.mana || s.mana.length !== 1 || s.mana[0]!.kind !== 'generic') throw new NoRenderer('a next-spell reduction other than generic mana');
      return plain(`the next ${spell} you cast this turn costs {${s.mana[0]!.amount}} less to cast`);
    }
    // edh-next-67 (CR 118.9, 202.3, 611.2; Marshland Bloodcaster): rider `life`
    if (s.rider === 'life') return plain(`rather than pay the mana cost of the next ${spell} you cast this turn, you may pay life equal to that spell's mana value`);
    // std-freecast-1 (CR 118.9, 611.2): rider `free`
    if (s.rider === 'free') return plain(`the next ${spell} you cast this turn can be cast without paying its mana cost`);
    // edh-d-14 (CR 601.3b, 702.8a, 305.1; Scout's Warning, family next-creature-card-played): a creature card can only be played by casting it, so "the next creature card you play this turn can be played as though it had flash" is the same waiting effect as the next creature spell
    if (s.rider === 'flash') return plain(alt(`the next ${spell} you cast this turn can be cast as though it had flash`, ...(spell === 'creature spell' ? ['the next creature card you play this turn can be played as though it had flash'] : []))); // edh-next-18 (CR 601.3b, 702.8a, 611.2)
    return plain(`the next ${spell} you cast this turn can't be countered`);
  },
};
