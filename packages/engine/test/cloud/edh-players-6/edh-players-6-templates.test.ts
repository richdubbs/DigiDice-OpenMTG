/**
 * edh-players-6 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-6.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-6-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp6 from '../../../src/parser/templates/zz-cloud/edh-players-6.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP6 = edhp6 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  // a ~ that "is still a land" is a land (the rider's type word is the object's own)
  if (/\bstill a land\b/.test(text) && text.includes('~')) return card('Example Nexus', 'Land', text);
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-players-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-6.json, path order: after edh-players-4, before edh-replace-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-6.json');
    expect(files.indexOf('zz-cloud/edh-players-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-4.json'));
    expect(files.indexOf('zz-cloud/edh-players-6.json')).toBeLessThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp6.*', () => {
    for (const t of EP6) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP6) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP6) {
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

describe('edh-players-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP6) {
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

describe('edh-players-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP6) {
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

/** The real cards that print each template's sentence and read it with the template: FULL ones are fully automated. */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'sta.edhp6.loyalty.twiceEachTurn': { full: ['Oath of Teferi'] },
  'eff.edhp6.loyalty.onceMoreEach': { full: ['The Chain Veil'] },
  'sta.edhp6.loyalty.cantActivate': { full: ['The Immortal Sun'] },
  'eff.edhp6.draw.anAdditionalCard': { full: ['The Immortal Sun'] },
  'eff.edhp6.eachOpponent.mill.equalHand': { full: ['Folio of Fancies'] },
  'eff.edhp6.eachOpponent.loseLife.forEachInTheirGraveyard': { full: ['One Ring to Rule Them All'] },
  'eff.edhp6.damage.eachOpponent.thatOpponentControls': { full: ['Mjölnir, Storm Hammer'] },
  'eff.edhp6.mayPay.x.atMostLifeGained': { full: ['Well of Lost Dreams'] },
  'eff.edhp6.eachOpponent.mayDiscard.elseLoseLife': { full: ['Professor Onyx'] },
  'eff.edhp6.eachOpponent.maySacrifice.whoDoesnt.loseLifeForEach': { full: ['Fandaniel, Telophoroi Ascian'] },
  'eff.edhp6.sacrifice.eachOpponentMaySameType': { full: ['Braids, Arisen Nightmare'] },
  'sta.edhp6.maxhand.eachOpponent.reduced': { full: ['Jin-Gitaxias, Core Augur'] },
};

describe.skipIf(index === null)('edh-players-6 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP6.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
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
  it('every template of the file has its real cards listed', () => {
    for (const t of EP6) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string): OracleCard => card('Example Volley', 'Sorcery', text);
const creature = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const artifact = (text: string): OracleCard => card('Example Relic', 'Artifact', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-6: "if you didn\'t activate a loyalty ability of a planeswalker this turn" (parser/holes/cond.ts#e22History, render/cond.ts)', () => {
  const t = (cond: string): OracleCard => artifact(`At the beginning of your end step, if ${cond}, you lose 2 life.`);
  it('is read in its four wordings, and says itself back', () => {
    for (const c of ["you didn't activate a loyalty ability of a planeswalker this turn", "you didn't activate a loyalty ability this turn", "you haven't activated a loyalty ability this turn",
      "you haven't activated a loyalty ability of a planeswalker this turn"]) expect(isFull(t(c)), c).toBe(true);
  });
  it('another kind of ability, another player, or another time is not read', () => {
    for (const c of ["you didn't activate an exhaust ability this turn", "an opponent didn't activate a loyalty ability this turn", "you didn't activate a loyalty ability last turn",
      "you didn't activate a loyalty ability of a creature this turn"]) expect(isFull(t(c)), c).toBe(false);
  });
});

describe('edh-players-6: loyalty abilities in rules text (render/stat.ts: families loyalty-abilities-cant-activate, loyalty-twice-each-turn)', () => {
  it('"twice each turn rather than only once" names the loyalty abilities of a group and never another count, kind of ability or player', () => {
    expect(isFull(artifact('You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once.'))).toBe(true);
    expect(isFull(artifact('You may activate the loyalty abilities of planeswalkers you control three times each turn rather than only once.'))).toBe(false);
    expect(isFull(artifact('You may activate the exhaust abilities of creatures you control twice each turn rather than only once.'))).toBe(false);
  });
  it('"Players can\'t activate planeswalkers\' loyalty abilities" is the ban on every loyalty ability, not on other abilities or on one player\'s', () => {
    expect(isFull(artifact("Players can't activate planeswalkers' loyalty abilities."))).toBe(true);
    expect(isFull(artifact("Players can't activate planeswalkers' mana abilities."))).toBe(false);
    expect(isFull(artifact("Your opponents can't activate planeswalkers' loyalty abilities."))).toBe(false);
  });
});

describe('edh-players-6: one pronoun per opponent in a quantity (templates with the folds of render/fold-edhp6.ts)', () => {
  it('"each opponent mills cards equal to the number of cards in their hand" is read with the opponents\' own hands; "your hand" is not that', () => {
    expect(isFull(spell('Each opponent mills cards equal to the number of cards in their hand.'))).toBe(true);
    expect(isFull(spell('Each opponent mills cards equal to the number of cards in your hand.'))).toBe(true); // the plain reading of another template: a count of YOUR hand
  });
  it('"each opponent loses N life for each <type> card in that player\'s graveyard" says one card type back, and nothing else', () => {
    expect(isFull(spell("Each opponent loses 2 life for each creature card in that player's graveyard."))).toBe(true);
    expect(isFull(spell("Each opponent loses 2 life for each creature card in that player's hand."))).toBe(true); // edh-players-12: each opponent's own hand, read for each in turn
    // edh-players-12 (parser/lower/anaphora.ts#groupChooser): "that player" of each player's own amount is that player in turn: read now (still never an opponent's graveyard counted for another player)
    expect(isFull(spell("Each player loses 2 life for each creature card in that player's graveyard."))).toBe(true);
  });
  it('"~ deals damage to each opponent equal to the number of <objects> that opponent controls" is said with "that opponent"', () => {
    expect(isFull(spell('Example Volley deals damage to each opponent equal to the number of tapped creatures that opponent controls.'))).toBe(true);
    expect(isFull(spell('Example Volley deals damage to each opponent equal to the number of tapped creatures you control.'))).toBe(true); // the plain reading of another template
  });
});

describe('edh-players-6: "draw an additional card" (render/steps-cards.ts, family additional-card)', () => {
  it('is read in a draw-step trigger only; elsewhere "additional" would not be the same instruction (fails closed)', () => {
    expect(isFull(artifact('At the beginning of your draw step, draw an additional card.'))).toBe(true);
    expect(isFull(artifact('At the beginning of your upkeep, draw an additional card.'))).toBe(false);
  });
});

describe('edh-players-6: "you may pay X life, where X is <a number>. If you do, draw X cards." (render/steps-flow.ts#payLifeWhereX, family pay-x-life-where-x)', () => {
  const t = (tail: string): OracleCard => creature(`When this creature dies, you may pay X life, where X is its power. If you do, ${tail}`);
  it('is said back for the same number paid and drawn; another instruction after "If you do" is not that wording (fails closed)', () => {
    expect(isFull(t('draw X cards.'))).toBe(true);
    expect(isFull(t('you gain X life.'))).toBe(false);
  });
  it('a payment by another player, or of mana, is not that wording', () => {
    expect(isFull(creature('When this creature dies, target opponent may pay X life, where X is its power. If they do, draw X cards.'))).toBe(false);
  });
});

describe('edh-players-6: "you may pay {X}, where X is less than or equal to the amount of life you gained" (pay.xMax; render/steps-flow.ts#payClause)', () => {
  const t = (trigger: string): OracleCard => artifact(`${trigger}, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.`);
  it('is read in a lifegain trigger only: the amount is that trigger\'s (fails closed anywhere else)', () => {
    expect(isFull(t('Whenever you gain life'))).toBe(true);
    expect(isFull(t('Whenever you cast a spell'))).toBe(false);
    expect(isFull(t('At the beginning of your upkeep'))).toBe(false);
  });
});

describe('edh-players-6: "as long as it attacked this turn" (parser/holes/cond.ts#history, render/cond.ts, family it-attacked-this-turn)', () => {
  it('is read for the object itself (effect first, as Oracle prints it), and only this turn', () => {
    expect(isFull(creature('This creature has flying as long as it attacked this turn.'))).toBe(true);
    expect(isFull(creature('This creature has flying as long as it attacked last turn.'))).toBe(false);
    expect(isFull(creature('This creature has flying as long as it blocked this turn.'))).toBe(false);
    expect(isFull(creature('This creature has flying as long as another creature attacked this turn.'))).toBe(false);
  });
});

describe('edh-players-6: each opponent in turn may do something; each who does not loses life (lower/ability.ts#joinGroupMayElse, render/fold-edhp6.ts)', () => {
  it('"If they don\'t," and "Each opponent who doesn\'t" after "Each opponent may ..." are one instruction with it; a single player or another follow-up is not', () => {
    expect(isFull(spell("Each opponent may discard a card. If they don't, they lose 3 life."))).toBe(true);
    expect(isFull(spell("Each opponent may discard a card. Each opponent who doesn't loses 3 life."))).toBe(true);
    expect(isFull(spell("Each opponent may discard a card. If they do, they lose 3 life."))).toBe(false);
    expect(isFull(spell("Each opponent may discard a card. If you don't, they lose 3 life."))).toBe(false);
    expect(isFull(spell("Target opponent may discard a card. Each opponent who doesn't loses 3 life."))).toBe(false);
  });
  it('a loss counted for each card of a description reads the controller\'s own graveyard', () => {
    expect(isFull(spell("Each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn't loses 2 life for each instant and sorcery card in your graveyard."))).toBe(true);
    expect(isFull(spell("Each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn't loses 2 life for each instant and sorcery card in their graveyard."))).toBe(false);
  });
});
