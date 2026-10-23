/**
 * Clauses: what a step prints (WP2). A step is written in two forms because Oracle writes the same instruction both ways:
 *   imp  "draw a card"           the verb phrase without a subject, valid when the subject is understood (the controller of the ability, or the
 *                                player of the `may` / `pay` it sits in);
 *   sub  "you draw a card"       the clause with its subject, valid anywhere.
 * `actor` names the player the subject stands for. A clause with no actor ("destroy target creature") reads the same everywhere.
 */
import { alt, firstAlt, parseMarked, serializeMarked, type MarkedNode } from './text';

export interface Clause {
  imp: string;
  sub: string;
  /** Key of the acting player ('you', 'ctrl:t:t0', ...), or null when the clause has no distinct subject. */
  actor: string | null;
  /** For a clause whose subject is baked in ("~ deals 3 damage to X"): the "have ... do" form used inside a `may` ("have ~ deal 3 damage to X"). */
  have?: string;
  /** The verb phrase without its subject, third person ("loses 1 life"): what follows "and" when the same player did the step before ("draws a card and loses 1 life"). */
  pred?: string;
  /** Display preference: start a sentence here (Oracle writes "An opponent separates them into two piles. Put one pile ..."). */
  breakBefore?: boolean;
  /** The clause carries sentence breaks or conditionals of its own and must not be joined by "and" or a comma. */
  standalone?: boolean;
  /** An optional clause ("you may ..."): the step after it is not part of the choice, so a sentence break separates them (CR 608.2d). */
  closesScope?: boolean;
  /** Nothing to print (a `let` step names a value; its words appear where the value is used). */
  empty?: boolean;
  /** FAST2 T8: a sentence of its own that Oracle may also begin with "Then" ("Then if it has three or more +1/+1 counters on it, sacrifice ~"; CR 608.2c). */
  leadThen?: boolean;
  /**
   * FAST5 T61 (CR 608.2c, 608.2d): a sentence of its own that starts with "you may" and carries its "If you do," follower ("you may exile an Elf card from your
   * graveyard. If you do, each opponent loses 2 life."); Oracle also joins it to a plain instruction before it by ", then" ("Mill three cards, then you may exile ...").
   */
  commaThen?: boolean;
  /**
   * CLOUD std-dft: the clause is itself two instructions of a list ("search your library and/or graveyard for a card, reveal it"), so the next instruction may
   * follow it with the serial comma: "..., reveal it, and put it into your hand" (CR 608.2c; family serial-comma-after-reveal).
   */
  serial?: boolean;
  /**
   * r4-repl: one more reading of a standalone clause, used only right after a plain clause it is joined to like a plain clause ("..., reveal it, and" + "put it
   * into your hand. If C, put that card onto the battlefield instead": an "instead" that replaces the last instruction of a list, CR 614.15). The clause's own
   * readings stay, after a sentence break, as for any standalone clause.
   */
  joined?: string;
}

export const EMPTY_CLAUSE: Clause = { imp: '', sub: '', actor: null, empty: true };

/** A clause with no subject concept. */
export const plain = (text: string, extra: Partial<Clause> = {}): Clause => ({ imp: text, sub: text, actor: null, ...extra });

/** A clause with an acting player: `verbPhrase` is written for the imperative, `subject` and the agreeing verb phrase for the full form. */
export function acting(actor: string, imp: string, sub: string, extra: Partial<Clause> = {}): Clause {
  return { imp, sub, actor, ...extra };
}

/**
 * The text of a clause where its subject is NOT fixed by the surroundings (the start of a sentence, after "and"): the imperative when the actor is
 * the controller, both forms as alternatives so "Draw a card" and "you draw a card" match; the explicit form otherwise.
 */
export function fragment(c: Clause): string {
  if (c.empty) return '';
  if (c.actor === null) return c.sub;
  if (c.actor === 'you') return alt(c.imp, c.sub);
  return c.sub;
}

/** The text of a clause inside a `may`/`pay` of `actor`: the imperative when the clause's actor is that same player (or there is none), else the full form. */
export function within(c: Clause, actor: string | null): string {
  if (c.empty) return '';
  if (c.actor === null) return c.imp;
  if (c.actor === actor) return c.imp;
  return c.sub;
}

/** A text needs the period of its sentence unless it ends in punctuation of its own. */
// r3-fx: a quoted ability inside quotes closes with a single quote (render/quote.ts), which also ends the sentence
const needsPeriod = (tail: string): boolean => !(/[.!?](?:"|'|'")?$/.test(tail) || tail.endsWith('--') || tail.endsWith(':'));

/**
 * The nodes of a sentence with its period: decided per reading, not by the display reading alone. A sentence whose readings end differently ("... gain \"...
 * draw a card.\" until end of turn" against "Until end of turn, ... gain \"... draw a card.\"") ends in a period only where its reading does not end in
 * punctuation of its own (FAST5 T41: the period inside the closing quote of a granted ability closes the sentence of the outer one).
 */
function endNodes(nodes: MarkedNode[], before: string): MarkedNode[] {
  const last = nodes[nodes.length - 1];
  if (last === undefined) return nodes;
  const head = nodes.slice(0, -1);
  const beforeLast = before + firstAlt(serializeMarked(head));
  if (typeof last === 'string') return needsPeriod(beforeLast + last) ? [...head, `${last}.`] : nodes;
  if (last.alts.some((a) => a.length === 0)) return needsPeriod(beforeLast + firstAlt(serializeMarked([last]))) ? [...nodes, '.'] : nodes;
  return [...head, { alts: last.alts.map((a) => endNodes(a, beforeLast)) }];
}

/** End a sentence: add a period unless it ends in punctuation of its own. */
export function endSentence(s: string): string {
  const t = s.replace(/\s+$/, '');
  if (t === '') return t;
  return serializeMarked(endNodes(parseMarked(t), ''));
}
