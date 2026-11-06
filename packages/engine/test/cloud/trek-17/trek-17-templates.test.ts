/**
 * Lane trek, round trek-17 (Star Trek: library cards): the template data of parser/templates/zz-cloud/trek-17.json and what finishes the cards around it:
 *  - "put those <type> cards onto the battlefield and the rest on the bottom of your library in a random order" and "Sacrifice those lands at the beginning of your next end step"
 *    (the cards put onto the battlefield are permanents, "those lands": render/fold.ts#putThatAndRest; CR 608.2c, 701.20a, 400.7);
 *  - "put all <cards> revealed this way onto the battlefield tapped and the rest on the bottom ..." (CR 701.20a, 608.2c, 401.4);
 *  - "The owner of ... draws two cards, then shuffles that creature into their library" (render/fold-trek17.ts; CR 108.3, 121.1, 701.24a);
 *  - "each player reveals the top card of their library, then draws a card", "for each nonland card revealed this way" and "the greatest mana value among cards revealed this way" after
 *    the draw (parser/holes/trek17.ts, Discourse.revealDrawn; the engine keeps the cards revealed in the group once they are drawn: effects/refs.ts#followRevealed; CR 701.20a, 121.1);
 *  - "a random opponent" (PlayerRef randomOpponent, effects/refs.ts; CR 608.2c);
 *  - "sacrifice any number of lands you control, then search your library for up to that many land cards" (render/fold.ts#chooseThenSacrificeAny, CR 701.21a, 701.23a);
 *  - "if you faced a dilemma this turn" (parser/holes/cond.ts#history; the term has no CR text yet, reminder text of the set).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10).
 * The behavior is in trek-17-scenarios.test.ts. CR cites checked against MagicCompRules 20260925 except the set's own terms.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-17.json';
import review from '../../m5/golden/cards/trek-17-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An example as a card: an ability line (with a colon or a trigger word) of a creature, a spell's text otherwise. */
const parse = (text: string) => {
  const ability = /^(At|When|Whenever)\b/.test(text) || /^\{[^}]*\}[^.]*:/.test(text);
  return parseCard(card('Example Ooze', ability ? 'Creature — Ooze' : 'Sorcery', text, ability ? { power: '0', toughness: '0' } : {}), OPTS).faces[0]!;
};
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-17 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-17.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-17.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.trek17.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.trek17\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings, standing rule of 2026-10-27): each wording is printed on one or two Star Trek cards, so each template is stable on those hand-verified golden cards plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('eff.trek17.putThoseTyped.battlefield.rest.bottomRandom')).toEqual(['Will Riker, First in the Field']);
    expect(evidence('eff.trek17.putAll.revealed.battlefieldTapped.rest.bottomRandom')).toEqual(['Branching Timeline']);
    expect(evidence('eff.trek17.player.draws.thenShufflesIntoLibrary')).toEqual(['Unification']);
    expect(evidence('eff.trek17.player.revealTop.thenDraws').sort()).toEqual(["Alexander, Ship's Fool", "Ambassador K'Ehleyr"]);
    expect(evidence('eff.trek17.forEach.putCounter')).toEqual(["Ambassador K'Ehleyr"]);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-17 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/on the bottom of your library/, 'on top of your library'], [/in a random order/, 'in any order'], [/onto the battlefield tapped/, 'into your hand'],
    [/then draws a card/, 'then draws two cards'], [/then draws a card/, 'then discards a card'], [/reveals the top card/, 'reveals the top two cards'],
    [/into their library/, 'into your library'], [/draws (two|a) cards?/, 'draws four cards'], [/put a /, 'put two '],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-17 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-17 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words[i + 1]?.startsWith('counter')) return; // (any word is a kind of counter)
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-17 guard G2 on the whole cards: a nonsense word in any place of the card\'s own text never leaves it full', () => {
  const CARDS: [string, string, string, string][] = [
    ['Test Envoy', 'Legendary Creature — Klingon Human Advisor', 'Vigilance\nParley — At the beginning of combat on your turn, each player reveals the top card of their library, then draws a card. For each nonland card revealed this way, put a +1/+1 counter on ~.', '{2}{W}'],
    ['Test Jester', 'Legendary Creature — Klingon Human', 'Vigilance, haste\n{T}: Each player reveals the top card of their library, then draws a card. ~ deals X damage to a random opponent, where X is the greatest mana value among cards revealed this way.', '{3}{R}{W}'],
    ['Test Scout', 'Legendary Creature — Human Officer', 'At the beginning of combat on your turn, reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield and the rest on the bottom of your library in a random order. Sacrifice those lands at the beginning of your next end step.', '{3}{R}'],
    ['Test Timeline', 'Sorcery', 'Strange new worlds — Reveal the top X cards of your library, where X is the number of differently named lands you control. Put all permanent cards revealed this way onto the battlefield tapped and the rest on the bottom of your library in a random order.', '{6}{G}{G}'],
    ['Test Genesis', 'Legendary Artifact', 'When ~ enters, search your library for a basic land card or Planet card, put it onto the battlefield tapped, then shuffle.\n{3}{G}{G}, {T}, Sacrifice ~: Sacrifice any number of lands you control, then search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle. Activate only as a sorcery.', '{2}{G}'],
    ['Test Caretaker', 'Legendary Creature — Elemental', 'Vigilance, ward {2}\nAt the beginning of each end step, if you faced a dilemma this turn, target opponent exiles cards from the top of their library until they exile a nonland card. You may cast that card without paying its mana cost.', '{5}{U}'],
    ['Test Unification', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — The owner of up to one target creature draws two cards, then shuffles that creature into their library.\nII — You may put a Spacecraft card from your hand or graveyard onto the battlefield.\nIII — You and target opponent each draw two cards.', '{3}{W}{U}'],
  ];
  const level = (name: string, type: string, text: string, cost: string): { level: string; manualPart: boolean } => {
    const def = compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
    return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
  };
  for (const [name, type, text, cost] of CARDS) {
    it(`${name}: as printed it is full with no manual part; replacing any one word by an invented word is never full`, () => {
      expect(level(name, type, text, cost)).toEqual({ level: 'full', manualPart: false });
      // the words of the card's own rules text: not the reminder text (in parentheses), not an ability word or flavor word before the dash of a line, and every word on its own (lines are split too)
      const tokens = text.split(/([ \n])/);
      let paren = false;
      let dash = false;
      const skip = new Set<number>();
      const lineStart = (i: number): boolean => i === 0 || tokens[i - 1] === '\n' || tokens[i - 2] === '\n';
      tokens.forEach((w, i) => {
        if (w === '\n') dash = false;
        if (lineStart(i) && /^[A-Z][A-Za-z']*$/.test(w) && tokens.slice(i, i + 12).join('').split('\n')[0]!.includes(' — ')) dash = true;
        if (w.startsWith('(')) paren = true;
        if (paren || dash || w === ' ' || w === '\n' || w === '' || w === '—' || w === '--' || /^[IV]+$/.test(w) || /^\{/.test(w)) skip.add(i);
        if (w.endsWith(')')) paren = false;
        if (w === '—') dash = false;
      });
      tokens.forEach((w, i) => {
        if (skip.has(i) || tokens[i + 2]?.startsWith('counter')) return; // (any word is a kind of counter)
        const end = w.match(/[.,:"]+$/)?.[0] ?? '';
        const mutated = [...tokens.slice(0, i), `blorfty${end}`, ...tokens.slice(i + 1)].join('');
        const r = level(name, type, mutated, cost);
        expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
      });
    });
  }
});

describe('trek-17 near misses of the cards: a sentence missing, a number or a quantifier changed is never the card', () => {
  const lvl = (type: string, text: string): boolean => {
    const def = compileCard({ name: 'Test Card', layout: 'normal', mana_cost: '{1}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
    return def.automation.level === 'full' && !JSON.stringify(def.faces).includes('"op":"manual"') && !JSON.stringify(def.faces).includes('"kind":"manual"');
  };
  it('"a random opponent" is a player reference only for "a random opponent": "target opponent", "each opponent" are other cards', () => {
    expect(lvl('Creature — Ooze', '{T}: Each player reveals the top card of their library, then draws a card. ~ deals X damage to a random opponent, where X is the greatest mana value among cards revealed this way.')).toBe(true);
    for (const who of ['two random opponents', 'a random player', 'a random creature']) {
      expect(lvl('Creature — Ooze', `{T}: Each player reveals the top card of their library, then draws a card. ~ deals X damage to ${who}, where X is the greatest mana value among cards revealed this way.`), who).toBe(false);
    }
  });
  it('the count after the draw is of the cards revealed this way: "the least mana value", a count without "for each", or a draw before the reveal are not understood', () => {
    expect(lvl('Creature — Ooze', 'At the beginning of combat on your turn, each player draws a card, then reveals the top card of their library. For each nonland card revealed this way, put a +1/+1 counter on ~.')).toBe(false);
    expect(lvl('Creature — Ooze', 'At the beginning of combat on your turn, each player reveals the top card of their library, then draws a card. Put a +1/+1 counter on ~ for each nonland card revealed this way.')).toBe(false);
    expect(lvl('Creature — Ooze', '{T}: Each player reveals the top card of their library, then draws a card. ~ deals X damage to a random opponent, where X is the least mana value among cards revealed this way.')).toBe(false);
  });
  it('a draw by a card other than the revealed one: after a discard or a mill in between the group is not understood', () => {
    expect(lvl('Creature — Ooze', 'At the beginning of combat on your turn, each player reveals the top card of their library, then draws a card. Each player discards a card. For each nonland card revealed this way, put a +1/+1 counter on ~.')).toBe(false);
  });
  it('sacrificing then searching: "up to that many" needs the sacrifice of any number; a fixed sacrifice is another card', () => {
    expect(lvl('Artifact', '{T}: Sacrifice any number of lands you control, then search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.')).toBe(true);
    expect(lvl('Artifact', '{T}: Sacrifice a land you control, then search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.')).toBe(false);
    // edh-d-28 (anaphora.ts#searchIdiom): "put them" after a search for several cards is the cards found whatever the destination, so this one is a correct full reading (search up to that many lands into your hand)
    expect(lvl('Artifact', '{T}: Sacrifice any number of lands you control, then search your library for up to that many land cards, put them into your hand, then shuffle.')).toBe(true);
  });
  it('"if you faced a dilemma this turn" is the player\'s own: "if an opponent faced a dilemma this turn" and "if you face a dilemma" are other conditions', () => {
    const text = (cond: string): string => `At the beginning of each end step, if ${cond}, target opponent exiles cards from the top of their library until they exile a nonland card.`;
    expect(lvl('Creature — Ooze', text('you faced a dilemma this turn'))).toBe(true);
    expect(lvl('Creature — Ooze', text('an opponent faced a dilemma this turn'))).toBe(false);
    expect(lvl('Creature — Ooze', text('you face a dilemma'))).toBe(false);
  });
});

describe('trek-17 engine capabilities: the player reference and the cards the engine needs are advertised', () => {
  it('`ref:randomOpponent` is resolved by the engine (REF_RESOLVERS), and the reveal/draw ops it uses are engine capabilities', () => {
    for (const c of ['op:reveal', 'op:draw', 'op:damage', 'ref:randomOpponent', 'op:revealUntil', 'op:delay', 'op:search', 'op:sacrifice', 'op:exileUntil', 'op:shuffle']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-17 design 6.10 (local index): synthetic examples', () => {
  it('no trek-17 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
