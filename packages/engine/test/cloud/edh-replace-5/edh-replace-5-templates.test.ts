/**
 * edh-replace-5 (Commander lane edh-replace): the template data of parser/templates/zz-cloud/edh-replace-5.json and the parser, lowering and renderer changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-replace-5-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhr5 from '../../../src/parser/templates/zz-cloud/edh-replace-5.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const ER5 = edhr5 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-replace-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-replace-5.json, path order: after edh-replace-3, before edh-zones-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-replace-5.json');
    expect(files.indexOf('zz-cloud/edh-replace-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-replace-3.json'));
    expect(files.indexOf('zz-cloud/edh-replace-5.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhr5.*', () => {
    for (const t of ER5) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rep)\.edhr5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of ER5) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-replace-5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of ER5) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\binstead\b/, 'also'], [/\btwice\b/, 'three times'], [/\bdouble\b/, 'triple'], [/\bplus\b/, 'minus'], [/\byou control\b/, 'an opponent controls'],
    [/\bexile it\b/, 'destroy it'], [/\byour graveyard\b/, 'your hand'], [/\bwould\b/, 'could'], [/\bone or more\b/, 'exactly one'], [/\bcreature spell\b/, 'artifact spell'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-replace-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of ER5) {
    it(`${t.id}: an appended "unless/at random/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-replace-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of ER5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || w === "~'s" || /^"?\{/.test(w) || w.includes('\n')) return;
          // a counter's kind is an open class (design 6.11: the word before "counter(s)" is any word, weak when it is not in the lexicon): not a G2 word here
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/**
 * The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`): FULL ones are fully
 * automated; the others have a sentence another slice owns (backlog/r4-owners.md) and are checked for this template's line only.
 */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'eff.edhr5.mayPay.anyAmount': { full: ['Leyline Tyrant'] },
  'eff.edhr5.token.you.forEachOpponentDealtDamage': { full: ['Malcolm, Keen-Eyed Navigator'] },
  'rep.edhr5.counters.energy.youGetPlusOne': { full: ['Izzet Generatorium'] },
};

describe.skipIf(index === null)('edh-replace-5 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-replace-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle|Saga)\b/gi, '~').trim());
        }
      }
    }
    // a pattern with no hole ({e} is the energy symbol, no hole) is the rule's own words: its sentence alone is the one line an example can't avoid ("Combat damage can't be prevented."); a lone
    // keyword line ("Reach") is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.replaceAll('{e}', '').includes('{') && norm(l) === norm(t.pattern));
    const verbatim = ER5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  for (const [id, { full, partial }] of Object.entries(REAL)) {
    it(`${id}: ${[...full, ...(partial ?? [])].join(', ')} read the line with it and pass the render gate${full.length > 0 ? ' (and the first are fully automated)' : ''}`, () => {
      for (const name of [...full, ...(partial ?? [])]) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        if (full.includes(name)) {
          expect(compileCard(oracle!).automation.level, name).toBe('full');
          expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        }
      }
    }, 60_000);
  }
  it('every template of the file has its real cards listed (or is read by none yet, listed here with the reason)', () => {
    const none: Readonly<Record<string, string>> = {
    };
    for (const t of ER5) expect(REAL[t.id] !== undefined || none[t.id] !== undefined, t.id).toBe(true);
  });
});



// ---- the parser, lowering and renderer changes of the round (each with its negative cases) -----------------------------------------------------------------------------

const creatureText = (text: string, extra: Partial<OracleCard> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-replace-5: "you may pay any amount of {R}" (types pay.anyAmount, effects/handlers/pay.ts, render/steps-flow.ts, parser/lower/quantities.ts; CR 118.12, 608.2d)', () => {
  const dies = (pay: string, then: string): OracleCard => creatureText(`When this creature dies, ${pay} When you do, ${then}`);
  it('"that much" after it is the number of times it was paid, for damage and (by the same count) nothing else is guessed', () => {
    expect(isFull(dies('you may pay any amount of {R}.', 'it deals that much damage to any target.'))).toBe(true);
    const f = parseCard(dies('you may pay any amount of {R}.', 'it deals that much damage to any target.'), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('"anyAmount":true');
    expect(JSON.stringify(f.abilities)).toContain('"q":"resultCount"');
    expect(ENGINE_CAPABILITIES.has('op:pay.anyAmount')).toBe(true);
  });
  it('other costs, another payer and other follow-ups are not read: life, an opponent, a fixed damage, "any number of times" stay manual', () => {
    // (life is read since edh-players-16: eff.edhp16.mayPay.anyAmountOfLife; the template of this round stays the mana one)
    expect(isFull(dies('you may pay any amount of life.', 'it deals that much damage to any target.'))).toBe(true);
    expect(isFull(dies('each opponent may pay any amount of {R}.', 'it deals that much damage to any target.'))).toBe(false);
    expect(isFull(dies('you may pay {R} any number of times.', 'it deals that much damage to any target.'))).toBe(false);
  });
  it('the older "up to N times" reading is unchanged (no anyAmount flag)', () => {
    const f = parseCard(creatureText('Whenever this creature attacks, you may pay {1} up to two times. When you do, choose up to that many —\n• Gain — You gain 3 life.\n• Draw — Draw a card.'), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).not.toContain('anyAmount');
    expect(JSON.stringify(f.abilities)).toContain('"upTo":2');
  });
});

describe('edh-replace-5: "... deal damage to your opponents" is one trigger for the whole batch, and "for each opponent dealt damage" counts the opponents (parser/holes/event.ts, parser/holes/qty.ts, render/evt.ts, render/qty.ts; CR 603.2c, 102.3)', () => {
  const t = (what: string, then = 'you create a Treasure token for each opponent dealt damage.'): OracleCard => creatureText(`Whenever one or more Pirates you control deal ${what}, ${then}`);
  it('is read for the creatures of a batch, combat or not; with "to one or more players" the recipient is any player and the count is refused', () => {
    expect(isFull(t('damage to your opponents'))).toBe(true);
    expect(isFull(t('combat damage to your opponents'))).toBe(true);
    const f = parseCard(t('damage to your opponents'), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('wholeBatch');
    expect(JSON.stringify(f.abilities)).toContain('"role":"recipient"');
    expect(isFull(t('damage to one or more players'))).toBe(false); // players include you: "each opponent dealt damage" would count the wrong set
  });
  it('a single creature, "to an opponent" (one trigger for each opponent), another count and a count outside a damage trigger are not read', () => {
    expect(isFull(creatureText('Whenever this creature deals damage to your opponents, you create a Treasure token for each opponent dealt damage.'))).toBe(false);
    expect(isFull(t('damage to your opponents', 'you create two Treasure tokens for each opponent dealt damage.'))).toBe(false);
    expect(isFull(creatureText('Whenever this creature attacks, you create a Treasure token for each opponent dealt damage.'))).toBe(false);
  });
  it('"an opponent" stays one trigger for each opponent (no wholeBatch flag)', () => {
    const f = parseCard(creatureText('Whenever a creature you control deals damage to an opponent, draw a card.'), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).not.toContain('wholeBatch');
  });
});

describe('edh-replace-5: "you\'ve paid or lost four or more {E} this turn" (rules/history.ts sum of counters, model/forms.ts#isTurnEnergySpent, parser/holes/cond.ts, render/cond.ts; CR 107.14, 602.5b)', () => {
  const act = (n: string): OracleCard => creatureText(`{T}: Draw a card. Activate only if you've paid or lost ${n} or more {E} this turn.`);
  it('is an activation restriction only, and a capability of the announcement', () => {
    expect(isFull(act('four'))).toBe(true);
    const f = parseCard(act('four'), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('"sum":"amount"');
    expect(JSON.stringify(f.abilities)).toContain('"change":"removed"');
  });
  it('"exactly", a life count and another player are not this reading', () => {
    expect(isFull(creatureText("{T}: Draw a card. Activate only if you've paid or lost exactly four {E} this turn."))).toBe(false);
    expect(isFull(creatureText("{T}: Draw a card. Activate only if you've paid or lost four or more life this turn."))).toBe(false);
    expect(isFull(creatureText("{T}: Draw a card. Activate only if an opponent has paid or lost four or more {E} this turn."))).toBe(false);
  });
});

describe('edh-replace-5: "if you would get one or more {E}, you get that many plus one {E} instead" (render/evt.ts, render/stat.ts)', () => {
  const rep = (who: string, plus: string, tail = 'instead'): OracleCard => creatureText(`If ${who} would get one or more {E}, ${who === 'you' ? 'you' : 'they'} get that many plus ${plus} {E} ${tail}.`);
  it('is read for you; another player, another amount and a missing "instead" are not', () => {
    expect(isFull(rep('you', 'one'))).toBe(true);
    expect(isFull(rep('an opponent', 'one'))).toBe(false);
    expect(isFull(rep('you', 'two'))).toBe(false);
    expect(isFull(creatureText('If you would get one or more {E}, you get that many plus one {E}.'))).toBe(false);
  });
});

describe('edh-replace-5 review: "any amount" is one mana symbol (render/steps-flow.ts; "that much" counts the payments)', () => {
  const dies = (cost: string): OracleCard => creatureText(`When this creature dies, you may pay any amount of ${cost}. When you do, it deals that much damage to any target.`);
  it('{R} is read; {R}{R}, {2} and {X} are not (they would make "that much" the number of payments, not of mana)', () => {
    expect(isFull(dies('{R}'))).toBe(true);
    expect(isFull(dies('{R}{R}'))).toBe(false);
    expect(isFull(dies('{2}'))).toBe(false);
    expect(isFull(dies('{X}'))).toBe(false);
  });
});
