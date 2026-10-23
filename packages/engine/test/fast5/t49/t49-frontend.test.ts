/**
 * FAST5 T49, front end (parser/front/selfref.ts, parser/preprocess.ts): the pronouns of a named character and a flavor word on a Saga chapter.
 *
 *   CR 201.5c   a legendary creature or planeswalker is written about as a person: "he", "him", "his" are the object itself once the line named it
 *   CR 714.2    a Saga chapter's numerals, then (CR 207.2c) a flavor word with no rules meaning, then the effect
 */
import { describe, expect, it } from 'vitest';
import { face, pre } from '../../m5/parser/support';

const parseText = (ctx: ReturnType<typeof face>): string => pre(ctx).parse;
/** The parse text with runs of spaces (where a self reference replaced several words) collapsed. */
const flat = (s: string): string => s.replace(/[ 	]+/g, ' ').trim();

describe('CR 201.5c: "he", "him" and "his" of a legendary creature or planeswalker', () => {
  const legend = (text: string, typeLine = 'Legendary Creature — Human Rogue') => face('Jet', typeLine, text);

  it('become "~" once the same line has named the object ("his" becomes "~\'s", the offsets do not move)', () => {
    const text = 'When Jet enters, he deals damage equal to his power to target creature, and put a +1/+1 counter on him.';
    const parse = parseText(legend(text));
    expect(parse).toHaveLength(text.length);
    expect(parse.replace(/\s+/g, ' ')).toBe("When ~ enters, ~ deals damage equal to ~'s power to target creature, and put a +1/+1 counter on ~.");
  });
  it('the sentence-initial "He" counts too, after a sentence of the same line that named the object', () => {
    const parse = parseText(legend('Put a +1/+1 counter on Jet. He gains haste until end of turn.'));
    expect(parse.replace(/\s+/g, ' ')).toBe('Put a +1/+1 counter on ~. ~ gains haste until end of turn.');
  });
  // FAST5 batch 5 merge: on a whole face FAST5X E24's unique-candidate rule (design 6.4) decides: the face names one character and nothing else, so a line that
  // has not named it yet means it too; a second candidate keeps the word (the same line naming the object does not make it unique).
  it('the face names one character only: a line that has not named it yet means it too (design 6.4, FAST5X E24)', () => {
    const parse = parseText(legend('Prevent all damage that would be dealt to him this turn.\nJet gets +1/+1 until end of turn. Put a counter on him.'));
    const [first, second] = parse.split('\n');
    expect(flat(first!)).toBe('Prevent all damage that would be dealt to ~ this turn.');
    expect(flat(second!)).toBe('~ gets +1/+1 until end of turn. Put a counter on ~.');
  });
  it('a second candidate on the same line keeps the word (design 6.4, FAST5X E24)', () => {
    expect(parseText(legend('Whenever Jet or Marco attacks, he deals 1 damage to any target.'))).toContain(' he ');
  });
  it('a quoted ability keeps its words: inside the quote "he" is another object', () => {
    const parse = parseText(legend('Target creature gains "When this creature dies, he deals 1 damage to you." Jet deals 1 damage to him.'));
    expect(flat(parse)).toContain('he deals 1 damage to you');
    expect(flat(parse)).toContain('~ deals 1 damage to ~.');
  });
  it('only a legendary card names a character: another card keeps the word', () => {
    expect(parseText(face('Jet', 'Creature — Human Rogue', 'When Jet enters, he deals 2 damage to target creature.'))).toContain(' he ');
    // FAST5X E24 (design 6.4): any legendary face whose text names one character only (every such face of the index is a character)
    expect(parseText(face('Jet', 'Legendary Artifact', 'When Jet enters, he deals 2 damage to target creature.')).replace(/\s+/g, ' ')).toBe('When ~ enters, ~ deals 2 damage to target creature.');
    expect(parseText(legend('When Jet enters, he deals 2 damage to target creature.', 'Legendary Planeswalker — Jet')).replace(/\s+/g, ' ')).toBe('When ~ enters, ~ deals 2 damage to target creature.');
  });
  it('a word that merely contains the letters is not a pronoun ("heroes", "this", "hers", "he\'s" stays)', () => {
    const parse = parseText(legend('Jet gets +1/+1 for each of the heroes this turn.'));
    expect(flat(parse)).toBe('~ gets +1/+1 for each of the heroes this turn.');
  });
});

describe('CR 714.2, 207.2c: a flavor word between a Saga chapter and its effect', () => {
  const saga = (text: string) => face('Test Saga', 'Enchantment — Saga', text);

  it('is a label of the chapter line: it leaves the text the effect is read from and the ledger says so', () => {
    const p = pre(saga('I -- Bright Bolt -- ~ deals 2 damage to target creature.\nII, III -- Draw a card.'));
    expect(p.parse.split('\n')[0]!.replace(/\s+/g, ' ')).toBe('I -- ~ deals 2 damage to target creature.');
    expect(p.lines[0]!.chapterLabel?.text).toBe('Bright Bolt');
    expect(p.ledger.some((e) => e.status === 'label')).toBe(true);
  });
  it('a chapter with no flavor word is unchanged, and a prefix that reads like rules text is not taken for one', () => {
    const plain = pre(saga('I -- Draw a card.'));
    expect(plain.lines[0]!.chapterLabel).toBeUndefined();
    const rules = pre(saga('I -- Each player draws a card.'));
    expect(rules.lines[0]!.chapterLabel).toBeUndefined();
  });
  it('only a Saga has chapters: the same line on another face is not touched', () => {
    const other = pre(face('Test Card', 'Enchantment', 'I -- Bright Bolt -- ~ deals 2 damage to target creature.'));
    expect(other.lines[0]!.chapterLabel).toBeUndefined();
  });
});
