/**
 * Commander lane edh-top, round edh-top-5: the template data of parser/templates/zz-cloud/edh-top-5.json ("Put a counter on target creature, then goad each creature that had a counter put on it
 * this way", "Each player may put counters on a creature they control. Goad each creature that had counters put on it this way.", "that player gains control of ~, untaps it, and puts a +1/+1 counter
 * on it", "~ attacks each combat if able, can't be sacrificed, and can't attack its owner" (and the planeswalker variant), "~ enters under the control of an opponent of your choice", "Until end of turn,
 * you may play that card, and you may spend mana as though it were mana of any color to cast it") and the round's engine, parser and renderer changes, tested at the end of this file and in
 * edh-top-5-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index
 * when it is present. The behavior is in edh-top-5-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop5 from '../../../src/parser/templates/zz-cloud/edh-top-5.json';
import review from '../../m5/golden/cards/edh-top-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop5 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on
 * one card (of the EDHREC top 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule
 * 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edht5.counters.put.thenGoadPut': ['Spectacular Showdown'],
  'eff.edht5.eachPlayerMayPutCounters.thenGoadPut': ['Agitator Ant'],
  'sta.edht5.obj.mustAttack.cantAttackOwnerOrTheirPlaneswalkers': ['Xantcha, Sleeper Agent'],
  'rep.edht5.self.enters.underOpponentOfYourChoice': ['Xantcha, Sleeper Agent'],
  'eff.edht5.dur.play.obj.anyColor': ['You Find Some Prisoners'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a creature for a triggered ability, a static one or a replacement (the abilities of a permanent), a sorcery for an instruction. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    t.kind === 'static' || /^(whenever|at the beginning)\b/i.test(text.replace(/^[^\n]*\n/, '')) || /^(whenever|at the beginning)\b/i.test(text)
      ? card('Example Plan', 'Creature — Angel', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
      : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-top-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-5.json, path order: after edh-top-4) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-5.json');
    expect(files.indexOf('zz-cloud/edh-top-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples (or one with a second sentence) and two counter-examples, a status, and is of version 8; ids are *.edht5.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht5\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-top-5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bits owner\b/, 'its controller'], [/\bcan't be sacrificed\b/, 'can be sacrificed'], [/\bof your choice\b/, 'of their choice'], [/\bmana of any color\b/, 'mana of any type'], [/\bgoad\b/i, 'untap'],
    [/\bplaneswalkers\b/, 'creatures'], [/\buntaps it\b/, 'taps it'], [/\bthat card\b/, 'those cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-top-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-top-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-top-5 engine, parser and renderer changes (one test each)', () => {
  it('the `may` step of a group has a `gather` field (types/ability.ts; effects/handlers/control.ts#mayHandler): the objects each player\'s run bound together, read by the goad after it; the lint knows the name', () => {
    const ant = parseCard(card('Example Ant', 'Creature — Insect', 'At the beginning of your end step, each player may put two +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way.', { power: '2', toughness: '2' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(ant)).toBe(true);
    expect(JSON.stringify(ant.abilities)).toContain('"gather":"put"');
  });
  it('parser/lower/ability.ts#joinEdhT5: the two sentences are one unit only for the exact pair; another goad sentence stays manual (fail closed)', () => {
    const other = parseCard(card('Example Ant', 'Creature — Insect', 'At the beginning of your end step, each player may put two +1/+1 counters on a creature they control. Goad each creature you control.', { power: '2', toughness: '2' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(JSON.stringify(other.abilities)).not.toContain('"gather"');
  });
  it('render/stat.ts: "under the control of an opponent of your choice" is the words of an `enters` body whose `under` is an opponent chosen by the controller; "under your control" etc. keep their own words', () => {
    const f = parseCard(card('Example Sleeper', 'Creature — Minion', '~ enters under the control of an opponent of your choice.', { power: '2', toughness: '2' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"under":{"ref":"anOpponent"}');
  });
  it('the attack bans on the owner (sta.edht5.obj.mustAttack.*): a ban on its owner alone leaves the owner\'s planeswalkers attackable, the two-part ban does not; neither is read for "its controller"', () => {
    const one = parseCard(card('Example Berserker', 'Creature — Human', "~ attacks each combat if able, can't be sacrificed, and can't attack its owner.", { power: '2', toughness: '2' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(JSON.stringify(one.abilities)).not.toContain('Planeswalker');
    const two = parseCard(card('Example Sleeper', 'Creature — Minion', "~ attacks each combat if able and can't attack its owner or planeswalkers its owner controls.", { power: '2', toughness: '2' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(JSON.stringify(two.abilities)).toContain('Planeswalker');
    const ctrl = parseCard(card('Example Berserker', 'Creature — Human', "~ attacks each combat if able, can't be sacrificed, and can't attack its controller.", { power: '2', toughness: '2' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(ctrl)).toBe(false);
  });
});
