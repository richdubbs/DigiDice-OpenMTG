/**
 * p2-player-rules-1 (Phase 2 lane p2-player-rules): the template data of parser/templates/zz-cloud/p2-player-rules-1.json and the statics, untap-step and renderer
 * support it needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does
 * not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in p2-player-rules-1-scenarios.test.ts.
 *
 *   types/ability.ts, core/steps.ts, statics/hooks.ts#untapLimits   rule `untapLimit`: "players can't untap more than N <permanents> during their untap steps" (CR 502.3)
 *   statics/hooks.ts#countFor, model/cap-walk.ts                     `feature:restrict.max.draw`: "can't draw more than one card each turn" (CR 121.1)
 *   statics/hooks.ts#castCountOfKind, model/cap-walk.ts              `feature:restrict.max.cast.other.<field>`: "more than one noncreature spell each turn" (CR 601.2i)
 *   render/stat.ts                                                   the untap limit; a cast limit of a kind; "Your life total can't change" (family life-total-cant-change)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2pr1 from '../../../src/parser/templates/zz-cloud/p2-player-rules-1.json';
import review from '../../m5/golden/cards/p2-player-rules-1-review.json';
import t75Review from '../../m5/golden/cards/fast5-t75-review.json'; // Narset, Parter of Veils: its earlier entry, updated (docs/CARD_AUTOMATION.md section 6)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const P2PR1 = p2pr1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three or more hand-verified golden cards, or, for a wording printed on one or two cards of the tuning half ("Narrow
 * wordings", docs/CARD_AUTOMATION.md section 5), its golden card(s) plus these tests and the played scenarios (a deviation from 6.9 that the round's record names
 * for the owner).
 */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  'sta.p2pr1.lose.cantHave': ['Archetype of Courage', 'Archetype of Endurance', 'Archetype of Finality', 'Archetype of Imagination'],
  'eff.p2pr1.detain': ['Azorius Justiciar', 'Lyev Decree', 'Tax Collector'],
  'eff.p2pr1.dur.costMore.opp': ['Tax Collector'],
  'sta.p2pr1.cantDrawMoreThanOne': ['Spirit of the Labyrinth', 'Narset, Parter of Veils'],
  'sta.p2pr1.untapLimit.players': ['Winter Moon', 'Smoke', 'Stoic Angel', 'Damping Field'],
  'sta.p2pr1.untapLimit.you': ['Mungha Wurm'],
  'sta.p2pr1.untapLimit.asLong': ['Static Orb'],
  'sta.p2pr1.lifeTotalCantChange': ['Platinum Emperion'],
  'sta.p2pr1.cantCastMoreThanOne.filter': ['Deafening Silence', 'Phyrexian Censor'],
};

/** A synthetic card in which an example is an ability of the right kind: a keyword line on an artifact, a triggered ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'ability' || t.kind === 'static') return card('Example Relic', 'Artifact', text);
  if (t.kind === 'effect' && !/^When/.test(text)) return card('Example Edict', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('p2-player-rules-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-player-rules-1.json, after look3.json, before r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-player-rules-1.json');
    expect(files.indexOf('zz-cloud/p2-player-rules-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-player-rules-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.p2pr1.* or eff.p2pr1.*', () => {
    expect(P2PR1.length).toBe(9);
    for (const t of P2PR1) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.p2pr1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings): a stable template has its hand-verified golden card(s); the review pins every card as full', () => {
    const golden = [...review, ...(t75Review as { card: string; verified: string }[]).filter((g) => g.verified.includes('p2-player-rules-1'))] as { card: string; verified: string; expect?: string }[];
    for (const t of P2PR1.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(GOLDEN[t.id] ?? [])].sort());
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of P2PR1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-player-rules-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of P2PR1) {
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
  const out = text.endsWith('.') ? [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`] : [`${text} unless it is blue`, `${text}, and a Wizard`];
  const swaps: [RegExp, string][] = [
    [/\bmore than one\b/, 'more than two'], [/\bmore than two\b/, 'more than one'], [/\buntap steps\b/, 'upkeeps'], [/\buntap step\b/, 'upkeep'], [/\bcan't\b/, 'can'],
    [/\beach turn\b/, 'this turn'], [/\bmore to cast\b/, 'less to cast'], [/\bopponents\b/, 'teammates'], [/\bDetain\b/, 'Goad'], [/\bis untapped\b/, 'is tapped'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-player-rules-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of P2PR1) {
    it(`${t.id}: an appended rider or a swapped key word never gives the example's JSON`, () => {
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

describe('p2-player-rules-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of P2PR1) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('p2-player-rules-1 statics, untap step and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Relic', type, text), OPTS).faces[0]!;
  const effects = (text: string): string => JSON.stringify(face('Artifact', text).abilities);
  it('CR 502.3: the untap limit names whose untap steps, the number and the permanents it counts; another player or a computed number is no reading', () => {
    expect(effects("Players can't untap more than one artifact creature during their untap steps.")).toContain('"rule":"untapLimit","player":{"ref":"each","who":"player"},"value":1,"of":{"allTypes":["Artifact","Creature"]}');
    expect(effects("You can't untap more than two Forests during your untap step.")).toContain('"player":{"ref":"you"},"value":2');
    expect(fullyAutomated(face('Artifact', "Target player can't untap more than one land during their untap steps."))).toBe(false);
    expect(fullyAutomated(face('Artifact', "Each player can't untap more than one land during their untap steps."))).toBe(false);
    expect(fullyAutomated(face('Artifact', "Players can't untap more than X lands during their untap steps."))).toBe(false);
  });
  it('CR 121.1: a draw limit is `feature:restrict.max.draw`; a limit of two is no reading', () => {
    expect(effects("Each player can't draw more than one card each turn.")).toContain('"action":"draw","max":1');
    expect(ENGINE_CAPABILITIES.has('feature:restrict.max.draw')).toBe(true);
    expect(fullyAutomated(face('Artifact', "Each player can't draw more than two cards each turn."))).toBe(false);
  });
  it('CR 601.2i: a cast limit of a kind is full only for the spell fields the cast history keeps (a mana value is not one: fail closed); a plain limit keeps its template', () => {
    expect(effects("Each player can't cast more than one noncreature spell each turn.")).toContain('"other":{"notTypes":["Creature"]');
    expect(face('Artifact', "Each player can't cast more than one spell each turn.").templatesUsed).toContain('sta.t24.player.cast.max1');
    const mv = compileCard(card('Example Relic', 'Artifact', "Each player can't cast more than one spell with mana value 2 or less each turn."));
    expect(mv.automation.level).not.toBe('full');
    expect(JSON.stringify(mv.automation)).toContain('feature:restrict.max.cast.other.manaValue');
    expect(compileCard(card('Example Relic', 'Artifact', "Each player can't cast more than one noncreature spell each turn.")).automation.level).toBe('full');
  });
  it('CR 119.7, 119.8 (family life-total-cant-change): "Your life total can\'t change" is the two restrictions of you; another player\'s is no reading', () => {
    expect(effects("Your life total can't change.")).toContain('"action":"gainLife"');
    expect(effects("Your life total can't change.")).toContain('"action":"loseLife"');
    expect(fullyAutomated(face('Artifact', "Each opponent's life total can't change."))).toBe(false);
  });
  it('CR 701.35a, 611.2c: detain reads only targets: "detain each <permanents>" is no reading (a resolved restriction over a description stays live, so it would detain permanents that arrive later)', () => {
    expect(fullyAutomated(parseCard(card('Example Edict', 'Sorcery', 'Detain each creature your opponents control.'), OPTS).faces[0]!)).toBe(false);
    expect(fullyAutomated(parseCard(card('Example Edict', 'Sorcery', 'Detain target artifact.'), OPTS).faces[0]!)).toBe(true);
  });
  it('CR 613.1f: "lose K and can\'t have or gain K" is one layer 6 modification removing K and refusing it', () => {
    expect(effects("Elves your opponents control lose trample and can't have or gain trample.")).toContain('"layer":6,"remove":["trample"],"cantHave":["trample"]');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-player-rules-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-player-rules-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const [name, text] of [[c.name, c.oracle_text], ...(c.card_faces ?? []).map((x) => [x.name, x.oracle_text])] as [string, string | undefined][]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = P2PR1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    ...GOLDEN,
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read their line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const p = parseCard(c!, OPTS);
        expect(p.faces.some((f) => f.templatesUsed.includes(id)), `${name}: ${p.faces.map((f) => f.templatesUsed.join(',')).join(' | ')}`).toBe(true);
        for (const f of p.faces) {
          expect(fullyAutomated(f), `${name}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
          expect(f.gate.every((g) => g.ok), name).toBe(true);
        }
      }
    }, 60_000);
  }
});
