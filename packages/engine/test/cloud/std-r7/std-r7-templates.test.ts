/**
 * Standard round 7 (hole readings): the parser and renderer support of the round. The round adds no template; it adds readings to three hole grammars that
 * existing templates use, each with its wording in the renderer:
 *
 *   parser/holes/qty.ts#historyCounts   "the number of permanents you've sacrificed this turn" (CR 701.21a, 608.2h), render/qty.ts#happened
 *   parser/holes/filter.ts#computeNp    a zone after a subtype-first list, "target Vehicle or creature card from your graveyard" (CR 400.1, 205.2a, 205.3)
 *   parser/holes/cond.ts#cond           "A or if B", one condition or the other (CR 603.4, 608.2c), render/cond.ts (family or-if)
 *
 * One test per change, with its negative cases; guard G2 (design 6.8: a nonsense word in place of any word never leaves an automated card) and design 6.10
 * (the sentences are synthetic: no line is a real Oracle line, checked against the local index when it is present). The behavior is in std-r7-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card, fullyAutomated } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const sorcery = (text: string) => face('Sorcery', text);
const json = (text: string): string => JSON.stringify(sorcery(text).abilities);
/** The abilities without their printed text (two wordings of one ability). */
const meaning = (text: string): string => JSON.stringify(sorcery(text).abilities.map(({ text: _text, ...a }) => a));

/** The synthetic sentences of the round (design 6.10), each fully automated as a sorcery. */
const SENTENCES = [
  "Put X +1/+1 counters on target creature, where X is the number of permanents you've sacrificed this turn.",
  "Put X +1/+1 counters on target creature, where X is the number of Foods you've sacrificed this turn.",
  'Return target Vehicle or creature card from your graveyard to your hand.',
  'Exile target Equipment, instant, or sorcery card from your graveyard.',
  'Draw a card. If you control an Elf or if you control a Goblin, draw two cards.',
];

describe('std-r7 parser and renderer support', () => {
  it('every sentence of the round is fully automated and passes the exact render gate (G6)', () => {
    for (const t of SENTENCES) {
      const f = sorcery(t);
      expect(fullyAutomated(f), `${t}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(f.gate.every((g) => g.ok), `${t}: ${JSON.stringify(f.gate)}`).toBe(true);
    }
  });

  it('CR 701.21a, 608.2h: "the number of permanents you\'ve sacrificed this turn" counts your sacrifices of the turn; "Foods" describes the sacrificed permanent', () => {
    expect(json(SENTENCES[0]!)).toContain('{"q":"happenedCount","event":{"ev":"action","verb":"sacrifice","actor":"you"},"scope":"turn"}');
    expect(json(SENTENCES[1]!)).toContain('"event":{"ev":"action","verb":"sacrifice","actor":"you","object":{"subtypes":["Food"]}}');
    // a card is never sacrificed (CR 701.21a: only a permanent), and another player's sacrifices are not "you've sacrificed"
    expect(fullyAutomated(sorcery("Put X +1/+1 counters on target creature, where X is the number of cards you've sacrificed this turn."))).toBe(false);
    expect(fullyAutomated(sorcery("Put X +1/+1 counters on target creature, where X is the number of permanents your opponents have sacrificed this turn."))).toBe(false);
    expect(fullyAutomated(sorcery("Put X +1/+1 counters on target creature, where X is the number of permanents you've sacrificed."))).toBe(false);
  });

  it('CR 400.1, 205.2a, 205.3: a zone after a list with a subtype first is the zone of every noun; other post-modifiers stay unread there (FAST4 T28)', () => {
    const vehicle = json(SENTENCES[2]!);
    expect(vehicle).toContain('"anyOf":[{"subtypes":["Vehicle"]},{"types":["Creature"]}],"zone":"graveyard","owner":"you","isCard":true');
    expect(json(SENTENCES[3]!)).toContain('"anyOf":[{"subtypes":["Equipment"]},{"types":["Instant","Sorcery"]}],"zone":"graveyard","owner":"you","isCard":true');
    // "Walls and/or creatures with flying" is Walls, and creatures with flying: one filter cannot say it, so it keeps no reading
    expect(fullyAutomated(sorcery('Destroy all Walls and/or creatures with flying.'))).toBe(false);
  });

  it('CR 603.4, 608.2c: "if A or if B" is one condition or the other; three parts, or "and if", have no reading of it', () => {
    expect(json(SENTENCES[4]!)).toContain('"cond":{"cond":"any","of":[{"cond":"exists"');
    expect(meaning(SENTENCES[4]!)).toBe(meaning('Draw a card. If you control an Elf or you control a Goblin, draw two cards.'));
    expect(fullyAutomated(sorcery('Draw a card. If you control an Elf or if you control a Goblin or if you control a Troll, draw two cards.'))).toBe(false);
    expect(fullyAutomated(sorcery('Draw a card. If you control an Elf and if you control a Goblin, draw two cards.'))).toBe(false);
  });
});

describe('std-r7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of SENTENCES) {
    it(`replacing any one word of "${t}" by an invented word makes the card not fully automated`, () => {
      const words = t.split(' ');
      words.forEach((w, i) => {
        // the counter kind before "counters" is any word to the CounterKind hole (an unlisted kind is a weak reading, parser/holes/misc.ts): not this round's words
        if (words[i + 1] === 'counters') return;
        const end = w.match(/[.,"]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
        expect(fullyAutomated(sorcery(mutated)), mutated).toBe(false);
      });
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-r7 design 6.10 (local index): synthetic sentences', () => {
  it('no sentence of the round is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    expect(SENTENCES.filter((s) => lines.has(s))).toEqual([]);
  }, 120_000);
});
