/**
 * Durations as phrases (WP2): "until end of turn", "for as long as ~ remains tapped", "until your next turn". An empty string for `permanent`
 * (CR 611.2a: no stated duration, so the text says nothing).
 */
import type { Duration } from '../types/ability';
import { K } from './kernel';
import type { RenderState } from './state';
import { possessiveStep, turnOf } from './turn';
import { alt, NoRenderer } from './text';

export function dur(d: Duration, st: RenderState, _o: { context?: 'mods' | 'rule' } = {}): string {
  switch (d.d) {
    case 'endOfTurn': return alt('until end of turn', 'this turn');
    case 'endOfCombat': return alt('until end of combat', 'this combat');
    case 'permanent': return '';
    case 'whileSource': {
      const self = K.obj({ ref: 'self' }, st, 'subject').text;
      switch (d.as) {
        case 'onBattlefield': return `for as long as ${self} ${alt('remains on the battlefield', 'is on the battlefield', 'stays on the battlefield')}`;
        case 'controlled': return `for as long as you control ${self}`;
        case 'attached': return `for as long as ${self} ${alt('remains attached to it', 'is attached to it', 'stays attached to it')}`;
        case 'tapped': return `for as long as ${self} ${alt('remains tapped', 'is tapped', 'stays tapped')}`;
      }
      break;
    }
    case 'until': return `until ${K.events([d.event], st, 'present')}`;
    case 'untilExiledWith': return `until you exile another card with ${K.obj({ ref: 'self' }, st, 'object').text}`; // r5-dig (CR 611.2a, 607.2a)
    case 'untilNextTurn': return `until ${turnOf(d.whose, st, true)}`;
    case 'untilNextStep': {
      const step = possessiveStep(d.step, d.whose, st, true);
      return alt(`until ${step}`, `until the beginning of ${step}`);
    }
    // MX5: the display form of a chip or record (Oracle says it inside the sentence: render/stat.ts#nextUntapRestriction)
    case 'throughNextUntap': return `until the end of ${d.whose === undefined ? "its controller's next untap step" : possessiveStep('untap', d.whose, st, true)}`;
    case 'asLongAs': return `for as long as ${K.cond(d.cond, st)}`;
    // std-rx32 (CR 611.2b): about the object the effect names ("it", "that creature"), not the source
    case 'whileObject': {
      const o = K.obj(d.object, st, 'subject').text;
      // std-combat-1 (CR 611.2b, 301.5): "for as long as that Aura is attached to it"
      if (d.as === 'attached') {
        if (d.to === undefined) throw new NoRenderer('whileObject attached with no object it is attached to');
        return `for as long as ${o} is attached to ${K.obj(d.to, st, 'object').text}`;
      }
      // audit-fix-2 (CR 702.62a): suspend's haste (keyword expansion only; no Oracle sentence is parsed to it)
      if (d.as === 'kept') return 'until you lose control of the spell or the permanent it becomes';
      return d.as === 'tapped' ? `for as long as ${o} remains tapped` : `for as long as ${o} has ${/^[aeiou]/.test(d.counter ?? '') ? 'an' : 'a'} ${d.counter ?? ''} counter on it`;
    }
    // FAST5X E29 (CR 611.2a, 514.2): "until the end of your next turn"
    case 'endOfNextTurn': return `until the end of ${turnOf(d.whose, st, true)}`;
    // FAST5X E29 (CR 611.2b, 400.7): the objects are the ones the permission names, said again as a pronoun or "that card"
    // std-control-1 (CR 500.7, 611.2a): the extra turn the sentence before added (parser/lower/ability.ts#joinSpeedFloor joins the two)
    case 'duringNextTurn': return 'during that turn';
    case 'remainsExiled': return `for as long as ${alt('it remains exiled', 'that card remains exiled', 'they remain exiled', 'those cards remain exiled')}`;
  }
  throw new NoRenderer(`duration ${(d as { d: string }).d}`);
}
