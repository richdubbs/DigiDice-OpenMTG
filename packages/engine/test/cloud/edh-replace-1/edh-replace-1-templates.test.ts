/**
 * edh-replace-1 (Commander lane edh-replace): the template data of parser/templates/zz-cloud/edh-replace-1.json and the parser, lowering and renderer changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-replace-1-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhr1 from '../../../src/parser/templates/zz-cloud/edh-replace-1.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const ER1 = edhr1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-replace-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-replace-1.json, path order: after edh-players-1, before edh-zones-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-replace-1.json');
    expect(files.indexOf('zz-cloud/edh-replace-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-1.json'));
    expect(files.indexOf('zz-cloud/edh-replace-1.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhr1.*', () => {
    for (const t of ER1) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rep)\.edhr1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of ER1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-replace-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of ER1) {
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

describe('edh-replace-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of ER1) {
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

describe('edh-replace-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of ER1) {
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
  'sta.edhr1.damage.double.noncombat.opp.thatPlayerOrPermanent': { full: ['Solphim, Mayhem Dominus'] },
  'rep.edhr1.counters.half.byOpponent.permanentOrPlayer': { full: ['Vorinclex, Monstrous Raider'] },
  'eff.edhr1.prevent.nextSourceOfChoice.you.ifPrevented.damageBack': { full: ['Deflecting Palm'] },
  'eff.edhr1.prevent.combat.toYou.forEachPrevented.create': { full: ['Inkshield'] },
  'sta.edhr1.damage.double.toOpp.anySource': { full: ['Gisela, Blade of Goldnight'] },
  'sta.edhr1.damage.preventHalf.toYouAndYours.roundedUp': { full: ['Gisela, Blade of Goldnight'] },
  'sta.edhr1.damage.preventAllButN.toFilter': { full: ['Temple Altisaur'] },
  'sta.edhr1.damage.combat.double.attached.toPermanentOrPlayer': { full: ['The Sound of Drums'] },
  'sta.edhr1.damage.combat.double.attached': { full: ["Inquisitor's Flail"] },
  'sta.edhr1.damage.combat.double.anotherCreature.toAttached': { full: ["Inquisitor's Flail"] },
};

describe.skipIf(index === null)('edh-replace-1 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-replace-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a pattern with no hole is the rule's own words: its sentence alone is the one line an example can't avoid ("Combat damage can't be prevented."); a lone
    // keyword line ("Reach") is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = ER1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of ER1) expect(REAL[t.id] !== undefined || none[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering and renderer changes of the round (each with its negative cases) -----------------------------------------------------------------------------

const creatureText = (text: string, extra: Partial<OracleCard> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const spellText = (text: string, extra: Partial<OracleCard> = {}): OracleCard => card('Example Volley', 'Instant', text, extra);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-replace-1: "N times X" as a quantity (parser/holes/qty.ts, render/steps-life.ts)', () => {
  const crackle = (text: string): OracleCard => spellText(text, { mana_cost: '{X}{R}' });
  it('"five times X damage to each of up to X targets" and "three times X damage to any target" are read', () => {
    expect(isFull(crackle('Example Volley deals five times X damage to each of up to X targets.'))).toBe(true);
    expect(isFull(crackle('Example Volley deals three times X damage to any target.'))).toBe(true);
  });
  it('twice X keeps its own reading; "once", "two times", "five times" without a quantity and "five times X" with a different recipient list are not read', () => {
    expect(isFull(crackle('Example Volley deals twice X damage to any target.'))).toBe(true);
    expect(isFull(crackle('Example Volley deals five times damage to any target.'))).toBe(false);
    expect(isFull(crackle('Example Volley deals five times X damage to each of up to X other targets.'))).toBe(false);
  });
  it('edh-top-3 (CR 601.2d, 107.3): a divided total that is arithmetic of X is announced with the spell, so "five times X damage divided as you choose" is read', () => {
    expect(isFull(crackle('Example Volley deals five times X damage divided as you choose among any number of targets.'))).toBe(true);
  });
});

describe('edh-replace-1: "if you have exactly N cards in your hand" and "there are N or more counters on it" (parser/holes/cond.ts, render/cond.ts)', () => {
  it('a hand size equal to a number is read only with "exactly"; the counters of any kind on the object are read for "N or more"', () => {
    expect(isFull(creatureText('At the beginning of your upkeep, if you have exactly thirteen cards in your hand, you win the game.'))).toBe(true);
    expect(isFull(creatureText('At the beginning of your upkeep, if you have thirteen cards in your hand, you win the game.'))).toBe(false);
    expect(isFull(creatureText('At the beginning of your upkeep, if an opponent has exactly thirteen cards in hand, you win the game.'))).toBe(false);
    expect(isFull(creatureText('Whenever this creature attacks, you win the game if there are twenty or more counters on it.'))).toBe(true);
    expect(isFull(creatureText('Whenever this creature attacks, you win the game if there are exactly twenty counters on it.'))).toBe(false);
  });
});

describe('edh-replace-1: "prevent all but N of that damage" and "prevent half that damage, rounded up" (render/stat.ts, effects/bodies/m5.ts)', () => {
  it('are read for damage to you / permanents you control (half) and to a described permanent (all but N)', () => {
    expect(isFull(creatureText('If a source would deal damage to you or a permanent you control, prevent half that damage, rounded up.'))).toBe(true);
    expect(isFull(creatureText('If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.'))).toBe(true);
  });
  it('another rounding, a player recipient with "all but", a computed N and a third of the damage are not read', () => {
    expect(isFull(creatureText('If a source would deal damage to you or a permanent you control, prevent half that damage, rounded down.'))).toBe(false);
    expect(isFull(creatureText('If a source would deal damage to you, prevent all but 1 of that damage.'))).toBe(false);
    expect(isFull(creatureText('If a source would deal damage to another Dinosaur you control, prevent all but X of that damage.'))).toBe(false);
    expect(isFull(creatureText('If a source would deal damage to you or a permanent you control, prevent a third of that damage, rounded up.'))).toBe(false);
  });
});

describe('edh-replace-1: "If damage is prevented this way, ~ deals that much damage to that source\'s controller." joins the shield sentence (parser/lower/ability.ts#joinPreventedThisWay)', () => {
  const shield = 'The next time a source of your choice would deal damage to you this turn, prevent that damage.';
  it('"If" joins (the draw version\'s "When" is its own template); any other follow-up sentence stays separate', () => {
    expect(isFull(spellText(`${shield} If damage is prevented this way, ~ deals that much damage to that source's controller.`))).toBe(true);
    expect(isFull(spellText(`${shield} When damage is prevented this way, ~ deals that much damage to that source's controller and you draw that many cards.`))).toBe(true);
    expect(isFull(spellText(`${shield} When damage is prevented this way, ~ deals that much damage to that source's controller.`))).toBe(false);
    expect(isFull(spellText(`${shield} If damage is prevented this way, ~ deals that much damage to any target.`))).toBe(false);
    expect(isFull(spellText(`${shield} If you do, ~ deals that much damage to that source's controller.`))).toBe(false);
  });
  it('Inkshield\'s shape: only "prevent all combat damage that would be dealt to you" joins "For each 1 damage prevented this way"', () => {
    expect(isFull(spellText('Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 1/1 white Spirit creature token with flying.'))).toBe(true);
    expect(isFull(spellText('Prevent all damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 1/1 white Spirit creature token with flying.'))).toBe(false);
    expect(isFull(spellText('Prevent all combat damage that would be dealt to you this turn. For each 2 damage prevented this way, create a 1/1 white Spirit creature token with flying.'))).toBe(false);
  });
});
