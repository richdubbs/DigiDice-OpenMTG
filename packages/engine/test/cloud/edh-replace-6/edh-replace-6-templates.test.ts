/**
 * edh-replace-6 (Commander lane edh-replace): the template data of parser/templates/zz-cloud/edh-replace-6.json and the parser, lowering and renderer changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-replace-6-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhr6 from '../../../src/parser/templates/zz-cloud/edh-replace-6.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const ER6 = edhr6 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-replace-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-replace-6.json, path order: after edh-replace-5, before edh-top-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-replace-6.json');
    expect(files.indexOf('zz-cloud/edh-replace-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-replace-5.json'));
    expect(files.indexOf('zz-cloud/edh-replace-6.json')).toBeLessThan(files.indexOf('zz-cloud/edh-top-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhr6.*', () => {
    for (const t of ER6) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rep)\.edhr6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of ER6) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-replace-6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of ER6) {
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

describe('edh-replace-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of ER6) {
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

describe('edh-replace-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of ER6) {
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
  'eff.edhr6.transform.each': { full: ['Moonmist'] },
  'rep.edhr6.draw.while.instead.returnCreatureOrLose': { full: ['Out of the Tombs'] },
  'eff.edhr6.prevent.all.to.them.dur': { full: ['Mutational Advantage'] },
  'sta.edhr6.triggerMod.dealingCombatDamage': { full: ['Felix Five-Boots'] },
};

describe.skipIf(index === null)('edh-replace-6 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-replace-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = ER6.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of ER6) expect(REAL[t.id] !== undefined || none[t.id] !== undefined, t.id).toBe(true);
  });
});




// ---- the parser, lowering and renderer changes of the round (each with its negative cases) -----------------------------------------------------------------------------

const creatureText = (text: string, extra: Partial<OracleCard> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const spellText = (text: string): OracleCard => card('Example Volley', 'Instant', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-replace-6: "protection from Ring-bearers" (rules/quality.ts `ringBearer`, parser/holes/misc.ts, render/kw.ts, statics/layers.ts; CR 701.54e, 702.16a)', () => {
  const grant = (q: string): OracleCard => creatureText(`Wraiths you control have protection from ${q}.`);
  it('is read for Ring-bearers (one quality) and refused for near-misses: a Ring-bearer in the singular, "your Ring-bearer", "the Ring"', () => {
    expect(isFull(grant('Ring-bearers'))).toBe(true);
    expect(JSON.stringify(parseCard(grant('Ring-bearers'), OPTS).faces[0]!.abilities)).toContain('"quality":"ringBearer"');
    expect(isFull(grant('a Ring-bearer'))).toBe(false);
    expect(isFull(grant('your Ring-bearer'))).toBe(false);
    expect(isFull(grant('the Ring'))).toBe(false);
  });
  it('hexproof from Ring-bearers is the same quality', () => {
    expect(JSON.stringify(parseCard(creatureText('Wraiths you control have hexproof from Ring-bearers.'), OPTS).faces[0]!.abilities)).toContain('"quality":"ringBearer"');
  });
});

describe('edh-replace-6: "creatures other than Werewolves and Wolves" (parser/holes/filter.ts#exceptForList, render/np.ts; CR 205.3m)', () => {
  const prevent = (kinds: string): OracleCard => spellText(`Prevent all combat damage that would be dealt this turn by creatures other than ${kinds}.`);
  it('two or more plain kinds are the negated kinds; one kind, a non-plain kind and a different joiner are not read', () => {
    expect(isFull(prevent('Werewolves and Wolves'))).toBe(true);
    const json = JSON.stringify(parseCard(prevent('Werewolves and Wolves'), OPTS).faces[0]!.abilities);
    expect(json).toContain('"notSubtypes":["Werewolf","Wolf"]');
    expect(isFull(spellText('Destroy all creatures other than Elves, Wolves, and Goblins.'))).toBe(true);
    expect(isFull(prevent('Wolves'))).toBe(false); // one kind: not read here (fails closed; the renderer says "non-Wolf creatures")
    expect(isFull(prevent('Werewolves with flying'))).toBe(false);
    expect(isFull(prevent('Werewolves or Wolves'))).toBe(false); // the renderer says "and": the render gate refuses the "or" wording (fail closed)
  });
  it('"other" alone and "other than" a single named card are not a kinds list', () => {
    expect(isFull(spellText('Destroy all other creatures.'))).toBe(false);
    expect(isFull(spellText('Destroy all creatures other than target creature.'))).toBe(false);
  });
});

describe('edh-replace-6: "Transform all Humans." (eff.edhr6.transform.each; CR 701.27a, 701.27c)', () => {
  it('is read for a described group; targets and conditions are not this template', () => {
    expect(isFull(spellText('Transform all Werewolves you control.'))).toBe(true);
    expect(isFull(spellText('Transform each creature you control.'))).toBe(true);
    expect(JSON.stringify(parseCard(spellText('Transform target Werewolf.'), OPTS).faces[0]!.abilities)).not.toContain('"ref":"each"'); // a target is the older template\'s
  });
});

describe('edh-replace-6: a grant to a group whose description can change names its locked set (model/focus.ts#lockedGroup, parser/lower/mentions.ts, render/steps-lasting.ts; CR 611.2c, 608.2c)', () => {
  it('"those creatures" / "them" after a grant to creatures with counters is the group bound under the grant step\'s name; a static description keeps the description read again (grantedGroup, unchanged)', () => {
    const counters = parseCard(spellText('Creatures you control with counters on them gain hexproof until end of turn. Prevent all damage that would be dealt to those creatures this turn.'), OPTS).faces[0]!;
    expect(JSON.stringify(counters.abilities)).toContain('"ref":"bound"');
    expect(counters.gate.every((g) => g.ok)).toBe(true);
    const plain = parseCard(spellText('Creatures you control gain hexproof until end of turn. Untap them.'), OPTS).faces[0]!;
    expect(JSON.stringify(plain.abilities)).not.toContain('"ref":"bound"'); // the description again (FAST5 T76), not a name
  });
  it('a pump (layer 7c) names its locked set too; a change of the description by the effect itself (control, types) is not read', () => {
    expect(isFull(spellText('Creatures you control with counters on them get +1/+1 until end of turn. Prevent all damage that would be dealt to them this turn.'))).toBe(true);
    expect(isFull(spellText('Creatures you control with counters on them become artifacts until end of turn. Prevent all damage that would be dealt to them this turn.'))).toBe(false);
  });
  it('without a grant before it, "those creatures" stays manual', () => {
    expect(isFull(spellText('Prevent all damage that would be dealt to those creatures this turn.'))).toBe(false);
  });
});

describe('edh-replace-6: "if you can\'t, you lose the game" after a replacement that returns a creature card (CR 608.2d, 614.1a)', () => {
  const rep = (cond: string, kind = 'creature', tail = "If you can't, you lose the game."): OracleCard => card('Example Crypt', 'Enchantment', `If you would draw a card while ${cond}, instead return a ${kind} card from your graveyard to the battlefield. ${tail}`);
  it('is read with a condition; a land card, a different tail and no tail are not this template', () => {
    expect(isFull(rep('your library has no cards in it'))).toBe(true);
    expect(isFull(rep('you control a Wizard'))).toBe(true);
    expect(isFull(rep('your library has no cards in it', 'land'))).toBe(false);
    expect(isFull(rep('your library has no cards in it', 'creature', "If you can't, you win the game."))).toBe(false);
  });
});

describe('edh-replace-6: "a creature you control dealing combat damage to a player" as the cause of an additional trigger (model/cap-walk.ts, triggers/collect.ts, render/stat.ts; CR 603.2d, 510.2)', () => {
  const mod = (cause: string): OracleCard => card('Example Echo', 'Enchantment', `If ${cause} causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.`);
  it('is read for combat damage to a player; noncombat damage, damage to a creature and a damage count are not', () => {
    expect(isFull(mod('a creature you control dealing combat damage to a player'))).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:triggerMod.damage')).toBe(true);
    expect(isFull(mod('a creature you control dealing damage to a player'))).toBe(false);
    expect(isFull(mod('a creature you control dealing combat damage to a creature'))).toBe(false);
    expect(isFull(mod('a creature you control dealing combat damage to an opponent'))).toBe(false);
  });
});
