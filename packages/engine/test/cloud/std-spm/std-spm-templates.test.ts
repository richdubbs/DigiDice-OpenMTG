/**
 * Cloud batch 2, slice std-spm (the Standard backlog of Marvel's Spider-Man, tuning half): the template data of parser/templates/zz-cloud/std-spm.json and the
 * hole, lowering, renderer and engine support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact
 * render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word
 * of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present, and
 * each stable template has hand-verified golden cards (test/m5/golden/cards/cloud-std-spm-review.json, design 6.9). The behavior is in
 * std-spm-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdSpm from '../../../src/parser/templates/zz-cloud/std-spm.json';
import review from '../../m5/golden/cards/cloud-std-spm-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const SPM = stdSpm as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
/**
 * The stable templates read only by PARTIAL real cards (their other sentences): their evidence is the try step on those cards below and the scenario tests.
 * Line merge (std-blb + std-spm): std-spm's `eff.stdspm.look.cardsFromTop` was the same template as std-blb's `eff.stdblb.look.nFromTop` (same pattern, same
 * build); the one kept is std-blb's, which also holds std-spm's examples and counter-examples, so std-spm has none left here.
 */
const PARTIAL_ONLY: ReadonlySet<string> = new Set<string>();

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if ((t.kind === 'effect' || t.kind === 'rider') && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Spider Hero', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
/** Fully automated, and no manual cost part either (a cost the model cannot state is a `{kind:'manual'}` part, which `fullyAutomated` does not look for). */
const fullSpm = (f: ReturnType<typeof parsedWith>): boolean => fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"');
/** The counter kind is any word before "counters" (the CounterKind hole takes unlisted words, as every counter template of the set does): not a word G2 replaces. */
const COUNTER_WORD = /^[+-]\d+\/[+-]\d+$/;

describe('std-spm template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-spm.json, after trigger.json and zz-cloud/std-otj.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-spm.json');
    expect(files.indexOf('zz-cloud/std-spm.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-spm.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-otj.json'));
    expect(files.indexOf('zz-cloud/std-spm.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff/sta/trg/rid.stdspm.*', () => {
    expect(SPM.length).toBe(17); // 18 written; the look-from-the-top one is std-blb's eff.stdblb.look.nFromTop (line merge)
    for (const t of SPM) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta|rid)\.stdspm\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
    // p2-promote-1: the two templates no card of the corpus read then are stable on the cards that print them (6.9 narrow wordings: Disciple of Freyalise and
    // Nyla, Shirshu Sleuth; Gloom Surgeon; golden in cloud-std-spm-review.json)
    expect(SPM.filter((t) => t.status === 'experimental').map((t) => t.id).sort()).toEqual([]);
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards that name it; every golden card is pinned full', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of SPM.filter((x) => x.status === 'stable' && !PARTIAL_ONLY.has(x.id))) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id},`) || g.verified.includes(` ${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of SPM) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'double']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-spm guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of SPM) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, `${e.text}: ${f.templatesUsed.join(', ')}`).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (t.status === 'stable') expect(fullSpm(f), e.text).toBe(true);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bcolorless\b/, 'blue'], [/\bgains\b/, 'loses'], [/\beach kind of counter\b/, 'each +1/+1 counter'],
    [/\bmay discard\b/, 'discard'], [/\bdoesn't\b/, 'does'], [/\bgraveyards\b/, 'libraries'], [/\bfrom a graveyard\b/, 'from exile'], [/\bfrom the top\b/, 'from the bottom'],
    [/\bwhere X is\b/, 'where Y is'], [/\bconnive\b/, 'explore'], [/\blife totals\b/, 'hands'], [/\bprevent that damage and\b/, 'prevent that damage or'],
    [/\bdamage would be dealt to\b/, 'damage would be dealt by'], [/\bcan't be\b/, 'can be'], [/\bSpells and abilities\b/, 'Spells'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-spm guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of SPM) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-spm guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of SPM) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w) || w.includes('\n') || COUNTER_WORD.test(w)) return;
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullSpm(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-spm design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no std-spm example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = SPM.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdspm.becomes.artifactcreature.basept.trail': ['Living Brain, Mechanical Marvel', 'Skilled Animator', "Unctus's Retrofitter", 'Yotia Declares War'],
    'eff.stdspm.becomes.colorless': ['Raging Spirit', 'Ancient Kavu'],
    'eff.stdspm.gains.becomes.colorless': ['Miles Morales // Ultimate Spider-Man'],
    'eff.stdspm.counters.double.eachKind': ['Miles Morales // Ultimate Spider-Man', 'Vorel of the Hull Clade', 'Gilder Bairn', 'Ferrafor, Young Yew', 'The First Tyrannic War'],
    'sta.stdspm.damage.unpreventable': ['Spider-Punk', 'Leyline of Punishment', 'Sunspine Lynx'],
    'sta.stdspm.spellsAndAbilities.cantcounter': ['Spider-Punk'],
    'eff.stdspm.eachMay.discard': ['The Death of Gwen Stacy'],
    'rid.stdspm.eachWhoDoesnt.loseLife': ['The Death of Gwen Stacy'],
    'eff.stdspm.exile.graveyards.targetPlayers': ['The Death of Gwen Stacy', 'Thraben Charm', 'Stonespeaker Crystal'],
    'trg.stdspm.enters.fromGraveyard': ['Triarch Praetorian', 'Canoptek Tomb Sentinel', 'Oscorp Industries'],
    // line merge: std-spm's eff.stdspm.look.cardsFromTop is std-blb's eff.stdblb.look.nFromTop (one template kept); these cards read the line with it
    'eff.stdblb.look.nFromTop': ['Symbiote Spider-Man', "Garruk's Harbinger", 'Doomskar Warrior', 'Stargaze'],
    'eff.stdspm.if.compound.whereX.then': ['Eddie Brock // Venom, Lethal Protector'],
    'eff.stdspm.mayHave.connive': ['Baron Strucker, HYDRA Overlord'],
    'eff.stdspm.exchange.lifeTotals.with': ['Mister Negative', 'Magus of the Mirror', 'Mirror Universe'],
    'sta.stdspm.damageToSelf.prevent.then': ['Anti-Venom, Horrifying Healer'],
    'sta.stdspm.damageToYou.prevent.then': ['Angel of Suffering'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it and pass the render gate`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        expect(compileCard(oracle!).automation.level, name).not.toBe('manual');
      }
    }, 60_000);
  }
});
