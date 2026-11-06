/**
 * edh-players-4 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-4.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-4-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp4 from '../../../src/parser/templates/zz-cloud/edh-players-4.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP4 = edhp4 as Template[];
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

describe('edh-players-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-4.json, path order: after edh-players-2, before edh-replace-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-4.json');
    expect(files.indexOf('zz-cloud/edh-players-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-2.json'));
    expect(files.indexOf('zz-cloud/edh-players-4.json')).toBeLessThan(files.indexOf('zz-cloud/edh-replace-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp4.*', () => {
    for (const t of EP4) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP4) {
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

describe('edh-players-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP4) {
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

describe('edh-players-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP4) {
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
  'eff.edhp4.untapAll.gainControl.them': { full: ['Insurrection'] },
  'eff.edhp4.player.mayHave.youDraw': { full: ['Combustible Gearhulk', 'Palantír of Orthanc'] },
  'eff.edhp4.becomes.color.andGains': { full: ['Crimson Wisps'] },
  'eff.edhp4.draw.nAdditional': { full: ['Font of Mythos'] },
  'eff.edhp4.draw.nAdditional.you': { full: ['Sylvan Library'] }, // edh-players-7 made it full (and promoted the template on it)
  'eff.edhp4.sacrificeChoice.andGetsCounters': { full: ["Vraska's Fall"] },
  'eff.edhp4.target.attack.nodefender': { full: ['Assault Formation'] },
};

describe.skipIf(index === null)('edh-players-4 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP4) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, opts: { cost?: string } = {}): OracleCard => card('Example Volley', 'Sorcery', text, opts.cost !== undefined ? { mana_cost: opts.cost } : {});
const creature = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const artifact = (text: string): OracleCard => card('Example Relic', 'Artifact', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-4: "that creature" names what a sacrifice of yours sacrificed (parser/lower/mentions.ts, Mention.demonstrative; template cmd5 names it)', () => {
  it('"Sacrifice another creature. You gain X life and draw X cards, where X is that creature\'s power." is read, and says its X back', () => {
    expect(isFull(creature("When this creature enters, sacrifice another creature. You gain X life and draw X cards, where X is that creature's power."))).toBe(true);
    expect(isFull(creature("When this creature enters, sacrifice another creature. You gain X life and draw X cards, where X is that creature's toughness."))).toBe(true);
  });
  it('a count other than one is not read', () => {
    expect(isFull(creature("When this creature enters, sacrifice two other creatures. You gain X life and draw X cards, where X is that creature's power."))).toBe(false);
  });
});

describe('edh-players-4: "they" after "untap all ..." (model/focus.ts#focusEffect: a group a tap or untap worked on)', () => {
  it('"Untap all attacking creatures. They gain first strike until end of turn." is read in an attack trigger, where the attackers are another plural group', () => {
    expect(isFull(creature('Whenever you attack, untap all attacking creatures. They gain first strike until end of turn.'))).toBe(true);
    expect(isFull(creature('Whenever you attack, tap all creatures your opponents control. They gain first strike until end of turn.'))).toBe(true); // a tap names its group too (effects/handlers/zones-status.ts binds every object)
  });
  it('a pronoun for an object other than the group stays as it was (no focus on a single untapped object)', () => {
    expect(isFull(creature('Whenever you attack, untap target creature you control. It gains first strike until end of turn.'))).toBe(true);
    expect(isFull(creature('Whenever you attack, untap all attacking creatures. It gains first strike until end of turn.'))).toBe(false);
  });
});

describe('edh-players-4: "those cards" names the cards a mill milled (Mention.demonstrative, render/qty.ts)', () => {
  it('"you mill three cards, then ~ deals damage to target opponent equal to the total mana value of those cards" is read', () => {
    expect(isFull(creature('When this creature enters, you mill three cards, then this creature deals damage to target opponent equal to the total mana value of those cards.'))).toBe(true);
    expect(isFull(creature('When this creature enters, mill three cards. You gain life equal to the total power of those cards.'))).toBe(true);
  });
  it('a bare "they" after a mill still names no milled card, and "those lands" is not a card noun of the mill', () => {
    expect(isFull(creature('When this creature enters, mill three cards. You gain life equal to the total mana value of them.'))).toBe(false);
    expect(isFull(creature('When this creature enters, mill three cards. You gain life equal to the total mana value of those lands.'))).toBe(false);
  });
});

describe('edh-players-4: "At the beginning of your end step, ... that player" names the target, not the active player (parser/lower/scope.ts)', () => {
  it('Palantir-style: a target opponent\'s option, then "that player loses life" after a mill with a where-X clause', () => {
    const t = (tail: string): OracleCard => artifact(`At the beginning of your end step, target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of cards in your hand, ${tail}`);
    expect(isFull(t('and that player loses life equal to the total mana value of those cards.'))).toBe(true);
    expect(isFull(t('and that player gains life equal to the total mana value of those cards.'))).toBe(true);
  });
  it('at the beginning of EACH player\'s end step "that player" is the active player and the target is a second candidate (manual)', () => {
    expect(isFull(artifact("At the beginning of each player's end step, target opponent may have you draw a card. If that player doesn't, that player loses 1 life."))).toBe(false);
  });
});

describe('edh-players-4: "draws N additional cards" at the beginning of a draw step (render/steps-cards.ts, family additional-card)', () => {
  it('is read only in a draw-step trigger: elsewhere "additional" would not be the same instruction (fails closed)', () => {
    expect(isFull(artifact("At the beginning of each opponent's draw step, that player draws two additional cards."))).toBe(true);
    expect(isFull(artifact('At the beginning of your upkeep, draw two additional cards.'))).toBe(false);
    expect(isFull(spell('Draw two additional cards.'))).toBe(false);
  });
});

describe('edh-players-4: "two times X" is twice X (parser/holes/qty.ts, render/steps-util.ts, family twice-x)', () => {
  it('is read for a life loss; the sentence "loses two times X life" says itself back', () => {
    expect(isFull(spell('Each opponent loses two times X life.', { cost: '{X}{B}' }))).toBe(true);
    expect(isFull(spell('Each opponent loses two time X life.', { cost: '{X}{B}' }))).toBe(false);
  });
});
