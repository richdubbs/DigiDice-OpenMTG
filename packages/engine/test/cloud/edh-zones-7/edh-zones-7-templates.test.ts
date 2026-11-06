/**
 * edh-zones-7 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-7.json and the round's other changes: "if you have N or more cards in your
 * graveyard" (parser/holes/cond.ts#graveyardSize, render/cond.ts), a choice made inside a branch is no "rest" of its group (parser/lower/mentions.ts#restOf), a source that paid
 * its way out of the hand finds itself (effects/refs.ts#costMovedSelf, CR 400.7j), the renderer alternatives (render/stat.ts, np.ts, fold.ts). Guard G9 and G2 as the earlier
 * rounds run them; examples are synthetic (design 6.10). The behavior is in edh-zones-7-scenarios.test.ts. CR cites checked against MagicCompRules 20260925.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones7 from '../../../src/parser/templates/zz-cloud/edh-zones-7.json';
import review from '../../m5/golden/cards/edh-zones-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ7 = edhZones7 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery or an artifact. */
const typeOf = (text: string): string => (/^Whenever|^When|^If |this creature/m.test(text) ? 'Creature — Beast' : /^\{/m.test(text) ? 'Artifact' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = ['sta.edhz7.graveyard.opponent.insteadExile.withCounter', 'eff.edhz7.choose.exiledOpponentCard.withCounter', 'eff.edhz7.permit.free.play.obj.durMid', 'eff.edhz7.dig.put.oneCard.hand', 'eff.edhz7.shuffle.self.fromYourGraveyard.intoYourLibrary', 'eff.edhz7.linked.putOne.battlefield', 'eff.edhz7.exile.playerChoosesN'];

describe('edh-zones-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-7.json, after zz-cloud/edh-zones-1.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-7.json');
    expect(files.indexOf('zz-cloud/edh-zones-7.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-7.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ7.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ7) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhz7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (printed on one or two cards of the top 5,000), stable on one hand-verified golden card plus these tests and the scenarios: 6.9 deviations named in the
    // round record. (Dread and Serra Avatar print the first one too, but they are held-out cards outside the top 5,000: opened for verification only, never evidence.)
    expect(goldenUsing('sta.edhz7.graveyard.opponent.insteadExile.withCounter')).toEqual(['Dauthi Voidwalker']);
    expect(goldenUsing('eff.edhz7.choose.exiledOpponentCard.withCounter')).toEqual(['Dauthi Voidwalker']);
    expect(goldenUsing('eff.edhz7.permit.free.play.obj.durMid')).toEqual(['Dauthi Voidwalker']);
    expect(goldenUsing('eff.edhz7.dig.put.oneCard.hand')).toEqual(['Planar Genesis']);
    expect(goldenUsing('eff.edhz7.shuffle.self.fromYourGraveyard.intoYourLibrary')).toEqual(['Kogla and Yidaro']);
    expect(goldenUsing('eff.edhz7.linked.putOne.battlefield')).toEqual(['Nautiloid Ship']);
    expect(goldenUsing('eff.edhz7.exile.playerChoosesN')).toEqual(['Bane of Bala Ged']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ7) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ7) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bbottom\b/, 'top'], [/\ball the cards\b/, 'two cards'], [/\bgraveyard\b/, 'hand'], [/\binto their owner's library\b/, "into your library"], [/\bto the battlefield\b/, 'to the battlefield tapped'],
    [/\bthe battlefield\b/, 'your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ7) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ7) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('edh-zones-7 "you have N or more cards in your graveyard" (parser/holes/cond.ts#graveyardSize, render/cond.ts; CR 404.1)', () => {
  it('is the same condition as "N or more cards are in your graveyard", said both ways (the number of cards in your graveyard, CR 404.1)', () => {
    const a = face('Draw a card. Then if you have seven or more cards in your graveyard, you may draw a card.', 'Sorcery');
    const c = face('Draw a card. Then if seven or more cards are in your graveyard, you may draw a card.', 'Sorcery');
    expect(understood(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(c.abilities));
    expect(json('Sorcery', 'Draw a card. Then if you have seven or more cards in your graveyard, you may draw a card.')).toContain('"q":"zoneSize","zone":"graveyard","of":{"ref":"you"}');
  });
  it('near misses: fewer, another zone, another owner and an invented noun are not this reading', () => {
    for (const bad of ['seven or fewer cards in your graveyard', 'seven or more cards in an opponent\'s graveyard', 'seven or more blorfty in your graveyard']) {
      expect(level('Sorcery', `Draw a card. Then if you have ${bad}, you may draw a card.`), bad).not.toBe('full');
    }
    expect(json('Sorcery', 'Draw a card. Then if you have seven or more cards in your graveyard, you may draw a card.')).not.toContain('"op":"<="');
  });
});

describe('edh-zones-7 a choice made inside a branch is no group of its own (parser/lower/mentions.ts#restOf; CR 608.2c, 701.20e)', () => {
  const FIRST = 'Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped.';
  it("\"the rest\" after \"If you don't, put a card from among them into your hand\" is what the first choice left in the library, and the card is fully understood", () => {
    expect(level('Instant', `${FIRST} If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order.`)).toBe('full');
  });
  it('near misses: the same branch without the optional first choice, or with another destination for the picked card, or a wrong "rest" wording, is not understood', () => {
    expect(level('Instant', "Look at the top four cards of your library. If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order.")).not.toBe('full');
    expect(level('Instant', `${FIRST} If you don't, put a card from among them into your graveyard. Put the rest on the bottom of your library in a random order.`)).not.toBe('full');
    expect(level('Instant', `${FIRST} If you don't, put two cards from among them into your hand. Put the rest on the bottom of your library in a random order.`)).not.toBe('full');
  });
});

describe('edh-zones-7 renderer alternatives (render/stat.ts, np.ts, fold.ts; CR 614.1a, 122.1, 607.2a, 701.24a)', () => {
  it('"instead exile it with a counter": one counter on the exiled card; a counter of another number, a card put elsewhere or a player\'s own graveyard is not read', () => {
    const t = "If a card would be put into an opponent's graveyard from anywhere, instead exile it with a gloom counter on it.";
    expect(level('Creature — Rogue', t)).toBe('full');
    expect(level('Creature — Rogue', t.replace('a gloom counter', 'two gloom counters'))).not.toBe('full');
    expect(level('Creature — Rogue', t.replace('exile it', 'put it into your hand'))).not.toBe('full');
    expect(level('Creature — Rogue', t.replace("an opponent's", 'your'))).not.toBe('full');
  });
  it('"play it this turn without paying its mana cost" and "until end of turn, you may play it without ..." are one permission', () => {
    const base = 'Exile the top card of your library. You may play that card this turn without paying its mana cost.';
    const other = 'Exile the top card of your library. Until end of turn, you may play that card without paying its mana cost.';
    expect(jsonKey(face(base, 'Sorcery').abilities)).toBe(jsonKey(face(other, 'Sorcery').abilities));
    expect(level('Sorcery', base.replace('without paying its mana cost', 'by paying {1}'))).not.toBe('full');
    expect(level('Sorcery', base.replace('this turn', 'this combat'))).not.toBe('full');
  });
  it('"put a creature card exiled with ~ onto the battlefield under your control" is the same move as the "return" wording', () => {
    const lead = 'When ~ enters, exile target player\'s graveyard.\n';
    const a = face(`${lead}Whenever ~ deals combat damage to a player, you may put a creature card exiled with ~ onto the battlefield under your control.`, 'Artifact — Vehicle');
    const b = face(`${lead}Whenever ~ deals combat damage to a player, you may return a creature card exiled with ~ to the battlefield under your control.`, 'Artifact — Vehicle');
    expect(understood(a) && understood(b)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('"defending player exiles two permanents they control": "they control" for the defending player too; an invented noun or another controller is not read', () => {
    const t = 'Whenever ~ attacks, defending player exiles two permanents they control.';
    expect(level('Creature — Eldrazi', t)).toBe('full');
    expect(level('Creature — Eldrazi', t.replace('they control', 'you control'))).not.toBe('full');
    expect(level('Creature — Eldrazi', t.replace('permanents', 'blorftys'))).not.toBe('full');
  });
  it('"shuffle ~ into your library from your graveyard" is the move of the card itself and your shuffle; "from your hand" is not read', () => {
    const t = '{1}, Discard ~: Draw a card. Shuffle ~ into your library from your graveyard.';
    expect(level('Creature — Construct', t)).toBe('full');
    expect(level('Creature — Construct', t.replace('graveyard', 'hand'))).not.toBe('full');
    expect(level('Creature — Construct', t.replace('your library', 'target player\'s library'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-7 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = EZ7.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
