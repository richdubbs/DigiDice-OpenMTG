/**
 * Cloud r3-mech: the clauses of its ops. `fromOutside` (CR 400.11b): "reveal a creature card you own from outside the game and put it into your hand", "put a card
 * you own from outside the game into your hand" (the `may` around it is the caller's).
 */
import { plain, type Clause } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';
import type { StepOf } from './steps-util';
import { NoRenderer, numWord } from './text';

export const CLAUSES_R3MECH = {
  fromOutside: (s: StepOf<'fromOutside'>, st: RenderState): Clause => {
    if (s.who.ref !== 'you') throw new NoRenderer('a card from outside the game for another player');
    // std-rx30 (CR 400.11b, 201.2, 608.2d): "reveal exactly two cards you own with different names from outside the game. An opponent chooses one of them. You put that
    // card into your hand." (Extrapolate the Impossible)
    if (s.exactly !== undefined || s.differentNames !== undefined || s.chooser !== undefined) {
      if (s.exactly === undefined || s.differentNames !== true || s.chooser?.ref !== 'anOpponent' || !s.reveal || s.filter !== undefined) throw new NoRenderer('another choice among cards revealed from outside the game');
      return plain(`reveal exactly ${numWord(s.exactly)} cards you own with different names from outside the game. an opponent chooses 1 of them. you put that card into your hand`, { standalone: true });
    }
    // "a card you own named Legion Angel" (only a name): Oracle puts the name after "you own"
    const named = s.filter !== undefined && Object.keys(s.filter).length === 1 && s.filter.name !== undefined;
    const card = s.filter === undefined || named ? 'a card' : K.np(s.filter, st, { det: 'a', head: 'card' });
    const owned = `${card} you own${named ? ` named ${s.filter!.name!}` : ''}`;
    return plain(s.reveal ? `reveal ${owned} from outside the game and put it into your hand` : `put ${owned} from outside the game into your hand`);
  },
};
